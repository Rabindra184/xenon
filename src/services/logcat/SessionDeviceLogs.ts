import { Container, Service } from 'typedi';
import log from '../../logger';
import { prisma } from '../../prisma';
import type { IDevice } from '../../interfaces/IDevice';
import { PluginContext } from '../../PluginContext';
import { isOwnDevice, localDeviceHosts } from '../../device-managers/localDeviceHosts';
import { LogcatStreamService } from '../../device-managers/android/LogcatStreamService';
import type { LogcatMultiplexer } from '../../device-managers/android/LogcatMultiplexer';
import { adbForPhone } from '../network/adbForPhone';
import { NodeDeviceLogStore } from './NodeDeviceLogStore';
import { NodeDeviceLogsCollector, StoredLine } from './NodeDeviceLogsCollector';
import { NodeDeviceLogsSource, NodeDeviceLogsSupport, UNCLAIMED_MS } from './nodeDeviceLogs';
import {
  DEVICE_CLOCK_COMMAND,
  DeviceClock,
  DeviceLogBook,
  DeviceLogLine,
  UNKNOWN_CLOCK,
  parseDeviceClock,
} from './deviceLogBook';

/** How often a session's new lines are written. */
export const FLUSH_INTERVAL_MS = 5_000;
/** Lines per write, and how many waiting lines start one before the interval. */
export const WRITE_BATCH = 500;
/** The phone's `date`, read once a session; one that hangs this long is unknown. */
const CLOCK_TIMEOUT_MS = 5_000;
/** Waits before opening the phone's log stream again: doubling from the first, up to the last. */
const RETRY_FIRST_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/**
 * The newest stored rows a hub reads when its collection resumes after a
 * restart, to find where they end in the node's first answer.
 */
const RESUME_TAIL = 32;

export interface DeviceLogsStart {
  sessionId: string;
  device: IDevice;
  /** When the phone was given to the session, by this server's clock: lines count from about then. */
  since?: number;
  /** A session on a node's phone (a hub's RemoteSession): its lines are collected from the node. */
  source?: NodeDeviceLogsSource;
  /** Collecting again after a hub restart: new lines go after the newest one stored. */
  resume?: boolean;
}

interface Running {
  udid: string;
  /** Made once the phone's clock is read. */
  book?: DeviceLogBook;
  /** Rows waiting to be written, in order. */
  buffer: DeviceLogLine[];
  /** None on a node, which holds the rows for its hub instead of writing them. */
  flushTimer?: ReturnType<typeof setInterval>;
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
  /** On a node: the rows go to the NodeDeviceLogStore, for the hub to collect. */
  held: boolean;
  /** On a node: stops recording a session no hub has asked about (UNCLAIMED_MS). */
  unclaimedTimer?: ReturnType<typeof setTimeout>;
  /** On a hub, for a node's phone: asks the node for the session's lines. */
  collector?: NodeDeviceLogsCollector;
  /** On a hub, until the collector exists (a resume reads what is stored first). */
  collecting?: Promise<void>;
}

/**
 * The session page's Device logs for a session on this server's own Android
 * phone: its lines from start to end, each once, with its own time and level,
 * up to a limit (DeviceLogBook).
 *
 * The session listens to the phone's log stream (LogcatStreamService, one
 * `adb logcat` per phone, which the device page's Logs viewer may share) from
 * EventManager's start, once the session's row exists, to its stop, which
 * every ending reaches. While it listens, the stream has a viewer, so its idle
 * stop leaves it running; afterwards it stops 30 s after its last viewer, as
 * ever. The session never stops or restarts it. If the stream ends (the phone
 * restarted, or was unplugged), the session opens it again and notes the gap.
 *
 * A node records the sessions its hub creates the same way, whatever its
 * dashboard setting, but has no Session row for them: it holds the rows in
 * memory (NodeDeviceLogStore) for the hub to collect, and stops recording a
 * session no hub has asked about within UNCLAIMED_MS (a hub with its
 * dashboard off never asks). On a hub, a session on a node's phone gets a
 * NodeDeviceLogsCollector instead, which asks the node for the rows and
 * writes them here, in the order the node kept them.
 *
 * Until 2.14 each recorded command dumped the last 500 lines (`logcat -d`),
 * kept the last 100 and skipped as many as the previous dump had given, so
 * after the first command nothing more was ever saved, each line stamped with
 * the time it was saved.
 */
