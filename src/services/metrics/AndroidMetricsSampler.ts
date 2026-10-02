import {
  AndroidReading,
  androidSample,
  androidSampleCommand,
  isSafePackage,
  parseAndroidReading,
  parseForegroundPackage,
} from './androidMetrics';
import {
  FOREGROUND_REFRESH_MS,
  MAX_CONSECUTIVE_FAILURES,
  MetricsSampler,
  SAMPLE_INTERVAL_MS,
  SamplerHooks,
} from './types';

export interface AndroidSamplerOptions {
  /** Runs a command in the phone's shell (the resolved adb) and returns its output. */
  shell: (command: string) => Promise<string>;
  /** The session's appPackage capability; anything but a package name is ignored. */
  appPackage: unknown;
  hooks: SamplerHooks;
  now?: () => number;
}

/**
 * Samples an Android phone every SAMPLE_INTERVAL_MS with one `adb shell`
 * call. The app is the session's package, else the app in the foreground.
 * Samples never overlap: the next is scheduled when one finishes.
 */
export class AndroidMetricsSampler implements MetricsSampler {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private prev: AndroidReading | null = null;
  private failures = 0;
  private foreground: { pkg: string | null; at: number } | null = null;
  private readonly pkg: string | null;

  constructor(private readonly opts: AndroidSamplerOptions) {
    this.pkg = isSafePackage(opts.appPackage) ? opts.appPackage : null;
  }

  start(): void {
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.sample().finally(() => this.schedule(SAMPLE_INTERVAL_MS));
    }, delay);
    this.timer.unref?.();
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private async sample(): Promise<void> {
    try {
      const appId = await this.appId();
      const reading = parseAndroidReading(await this.opts.shell(androidSampleCommand(appId)));
      if (!reading) throw new Error('unreadable /proc output');
      const sample = androidSample(this.prev, reading, appId, this.now());
      this.prev = reading;
      this.failures = 0;
      if (!this.stopped) this.opts.hooks.onSample(sample);
    } catch (err: any) {
      this.failures += 1;
      if (this.failures >= MAX_CONSECUTIVE_FAILURES && !this.stopped) {
        this.stopped = true;
        this.opts.hooks.onGiveUp(err?.message ?? String(err));
      }
    }
  }

  private async appId(): Promise<string | null> {
    if (this.pkg) return this.pkg;
    const now = this.now();
    if (this.foreground && now - this.foreground.at < FOREGROUND_REFRESH_MS) {
      return this.foreground.pkg;
    }
    let pkg: string | null = null;
    try {
      pkg = parseForegroundPackage(await this.opts.shell('dumpsys activity activities'));
    } catch {
      // Device figures still count; the app waits for the next lookup.
    }
    this.foreground = { pkg, at: now };
    return pkg;
  }
}
