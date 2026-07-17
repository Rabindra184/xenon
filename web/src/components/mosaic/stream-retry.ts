/**
 * Auto-retry policy + failure-reason mapping for mosaic device tiles.
 *
 * A tile's MJPEG `<img>` can fail two ways: instantly (`onError`, e.g. the
 * backend returned 503 because the stream isn't up yet) or silently (never
 * produces a first frame within the connect window). Previously either outcome
 * dead-ended the tile at "Connection Failed" with only a manual Retry button.
 *
 * The failure mode that bites in the multi-device mosaic: adding a second
 * device makes the server spend time on that device's cold-start (or on a
 * broken device's failing WDA install + tunnel retries), which slows a healthy
 * neighbour's first frame past a single connect window. With no auto-retry, the
 * healthy device gets stuck showing "Connection Failed" even though it's
 * seconds from streaming. Bounded auto-retry with backoff fixes that: keep
 * showing "connecting" and re-open the stream a few times before giving up.
 */

// Number of automatic retries before the tile shows a terminal "unavailable"
// state (manual Retry still available after that).
export const MAX_AUTO_RETRIES = 3;

// Per-attempt connect window (ms). If the tile is still 'connecting' after
// this, the attempt is treated as failed and the next retry fires. Kept under
// the backend startStream cap (120s) so a fresh GET can pick up a backend that
// finished starting during the previous window.
export const CONNECT_TIMEOUT_MS = 45000;

// Backoff before the Nth auto-retry (0-based attempt index). Short first for
// transient races, longer after for genuine cold-starts.
const BACKOFF_SCHEDULE_MS = [2000, 5000, 10000];

export function retryDelayMs(attempt: number): number {
  const i = Math.max(0, Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1));
  return BACKOFF_SCHEDULE_MS[i];
}

/** Whether another automatic retry is allowed given how many have run. */
export function canAutoRetry(attempt: number): boolean {
  return attempt < MAX_AUTO_RETRIES;
}

/**
 * Map backend stream status/lastError (from GET /stream/status) into a concise,
 * user-facing failure reason. Replaces the old hardcoded "port 9100 / automation
 * blocked the MJPEG port" copy, which was wrong for most real failures.
 */
export function describeStreamFailure(input: { lastError?: string; status?: string }): string {
  const err = (input.lastError || '').toLowerCase();

  if (/did not find test app|not installed|webdriveragentrunner|applicationverification/.test(err)) {
    return 'WebDriverAgent is not installed on this device. Install and trust WDA, then retry.';
  }
  if (/unsupported ios version|manualpairingtunnelstart/.test(err)) {
    return 'This device’s iOS version is not supported for live streaming on this host.';
  }
  if (/econnrefused|econnreset|connection reset|tunnel/.test(err)) {
    return 'Lost the connection to the device tunnel. Reconnect the device, then retry.';
  }
  if (input.lastError && input.lastError.trim()) {
    return input.lastError.trim();
  }
  return 'We couldn’t start the live stream for this device.';
}