@Service()
export class SessionDeviceLogs {
  private log = log.scope('DeviceLogs');
  private running = new Map<string, Running>();
  /** Stops under way: a second ending waits for the first one's last lines. */
  private stopping = new Map<string, Promise<void>>();

  /**
   * Whether a session on this phone is recorded: an Android phone (or
   * emulator) this server drives, or, on a hub, a node's through its session.
   */
  appliesTo(device: IDevice | undefined, source?: NodeDeviceLogsSource): boolean {
    if (!device || device.cloud) return false;
    if (String(device.platform ?? '').toLowerCase() !== 'android') return false;
    if (this.ownPhone(device)) return true;
    // A node's phone isn't reachable with this server's adb: on a hub, its
    // lines are collected from the node. Never a cloud provider's (above).
    return !!source && !this.holdsForHub();
  }

  private ownPhone(device: IDevice): boolean {
    const ctx = this.context();
    return isOwnDevice(localDeviceHosts(ctx.pluginArgs, ctx.port), ctx.nodeId, device);
  }

  /**
   * Starts recording the session's device log. Resolves once it listens to
   * the phone's stream (or is waiting to try again), or asks the node;
   * callers needn't wait.
   */
  start({ sessionId, device, since, source, resume }: DeviceLogsStart): Promise<void> {
    if (this.running.has(sessionId) || !this.appliesTo(device, source)) return Promise.resolve();
    // A node has no Session row for the hub's sessions, so it holds the rows
    // for its hub to collect (GET /node/sessions/:id/device-logs).
    const held = this.holdsForHub();
    const entry: Running = {
      udid: device.udid,
      buffer: [],
      writing: Promise.resolve(),
      lastCreatedAt: 0,
      attempts: 0,
      stopped: false,
      held,
    };
    if (!held) {
      entry.flushTimer = setInterval(
        () => void this.write(sessionId, entry),
        this.flushIntervalMs(),
      );
      entry.flushTimer.unref?.();
    }
    this.running.set(sessionId, entry);
    const warn = (err: any) =>
      this.log.warn(`[${sessionId}] Device log not recorded: ${err?.message ?? err}`);
    if (source && !this.ownPhone(device)) {
      this.log.info(`[${sessionId}] Collecting the device log of ${device.udid} from its node`);
      entry.collecting = this.collect(sessionId, entry, source, resume === true).catch(warn);
      return entry.collecting;
    }
    if (held) {
      this.nodeStore().begin(sessionId);
      entry.unclaimedTimer = setTimeout(() => this.dropUnclaimed(sessionId), this.unclaimedMs());
      entry.unclaimedTimer.unref?.();
    }
    this.log.info(`[${sessionId}] Recording the device log of ${device.udid}`);
    return this.open(sessionId, entry, since ?? Date.now()).catch(warn);
  }

  /**
   * Stops listening and writes what is left (on a node, holds it for the
   * hub). Idempotent: a stop while one is under way resolves with it, once
   * the last lines are written, since what follows an ending (the failure
   * analysis) reads them.
   */
  stop(sessionId: string): Promise<void> {
    const underway = this.stopping.get(sessionId);
    if (underway) return underway;
    const entry = this.running.get(sessionId);
    if (!entry) return Promise.resolve();
    const done = this.finishStop(sessionId, entry).finally(() => this.stopping.delete(sessionId));
    this.stopping.set(sessionId, done);
    return done;
  }

  private async finishStop(sessionId: string, entry: Running): Promise<void> {
    this.halt(sessionId, entry);
    // On a hub: the node's last lines. Its session ended first (the hub's
    // DELETE reached it), so they are all there.
    if (entry.collecting) await entry.collecting;
    if (entry.collector) await entry.collector.stop();
    if (entry.book) this.keep(sessionId, entry, entry.book.finish(new Date()));
    if (entry.held) this.nodeStore().end(sessionId);
    else await this.write(sessionId, entry);
  }

