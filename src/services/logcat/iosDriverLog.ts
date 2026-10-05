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

// A line's process, the library that logged it and its pid: an iPhone's
// "… Rabindras-iPhone Edge(UIKitCore)[8788] <Notice>: …" or a simulator's
// "2026-10-05 20:31:40.123 Df Shop[4127:8812] (UIKitCore) …".
const SYSLOG_HEADER = /^\w{3}\s+\d+ \d\d:\d\d:\d\d \S+ ([^\s[(]+)(?:\(([^)]*)\))?\[(\d+)\]/;
const COMPACT_HEADER =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+\s+\S+\s+([^\s[]+)\[(\d+)(?::\d+)?\](?:\s+\(([^)]*)\))?/;

interface LineHeader {
  name: string;
  /** The library or binary that logged the line, when the line says. */
  sender?: string;
  pid: string;
}

function headerOf(message: string): LineHeader | null {
  const syslog = SYSLOG_HEADER.exec(message);
  if (syslog) return { name: syslog[1], sender: syslog[2] || undefined, pid: syslog[3] };
  const compact = COMPACT_HEADER.exec(message);
  if (compact) return { name: compact[1], sender: compact[3] || undefined, pid: compact[2] };
  return null;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Which of an iPhone's or simulator's lines a session keeps: what the app
 * under test's own code logs, every error and fault inside its process, what
 * the phone's app manager says about it (its launch, its state, how it
 * ended), the crash reports and memory kills that name it, and every fault.
 *
 * A phone logs hundreds of lines a second. Measured on an iPhone 14 Plus
 * (iOS 26.5): about 53,000 in a one-minute session, which filled the
 * 10,000-line limit during the create. Keeping the app's whole process wasn't
 * enough either: Edge's process logged about 110 lines a second, of which
 * its own code wrote 5 in 8,839. The rest was Apple's frameworks inside it
 * (UIKit, Network, CFNetwork, WebKit), so their ordinary lines are left out
 * and their errors kept. Only `runningboardd` and `SpringBoard` are kept for
 * naming the app: about twenty other daemons each log every change of its
 * state ("Received state update for 8723 (app<…"), 3,000 lines in 78 s.
 *
 * The app's process is learnt from the lines: the phone announces it by
 * bundle id and pid (`app<com.example.shop(…)>:4127`, `pid: 4127 bundleID:
 * com.example.shop`), and the lines of that pid give its executable's name,
 * so a crash report or a memory kill that names it (`Shop[4127]`, `[Shop]`,
 * `corpse[4127]`) is kept too. A line with no header of its own continues
 * the one before.
 */
// The processes whose lines about the app say how it lives and ends: its
// launch, assertions and exit with its reason (RunningBoard), its scenes and
// windows (SpringBoard).
const APP_MANAGERS = new Set(['runningboardd', 'SpringBoard']);

export class IosAppLines {
  private readonly pidAnnounced: RegExp[];
  private readonly pids = new Set<string>();
  private readonly names = new Set<string>();
  private lastKept = false;

  constructor(readonly bundleId: string) {
    const id = escapeRegExp(bundleId);
    this.pidAnnounced = [
      new RegExp(`app<${id}[^>]*>:(\\d+)`, 'g'),
      new RegExp(`pid:? (\\d+),? bundleID:? ${id}\\b`, 'g'),
    ];
  }

  /** Learns the app's pid and executable from a line, without deciding on it. */
  learn(message: string): void {
    if (message.includes(this.bundleId)) {
      for (const re of this.pidAnnounced) {
        for (const m of message.matchAll(re)) this.pids.add(m[1]);
      }
    }
    const header = headerOf(message);
    if (header && this.pids.has(header.pid)) this.names.add(header.name);
  }

  /** Whether the session keeps the line. */
  keeps(message: string, level: string): boolean {
    this.learn(message);
    const header = headerOf(message);
    if (!header) return this.lastKept;
    const { name, sender, pid } = header;
    const inApp = this.pids.has(pid) || this.names.has(name);
    const keep =
      level === 'F' ||
      (inApp && (level === 'E' || !sender || this.names.has(sender))) ||
      (APP_MANAGERS.has(name) && message.includes(this.bundleId)) ||
      (!inApp &&
        ([...this.names].some((n) => message.includes(`${n}[`) || message.includes(`[${n}]`)) ||
          [...this.pids].some((p) => message.includes(`[${p}]`))));
    this.lastKept = keep;
    return keep;
  }
}
