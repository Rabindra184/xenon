/**
 * Helpers for rendering log rows in the session detail viewer.
 */

import type { LogLike } from './derive';

export type LogTabKey = 'commands' | 'timeline' | 'screenshots' | 'device' | 'debug' | 'profiling';

/** A tab's count, short: 2674 reads "2.7k". */
export function formatTabCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
}

export interface LogRowKindStyle {
  /** A 1-2 word event/method label shown in the row. */
  label: string;
  /** Color tone for the kind dot + label tint. */
  tone: 'green' | 'red' | 'amber' | 'blue' | 'neutral';
}

/**
 * A device or debug log line: a Log row ({ id, session_id, log_type, message,
 * timestamp }), as opposed to a command (a SessionLog row, which has a
 * command_name and a title).
 */
export function isLogLine(log: LogLike): boolean {
  const l = log as Record<string, unknown>;
  return typeof l.message === 'string' && !l.command_name && !l.title;
}

// logcat's threadtime format ("10-04 09:13:10.120  4127  4127 E Tag: …"), its
// brief format ("E/Tag( 4127): …"), an iPhone's syslog level ("<Error>: …")
// and a simulator's compact `log stream` type ("2026-10-05 20:31:40.123 E  …").
const LOGCAT_THREADTIME = /^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+\d+\s+([VDIWEF])\s/;
const LOGCAT_BRIEF = /^([VDIWEF])\/[^(:]*[(:]/;
const SYSLOG_LEVEL = /<(Error|Fault|Warning)>/;
const SIMULATOR_COMPACT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+\s+(Df|Db|E|F|I|A)\s/;

/** The severity a device log line carries, when it carries one. */
export function logLineLevel(message: string): 'error' | 'warn' | null {
  const letter = LOGCAT_THREADTIME.exec(message)?.[1] ?? LOGCAT_BRIEF.exec(message)?.[1];
  if (letter) return letter === 'E' || letter === 'F' ? 'error' : letter === 'W' ? 'warn' : null;
  const level = SYSLOG_LEVEL.exec(message)?.[1];
  if (level) return level === 'Warning' ? 'warn' : 'error';
  const type = SIMULATOR_COMPACT.exec(message)?.[1];
  if (type === 'E' || type === 'F') return 'error';
  return null;
}

/**
 * Best-effort extraction of a HH:MM:SS timestamp string from a log entry.
 * Falls back to '--:--:--'.
 */
export function logTimestamp(log: LogLike): string {
  const raw = log.timestamp;
  if (!raw) {
    // sessionLog rows store createdAt as the time field; try that.
    const created = (log as Record<string, unknown>).createdAt;
    if (created) return logTimestamp({ timestamp: created as string | number });
    return '--:--:--';
  }
  const d = typeof raw === 'number' ? new Date(raw) : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return '--:--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Decide the dot tone + label for a given log row.
 */
export function logRowKind(log: LogLike): LogRowKindStyle {
  if (isLogLine(log)) {
    const level = logLineLevel(log.message as string);
    if (level === 'error') return { label: 'error', tone: 'red' };
    if (level === 'warn') return { label: 'warn', tone: 'amber' };
    return { label: '', tone: 'neutral' };
  }
  // Healed (auto-recovery applied): SessionLog.is_healed.
  if ((log as any).is_healed === true)
    return { label: String((log as any).command_name || 'healed'), tone: 'amber' };
  // Explicit failure
  if (log.is_success === false || (log as any).is_error === true)
    return { label: String(log.command_name || (log as any).title || 'error'), tone: 'red' };
  // Explicit success
  if (log.is_success === true) return { label: String(log.command_name || (log as any).title || 'ok'), tone: 'green' };
  // session_started / session_stopped style
  const evt = (log as any).title || (log as any).event || (log as any).command_name;
  if (typeof evt === 'string') {
    if (/stop|fail|error/i.test(evt)) return { label: evt, tone: 'red' };
    if (/start|begin|init/i.test(evt)) return { label: evt, tone: 'green' };
    return { label: evt, tone: 'blue' };
  }
  return { label: 'log', tone: 'neutral' };
}

/**
 * Pretty-print any value (object or string-of-JSON) for the expanded row.
 */
export function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

/**
 * Lightweight regex-based JSON tokenizer. Returns an array of {text, kind}
 * spans where kind ∈ {'key', 'string', 'number', 'boolean', 'null', 'punct',
 * 'plain'}. Render as <span class={…}>{text}</span> in `JsonBlock`.
 *
 * This is intentionally not a full JSON parser — it's a syntax painter for
 * already-pretty-printed JSON. Robust enough for log payloads, falls back to
 * a single 'plain' span if the input doesn't look like JSON.
 */
export type JsonToken = { text: string; kind: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'plain' };

export function tokenizeJson(src: string): JsonToken[] {
  if (!src || typeof src !== 'string') return [{ text: String(src ?? ''), kind: 'plain' }];
  const tokens: JsonToken[] = [];
  // Pattern matches (in order): "key": → string (key), "value" → string,
  // numbers, booleans, null, structural punctuation, anything else.
  const re = /("(?:\\.|[^"\\])*")(\s*:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],])/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ text: src.slice(lastIndex, m.index), kind: 'plain' });
    }
    if (m[1] && m[2] !== undefined) {
      tokens.push({ text: m[1], kind: 'key' });
      tokens.push({ text: m[2], kind: 'punct' });
    } else if (m[3]) {
      tokens.push({ text: m[3], kind: 'string' });
    } else if (m[4]) {
      tokens.push({ text: m[4], kind: 'number' });
    } else if (m[5]) {
      tokens.push({ text: m[5], kind: 'boolean' });
    } else if (m[6]) {
      tokens.push({ text: m[6], kind: 'null' });
    } else if (m[7]) {
      tokens.push({ text: m[7], kind: 'punct' });
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < src.length) {
    tokens.push({ text: src.slice(lastIndex), kind: 'plain' });
  }
  return tokens;
}

/**
 * Human-facing title for a log row: a log line's first line; for a command,
 * the structured `.title` field, then `.command_name`, then a generic label.
 * Never the raw JSON.
 */
export function logDisplayTitle(log: LogLike): string {
  if (isLogLine(log)) return (log.message as string).split(/\r?\n/, 1)[0].trimEnd();
  const l = log as any;
  const t = typeof l.title === 'string' && l.title.trim() ? l.title.trim() : null;
  const c = typeof l.command_name === 'string' && l.command_name.trim() ? l.command_name.trim() : null;
  return t ?? c ?? 'Command';
}

/**
 * Human-facing subtitle for a log row — the structured `.subtitle` field,
 * or null when absent.
 */
export function logDisplaySubtitle(log: LogLike): string | null {
  const s = (log as any).subtitle;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}

/**
 * Filter logs by error-only toggle.
 */
export function filterErrorsOnly(logs: LogLike[], on: boolean): LogLike[] {
  if (!on) return logs;
  return logs.filter(
    (l) =>
      l.is_success === false ||
      (l as any).is_error === true ||
      (isLogLine(l) && logLineLevel(l.message as string) === 'error'),
  );
}
