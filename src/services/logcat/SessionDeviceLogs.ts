import { Container, Service } from 'typedi';
import log from '../../logger';
import { prisma } from '../../prisma';
import type { IDevice } from '../../interfaces/IDevice';
import { PluginContext } from '../../PluginContext';
import { isOwnDevice, localDeviceHosts } from '../../device-managers/localDeviceHosts';
import { LogcatStreamService } from '../../device-managers/android/LogcatStreamService';
import type { LogcatMultiplexer } from '../../device-managers/android/LogcatMultiplexer';
import { adbForPhone } from '../network/adbForPhone';
import {
  DEVICE_CLOCK_COMMAND,
  DeviceClock,
  DeviceLogBook,
  DeviceLogLine,
  UNKNOWN_CLOCK,
  parseDeviceClock,
} from './deviceLogBook';
import {
  IosAppLines,
  bufferedDriverLog,
  iosLineText,
  isDriverLog,
  recordFromDriverLog,
  type DriverLogEntry,
} from './iosDriverLog';

/** How often a session's new lines are written. */
export const FLUSH_INTERVAL_MS = 5_000;
/** Lines per write, and how many waiting lines start one before the interval. */
export const WRITE_BATCH = 500;
/** The phone's `date`, read once a session; one that hangs this long is unknown. */
const CLOCK_TIMEOUT_MS = 5_000;
/** Waits before opening the phone's log stream again: doubling from the first, up to the last. */
const RETRY_FIRST_MS = 1_000;
const RETRY_MAX_MS = 30_000;

export interface DeviceLogsStart {
  sessionId: string;
  device: IDevice;
  /** When the phone was given to the session, by this server's clock: lines count from about then. */
  since?: number;
  /**
   * An iPhone or simulator session's: the XCUITest driver's own device log
   * (`driver.logs.syslog`, iosDriverLog.ts). Absent when the session skips
   * log capture.
   */
  driverLog?: unknown;
  /**
   * The bundle id of an iPhone or simulator session's app: its device log
   * keeps the app's lines, the lines that name it and faults (IosAppLines).
   * Without one it keeps every line.
   */
  appUnderTest?: string;
}

interface Running {
  udid: string;
  /** Made once the phone's clock is read. */
  book?: DeviceLogBook;
  /** Rows waiting to be written, in order. */
  buffer: DeviceLogLine[];
  flushTimer: ReturnType<typeof setInterval>;
  /** Writes run one after another. */
  writing: Promise<void>;
  /** The last `createdAt` written: each row's is one millisecond after the one before. */
  lastCreatedAt: number;
  /** Detaches from the stream's multiplexer, while attached. */
  remove?: () => void;
  retryTimer?: ReturnType<typeof setTimeout>;
  /** Stream opens that failed or delivered nothing since the last that did. */
  attempts: number;
  stopped: boolean;
}

/**
 * The session page's Device logs for a session on this server's own Android
 * phone, iPhone or simulator: its lines from start to end, each once, with
 * its own time and level, up to a limit (DeviceLogBook).
 *
 * An Android session listens to the phone's log stream (LogcatStreamService, one
 * `adb logcat` per phone, which the device page's Logs viewer may share) from
 * EventManager's start, once the session's row exists, to its stop, which
 * every ending reaches. While it listens, the stream has a viewer, so its idle
 * stop leaves it running; afterwards it stops 30 s after its last viewer, as
 * ever. The session never stops or restarts it. If the stream ends (the phone
 * restarted, or was unplugged), the session opens it again and notes the gap.
 *
 * An iPhone or simulator session listens to the XCUITest driver's own log
 * of the device (iosDriverLog.ts), which the driver captures from early in
 * the create to the session's end, after reading the lines it already holds.
 * Neither takes lines from the driver, so a test's own `getLog('syslog')` is
 * unchanged. It isn't the device page's Logs viewer stream (`go-ios
 * ostrace`): that one has no simulators, needs the phone's go-ios tunnel on
 * iOS 17+, serves one reader per phone and carries ten times the lines.
 *
 * Until 2.14 each recorded command dumped the last 500 lines (`logcat -d`),
 * kept the last 100 and skipped as many as the previous dump had given, so
 * after the first command nothing more was ever saved, each line stamped with
 * the time it was saved. iPhones lost lines the same way, and simulators
 * saved none.
 */
@Service()
export class SessionDeviceLogs {
  private log = log.scope('DeviceLogs');
  private running = new Map<string, Running>();

  /**
   * Whether a session on this device is recorded: an Android phone or
   * emulator, an iPhone or a simulator, that this server drives.
   */
  appliesTo(device: IDevice | undefined): boolean {
    if (!device || device.cloud) return false;
    if (!['android', 'ios', 'tvos'].includes(String(device.platform ?? '').toLowerCase())) {
      return false;
    }
    // A node's phone isn't reachable from here (its driver and its adb are
    // the node's); the node has the session, and no row for it.
    const ctx = this.context();
    return isOwnDevice(localDeviceHosts(ctx.pluginArgs, ctx.port), ctx.nodeId, device);
  }

