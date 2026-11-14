/**
 * A hub's note that a node has just taken one of its phones, before the
 * node's own report says so (markNodeBusy: the node answered a forwarded
 * stream/start with a 2xx).
 *
 * A node's report carries no time or sequence number, and the node sends it
 * every `sendNodeDevicesToHubIntervalMs` (InternalHttpClient retries one that
 * fails). A report the node built before the preview started can land after
 * markNodeBusy and say "free": through 2.36 it cleared `nodeBusy` and `busy`,
 * and the hub could hand the phone to a session the node would refuse. While
 * the note lasts, a report of "free" leaves `nodeBusy`, `nodeHold` and `busy`
 * as they are (the stores' node-report paths read it); a report of "busy" is
 * written as usual.
 *
 * In memory, on the hub, gone with a restart. A note ends when the node has
 * caught up: its report says the phone is busy (the stores' node-report
 * paths call nodeBusyConfirmed), so the next "free" is believed. A
 * forwarded stream/stop the node accepted ends it too. The note's first
 * version (#624) lasted two report intervals whatever the node said, and a
 * report held up longer than that (InternalHttpClient tries one four times,
 * 30 s each) still freed the phone.
 *
 * NODE_BUSY_NOTE_MAX_MS (or NODE_BUSY_NOTE_REPORTS report intervals, when
 * that is longer) is only an upper bound, for a node that never says busy: a
 * preview that ended before its next report, without a forwarded stop. Five
 * minutes outlasts a report's four tries plus a few intervals; until then
 * such a phone stays busy on the hub, which costs a wait, never a session
 * sent to a phone the node holds.
 *
 * Not a schema change: the node could send a report time instead, but the
 * node's and the hub's clocks needn't agree, and an older node wouldn't send
 * one.
 */

/** A note lasts at least this many report intervals... */
export const NODE_BUSY_NOTE_REPORTS = 2;

/** ...and at least this long, unless the node confirms or stops first. */
export const NODE_BUSY_NOTE_MAX_MS = 5 * 60_000;

/** sendNodeDevicesToHubIntervalMs' default, until the hub's own is set. */
const DEFAULT_REPORT_INTERVAL_MS = 30_000;

let reportIntervalMs = DEFAULT_REPORT_INTERVAL_MS;
const notedUntil = new Map<string, number>();

const keyOf = (udid: string, host: string) => `${udid}\u0000${host}`;

/** The hub's report interval (its own `sendNodeDevicesToHubIntervalMs`). */
export function setNodeReportIntervalMs(ms: unknown): void {
  reportIntervalMs =
    typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_REPORT_INTERVAL_MS;
}

/** How long a note lasts now, at most. */
export function nodeBusyNoteMs(): number {
  return Math.max(NODE_BUSY_NOTE_MAX_MS, NODE_BUSY_NOTE_REPORTS * reportIntervalMs);
}

/** markNodeBusy wrote this phone busy now. */
export function noteNodeBusy(udid: string, host: string, now = Date.now()): void {
  for (const [key, until] of notedUntil) if (until <= now) notedUntil.delete(key);
  notedUntil.set(keyOf(udid, host), now + nodeBusyNoteMs());
}

/** Whether a node's report of "free" for this phone may still be stale. */
export function nodeBusyNoted(udid: string, host: string, now = Date.now()): boolean {
  const key = keyOf(udid, host);
  const until = notedUntil.get(key);
  if (until === undefined) return false;
  if (until > now) return true;
  notedUntil.delete(key);
  return false;
}

/** The node's report says the phone is busy: it has caught up with the note. */
export function nodeBusyConfirmed(udid: string, host: string): void {
  notedUntil.delete(keyOf(udid, host));
}

/** The node has let the phone go (a forwarded stream/stop it accepted). */
export function forgetNodeBusy(udid: string, host: string): void {
  notedUntil.delete(keyOf(udid, host));
}

/** Every note, and the interval back to its default. For specs. */
export function forgetAllNodeBusyNotes(): void {
  notedUntil.clear();
  reportIntervalMs = DEFAULT_REPORT_INTERVAL_MS;
}
