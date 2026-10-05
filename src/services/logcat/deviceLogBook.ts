import { parseThreadtimeLine, type LogcatRecord } from './logcatParse';

/**
 * Which of a phone's log records a session keeps, and as what. Pure: the
 * service (SessionDeviceLogs) feeds it the records of the phone's shared log
 * stream and writes what it returns.
 *
 * - **The session's lines only.** The stream starts with up to 2000 lines of
 *   history (`-T`, or the multiplexer's replay to a late joiner), so a line
 *   counts from shortly before the phone was given to the session.
 * - **Its own time, on this server's clock.** A line is stamped with the
 *   moment the phone logged it, moved by the phone's clock offset, so it
 *   lines up with the session's commands; its text keeps the time the phone
 *   printed. A phone's clock is often seconds off, and one with no network
 *   time can be minutes off.
 * - **Each line once.** A stream delivers a record once. When the stream
 *   ends mid-session and is started again, its history overlaps what was
 *   kept, so a resumed stream counts only lines after the newest one seen,
 *   compared by time and, at that same millisecond, by content.
 * - **Bounded.** DEVICE_LOG_LINE_LIMIT lines of any level, then errors only
 *   (a crash's "FATAL EXCEPTION" is an error) up to DEVICE_LOG_ERROR_LIMIT
 *   more, each step said in the log itself.
 */

/** Lines of any level a session keeps. */
export const DEVICE_LOG_LINE_LIMIT = 10_000;
/** Errors (E and F) kept after DEVICE_LOG_LINE_LIMIT; nothing more after them. */
export const DEVICE_LOG_ERROR_LIMIT = 2_000;
/**
 * How long before the phone was given to the session a line may be and still
 * count: the phone's clock offset, read once, is only about that good.
 */
export const WINDOW_SLACK_MS = 2_000;

/**
 * A phone's clock against this server's. A record's `ts` is its time as the
 * phone printed it, read as this server's local time (parseThreadtimeLine).
 */
export interface DeviceClock {
  /** Add to a record's `ts` for the moment by the phone's clock: the two time zones' difference. */
  zoneShiftMs: number;
  /** This server's clock minus the phone's. */
  skewMs: number;
}

/** A phone whose clock couldn't be read: taken to be this server's. */
export const UNKNOWN_CLOCK: DeviceClock = { zoneShiftMs: 0, skewMs: 0 };

const QUARTER_HOUR_MS = 15 * 60_000;

/**
 * The phone's `date` command for {@link parseDeviceClock}: seconds since the
 * epoch, nanoseconds, and the local time logcat prints, at one instant, with
 * no spaces (it goes through the phone's shell as one word). An older
 * toybox prints no nanoseconds.
 */
export const DEVICE_CLOCK_COMMAND = 'date +%s.%N.%m-%d.%H:%M:%S';

/**
 * The phone's clock from {@link DEVICE_CLOCK_COMMAND}'s output, or null if it
 * isn't that. `hostNowMs` is this server's time when the phone answered.
 *
 * The local time is read the way parseThreadtimeLine reads a log line, so the
 * difference to the phone's epoch is exactly the shift its lines need,
 * whatever either time zone is. Rounded to a quarter hour: time zones differ
 * by whole quarters.
 */
export function parseDeviceClock(output: string, hostNowMs: number): DeviceClock | null {
  const m = /(\d{9,})\.(\S*?)\.(\d{2})-(\d{2})\.(\d{2}):(\d{2}):(\d{2})/.exec(output);
  if (!m) return null;
  const [, secs, nanos, mo, d, h, mi, s] = m;
  const asLogged = parseThreadtimeLine(
    `${mo}-${d} ${h}:${mi}:${s}.000     0     0 I clock: now`,
    new Date(hostNowMs),
  );
  if (!asLogged) return null;
  // Without nanoseconds, the phone's instant was within the second after `%s`.
  const fraction = /^\d{9}$/.test(nanos) ? Math.floor(Number(nanos) / 1e6) : 500;
  const phoneNow = Number(secs) * 1000 + fraction;
  return {
    zoneShiftMs: Math.round((phoneNow - asLogged.ts) / QUARTER_HOUR_MS) * QUARTER_HOUR_MS,
    skewMs: hostNowMs - phoneNow,
  };
}

/** A row of the session's Device logs. */
export interface DeviceLogLine {
  message: string;
  timestamp: Date;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * A record as logcat's threadtime format prints it (logprint.cpp,
 * `"%s %5d %5d %c %-8s: "`): the time as the phone printed it, then the pid,
 * the tid, the level, the tag and the message. The dashboard reads the level
 * from this text (log-derive.ts), and it is what Android developers know.
 */