  /** Stops listening, with nothing more written or held. */
  private halt(sessionId: string, entry: Running): void {
    this.running.delete(sessionId);
    entry.stopped = true;
    if (entry.flushTimer) clearInterval(entry.flushTimer);
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    if (entry.unclaimedTimer) clearTimeout(entry.unclaimedTimer);
    entry.remove?.();
    entry.remove = undefined;
  }

  /**
   * On a node: no hub has asked about the session since it started, so none
   * collects it (a hub with its dashboard off, the default, or an older
   * one). Recording it would run the phone's log stream and hold up to the
   * book's limit for nothing.
   */
  private dropUnclaimed(sessionId: string): void {
    const entry = this.running.get(sessionId);
    if (!entry || this.nodeStore().claimed(sessionId)) return;
    this.halt(sessionId, entry);
    this.nodeStore().forget(sessionId);
    this.log.debug(
      `[${sessionId}] No hub asked for the device log of ${entry.udid}; stopped recording it`,
    );
  }

  /**
   * On a hub: asks the node for the session's lines and writes each answer's
   * at once. After a restart, new rows go after the newest ones stored.
   */
  private async collect(
    sessionId: string,
    entry: Running,
    source: NodeDeviceLogsSource,
    resume: boolean,
  ): Promise<void> {
    let tail: Array<StoredLine & { createdAt: number }> = [];
    if (resume) {
      try {
        tail = await this.storedTail(sessionId);
      } catch (err: any) {
        this.log.warn(
          `[${sessionId}] Can't read the newest device log lines stored: ${err?.message ?? err}`,
        );
      }
      if (tail.length > 0) entry.lastCreatedAt = tail[tail.length - 1].createdAt;
    }
    entry.collector = this.collectorFor(
      source,
      (rows) => {
        this.keep(sessionId, entry, rows);
        return this.write(sessionId, entry);
      },
      tail.map(({ message, timestamp }) => ({ message, timestamp })),
    );
    // Made even when the session ended meanwhile: its stop then asks the
    // node once, for the last lines.
    if (!entry.stopped) entry.collector.start();
  }

  /** The session's new rows: held for the hub on a node, else written soon. */
  private keep(sessionId: string, entry: Running, rows: DeviceLogLine[]): void {
    if (rows.length === 0) return;
    if (entry.held) {
      this.nodeStore().add(sessionId, rows);
      return;
    }
    entry.buffer.push(...rows);
    if (entry.buffer.length >= WRITE_BATCH) void this.write(sessionId, entry);
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
        this.keep(sessionId, entry, book.add(rec));
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
          this.keep(sessionId, entry, note);
          this.log.info(`[${sessionId}] The device log of ${entry.udid} ended; opening it again`);
        }
        this.retry(sessionId, entry);
      },
    );
    entry.remove = remove;
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

  /** A node (a server with `hub`) holds the rows for its hub instead of writing them. */
  protected holdsForHub(): boolean {
    return this.context().pluginArgs?.hub !== undefined;
  }

  protected nodeStore(): NodeDeviceLogStore {
    return Container.get(NodeDeviceLogStore);
  }

  protected unclaimedMs(): number {
    return UNCLAIMED_MS;
  }

  protected collectorFor(
    source: NodeDeviceLogsSource,
    onLines: (rows: DeviceLogLine[]) => Promise<void>,
    storedTail: StoredLine[],
  ): NodeDeviceLogsCollector {
    return new NodeDeviceLogsCollector({
      source,
      onLines,
      storedTail,
      support: Container.get(NodeDeviceLogsSupport),
      logger: this.log,
    });
  }

  /** The session's newest Device logs rows, by `createdAt`, oldest first. */
  protected async storedTail(
    sessionId: string,
  ): Promise<Array<StoredLine & { createdAt: number }>> {
    const rows = await prisma.log.findMany({
      where: { session_id: sessionId, log_type: 'DEVICE' },
      orderBy: { createdAt: 'desc' },
      take: RESUME_TAIL,
      select: { message: true, timestamp: true, createdAt: true },
    });
    return rows.reverse().map((row) => ({
      message: row.message,
      timestamp: row.timestamp.getTime(),
      createdAt: row.createdAt.getTime(),
    }));
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
