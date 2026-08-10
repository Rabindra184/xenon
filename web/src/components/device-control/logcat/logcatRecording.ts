import type { LogRecordLike } from './logcatFilter';

/**
 * A bounded, append-only capture of the raw log stream between an explicit
 * START and STOP.
 *
 * Separate from the view's 5000-record display buffer for a measured reason: a
 * Galaxy S9 emits ~84 records/sec, so that buffer holds about a MINUTE of it.
 * Marking a start index into it and slicing at stop would silently drop the
 * beginning of any recording longer than that — the same invisible loss this
 * subsystem goes out of its way to prevent everywhere else.
 *
 * Two decisions follow from that:
 *
 * 1. **Serialise on arrival.** A record is turned into its output line the
 *    moment it lands, and only the string is kept. A live object with its tag,
 *    message and package strings plus object overhead runs to a few hundred
 *    bytes; the formatted line is ~120. Ten minutes of the device above is
 *    ~6MB instead of tens of MB, which is the difference between a capture you
 *    can leave running and one that degrades the tab.
 * 2. **Record unfiltered.** The active filter is a view concern. A capture can
 *    always be filtered afterwards; it cannot be unfiltered.
 */
export const RECORDING_MAX_LINES = 500_000;

export interface RecordingState {
  lines: string[];
  startedAt: number;
  /** Records the cap forced us to discard. Surfaced, never silent. */
  dropped: number;
}

/**
 * One output line. Deliberately the same shape the EXPORT button already
 * writes, so a recording and an export of the same records are diffable rather
 * than gratuitously different formats.
 */
export function formatLine(r: LogRecordLike & { ts: number; pid: number }): string {
  return `${new Date(r.ts).toISOString()} ${r.pid} ${r.level}/${r.tag}: ${r.message}`;
}

export function startRecording(now: number): RecordingState {
  return { lines: [], startedAt: now, dropped: 0 };
}

/**
 * Append a batch. Mutates and returns the same object — this runs on every
 * flush at up to ~84 records/sec, and copying a 500k-entry array per flush
 * would be the most expensive thing on the page.
 *
 * At the cap it keeps the OLDEST lines and drops new ones, the opposite of the
 * display buffer. A recording is evidence of a window you chose: losing the
 * start would move the window silently, while losing the tail leaves the
 * beginning where you put it and is reported in the trailer.
 */
export function appendToRecording(
  state: RecordingState,
  records: ReadonlyArray<LogRecordLike & { ts: number; pid: number }>,
): RecordingState {
  for (const r of records) {
    if (state.lines.length >= RECORDING_MAX_LINES) {
      state.dropped += 1;
      continue;
    }
    state.lines.push(formatLine(r));
  }
  return state;
}

/**
 * The downloadable text: a header naming the window, the lines, and — only
 * when the cap actually bit — a trailer saying so.
 *
 * `started`/`stopped` are host wall-clock at the button press, while each
 * line's timestamp is the DEVICE clock at the moment it was logged. The first
 * line can therefore read slightly earlier than `started` — measured ~0.6s on
 * a Galaxy S9 — because a line logged just before the press is delivered just
 * after it, through logcat, the parser and the socket. That is the honest
 * result: the record did arrive inside the window. Filtering by `ts >=
 * startedAt` would look tidier and would silently drop lines that genuinely
 * belong to the capture, which is the trade this whole subsystem refuses.
 *
 * The trailer is the point of tracking `dropped` at all. A truncated capture
 * that looks complete is worse than no capture, because it gets used as
 * evidence that something did not happen.
 */
export function serializeRecording(state: RecordingState, stoppedAt: number, udid: string): string {
  const header = [
    `# Xenon logcat recording`,
    `# device:   ${udid}`,
    `# started:  ${new Date(state.startedAt).toISOString()}`,
    `# stopped:  ${new Date(stoppedAt).toISOString()}`,
    `# duration: ${((stoppedAt - state.startedAt) / 1000).toFixed(1)}s`,
    `# lines:    ${state.lines.length}`,
  ];
  if (state.dropped > 0) {
    header.push(
      `# TRUNCATED: ${state.dropped} further line(s) were dropped after the ` +
        `${RECORDING_MAX_LINES}-line cap. This capture is INCOMPLETE.`,
    );
  }
  const body = state.lines.join('\n');
  const trailer =
    state.dropped > 0
      ? `\n# --- TRUNCATED: ${state.dropped} line(s) not captured (cap ${RECORDING_MAX_LINES}) ---`
      : '';
  return `${header.join('\n')}\n\n${body}${trailer}\n`;
}

/** `logcat-<udid>-<ISO start>.txt`, with the colons ISO uses stripped. */
export function recordingFilename(udid: string, startedAt: number): string {
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  return `logcat-${udid}-${stamp}.txt`;
}
