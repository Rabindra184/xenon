/**
 * Parser for `adb logcat -v threadtime` output.
 *
 * Pure: no I/O, no Container, no clock of its own — the caller passes `now` so
 * year inference is testable.
 *
 *   MM-DD HH:MM:SS.mmm   PID   TID L TAG: message
 *   08-09 16:11:00.005  1408  1408 D KeyguardUpdateMonitor: received broadcast
 */
export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F';

export interface LogcatRecord {
  /** Epoch ms. threadtime carries no year — see inferYear below. */
  ts: number;
  pid: number;
  tid: number;
  level: LogLevel;
  tag: string;
  message: string;
  /** Process name for pid, attached later by the stream service. */
  pkg?: string;
  /** True for records Xenon injected rather than read from the device. */
  synthetic?: boolean;
}

const LINE =
  /^(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.*?):\s?(.*)$/;

/**
 * logcat gives MM-DD with no year. Assume the current one, unless that lands
 * more than a day in the future — which means the log crossed a New Year
 * boundary and belongs to the previous one.
 */
function inferYear(month: number, day: number, now: Date): number {
  const year = now.getFullYear();
  const candidate = new Date(year, month - 1, day);
  const oneDayMs = 24 * 60 * 60 * 1000;
  return candidate.getTime() - now.getTime() > oneDayMs ? year - 1 : year;
}

export function parseThreadtimeLine(line: string, now: Date = new Date()): LogcatRecord | null {
  const m = LINE.exec(line);
  if (!m) return null; // continuation line, banner, or noise — caller decides

  const [, mo, d, h, mi, s, ms, pid, tid, level, tag, message] = m;
  const month = Number(mo);
  const day = Number(d);
  const ts = new Date(
    inferYear(month, day, now),
    month - 1,
    day,
    Number(h),
    Number(mi),
    Number(s),
    Number(ms),
  ).getTime();

  return {
    ts,
    pid: Number(pid),
    tid: Number(tid),
    level: level as LogLevel,
    tag: tag.trim(),
    message,
  };
}
