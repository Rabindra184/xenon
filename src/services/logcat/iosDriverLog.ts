import type { LogLevel, LogcatRecord } from './logcatParse';

/**
 * An iPhone or simulator session's device log, as the XCUITest driver
 * captures it (`driver.logs.syslog`). Pure, apart from reading the log's own
 * buffer.
 *
 * The driver starts this capture early in the session's create, before the
 * app is installed and launched (unless `appium:skipLogCapture`): a real
 * iPhone's syslog (RemoteXPC, or the older lockdown service) or a
 * simulator's `xcrun simctl spawn <udid> log stream --style compact`. Each
 * line is an entry `{ timestamp, level: 'ALL', message }`, `timestamp` being
 * this server's clock when the line arrived and `message` the line as
 * printed.
 *
 * The log is an EventEmitter that emits `output` for every line, and keeps the
 * newest 10,000 in a buffer that `getLogs()` empties. Xenon listens to
 * `output` and reads the buffer without emptying it, so a test that asks
 * Appium for its own `syslog` still gets every line.
 */

/** A driver log entry (appium-xcuitest-driver `toLogEntry`). */
export interface DriverLogEntry {
  timestamp: number;
  level?: string;
  message: string;
}

/** The shape of the driver's `logs.syslog` Xenon relies on. */
export interface DriverLog {
  on(event: 'output', listener: (entry: DriverLogEntry) => void): unknown;
  removeListener(event: 'output', listener: (entry: DriverLogEntry) => void): unknown;
}

// A real iPhone's syslog line: "Oct  5 20:31:40 iPhone SpringBoard(FrontBoard)[57] <Notice>: …".
const SYSLOG_LEVEL = /<(Fault|Error|Warning|Notice|Default|Info|Debug)>:/;
// A simulator's compact line: "2026-10-05 20:31:40.123 E  SpringBoard[1234:5678] …".
const COMPACT_LEVEL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+\s+(Df|Db|E|F|I|A)\s/;

const SYSLOG_LETTERS: Record<string, LogLevel> = {
  Fault: 'F',
  Error: 'E',
  Warning: 'W',
  Notice: 'I',
  Default: 'I',
  Info: 'I',
  Debug: 'D',
};
const COMPACT_LETTERS: Record<string, LogLevel> = {
  F: 'F',
  E: 'E',
  Df: 'I',
  I: 'I',
  A: 'I',
  Db: 'D',
};

/** The level an iOS log line carries, as a logcat letter; `I` when it carries none. */
export function iosLineLevel(message: string): LogLevel {
  const syslog = SYSLOG_LEVEL.exec(message)?.[1];
  if (syslog) return SYSLOG_LETTERS[syslog];
  const compact = COMPACT_LEVEL.exec(message)?.[1];
  if (compact) return COMPACT_LETTERS[compact];
  return 'I';
}

// What `log stream` prints before its first line: not the device's.
const STREAM_BANNER = /^(Filtering the log data using |Timestamp\s+Ty\s+Process)/;

/**
 * A driver entry as a record for the session's book, or null for what isn't
 * a device line. A line without a level of its own (a message's continuation)
 * is kept, as `I`.
 */
export function recordFromDriverLog(entry: DriverLogEntry | undefined): LogcatRecord | null {
  if (!entry || typeof entry.message !== 'string') return null;
  const message = entry.message.replace(/\s+$/, '');
  if (!message || STREAM_BANNER.test(message)) return null;
  const ts = Number(entry.timestamp);
  return {
    ts: Number.isFinite(ts) ? ts : Date.now(),
    pid: 0,
    tid: 0,
    level: iosLineLevel(message),
    tag: '',
    message,
  };
}

/** An iOS record's row text: the line as the phone or simulator printed it. */
export const iosLineText = (rec: LogcatRecord): string => rec.message;

/**
 * The lines the driver's log already holds, oldest first, without taking
 * them: the ones from the create, before Xenon could listen. Reads the
 * driver's internals (`logs`, an LRU cache keyed by arrival, and
 * `_deserializeEntry`, as its own `getLogs()` does), so any other shape gives
 * nothing rather than an error.
 */
export function bufferedDriverLog(driverLog: unknown): DriverLogEntry[] {
  const log = driverLog as {
    logs?: { rvalues?: () => Iterable<unknown> };
    _deserializeEntry?: (value: unknown) => DriverLogEntry;
  };
  if (typeof log?.logs?.rvalues !== 'function' || typeof log._deserializeEntry !== 'function') {
    return [];
  }
  try {
    const out: DriverLogEntry[] = [];
    for (const value of log.logs.rvalues()) out.push(log._deserializeEntry(value));
    return out;
  } catch {
    return [];
  }
}

/** Whether `value` can be listened to as a driver log. */
export function isDriverLog(value: unknown): value is DriverLog {
  const v = value as Partial<DriverLog> | undefined;
  return typeof v?.on === 'function' && typeof v?.removeListener === 'function';
}
