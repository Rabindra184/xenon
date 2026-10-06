// Stop escalation for the supervised Appium+Xenon child, kept free of Electron
// and child_process so the timing is unit-testable with fake timers.
//
// Xenon's own shutdown drain (finalising recordings, releasing devices, reaping
// go-ios/iproxy sidecars) runs about 15 s, so the polite SIGINT gets 30 s before
// we escalate: SIGTERM at 30 s, SIGKILL 5 s after that.

/** How long SIGINT gets before we escalate to SIGTERM. */
export const STOP_GRACE_MS = 30_000;
/** How long SIGTERM gets before we escalate to SIGKILL. */
export const STOP_TERM_GRACE_MS = 5_000;

export interface StopEscalatorOptions {
  kill(signal: NodeJS.Signals): void;
  log(text: string): void;
  graceMs?: number;
  termGraceMs?: number;
}

export class StopEscalator {
  private readonly graceMs: number;
  private readonly termGraceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly opts: StopEscalatorOptions) {
    this.graceMs = opts.graceMs ?? STOP_GRACE_MS;
    this.termGraceMs = opts.termGraceMs ?? STOP_TERM_GRACE_MS;
  }

  /** True from begin() (or force()) until exited(). */
  get active(): boolean {
    return this.running;
  }

  /** Ask the child to stop (SIGINT) and arm the escalation. No-op while already active. */
  begin(): void {
    if (this.running) return;
    this.running = true;
    this.opts.log('Stopping Xenon…');
    this.opts.kill('SIGINT');
    this.timer = setTimeout(() => {
      this.opts.log('Xenon is taking longer than usual to stop…');
      this.opts.kill('SIGTERM');
      this.timer = setTimeout(() => this.force(), this.termGraceMs);
    }, this.graceMs);
  }

  /** The child has exited: cancel anything pending and re-arm for the next run. */
  exited(): void {
    this.clearTimer();
    this.running = false;
  }

  /** SIGKILL now and stop escalating; stays active until exited(). */
  force(): void {
    this.clearTimer();
    this.running = true;
    this.opts.log('Forcing Xenon to stop.');
    this.opts.kill('SIGKILL');
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
