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
}

/**
 * A session is keyed by device AND filter, not by device alone.
 *
 * The filter lives in the child process's arguments, so two viewers wanting
 * different slices genuinely need different processes; sharing one mux between
 * them would silently give the second viewer the first viewer's filter.
 * Viewers asking for the same slice still share, which is the common case.
 */
export function sessionKey(udid: string, opts: IOSLogOptions = {}): string {
  const levels = [...(opts.levels ?? DEFAULT_LEVELS)].sort().join(',');
  return `${udid}|${levels}|${opts.process ?? ''}`;
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

  getMultiplexer(udid: string, opts?: IOSLogOptions): LogcatMultiplexer | undefined {
    return this.sessions.get(sessionKey(udid, opts))?.mux;
  }

  async start(udid: string, opts: IOSLogOptions = {}): Promise<LogcatMultiplexer> {
    const key = sessionKey(udid, opts);
    const existing = this.sessions.get(key);
    if (existing) return existing.mux;

    return this.starts.run(key, async () => {
      const mux = new LogcatMultiplexer();
      // Read once, here, rather than per record. Android resolves pid →
      // package asynchronously for every line and needs a flushChain to stop
      // the varying latency reordering them; a start-time snapshot keeps the
      // hot path synchronous and needs none of that.
      const appIds = await this.loadAppIds(udid);
      const proc = await this.spawnOstrace(udid, opts);
      const session: Session = { mux, proc };
      this.sessions.set(key, session);

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
          const executable = rec.pkg;
          rec.pkg = appIdForProcess(executable, appIds);

          // Accept either form. The app id is what the filter is documented
          // around, but a user reading the pane sees whatever is in front of
          // them, and refusing the name they can actually see would be a poor
          // way to reward them for typing it.
          if (opts.process && rec.pkg !== opts.process && executable !== opts.process) return;
          mux.push(rec);
        });
      }

      const end = (reason: string) => {
        // An intentional stop() already removed this session and killed the
        // process; the 'close' that follows is expected, not a failure.
        if (this.sessions.get(key) !== session) return;
        this.sessions.delete(key);
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

      return mux;
    });
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

  /** Stop every stream for a device, whatever filter each was started with. */
  async stopDevice(udid: string): Promise<void> {
    const keys = [...this.sessions.keys()].filter((k) => k.startsWith(`${udid}|`));
    await Promise.all(keys.map((k) => this.stop(k)));
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
    // The process deliberately does NOT. go-ios 1.2.1 accepts `--process=<name>`
    // and then matches nothing at all: measured against an iPhone 14, every
    // value tried — bare name, full path, altered case — returned 0 lines,
    // while `--level` alone returned 48,195 and `--pid` returned 58,960 for the
    // same process. Passing a flag that silently empties the stream is worse
    // than not passing it, so the process filter is applied when records are
    // read instead. `--pid` works, but a name maps to a pid that changes on
    // every relaunch, which is exactly what a log filter must survive.

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