export function formatThreadtime(rec: LogcatRecord): string {
  // `ts` was built from the printed fields as this server's local time, so
  // its local fields are the printed ones.
  const t = new Date(rec.ts);
  const time =
    `${pad(t.getMonth() + 1)}-${pad(t.getDate())} ` +
    `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}.${pad(t.getMilliseconds(), 3)}`;
  const pid = String(rec.pid).padStart(5);
  const tid = String(rec.tid).padStart(5);
  return `${time} ${pid} ${tid} ${rec.level} ${rec.tag.padEnd(8)}: ${rec.message}`;
}

const count = (n: number) => n.toLocaleString('en-US');

/** What a stream may still deliver: records after `ts`, or at `ts` and not among `keys`. */
interface Floor {
  ts: number;
  keys: Set<string>;
}

const keyOf = (r: LogcatRecord) => `${r.pid} ${r.tid} ${r.level} ${r.tag} ${r.message}`;
const isError = (r: LogcatRecord) => r.level === 'E' || r.level === 'F';

export interface DeviceLogBookOptions {
  /** When the phone was given to the session, by this server's clock. */
  since: number;
  clock: DeviceClock;
  lineLimit?: number;
  errorLimit?: number;
  /** A kept record's row text. Default: logcat's threadtime line. */
  format?: (rec: LogcatRecord) => string;
}

export class DeviceLogBook {
  private readonly clock: DeviceClock;
  private readonly format: (rec: LogcatRecord) => string;
  private readonly lineLimit: number;
  private readonly errorLimit: number;
  private floor: Floor;
  /** The newest record seen in the session (kept or left out), and the ones at its millisecond. */
  private newest: Floor | undefined;
  private kept = 0;
  private leftOut = 0;
  private limitNoted = false;

  constructor(opts: DeviceLogBookOptions) {
    this.clock = opts.clock;
    this.format = opts.format ?? formatThreadtime;
    this.lineLimit = opts.lineLimit ?? DEVICE_LOG_LINE_LIMIT;
    this.errorLimit = opts.errorLimit ?? DEVICE_LOG_ERROR_LIMIT;
    // A record at `ts` was logged at ts + zoneShift + skew by this server's
    // clock (timeOf); it counts from WINDOW_SLACK_MS before `since`.
    const first = opts.since - WINDOW_SLACK_MS - this.clock.zoneShiftMs - this.clock.skewMs;
    this.floor = { ts: Math.ceil(first), keys: new Set() };
  }

  /** The rows a record adds: none, its own, or a note before it. */
  add(rec: LogcatRecord): DeviceLogLine[] {
    // The stream's own notes (a slow viewer's dropped lines, its end) aren't
    // the phone's; the service notes an interruption itself.
    if (rec.synthetic) return [];
    const key = keyOf(rec);
    if (rec.ts < this.floor.ts || (rec.ts === this.floor.ts && this.floor.keys.has(key))) {
      return [];
    }
    if (!this.newest || rec.ts > this.newest.ts) this.newest = { ts: rec.ts, keys: new Set([key]) };
    else if (rec.ts === this.newest.ts) this.newest.keys.add(key);

    const out: DeviceLogLine[] = [];
    if (this.kept >= this.lineLimit && !this.limitNoted) {
      this.limitNoted = true;
      out.push(
        this.note(
          `This session reached ${count(this.lineLimit)} device log lines. ` +
            'From here on, only errors are kept.',
          this.timeOf(rec),
        ),
      );
    }
    const room =
      this.kept < this.lineLimit || (isError(rec) && this.kept < this.lineLimit + this.errorLimit);
    if (room) {
      this.kept += 1;
      out.push({ message: this.format(rec), timestamp: this.timeOf(rec) });
    } else {
      this.leftOut += 1;
    }
    return out;
  }

  /**
   * The stream ended while the session runs. The next one starts with
   * history, so it may deliver only what is newer than what was seen.
   */
  interrupted(at: Date): DeviceLogLine[] {
    if (this.newest) this.floor = { ts: this.newest.ts, keys: new Set(this.newest.keys) };
    return [this.note("The phone's log was interrupted. Lines may be missing from here.", at)];
  }

  /** The session ended: what was left out, if anything. */
  finish(at: Date): DeviceLogLine[] {
    if (this.leftOut === 0) return [];
    const lines =
      this.leftOut === 1 ? '1 device log line was' : `${count(this.leftOut)} device log lines were`;
    return [this.note(`${lines} left out to keep this session's log within its limit.`, at)];
  }

  /** Lines kept so far. */
  get keptLines(): number {
    return this.kept;
  }

  private timeOf(rec: LogcatRecord): Date {
    return new Date(rec.ts + this.clock.zoneShiftMs + this.clock.skewMs);
  }

  private note(text: string, at: Date): DeviceLogLine {
    return { message: `Xenon: ${text}`, timestamp: at };
  }
}
