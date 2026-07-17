// Detects main-thread (event-loop) stalls. A timer scheduled for `intervalMs`
// that fires much later means the main thread was blocked in between — the
// hallmark of an Electron UI hang. This lets the app self-report "the main
// thread stalled ~Nms" to its log the moment it recovers, turning an
// unreproducible "it froze" into a timestamped, actionable event.
//
// Note: this catches stalls on the *main (browser) process* thread only. A hang
// caused by a wedged GPU/renderer process is caught separately by the
// child-process-gone / unresponsive listeners in the main entrypoint.

/**
 * Given the timer's nominal interval and the actual elapsed time, return the
 * stall in ms if it exceeds `thresholdMs`, else null. Pure so it's testable.
 *
 * `lag = actualElapsed - intervalMs` (how much later than scheduled it fired).
 */
export function computeLag(intervalMs: number, actualElapsedMs: number, thresholdMs: number): number | null {
  const lag = actualElapsedMs - intervalMs;
  return lag >= thresholdMs ? Math.round(lag) : null;
}

export interface LagMonitorDeps {
  intervalMs: number;
  thresholdMs: number;
  /** Monotonic clock in ms (e.g. performance.now). */
  now: () => number;
  /** Reports a detected stall (ms late). */
  onStall: (lagMs: number) => void;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clear?: (handle: ReturnType<typeof setInterval>) => void;
}

/**
 * Installs a repeating heartbeat that reports whenever the main thread was
 * blocked longer than `thresholdMs`. Returns a stop() to tear it down.
 */
export function startLagMonitor(deps: LagMonitorDeps): () => void {
  const schedule = deps.schedule ?? ((fn, ms) => setInterval(fn, ms));
  const clear = deps.clear ?? ((h) => clearInterval(h));
  let last = deps.now();
  const handle = schedule(() => {
    const t = deps.now();
    const elapsed = t - last;
    last = t;
    const lag = computeLag(deps.intervalMs, elapsed, deps.thresholdMs);
    if (lag !== null) deps.onStall(lag);
  }, deps.intervalMs);
  // Don't let the heartbeat keep the process alive on its own.
  (handle as unknown as { unref?: () => void }).unref?.();
  return () => clear(handle);
}
