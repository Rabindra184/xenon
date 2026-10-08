import { stripAnsi } from './ansi';
import type { CrashLine, LogLine } from './types';

// Shared by main and the window (no Node or Electron here), so both read a line the same way.
// What Logs shows of the lines in the buffer: which are problems, which are for technical details
// only, which match a search, and how they read as text when copied or saved. All of it works on
// the words as the person sees them, so the colour codes around a word never hide it.

export type LogLevel = 'error' | 'warn' | 'info';

/**
 * How many lines main keeps, and the window too, the oldest dropped first. One number for both, so
 * a window opened later starts from the same lines the open one has.
 */
export const LOG_LINES_KEPT = 5000;

// Xenon marks its own errors with ❌ (U+274C) and its warnings with ⚠ (U+26A0, often followed by
// U+FE0F), often in a line with no error word (R63). They are not word characters, so they sit
// outside the \b…\b words. "failed" and "failure" are left out: retries print them all the time.
const ERROR_RE = /\b(error|fatal|uncaught|exception|EADDRINUSE)\b|\u274C/i;
const WARN_RE = /\b(warn|warning|deprecated)\b|\u26A0/i;

/**
 * A line's level, from its words: the stream it came on says nothing about how bad it is. A line
 * main marks a problem (a crash's exit line, R68) is an error whatever its words.
 */
export function lineLevel(l: LogLine): LogLevel {
  if (l.problem === true) return 'error';
  const text = stripAnsi(l.text);
  if (ERROR_RE.test(text)) return 'error';
  if (WARN_RE.test(text)) return 'warn';
  return 'info';
}

export interface LogViewOptions {
  show: 'everything' | 'problems';
  /** Technical details on: system lines show. */
  technical: boolean;
  /** A case-insensitive search of the words; empty (or only spaces) searches nothing. */
  query: string;
  /** The line Logs was sent to: shown whatever the other options say. */
  keepId?: number;
}

/** True when Logs shows this line with technical details off: anything but a system line that is not `always`. */
function shownWithoutTechnicalDetails(l: LogLine): boolean {
  return l.stream !== 'system' || l.always === true;
}

/** The lines to show, in their order. The line `keepId` names is always among them. */
export function visibleLines(lines: LogLine[], o: LogViewOptions): LogLine[] {
  const query = o.query.trim().toLowerCase();
  return lines.filter((l) => {
    if (l.id === o.keepId) return true;
    if (!o.technical && !shownWithoutTechnicalDetails(l)) return false;
    if (o.show === 'problems' && lineLevel(l) === 'info') return false;
    return !query || stripAnsi(l.text).toLowerCase().includes(query);
  });
}

/** A time as the Mac's local HH:MM:SS. */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/**
 * The line Home quotes after a crash, and Logs scrolls to: the server's last error, else the last
 * thing it printed on stderr, else none. Only the server's own words: the app's system lines say how
 * the server ended (Home's sentence says that), so none of them is quoted, not even a crash's exit
 * line marked a problem (R68). The stderr fallback can be a line with no error word, which Problems
 * only would drop: Logs keeps this line in view through `keepId`.
 */
export function lastProblemLine(lines: LogLine[]): LogLine | null {
  let lastStderr: LogLine | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.stream === 'system') continue;
    if (lineLevel(l) === 'error') return l;
    if (!lastStderr && l.stream === 'stderr') lastStderr = l;
  }
  return lastStderr;
}

/**
 * A crash's line (ServerState.crashLine), which main works out from its own lines: what Home quotes
 * and where "See what happened" sends Logs, from one look at the lines (lastProblemLine), so the
 * quote and the jump are always the same line. Its id, and its words as they read on screen, without
 * colour codes. Null when there is no problem line.
 */
export function crashLineOf(lines: LogLine[]): CrashLine | null {
  const line = lastProblemLine(lines);
  return line === null ? null : { id: line.id, text: stripAnsi(line.text) };
}

/** The lines as plain text, one per line: "HH:MM:SS words", with no colour codes. For Copy and Save as…. */
export function logsAsText(lines: LogLine[]): string {
  return lines.map((l) => `${formatTime(l.ts)} ${stripAnsi(l.text)}`).join('\n');
}

/** Why Logs shows no line: none yet, none that is a problem, or none the search finds. */
export type LogsEmpty = 'no-output' | 'no-problems' | 'no-match';

/**
 * Why Logs shows no line, from how many lines there are and how many are shown, or null while it
 * shows some. No lines at all is "no output yet" whatever is chosen; lines that are all for
 * technical details read the same, since the person sees no output.
 */
export function emptyReason(
  total: number,
  shown: number,
  o: Pick<LogViewOptions, 'show' | 'query'>
): LogsEmpty | null {
  if (shown > 0) return null;
  if (total === 0) return 'no-output';
  if (o.query.trim()) return 'no-match';
  return o.show === 'problems' ? 'no-problems' : 'no-output';
}

/** How close to the end of the list counts as at it, in pixels: rows drawn late change its height a little. */
const END_SLACK_PX = 24;

/**
 * Whether the list is scrolled to its end (or everything fits), so new lines keep it there. Away
 * from the end, the person is reading higher up, and new lines leave the view where it is.
 */
export function nearEnd(el: { scrollTop: number; scrollHeight: number; clientHeight: number }): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= END_SLACK_PX;
}
