/**
 * Helpers for rendering log rows in the session detail viewer.
 */

import type { LogLike } from './derive';

export type LogTabKey = 'text' | 'performance' | 'evidence' | 'device' | 'debug' | 'profiling';

export interface LogRowKindStyle {
  /** A 1-2 word event/method label shown in the row. */
  label: string;
  /** Color tone for the kind dot + label tint. */
  tone: 'green' | 'red' | 'amber' | 'blue' | 'neutral';
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
  // Healed (auto-recovery applied)
  if ((log as any).healed === true) return { label: String((log as any).command_name || 'healed'), tone: 'amber' };
  // Explicit failure
  if (log.is_success === false) return { label: String(log.command_name || (log as any).title || 'error'), tone: 'red' };
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
 * One-line preview of the log entry's JSON payload — prefers `.body`, then
 * the whole entry, truncated to `maxLen`.
 */
export function logInlinePreview(log: LogLike, maxLen = 220): string {
  const body = (log as any).body;
  let raw: string;
  if (typeof body === 'string' && body.trim().length > 0) {
    raw = body;
  } else if (body && typeof body === 'object') {
    try { raw = JSON.stringify(body); } catch { raw = String(body); }
  } else {
    try { raw = JSON.stringify(log); } catch { raw = String(log); }
  }
  raw = raw.replace(/\s+/g, ' ').trim();
  return raw.length > maxLen ? raw.slice(0, maxLen) + '…' : raw;
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
 * Filter logs by error-only toggle.
 */
export function filterErrorsOnly(logs: LogLike[], on: boolean): LogLike[] {
  if (!on) return logs;
  return logs.filter((l) => l.is_success === false);
}
