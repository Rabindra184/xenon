import type { ChildProcess } from 'child_process';
import { parseSysmontapCpu } from './iosMetrics';
import {
  MAX_CONSECUTIVE_FAILURES,
  MetricsSampler,
  SAMPLE_INTERVAL_MS,
  SamplerHooks,
  TUNNEL_RENEW_MS,
} from './types';

export interface IOSSamplerOptions {
  udid: string;
  tunnels: {
    borrow(udid: string): Promise<number | null>;
    envFor(udid: string): NodeJS.ProcessEnv;
  };
  /** Starts `ios sysmontap --udid <udid>` with this environment. */
  spawnSysmontap: (env: NodeJS.ProcessEnv) => ChildProcess;
  hooks: SamplerHooks;
}

/** A reading older than this is not reported again. */
const STALE_MS = 2 * SAMPLE_INTERVAL_MS;

/**
 * Device CPU of an iPhone, from a long-running `ios sysmontap` through the
 * phone's tunnel (borrowed, and asked for again so it outlives the 2-minute
 * idle stop). Reports the latest reading every SAMPLE_INTERVAL_MS.
 */
export class IOSMetricsSampler implements MetricsSampler {
  private stopped = false;
  private proc?: ChildProcess;
  private latest?: { cpu: number; at: number };
  private failures = 0;
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private relaunch?: ReturnType<typeof setTimeout>;

  constructor(private readonly opts: IOSSamplerOptions) {}

  start(): void {
    void this.launch();
    this.every(SAMPLE_INTERVAL_MS, () => this.report());
    this.every(TUNNEL_RENEW_MS, () => {
      void this.opts.tunnels.borrow(this.opts.udid).catch(() => null);
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.timers.forEach((t) => clearInterval(t));
    if (this.relaunch) clearTimeout(this.relaunch);
    this.proc?.kill('SIGTERM');
    this.proc = undefined;
  }

  private every(ms: number, fn: () => void): void {
    const t = setInterval(fn, ms);
    t.unref?.();
    this.timers.push(t);
  }

  private async launch(): Promise<void> {
    if (this.stopped) return;
    // Below iOS 17 there is no tunnel (null), and sysmontap needs none.
    await this.opts.tunnels.borrow(this.opts.udid).catch(() => null);
    if (this.stopped) return;
    const proc = this.opts.spawnSysmontap(this.opts.tunnels.envFor(this.opts.udid));
    this.proc = proc;
    let rest = '';
    const read = (chunk: Buffer | string) => {
      const lines = (rest + chunk.toString()).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        const cpu = parseSysmontapCpu(line);
        if (cpu !== null) {
          this.latest = { cpu, at: Date.now() };
          this.failures = 0;
        }
      }
    };
    proc.stdout?.on('data', read);
    proc.stderr?.on('data', read);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      this.exited(proc);
    };
    proc.once('exit', end);
    proc.once('error', end);
  }

  private exited(proc: ChildProcess): void {
    if (this.proc === proc) this.proc = undefined;
    if (this.stopped) return;
    this.failures += 1;
    if (this.failures >= MAX_CONSECUTIVE_FAILURES) {
      void this.stop();
      this.opts.hooks.onGiveUp('ios sysmontap kept exiting');
      return;
    }
    const delay = Math.min(30_000, SAMPLE_INTERVAL_MS * 2 ** (this.failures - 1));
    this.relaunch = setTimeout(() => void this.launch(), delay);
    this.relaunch.unref?.();
  }

  private report(): void {
    if (this.stopped || !this.latest || Date.now() - this.latest.at > STALE_MS) return;
    this.opts.hooks.onSample({
      at: Date.now(),
      deviceCpuPct: this.latest.cpu,
      deviceMemMb: null,
      deviceMemTotalMb: null,
      appCpuPct: null,
      appMemMb: null,
      appId: null,
    });
  }
}
