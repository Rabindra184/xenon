/**
 * Poll `attempt` until it returns a non-null value or the timeout expires.
 *
 * Returns `{ value }` on success or `{ timedOut: true, lastError }` on timeout.
 * Errors thrown by `attempt` are treated as "not yet" — the caller decides
 * whether the final lastError matters.
 *
 * The loop guarantees at least one attempt even when timeoutMs is 0.
 */
export async function waitFor<T>(
  attempt: () => Promise<T | null | undefined>,
  opts: { timeoutMs: number; intervalMs: number; isTransientError?: (e: any) => boolean },
): Promise<{ value: T } | { timedOut: true; lastError?: any }> {
  const deadline = Date.now() + Math.max(0, opts.timeoutMs);
  let lastError: any;
  let firstPass = true;

  while (firstPass || Date.now() < deadline) {
    firstPass = false;
    try {
      const result = await attempt();
      if (result !== null && result !== undefined && result !== false) {
        return { value: result as T };
      }
    } catch (err: any) {
      lastError = err;
      if (opts.isTransientError && !opts.isTransientError(err)) {
        // Caller marked this error as fatal — bail immediately.
        throw err;
      }
    }
    if (Date.now() >= deadline) break;
    const remaining = deadline - Date.now();
    await sleep(Math.min(opts.intervalMs, Math.max(0, remaining)));
  }

  return { timedOut: true, lastError };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