  /**
   * Starts recording the session's device log. Resolves once it listens to
   * the phone's stream (or is waiting to try again); callers needn't wait.
   */
  start({ sessionId, device, since, driverLog, appUnderTest }: DeviceLogsStart): Promise<void> {
    if (this.running.has(sessionId) || !this.appliesTo(device)) return Promise.resolve();
    const android = String(device.platform).toLowerCase() === 'android';
    if (!android && !isDriverLog(driverLog)) {
      this.log.info(
        `[${sessionId}] No device log for ${device.udid}: the driver isn't capturing one ` +
          '(appium:skipLogCapture?)',
      );
      return Promise.resolve();
    }
    const entry: Running = {
      udid: device.udid,
      buffer: [],
      flushTimer: setInterval(() => void this.write(sessionId, entry), this.flushIntervalMs()),
      writing: Promise.resolve(),
      lastCreatedAt: 0,
      attempts: 0,
      stopped: false,
    };
    entry.flushTimer.unref?.();
    this.running.set(sessionId, entry);
    this.log.info(`[${sessionId}] Recording the device log of ${device.udid}`);
    const opened = android
      ? this.open(sessionId, entry, since ?? Date.now())
      : Promise.resolve(
          this.listenToDriver(sessionId, entry, since ?? Date.now(), driverLog, appUnderTest),
        );
    return opened.catch((err: any) =>
      this.log.warn(`[${sessionId}] Device log not recorded: ${err?.message ?? err}`),
    );
  }

  /** Stops listening and writes what is left. Idempotent. */
  async stop(sessionId: string): Promise<void> {
    const entry = this.running.get(sessionId);
    if (!entry) return;
    this.running.delete(sessionId);
    entry.stopped = true;
    clearInterval(entry.flushTimer);
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    entry.remove?.();
    entry.remove = undefined;
    if (entry.book) entry.buffer.push(...entry.book.finish(new Date()));
    await this.write(sessionId, entry);
  }

  /** Whether the session is recorded here. */
  isRecording(sessionId: string): boolean {
    return this.running.has(sessionId);
  }

  /**
   * A session that turned its device log off (`xe:save_device_logs`): its
   * Device logs tab says so, rather than look empty for no reason.
   */
  async noteOff(sessionId: string): Promise<void> {
    try {
      await this.writeLines(
        sessionId,
        [
          {
            message: "Xenon: This session's device log wasn't kept: the test turned it off.",
            timestamp: new Date(),
          },
        ],
        Date.now(),
      );
    } catch (err: any) {
      this.log.debug(
        `[${sessionId}] Couldn't note that the device log is off: ${err?.message ?? err}`,
      );
    }
  }

  private async open(sessionId: string, entry: Running, since: number): Promise<void> {
    let clock: DeviceClock | null = null;
    try {
      clock = await this.readClock(entry.udid);
    } catch (err: any) {
      this.log.debug(
        `[${sessionId}] Can't read the clock of ${entry.udid}: ${err?.message ?? err}`,
      );
    }
    if (!clock) {
      this.log.warn(
        `[${sessionId}] The clock of ${entry.udid} is unknown; its log lines are read as this server's time`,
      );
    }
    if (entry.stopped) return;
    entry.book = new DeviceLogBook({ since, clock: clock ?? UNKNOWN_CLOCK });
    await this.listen(sessionId, entry);
  }

  private async listen(sessionId: string, entry: Running): Promise<void> {
    entry.retryTimer = undefined;
    if (entry.stopped) return;
    let mux: LogcatMultiplexer;
    try {
      mux = await this.streams().start(entry.udid);
    } catch (err: any) {
      if (entry.attempts === 0) {
        this.log.warn(
          `[${sessionId}] Can't open the device log of ${entry.udid}: ${err?.message ?? err}. Trying again.`,
        );
      }
      this.retry(sessionId, entry);
      return;
    }
    // Stopped while the stream started: leave it to its own idle stop.
    if (entry.stopped) return;
    const book = entry.book as DeviceLogBook;
    let delivered = false;
    const remove = mux.addClient(
      (rec) => {
        if (rec.synthetic) return;
        if (!delivered) {
          delivered = true;
          entry.attempts = 0;
        }
        const rows = book.add(rec);
        if (rows.length === 0) return;
        entry.buffer.push(...rows);
        if (entry.buffer.length >= WRITE_BATCH) void this.write(sessionId, entry);
      },
      // Never refused: what the session keeps is bounded by its book.
      () => true,
      () => {
        if (entry.remove === remove) entry.remove = undefined;
        if (entry.stopped) return;
        const note = book.interrupted(new Date());
        // A stream that delivered nothing (a phone that's gone) isn't noted
        // again on every try.
        if (delivered) {
          entry.buffer.push(...note);
          this.log.info(`[${sessionId}] The device log of ${entry.udid} ended; opening it again`);
        }
        this.retry(sessionId, entry);
      },
    );
    entry.remove = remove;
  }

