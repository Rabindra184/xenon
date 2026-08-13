import { Service, Container } from 'typedi';
import { spawn, execFile, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import readline from 'readline';
import { appIdForProcess, parseInstalledApps } from './iosAppIds';
import log from '../../logger';
import { SingleFlight } from '../../helpers/singleFlight';
import { LogcatMultiplexer } from '../android/LogcatMultiplexer';
import { parseOstraceLine } from '../../services/logcat/ostraceParse';
import type { ChildProcessLike } from '../android/LogcatStreamService';
import { IDLE_TIMEOUT_MS, IDLE_POLL_MS } from '../android/LogcatStreamService';

/**
 * Which slice of os_trace to stream. These are pushed down to `go-ios ostrace`
 * rather than applied after the fact, because the unfiltered firehose cannot be
 * read at the rate it arrives — see DEFAULT_LEVELS.
 */
const execFileAsync = promisify(execFile);

export interface IOSLogOptions {
  /** os_log level names to include. Omitted means DEFAULT_LEVELS. */
  levels?: string[];
  /** Process name, e.g. `SpringBoard`. Omitted means every process. */
  process?: string;
}

/**
 * Everything except Debug.
 *
 * Measured on an idle iPhone 14 (iOS 26.5.2): Debug alone is 5,485 lines/sec —
 * 97% of all os_trace volume — while Info, Default and Error together are
 * ~335/sec, the same ballpark as `adb logcat` on a Galaxy S9. Streaming Debug
 * device-wide would mean the pane showing little but drop markers, so it is
 * opt-in: selecting it in the level dropdown re-subscribes with Debug included,
 * and narrowing to one process brings it back to ~115/sec.
 */
export const DEFAULT_LEVELS = ['Info', 'Default', 'Error', 'Fault'];

interface Session {
  mux: LogcatMultiplexer;
  proc: ChildProcessLike;
  /** Levels the running child was spawned with — only ever widened. */
  levels: string[];
  appIds: Map<string, string>;
  /**
   * Bumped whenever the child is replaced. The exit handlers of a child we
   * deliberately killed must not tear the session down, and comparing the
   * session object is not enough because widening keeps the same object.
   */
  generation: number;
}

/**
 * Levels the child must run with to satisfy both what it already streams and
 * what a new viewer wants. Union, never intersection: a viewer asking for less
 * is served by filtering downstream, but a viewer asking for more cannot be
 * served by a child that was never told to emit it.
 */
export function widenLevels(current: string[], wanted: string[]): string[] {
  return [...new Set([...current, ...wanted])];
}

/** True when the running child already emits everything `wanted` needs. */
export function levelsCovered(current: string[], wanted: string[]): boolean {
  return wanted.every((l) => current.includes(l));
}

/**
 * One continuous `go-ios ostrace` process per (device, filter), parsed and
 * fanned out through a {@link LogcatMultiplexer} — the iOS half of the Debug
 * Logs tab, and a deliberate mirror of {@link LogcatStreamService}.
 *
 * Simpler than the Android side in three ways, all of them because os_trace is
 * structured where logcat is text: every line is a complete JSON record, so
 * there is no continuation-line buffering; the timestamp is ISO 8601 with an
 * offset, so there is no year to infer; and the process name is carried on each
 * record, so there is no `PackageResolver` and none of the ordering machinery
 * its variable latency required.
 */
@Service()
export class IOSLogStreamService {
  private sessions = new Map<string, Session>();
  private readonly starts = new SingleFlight<LogcatMultiplexer>();

  constructor() {
    this.startWatchdog();
  }

  private startWatchdog(): void {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [key, s] of this.sessions.entries()) {
        const emptySince = s.mux.emptySince;
        if (emptySince === undefined) continue;
        if (now - emptySince > IDLE_TIMEOUT_MS) {
          log.info(`[${key}] Stopping idle os_trace stream (no viewers for ${IDLE_TIMEOUT_MS}ms)`);
          void this.stop(key);
        }
      }
    }, IDLE_POLL_MS);
    timer.unref?.();
  }

  getMultiplexer(udid: string): LogcatMultiplexer | undefined {
    return this.sessions.get(udid)?.mux;
  }

  /**
   * The device's log stream, widened if this caller needs levels the running
   * child does not emit.
   *
   * ONE child per device, never one per filter. os_trace_relay serves a single
   * consumer: measured against an iPhone 14, three concurrent `ostrace`
   * processes left every one of them silent — including a fresh capture taken
   * from a shell — and killing them restored 2,223 lines in 10s immediately.
   * A second child is not a second view of the logs, it is the end of the
   * first.
   *
   * So the per-viewer filter cannot live in the child's arguments. Only the
   * level does, because that is where 97% of the volume is and every viewer
   * can be served from a superset; process and level narrowing for a
   * particular socket happen where that socket is written to.
   */
  async start(udid: string, opts: IOSLogOptions = {}): Promise<LogcatMultiplexer> {
    const wanted = opts.levels ?? DEFAULT_LEVELS;
    const existing = this.sessions.get(udid);
    if (existing) {
      if (levelsCovered(existing.levels, wanted)) return existing.mux;
      // Widen in place: replace the child, keep the multiplexer, so viewers
      // already attached keep their sockets and their buffers and see only a
      // gap. Never narrowed again while the session lives — the idle watchdog
      // tears it down 30s after the last viewer leaves, which resets it.
      await this.respawn(udid, existing, widenLevels(existing.levels, wanted));
      return existing.mux;
    }

    return this.starts.run(udid, async () => {
      const already = this.sessions.get(udid);
      if (already) return already.mux;

      const mux = new LogcatMultiplexer();
      // Read once, here, rather than per record. Android resolves pid →
      // package asynchronously for every line and needs a flushChain to stop
      // the varying latency reordering them; a start-time snapshot keeps the
      // hot path synchronous and needs none of that.
      const appIds = await this.loadAppIds(udid);
      const proc = await this.spawnOstrace(udid, { levels: wanted });
      const session: Session = { mux, proc, levels: wanted, appIds, generation: 0 };
      this.sessions.set(udid, session);
      this.wire(udid, session);
      return mux;
    });
  }

  /** Attach the reader and exit handlers to the session's current child. */
  private wire(udid: string, session: Session): void {
    const generation = session.generation;
    const proc = session.proc;

    if (proc.stdout) {
      const rl = readline.createInterface({ input: proc.stdout });
      rl.on('line', (line: string) => {
        const rec = parseOstraceLine(line);
        // go-ios writes its own progress and warnings to the same stream, and
        // a line that is not a record is simply not one — there is no
        // continuation to append it to, unlike logcat.
        if (!rec) return;
        // An os_trace record names the binary, never the app. Translating it
        // here is what lets `package:com.example.app` mean the same thing on
        // iOS as it already does on Android.
        rec.pkg = appIdForProcess(rec.pkg, session.appIds);
        session.mux.push(rec);
      });
    }

    const end = (reason: string) => {
      // A child we replaced ourselves exits on cue; that is not the stream
      // ending. The session object survives a widen, so the generation is what
      // distinguishes them.
      if (this.sessions.get(udid) !== session || session.generation !== generation) return;
      this.sessions.delete(udid);
      session.mux.push({
        ts: Date.now(),
        pid: 0,
        tid: 0,
        level: 'E',
        tag: 'xenon',
        message: `log stream ended (${reason})`,
        synthetic: true,
      });
      // Close AFTER the record, so a client sees why it is being dropped.
      session.mux.close();
    };
    proc.on('close', () => end('process exited'));
    proc.on('error', () => end('process error'));
  }

  /**
   * Replace the child with one emitting `levels`, keeping the multiplexer.
   *
   * The generation is bumped BEFORE the old child is killed, so its exit
   * handler recognises itself as superseded and leaves the session alone.
   */
  private async respawn(udid: string, session: Session, levels: string[]): Promise<void> {
    log.info(`[${udid}] widening os_trace levels to ${levels.join(',')}`);
    const old = session.proc;
    session.generation += 1;
    try {
      old.kill();
    } catch {
      /* already gone */
    }
    session.levels = levels;
    session.proc = await this.spawnOstrace(udid, { levels });
    this.wire(udid, session);
  }

  /** Stop every stream. Called from the process-level shutdown in src/index.ts. */
  async cleanup(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((key) => this.stop(key)));
  }

  /**
   * Synchronously kill every ostrace child — the safety net for `cleanup()`,
   * for the same reason LogcatStreamService has one: Appium's SIGTERM handler
   * exits the process before this plugin's async cleanup runs, so only a
   * `process.on('exit')` hook is guaranteed, and that hook forbids async work.
   */
  killAllSync(): void {
    for (const s of this.sessions.values()) {
      try {
        s.proc.kill();
      } catch {
        /* best-effort: a child already gone is the desired state */
      }
    }
    this.sessions.clear();
  }

  async stop(key: string): Promise<void> {
    const s = this.sessions.get(key);
    if (!s) return;
    this.sessions.delete(key);
    // Release the viewers, exactly as the process-exit path does — otherwise an
    // explicit stop with viewers attached leaves them on a frozen mux, since
    // the killed child's own 'close' hits the stray-suppression guard above.
    s.mux.close();
    try {
      s.proc.kill();
    } catch {
      /* best-effort */
    }
  }

  /**
   * Stop the device's stream. There is exactly one — filters no longer fork
   * the session, so this is `stop` under the name callers already use.
   */
  async stopDevice(udid: string): Promise<void> {
    await this.stop(udid);
  }

  // ---------------------------------------------------------------------
  // Seams. Overridden by test subclasses; the defaults are the real thing.
  // ---------------------------------------------------------------------

  protected async spawnOstrace(udid: string, opts: IOSLogOptions): Promise<ChildProcessLike> {
    const goIOS = await this.goIOSPath();
    const args = ['ostrace', `--udid=${udid}`];
    // The level goes to the source, because that is where 97% of the volume
    // is and where dropping it costs nothing.
    const levels = opts.levels ?? DEFAULT_LEVELS;
    if (levels.length) args.push(`--level=${levels.join(',')}`);
    // The process deliberately does NOT, for two independent reasons. This
    // child is shared by every viewer of the device, so a per-viewer process
    // filter here would be one viewer's filter imposed on all of them. And
    // go-ios 1.2.1 accepts `--process=<name>` and then matches nothing at all:
    // measured against an iPhone 14, every value tried — bare name, full path,
    // altered case — returned 0 lines, while `--level` alone returned 48,195
    // and `--pid` returned 58,960 for that same process.

    const proc = this.spawnProcess(goIOS, args);
    // A ChildProcess emitting 'error' with no listener crashes the process.
    proc.on('error', (e) => log.warn(`[${udid}] ostrace process error: ${e.message}`));
    proc.stderr?.on('data', (d: Buffer) => log.debug(`[${udid}] ostrace: ${d.toString().trim()}`));
    return proc as unknown as ChildProcessLike;
  }

  /**
   * The vendored go-ios binary. Imported dynamically for the same reason the
   * Android services do it — a static import across device-manager directories
   * risks a module cycle at load time — and never a bare `ios`, since a server
   * launched from the Mac app has no shell PATH.
   */
  protected async goIOSPath(): Promise<string> {
    const { default: IOSStreamService } = await import('./IOSStreamService');
    return Container.get(IOSStreamService).goIOSPath;
  }

  protected spawnProcess(command: string, args: string[]): ChildProcess {
    return spawn(command, args);
  }

  /**
   * Executable → bundle id for the installed apps.
   *
   * `ios apps` needs no tunnel, unlike `ios ps`, which is why the map is built
   * from installed apps rather than running processes: the log stream must not
   * acquire a dependency on tunnel state it does not otherwise need.
   *
   * Never throws. A device that cannot list its apps yields an empty map and
   * the stream falls back to executable names — the behaviour before app ids
   * existed — rather than failing to start.
   */
  protected async loadAppIds(udid: string): Promise<Map<string, string>> {
    try {
      const goIOS = await this.goIOSPath();
      const stdout = await this.execCapture(goIOS, ['apps', `--udid=${udid}`]);
      const map = parseInstalledApps(stdout);
      log.debug(`[${udid}] resolved ${map.size} app id(s) for log attribution`);
      return map;
    } catch (err: any) {
      log.warn(`[${udid}] could not list apps for log attribution: ${err?.message ?? err}`);
      return new Map();
    }
  }

  protected async execCapture(command: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(command, args, { maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  }
}
