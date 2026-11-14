/**
 * Rows of another server's phones that the last stale check kept although
 * their server didn't answer (removeStaleDevices' keepsHeldRow: a claim or
 * hold of this server's is on them).
 *
 * Kept, such a row was dropped only at the next stale check after its claim
 * or hold ended, and until then it was free: allocation could hand it to a
 * session sent to a server that wasn't answering. So a release that leaves
 * one of these rows holding nothing of this server's deletes it at once
 * (device-service's dropIfUnanswered), and neither allocation nor the lease
 * queue (LeaseQueue.candidates) ever offers one. A
 * report from its node (POST /register) says it answers again, and so does
 * the next stale check that reaches it. The node's next report recreates a
 * deleted row, with its saved settings.
 *
 * In memory: a restart's own boot stale check fills it again.
 */

const unanswered = new Set<string>();

const keyOf = (udid: string, host: string) => `${udid}\u0000${host}`;

/** The rows the stale check just kept unanswered; replaces the last check's. */
export function setUnansweredRows(rows: { udid: string; host?: string }[]): void {
  unanswered.clear();
  for (const row of rows) if (row.host !== undefined) unanswered.add(keyOf(row.udid, row.host));
}

/** Whether the last stale check kept this row with its server not answering. */
export function isUnansweredRow(udid: string, host: string | undefined): boolean {
  return host !== undefined && unanswered.has(keyOf(udid, host));
}

/** The row's server answers again (its report), or the row has gone. */
export function forgetUnansweredRow(udid: string, host: string | undefined): void {
  if (host !== undefined) unanswered.delete(keyOf(udid, host));
}

/** Every row, for specs. */
export function forgetAllUnansweredRows(): void {
  unanswered.clear();
}
