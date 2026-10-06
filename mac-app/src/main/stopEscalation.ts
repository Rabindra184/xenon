// Stop escalation for the supervised Appium+Xenon child, kept free of Electron
// and child_process so the timing is unit-testable with fake timers.
//
// Xenon's own shutdown drain (finalising recordings, releasing devices, reaping
// go-ios/iproxy sidecars) runs about 15 s, so the polite SIGINT gets 30 s before
// we escalate: SIGTERM at 30 s, SIGKILL 5 s after that. A second quit (forceQuick)
// skips the wait but still sends SIGTERM first, so Xenon's synchronous 'exit' hook
// can reap its sidecars (logcat, ostrace, h264) before SIGKILL, which skips it.

/** How long SIGINT gets before we escalate to SIGTERM. */
export const STOP_GRACE_MS = 30_000;
/** How long SIGTERM gets before we escalate to SIGKILL. */
export const STOP_TERM_GRACE_MS = 5_000;
/** How long a forced stop (a second quit) lets SIGTERM work before SIGKILL. */
export const STOP_FORCE_GRACE_MS = 2_000;

export interface StopEscalatorOptions {
  kill(signal: NodeJS.Signals): void;
  log(text: string): void;
  graceMs?: number;
  termGraceMs?: number;
  forceGraceMs?: number;
}

export class StopEscalator {
  private readonly graceMs: number;
  private readonly termGraceMs: number;
  private readonly forceGraceMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  /** SIGTERM has gone out in this run, so the next step is SIGKILL. */
  private termSent = false;

  constructor(private readonly opts: StopEscalatorOptions) {
    this.graceMs = opts.graceMs ?? STOP_GRACE_MS;
    this.termGraceMs = opts.termGraceMs ?? STOP_TERM_GRACE_MS;
    this.forceGraceMs = opts.forceGraceMs ?? STOP_FORCE_GRACE_MS;
  }

  /** True from begin() (or force()/forceQuick()) until exited(). */
  get active(): boolean {
    return this.running;
  }

  // Each step arms its next timer BEFORE sending its signal. kill() can end the
  // run synchronously (a child 'error' emitted inside it calls exited()), and a
  // timer armed after that would outlive the run and signal the next child.

  /** Ask the child to stop (SIGINT) and arm the escalation. No-op while already active. */
  begin(): void {
    if (this.running) return;
    this.running = true;
    this.termSent = false;
    this.opts.log('Stopping Xenon…');
    this.timer = setTimeout(() => {
      this.termSent = true;
      this.opts.log('Xenon is taking longer than usual to stop…');
      this.timer = setTimeout(() => this.force(), this.termGraceMs);
      this.opts.kill('SIGTERM');
    }, this.graceMs);
    this.opts.kill('SIGINT');
  }

  /** The child has exited: cancel anything pending and re-arm for the next run. */
  exited(): void {
    this.clearTimer();
    this.running = false;
    this.termSent = false;
  }

  /** SIGKILL now and stop escalating; stays active until exited(). */
  force(): void {
    this.clearTimer();
    this.running = true;
    this.opts.log('Forcing Xenon to stop.');
    this.opts.kill('SIGKILL');
  }

  /**
   * A second quit: skip the SIGINT wait, but SIGTERM first so Xenon's 'exit'
   * hook can reap its sidecars, then SIGKILL after the force grace if the child
   * is still alive. If SIGTERM has already been sent in this run, SIGKILL at once.
   */
  forceQuick(): void {
    this.clearTimer();
    this.running = true;
    this.opts.log('Forcing Xenon to stop.');
    if (this.termSent) {
      this.opts.kill('SIGKILL');
      return;
    }
    this.termSent = true;
    this.timer = setTimeout(() => this.opts.kill('SIGKILL'), this.forceGraceMs);
    this.opts.kill('SIGTERM');
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
