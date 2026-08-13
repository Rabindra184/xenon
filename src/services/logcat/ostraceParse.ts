import { LogLevel, LogcatRecord } from './logcatParse';

/**
 * Parser for `go-ios ostrace` output — the iOS side of the Debug Logs tab.
 *
 * os_trace_relay is the transport Xcode's console reads, and unlike the older
 * `syslog` it carries Debug-level messages. It emits one JSON object per line:
 *
 *   {"pid":396,"timestamp":"2026-08-13T07:39:31.406821+05:30","level":2,
 *    "levelName":"Debug","threadId":654586,"imageName":"/…/IOKit",
 *    "filename":"/…/backboardd","message":"…",
 *    "label":{"subsystem":"com.apple.xpc.transaction","category":"all"}}
 *
 * Pure: no I/O and no clock of its own. Unlike the Android parser it needs no
 * `now` — the timestamp is ISO 8601 with an offset, so there is no year to
 * infer and no host-timezone assumption to get wrong.
 */

/**
 * os_log levels mapped onto the Android set the UI already speaks, in order.
 *
 * The `level:` filter is a MINIMUM, so only the ordering has to survive:
 * Debug < Info ≤ Default < Error < Fault. `Default` is os_log's normal-priority
 * level and has no Android peer — it is folded into `I` rather than promoted to
 * `W`, because rendering an ordinary message as a warning would be a lie the
 * colour scheme then repeats. Android's `V` and `W` simply never occur on iOS.
 */
const LEVELS: Record<string, LogLevel> = {
  debug: 'D',
  info: 'I',
  default: 'I',
  notice: 'I',
  error: 'E',
  fault: 'F',
};

/** The trailing path component — process and image arrive as absolute paths. */
function basename(p: string | undefined): string {
  if (!p) return '';
  const parts = p.split('/');
  return parts[parts.length - 1] || '';
}

interface OsTraceLine {
  pid?: number;
  timestamp?: string;
  levelName?: string;
  threadId?: number;
  imageName?: string;
  filename?: string;
  message?: string;
  label?: { subsystem?: string; category?: string };
}

/**
 * One ostrace line to a record, or null when the line is not one.
 *
 * Returns null rather than throwing for anything unparseable — go-ios writes
 * progress and warnings to the same stream, and a malformed line must not take
 * the session down.
 */
export function parseOstraceLine(line: string): LogcatRecord | null {
  const trimmed = (line ?? '').trim();
  if (!trimmed || trimmed[0] !== '{') return null;

  let parsed: OsTraceLine;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const ts = Date.parse(parsed.timestamp ?? '');
  if (Number.isNaN(ts)) return null;

  // The subsystem is what Xcode groups by and the most useful thing to colour,
  // so it is the tag. Records without one fall back to the logging image,
  // which is the nearest equivalent to "which component said this".
  const tag = parsed.label?.subsystem || basename(parsed.imageName) || 'ostrace';

  return {
    ts,
    pid: Number(parsed.pid ?? 0),
    tid: Number(parsed.threadId ?? 0),
    level: LEVELS[(parsed.levelName ?? '').toLowerCase()] ?? 'I',
    tag,
    // The process binary, so the existing `package:` filter term selects an
    // app's own logs — which is what "app-specific logs" means here.
    pkg: basename(parsed.filename) || undefined,
    message: parsed.message ?? '',
  };
}