  /**
   * An iPhone or simulator: the lines the driver already holds, then each one
   * as it arrives, until the session stops. Synchronous, so no line can arrive
   * between the two. Stamped with the time each reached this server, a moment
   * after the device logged it.
   */
  private listenToDriver(
    sessionId: string,
    entry: Running,
    since: number,
    driverLog: unknown,
    appUnderTest: string | undefined,
  ): void {
    if (!isDriverLog(driverLog)) return;
    const book = new DeviceLogBook({ since, clock: UNKNOWN_CLOCK, format: iosLineText });
    entry.book = book;
    const appLines = appUnderTest ? new IosAppLines(appUnderTest) : undefined;
    if (appLines) {
      entry.buffer.push({
        message:
          `Xenon: Kept here: what the app under test (${appUnderTest}) logs itself, ` +
          'every error inside it, what the phone says about its launch, state, crashes ' +
          "and end, and faults. The rest of the phone's log is left out.",
        timestamp: new Date(since),
      });
    }
    const take = (line: DriverLogEntry) => {
      const rec = recordFromDriverLog(line);
      if (!rec) return;
      if (appLines && !appLines.keeps(rec.message, rec.level)) return;
      const rows = book.add(rec);
      if (rows.length === 0) return;
      entry.buffer.push(...rows);
      if (entry.buffer.length >= WRITE_BATCH) void this.write(sessionId, entry);
    };
    // The create's lines first teach the filter the app's process, so its
    // first lines aren't lost to an announcement that comes after them.
    const buffered = bufferedDriverLog(driverLog);
    for (const line of buffered) appLines?.learn(line.message ?? '');
    for (const line of buffered) take(line);
    driverLog.on('output', take);
    entry.remove = () => driverLog.removeListener('output', take);
  }

  private retry(sessionId: string, entry: Running): void {
    if (entry.stopped || entry.retryTimer) return;
    entry.attempts += 1;
    const delay = Math.min(this.retryFirstMs() * 2 ** (entry.attempts - 1), RETRY_MAX_MS);
    entry.retryTimer = setTimeout(() => void this.listen(sessionId, entry), delay);
    entry.retryTimer.unref?.();
  }

  /**
   * Writes what is waiting, WRITE_BATCH rows at a time. On a failure the rows
   * wait for the next write: the book bounds how many there can be.
   */
  private write(sessionId: string, entry: Running): Promise<void> {
    entry.writing = entry.writing.then(async () => {
      while (entry.buffer.length > 0) {
        const batch = entry.buffer.splice(0, WRITE_BATCH);
        // The session's rows are read in `createdAt` order, so each is a
        // millisecond after the one before: the lines of one moment (a stack
        // trace's) keep their order whatever the database.
        const first = Math.max(Date.now(), entry.lastCreatedAt + 1);
        try {
          await this.writeLines(sessionId, batch, first);
          entry.lastCreatedAt = first + batch.length - 1;
        } catch (err: any) {
          entry.buffer.unshift(...batch);
          this.log.warn(
            `[${sessionId}] Writing ${batch.length} device log lines failed: ${err?.message ?? err}`,
          );
          return;
        }
      }
    });
    return entry.writing;
  }

  // ---------------------------------------------------------------------
  // Seams. Overridden by tests; the defaults are the real thing.
  // ---------------------------------------------------------------------

  protected context(): PluginContext {
    return Container.get(PluginContext);
  }

  protected streams(): Pick<LogcatStreamService, 'start'> {
    return Container.get(LogcatStreamService);
  }

  protected flushIntervalMs(): number {
    return FLUSH_INTERVAL_MS;
  }

  protected retryFirstMs(): number {
    return RETRY_FIRST_MS;
  }

  /** The phone's clock against this server's, or null if its answer isn't one. */
  protected async readClock(udid: string): Promise<DeviceClock | null> {
    const adb = await adbForPhone(udid);
    const asked = Date.now();
    // One word: the phone's shell would take a second one as a time to set.
    const out = await adb.adbExec(['-s', udid, 'shell', DEVICE_CLOCK_COMMAND], {
      timeout: CLOCK_TIMEOUT_MS,
    });
    return parseDeviceClock(String(out ?? ''), (asked + Date.now()) / 2);
  }

  protected async writeLines(
    sessionId: string,
    lines: DeviceLogLine[],
    firstCreatedAt: number,
  ): Promise<void> {
    await prisma.log.createMany({
      data: lines.map((line, i) => ({
        session_id: sessionId,
        log_type: 'DEVICE',
        message: line.message,
        timestamp: line.timestamp,
        createdAt: new Date(firstCreatedAt + i),
      })),
    });
  }
}
