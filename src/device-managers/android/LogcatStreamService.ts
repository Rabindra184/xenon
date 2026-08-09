import { Service, Container } from 'typedi';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import readline from 'readline';
import log from '../../logger';
import { LogcatMultiplexer } from './LogcatMultiplexer';
import { PackageResolver } from '../../services/logcat/PackageResolver';
import { parseThreadtimeLine, type LogcatRecord } from '../../services/logcat/logcatParse';

const execFileAsync = promisify(execFile);

/** Stop a stream 30s after the last viewer leaves — long enough to survive a
 * tab reload, short enough not to hold an adb channel per device indefinitely. */
export const IDLE_TIMEOUT_MS = 30_000;

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

interface Session {
  mux: LogcatMultiplexer;
  proc: ChildProcessLike;
  resolver: PackageResolver;
  emptyAt?: number;
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
 * Resolve the real adb binary + host/udid args the same way
 * ScrcpyServerSession and AndroidH264StreamService do — never a bare `adb`,
 * since a server launched from the Mac app has no shell PATH and a bare spawn
 * ENOENTs. AndroidDeviceManager is imported dynamically for the same reason
 * those two files do: a static import from this directory around to
 * AndroidDeviceManager risks a module-cycle at load time.
 */
async function adbFor(udid: string): Promise<{ path: string; base: string[] }> {
  const { default: AndroidDeviceManager } = await import('../AndroidDeviceManager');
  const adb: any = await Container.get(AndroidDeviceManager).getAdbForDevice(udid);
  if (!adb?.executable?.path) throw new Error(`[${udid}] adb executable path not resolved`);
  const hostArgs =
    adb?.adbHost && adb?.adbPort ? ['-H', adb.adbHost, '-P', String(adb.adbPort)] : [];
  return { path: adb.executable.path, base: [...hostArgs, '-s', udid] };
}

async function defaultSpawnLogcat(udid: string): Promise<ChildProcessLike> {
  const { path, base } = await adbFor(udid);
  const proc = spawn(path, [...base, 'logcat', '-v', 'threadtime']);
  // A ChildProcess emitting 'error' with zero listeners crashes the process —
  // always have one (same guard as ScrcpyServerSession / AndroidH264StreamService).
  proc.on('error', (e) => log.warn(`[${udid}] logcat process error: ${e.message}`));
  proc.stderr?.on('data', (d: Buffer) => log.debug(`[${udid}] logcat: ${d.toString().trim()}`));
  return proc as unknown as ChildProcessLike;
}

function defaultResolver(udid: string): PackageResolver {
  return new PackageResolver(async () => {
    const { path, base } = await adbFor(udid);
    // Exactly `ps -A -o PID,NAME` — PackageResolver's parser is written
    // against this two-column shape; plain `ps -A` returns nine columns and
    // parses to zero rows with no other symptom. Timeout bounds the round
    // trip: a hung `adb shell` must not wedge resolution forever.
    const { stdout } = await execFileAsync(path, [...base, 'shell', 'ps', '-A', '-o', 'PID,NAME'], {
      timeout: PS_TIMEOUT_MS,
    });
    return stdout;
  });
}

/**
 * One continuous `adb logcat -v threadtime` process per device, parsed and
 * fanned out through a {@link LogcatMultiplexer}. Mirrors the lifecycle shape
 * of {@link AndroidH264StreamService}: an idle watchdog, start-promise
 * de-duplication per udid, and a session dropped whole on process exit so the
 * next viewer always starts clean.
 */
@Service()
export class LogcatStreamService {
  private sessions = new Map<string, Session>();
  private startPromises = new Map<string, Promise<LogcatMultiplexer>>();

  constructor(
    private readonly spawnLogcat: (udid: string) => Promise<ChildProcessLike> = defaultSpawnLogcat,
    private readonly makeResolver: (udid: string) => PackageResolver = defaultResolver,
  ) {
    this.startWatchdog();
  }

  private startWatchdog(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [udid, s] of this.sessions.entries()) {
        if (s.mux.clientCount > 0) {
          s.emptyAt = undefined;
        } else if (s.emptyAt === undefined) {
          s.emptyAt = now;
        } else if (now - s.emptyAt > IDLE_TIMEOUT_MS) {
          log.info(`[${udid}] Stopping idle logcat stream (no viewers for ${IDLE_TIMEOUT_MS}ms)`);
          this.stop(udid);
        }
      }
    }, 10_000);
  }

  getMultiplexer(udid: string): LogcatMultiplexer | undefined {
    return this.sessions.get(udid)?.mux;
  }

  async start(udid: string): Promise<LogcatMultiplexer> {
    const existing = this.sessions.get(udid);
    if (existing) return existing.mux;
    // A start already in flight for this udid — join it rather than spawning a
    // second logcat process. Two viewers opening the tab at once arrive here
    // before either has had a chance to set `sessions` (same dedup
    // IOSStreamService.startPromises does for concurrent stream starts).
    const inflight = this.startPromises.get(udid);
    if (inflight) return inflight;

    const promise = (async () => {
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
        });
      };
      proc.on('close', () => end('process exited'));
      proc.on('error', () => end('process error'));

      return mux;
    })();

    this.startPromises.set(udid, promise);
    try {
      return await promise;
    } finally {
      this.startPromises.delete(udid);
    }
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
        const pkg = await session.resolver.resolve(rec.pid);
        if (pkg) rec.pkg = pkg;
      } catch {
        // Package resolution must never drop a log line.
      }
      session.mux.push(rec);
    });
  }

  async stop(udid: string): Promise<void> {
    const s = this.sessions.get(udid);
    if (!s) return;
    this.sessions.delete(udid);
    this.flushPending(s);
    try {
      s.proc.kill();
    } catch {
      /* best-effort */
    }
  }
}
