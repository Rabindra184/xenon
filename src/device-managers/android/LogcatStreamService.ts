import { Service, Container } from 'typedi';
import { spawn, execFile, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import readline from 'readline';
import log from '../../logger';
import { SingleFlight } from '../../helpers/singleFlight';
import { LogcatMultiplexer } from './LogcatMultiplexer';
import { PackageResolver } from '../../services/logcat/PackageResolver';
import { parseThreadtimeLine, type LogcatRecord } from '../../services/logcat/logcatParse';

const execFileAsync = promisify(execFile);

/** Stop a stream 30s after the last viewer leaves — long enough to survive a
 * tab reload, short enough not to hold an adb channel per device indefinitely. */
export const IDLE_TIMEOUT_MS = 30_000;

/**
 * How often the watchdog looks for an expired stream. This bounds *detection*
 * only: the multiplexer stamps the moment it emptied, so the effective stop is
 * `IDLE_TIMEOUT_MS` plus at most one poll — a few percent, not the 33–67%
 * overshoot you get from a poller that also has to discover emptiness.
 * (AndroidH264StreamService polls at 60s against a 600s budget and gets away
 * with inferring it; a 30s budget cannot afford that.)
 */
export const IDLE_POLL_MS = 2_000;

/**
 * Bounds the `ps` round trip this service owns. PackageResolver deliberately
 * imposes no timeout of its own — a runner that never settles is the one
 * failure it cannot recover from — so the timeout belongs here, with the
 * process spawn.
 */
export const PS_TIMEOUT_MS = 5_000;

export interface ChildProcessLike {
  stdout: NodeJS.ReadableStream | null;
  on(ev: 'close' | 'error', cb: (arg?: unknown) => void): void;
  kill(): void;
}

/** The shape of an appium-adb handle this service actually reads. */
interface AdbLike {
  executable?: { path?: string };
  adbHost?: string;
  adbPort?: number | string;
}

interface Session {
  mux: LogcatMultiplexer;
  proc: ChildProcessLike;
  resolver: PackageResolver;
  /**
   * The record awaiting either a continuation line (appended in place) or the
   * next parsed record line, which closes it out and sends it on. Buffering
   * one record of lookahead is what stops a wrapped message from being sent
   * to clients before its continuation line has arrived and been appended.
   */
  pending?: LogcatRecord;
  /**
   * FIFO queue of "resolve package, then push" work. Package resolution
   * latency varies per pid (cache hit vs a cold `ps` round trip), so pushing
   * each record as soon as ITS OWN resolve() settles can reorder records
   * relative to the order their lines actually arrived in. Chaining every
   * push off the previous one preserves line order regardless of how long
   * any individual resolve() takes.
   */
  flushChain: Promise<void>;
}

/**
 * One continuous `adb logcat -v threadtime` process per device, parsed and
 * fanned out through a {@link LogcatMultiplexer}. Mirrors the lifecycle shape
 * of {@link AndroidH264StreamService}: an idle watchdog, start de-duplication
 * per udid, and a session dropped whole on process exit so the next viewer
 * always starts clean.
 *
 * Constructed by the container (`Container.get(LogcatStreamService)`), so the
 * constructor takes no arguments: with `emitDecoratorMetadata` on, any
 * constructor parameter without an injectable type makes TypeDI throw
 * `ServiceNotFoundError` at resolution time. The I/O boundaries are
 * `protected` seams instead, overridden by test subclasses — the same shape
 * `AndroidH264StreamService` uses for `openCapture` / `openScrcpyCapture`.
 */
@Service()
export class LogcatStreamService {
  private sessions = new Map<string, Session>();
  /**
   * Per-udid start de-duplication. The hand-rolled version of this is issue
   * #194 — a settled promise left in the map hands every later caller a stale
   * mux for the life of the process — so use the shared helper.
   */
  private readonly starts = new SingleFlight<LogcatMultiplexer>();

  constructor() {
    this.startWatchdog();
  }

  private startWatchdog(): void {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [udid, s] of this.sessions.entries()) {
        const emptySince = s.mux.emptySince;
        if (emptySince === undefined) continue; // a viewer is attached
        if (now - emptySince > IDLE_TIMEOUT_MS) {
          log.info(`[${udid}] Stopping idle logcat stream (no viewers for ${IDLE_TIMEOUT_MS}ms)`);
          void this.stop(udid);
        }
      }
    }, IDLE_POLL_MS);
    // A watchdog must never be the reason the process stays alive.
    timer.unref?.();
  }

  getMultiplexer(udid: string): LogcatMultiplexer | undefined {
    return this.sessions.get(udid)?.mux;
  }

  async start(udid: string): Promise<LogcatMultiplexer> {
    const existing = this.sessions.get(udid);
    if (existing) return existing.mux;

    // A start already in flight for this udid is joined rather than spawning a
    // second logcat process — two viewers opening the tab at once arrive here
    // before either has had a chance to set `sessions`.
    return this.starts.run(udid, async () => {
      const mux = new LogcatMultiplexer();
      const proc = await this.spawnLogcat(udid);
      const resolver = this.makeResolver(udid);
      const session: Session = { mux, proc, resolver, flushChain: Promise.resolve() };
      this.sessions.set(udid, session);

      if (proc.stdout) {
        const rl = readline.createInterface({ input: proc.stdout });
        rl.on('line', (line: string) => this.onLine(session, line));
      }

      const end = (reason: string) => {
        // An intentional stop() already removed this session and killed the
        // process itself; the 'close' that follows is expected, not a failure
        // to report. Without this guard, a deliberate stop() would still emit
        // a stray "log stream ended" into a mux nobody is tracking anymore
        // (mirrors the `status === 'running'` guard AndroidH264StreamService
        // uses around its own capture-exit handlers).
        if (this.sessions.get(udid) !== session) return;
        this.sessions.delete(udid);
        this.flushPending(session);
        session.flushChain = session.flushChain.then(() => {
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
          // Dropping the mux alone is not enough: the sockets would stay
          // attached to an orphaned mux showing a frozen log, and those tabs
          // would never recover.
          session.mux.close();
        });
      };
      proc.on('close', () => end('process exited'));
      proc.on('error', () => end('process error'));

      return mux;
    });
  }

  private onLine(session: Session, line: string): void {
    const rec = parseThreadtimeLine(line);
    if (!rec) {
      // Continuation of the still-pending record. Banners
      // (`--------- beginning of main`) and blank noise also parse to null;
      // dropping them here rather than appending is what keeps a wrapped
      // message intact without also swallowing them into it.
      if (session.pending && line.trim().length > 0 && !line.startsWith('---------')) {
        session.pending.message += `\n${line.trim()}`;
      }
      return;
    }
    // A new record line proves the previous one has no more continuations —
    // close it out now. The new record becomes the pending one in turn.
    this.flushPending(session);
    session.pending = rec;
    // Close THIS record out at the end of the current turn unless something
    // already did (the next record line, process end, or stop()). Continuation
    // lines for the same message arrive as part of the same synchronous
    // readline burst as their parent line, so they are always applied before
    // this fires; process.nextTick reliably runs after that burst finishes and
    // before any timer/immediate, so a trailing record (nothing after it in
    // the stream) still reaches clients almost immediately instead of waiting
    // indefinitely for a line that may never come.
    process.nextTick(() => {
      // Identity check, not just a null check: a redundant flush is harmless
      // (flushPending is a no-op with nothing pending, and never emits a
      // record twice), so this is a short-circuit rather than a correctness
      // guard — no input distinguishes it from an unconditional flush.
      if (session.pending === rec) this.flushPending(session);
    });
  }

  /** Close out the session's pending record, if any: resolve its package and
   * push it, without letting resolution latency reorder it against records
   * already queued ahead of it. */
  private flushPending(session: Session): void {
    const rec = session.pending;
    if (!rec) return;
    session.pending = undefined;
    session.flushChain = session.flushChain.then(async () => {
      try {
        // Package resolution must never drop a log line. PackageResolver
        // swallows its own runner failures today, but a rejection reaching
        // here would poison flushChain: every later `.then(onFulfilled)` is
        // skipped, so the device's log stream dies permanently and silently.
        const pkg = await session.resolver.resolve(rec.pid);
        if (pkg) rec.pkg = pkg;
      } catch {
        /* no pkg; the record still goes out */
      }
      session.mux.push(rec);
    });
  }

  async stop(udid: string): Promise<void> {
    const s = this.sessions.get(udid);
    if (!s) return;
    this.sessions.delete(udid);
    // Redundant with the nextTick flush in onLine (verified: no input reaches
    // stop() with a record still pending that the tick would not have
    // flushed). Kept as defence in depth so a change to the tick scheduling
    // cannot silently start dropping the last line before a stop.
    this.flushPending(s);
    try {
      s.proc.kill();
    } catch {
      /* best-effort */
    }
  }

  // ---------------------------------------------------------------------
  // Seams. Overridden by test subclasses; the defaults are the real thing.
  // ---------------------------------------------------------------------

  /** The whole logcat child for a device. */
  protected async spawnLogcat(udid: string): Promise<ChildProcessLike> {
    const { path, base } = await this.adbFor(udid);
    // `logcat -v threadtime` with no `-d`: `-d` dumps and exits, which is the
    // duplicate-producing poll this whole feature exists to replace.
    const proc = this.spawnProcess(path, [...base, 'logcat', '-v', 'threadtime']);
    // A ChildProcess emitting 'error' with zero listeners crashes the process —
    // always have one (same guard as ScrcpyServerSession / AndroidH264StreamService).
    proc.on('error', (e) => log.warn(`[${udid}] logcat process error: ${e.message}`));
    proc.stderr?.on('data', (d: Buffer) => log.debug(`[${udid}] logcat: ${d.toString().trim()}`));
    return proc as unknown as ChildProcessLike;
  }

  /** The pid → package resolver for a device. */
  protected makeResolver(udid: string): PackageResolver {
    return new PackageResolver(async () => {
      const { path, base } = await this.adbFor(udid);
      // Exactly `ps -A -o PID,NAME` (PackageResolver.PS_COMMAND) — its parser
      // is written against this two-column shape; plain `ps -A` returns nine
      // columns and parses to zero rows with no other symptom. Timeout bounds
      // the round trip: a hung `adb shell` must not wedge resolution forever.
      return this.execFileCapture(path, [...base, 'shell', 'ps', '-A', '-o', 'PID,NAME'], {
        timeout: PS_TIMEOUT_MS,
      });
    });
  }

  /**
   * The adb handle for a device. Imported dynamically for the same reason
   * ScrcpyServerSession and AndroidH264StreamService do it: a static import
   * from this directory around to AndroidDeviceManager risks a module cycle at
   * load time.
   */
  protected async getAdb(udid: string): Promise<AdbLike> {
    const { default: AndroidDeviceManager } = await import('../AndroidDeviceManager');
    return (await Container.get(AndroidDeviceManager).getAdbForDevice(udid)) as AdbLike;
  }

  /** Long-lived child spawn. */
  protected spawnProcess(command: string, args: string[]): ChildProcess {
    return spawn(command, args);
  }

  /** One-shot command, stdout collected. */
  protected async execFileCapture(
    command: string,
    args: string[],
    opts: { timeout: number },
  ): Promise<string> {
    const { stdout } = await execFileAsync(command, args, opts);
    return stdout;
  }

  /**
   * Resolve the real adb binary + host/udid args the same way
   * ScrcpyServerSession and AndroidH264StreamService do — never a bare `adb`,
   * since a server launched from the Mac app has no shell PATH and a bare
   * spawn ENOENTs. Stricter than AndroidH264StreamService's `|| 'adb'`
   * fallback on purpose: a missing path is a misconfiguration to surface, not
   * one to paper over with a binary that may not exist.
   */
  private async adbFor(udid: string): Promise<{ path: string; base: string[] }> {
    const adb = await this.getAdb(udid);
    if (!adb?.executable?.path) throw new Error(`[${udid}] adb executable path not resolved`);
    const hostArgs =
      adb.adbHost && adb.adbPort ? ['-H', adb.adbHost, '-P', String(adb.adbPort)] : [];
    return { path: adb.executable.path, base: [...hostArgs, '-s', udid] };
  }
}
