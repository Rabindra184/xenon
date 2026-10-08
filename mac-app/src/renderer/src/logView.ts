import type { LogLine } from '@shared/types';
import { stripAnsi } from './ansi';
import type { UiLogLine } from './logBuffer';

// What Logs shows of the lines in the buffer: which are problems, which are for technical details
// only, which match a search, and how they read as text when copied or saved. All of it works on
// the words as the person sees them, so the colour codes around a word never hide it.

export type LogLevel = 'error' | 'warn' | 'info';

const ERROR_RE = /\b(error|fatal|uncaught|exception|EADDRINUSE)\b/i;
const WARN_RE = /\b(warn|warning|deprecated)\b/i;

/** A line's level, from its words: the stream it came on says nothing about how bad it is. */
export function lineLevel(l: LogLine): LogLevel {
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
export function visibleLines(lines: UiLogLine[], o: LogViewOptions): UiLogLine[] {
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
 * The line Home quotes after a crash, and Logs scrolls to: the last error, else the last thing the
 * server printed on stderr, else none. Home sends the person to Logs with technical details off, so
 * a system line only technical details show is never the one quoted. The stderr fallback can be a
 * line with no error word, which Problems only would drop: Logs keeps this line in view through
 * `keepId`.
 */
export function lastProblemLine(lines: UiLogLine[]): UiLogLine | null {
  let lastStderr: UiLogLine | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!shownWithoutTechnicalDetails(l)) continue;
    if (lineLevel(l) === 'error') return l;
    if (!lastStderr && l.stream === 'stderr') lastStderr = l;
  }
  return lastStderr;
}

/** The lines as plain text, one per line: "HH:MM:SS words", with no colour codes. For Copy and Save as…. */
export function logsAsText(lines: UiLogLine[]): string {
  return lines.map((l) => `${formatTime(l.ts)} ${stripAnsi(l.text)}`).join('\n');
}
