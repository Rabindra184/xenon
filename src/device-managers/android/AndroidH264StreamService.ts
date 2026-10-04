import { spawn, ChildProcess } from 'child_process';
import { Service, Container } from 'typedi';
import log from '../../logger';
import { findOwnDevice } from '../ownDeviceRow';
import { H264Multiplexer, H264Packet } from './H264Multiplexer';
import { H264NalParser } from './h264NalParser';
import { H264Source, resolveAndroidH264 } from '../../app/routers/androidH264Config';
import { PluginContext } from '../../PluginContext';
import { releaseIdlePreviewHold } from './previewHold';

interface H264Session {
  status: 'running' | 'stopped';
  mux: H264Multiplexer;
  capture?: { kill: () => void };
  emptyAt?: number;
  /**
   * A page that shows MJPEG asked for this phone (`endWhenUnwatched`): the
   * capture ends as soon as nobody watches it, not after the idle wait.
   */
  endWhenUnwatched?: boolean;
}

const IDLE_TIMEOUT_MS = 600_000; // stop a stream after 10 min with zero viewers
const RESTART_MIN_INTERVAL_MS = 300; // fast restart after a healthy stream hits the cap/rotation
// After this many consecutive restarts that produced no frames (device gone,
// unsupported size, …) give up instead of spin-looping forever.
const MAX_RESTART_FAILURES = 5;
const DEFAULT_CAPTURE_SIZE = '720x1560';
const MAX_CAPTURE_WIDTH = 720;

/**
 * Continuous H.264 live-stream capture for Android via `adb screenrecord`,
 * fanned out to WebSocket clients through an {@link H264Multiplexer}. Parallel
 * to (and independent of) the MJPEG `AndroidStreamService` — selected per the
 * `streaming.androidH264` flag with MJPEG as the fallback.
 *
 * `screenrecord` ends on its ~3-min `--time-limit` cap and on device rotation;
 * `openCapture` transparently restarts it (rate-limited) while the session has
 * viewers, so a fresh keyframe resumes decoders seamlessly.
 */
@Service({ name: 'AndroidH264StreamService' })
class AndroidH264StreamService {
  private sessions: Map<string, H264Session> = new Map();
  private startPromises: Map<string, Promise<H264Multiplexer>> = new Map();
  // udids where scrcpy proved incompatible (e.g. it aborts on init — the Exynos
  // "stack corruption" crash). Once seen, skip scrcpy for that device and use the
  // screenrecord H.264 source directly instead of re-crashing scrcpy every start.
  private scrcpyIncompatible: Set<string> = new Set();

  constructor() {
    this.startWatchdog();
  }

  private startWatchdog() {
    // unref()ed below: the server's listener keeps the process alive; this only
    // needs to fire while it runs.
    setInterval(() => this.sweep(Date.now()), 60_000).unref();
  }

  /** One look at every capture: ends those nobody has watched for long enough. */
  sweep(now: number): void {
    for (const [udid, s] of this.sessions.entries()) {
      if (s.status !== 'running') continue;
      if (s.mux.clientCount > 0) {
        s.emptyAt = undefined;
      } else if (s.endWhenUnwatched && !this.startPromises.has(udid)) {
        // A page asked for MJPEG while this capture was starting for a viewer
        // who then never came (endWhenUnwatched leaves a start alone).
        log.info(`[${udid}] Stopping the unwatched H.264 stream: the phone is shown as MJPEG`);
        void this.stop(udid);
      } else if (s.emptyAt === undefined) {
        s.emptyAt = now;
      } else if (now - s.emptyAt > IDLE_TIMEOUT_MS) {
        log.info(`[${udid}] Stopping idle H.264 stream (no viewers for ${IDLE_TIMEOUT_MS}ms)`);
        // The stream went, but the live-preview hold stayed: with H.264
        // preview, a tab closed without releasing kept the device busy for
        // good. stop() itself must not release (a recording starting calls
        // it); an idle stop does, if nothing else uses the device.
        void this.stop(udid).then(() => releaseIdlePreviewHold(udid));
      }
    }
  }

  getMultiplexer(udid: string): H264Multiplexer | undefined {
    return this.sessions.get(udid)?.mux;
  }

  async start(udid: string, opts?: { source?: H264Source }): Promise<H264Multiplexer> {
    const inflight = this.startPromises.get(udid);
    if (inflight) return inflight;
    const existing = this.sessions.get(udid);
    if (existing && existing.status === 'running') return existing.mux;

    const promise = (async () => {
      const mux = new H264Multiplexer();
      const session: H264Session = { status: 'running', mux };
      mux.onEmpty(() => this.endIfUnwatched(udid, session));
      this.sessions.set(udid, session);
      try {
        let resolveConfig: () => void = () => undefined;
        const firstConfig = new Promise<void>((r) => (resolveConfig = r));
        let seenConfig = false;
        const onPacket = (p: H264Packet) => {
          mux.push(p);
          if (p.type === 'config' && !seenConfig) {
            seenConfig = true;
            resolveConfig();
          }
        };

        // Resolve the capture source: an explicit opts.source wins; otherwise
        // read the server-wide flag config. Resolving here (not just at the REST
        // call site) means the WS auto-start path — start(udid) with no opts —
        // also honours a configured { source: 'screenrecord' } instead of
        // silently defaulting to scrcpy.
        const source: H264Source =
          opts?.source ??
          resolveAndroidH264(Container.get(PluginContext).pluginArgs.streaming?.androidH264).source;
        session.capture = await this.openCapture(udid, onPacket, source);
        // Give the first keyframe/config a moment so callers get a ready stream,
        // but never block start-up indefinitely.
        let cap: NodeJS.Timeout | undefined;
        try {
          await Promise.race([firstConfig, new Promise((r) => (cap = setTimeout(r, 3000)))]);
        } finally {
          clearTimeout(cap);
        }
        return mux;
      } catch (e) {
        // Don't leave a zombie 'running' session with no capture — later
        // start()/getMultiplexer would hand back a mux that never produces frames.
        if (this.sessions.get(udid) === session) this.sessions.delete(udid);
        throw e;
      }
    })();

    this.startPromises.set(udid, promise);
    try {
      return await promise;
    } finally {
      this.startPromises.delete(udid);
    }
  }

  /**
   * A page that showed this phone's H.264 preview now shows MJPEG (its player
   * failed, or it cannot play H.264), and the MJPEG capture is starting for
   * it. One capture per phone where possible, but never at the expense of a
   * viewer still playing H.264: another tile, tab or admin may be. So the
   * capture ends now if nobody watches it, else the moment its last viewer
   * leaves, never after the idle wait. A viewer who joins meanwhile is served
   * and ends it in turn. A capture still starting is left to the viewer it is
   * starting for, and the watchdog ends it if that viewer never comes.
   */
  async endWhenUnwatched(udid: string): Promise<void> {
    const session = this.sessions.get(udid);
    if (!session || session.status !== 'running') return;
    session.endWhenUnwatched = true;
    const viewers = session.mux.clientCount;
    if (viewers > 0) {
      log.info(
        `[${udid}] H.264 stream kept beside MJPEG for its ${viewers} viewer(s); ` +
          'it ends when the last one leaves',
      );
      return;
    }
    if (this.startPromises.has(udid)) {
      log.info(`[${udid}] H.264 stream still starting: kept for the viewer it is starting for`);
      return;
    }
    log.info(`[${udid}] Stopping the unwatched H.264 stream: the phone is shown as MJPEG`);
    await this.stop(udid);
  }

  /** The last viewer left `session`: end it if a page asked (endWhenUnwatched). */
  private endIfUnwatched(udid: string, session: H264Session): void {
    // A capture replaced since (a stop and a new start) is not this one.
    if (this.sessions.get(udid) !== session || !session.endWhenUnwatched) return;
    log.info(
      `[${udid}] Stopping the H.264 stream: its last viewer left, the phone is shown as MJPEG`,
    );
    void this.stop(udid);
  }

  async stop(udid: string): Promise<void> {
    const session = this.sessions.get(udid);
    if (!session) return;
    session.status = 'stopped';
    try {
      session.capture?.kill();
    } catch {
      /* best-effort */
    }
    this.sessions.delete(udid);
    // Viewers still on it (a recording starting, a stream/stop) are told, so
    // their players fall back to MJPEG instead of freezing on the last frame.
    session.mux.close();
    log.info(`[${udid}] H.264 stream terminated.`);
  }

  /**
   * Kill every capture child, synchronously. Called from the process 'exit'
   * hook in `src/index.ts`.
   *
   * This service is not registered with ProcessRegistry, and its async
   * teardown would not help anyway: on SIGTERM Appium's own handler exits the
   * process before the plugin's async cleanup phase runs — measured against a
   * real device for the sibling logcat service, which orphaned both its host
   * `adb` child and the device-side reader on every restart. `scrcpy` and
   * `screenrecord` are long-lived children in exactly the same position.
   *
   * 'exit' forbids async work, so this is synchronous by necessity;
   * `capture.kill()` is a syscall and is safe there.
   */
  killAllSync(): number {
    let killed = 0;
    for (const session of this.sessions.values()) {
      session.status = 'stopped';
      try {
        session.capture?.kill();
        killed += 1;
      } catch {
        /* already gone is the desired state; never throw from an exit hook */
      }
    }
    this.sessions.clear();
    return killed;
  }

  /**
   * Select the capture source: `screenrecord` (legacy, rollback path) or
   * `scrcpy` (default). Dispatches to the matching producer.
   */
  protected async openCapture(
    udid: string,
    onPacket: (p: H264Packet) => void,
    source: H264Source,
  ): Promise<{ kill: () => void }> {
    return source === 'screenrecord'
      ? this.openScreenrecordCapture(udid, onPacket)
      : this.openScrcpyCapture(udid, onPacket);
  }

  /**
   * scrcpy-server capture: pushes/launches the vendored server jar over adb
   * and streams its Annex-B H.264 socket output through a fresh
   * {@link H264NalParser}. Unlike screenrecord, scrcpy has no time cap, so a
   * 'close' while the session is still 'running' is unexpected — treat it as
   * a crash and stop the session rather than silently going dark.
   */
  protected async openScrcpyCapture(
    udid: string,
    onPacket: (p: H264Packet) => void,
  ): Promise<{ kill: () => void }> {
    // A device where scrcpy already proved incompatible skips straight to the
    // screenrecord H.264 source — no point re-crashing scrcpy every time.
    if (this.scrcpyIncompatible.has(udid)) {
      log.info(`[${udid}] scrcpy known-incompatible here; using screenrecord H.264 source.`);
      return this.openScreenrecordCapture(udid, onPacket);
    }
    try {
      return await this.startScrcpyOrThrow(udid, onPacket);
    } catch (e: any) {
      // scrcpy failed to produce frames (aborted on init, closed early, or timed
      // out). Fall back to the screenrecord H.264 source — still real H.264
      // (~30fps), far better than dropping all the way to ~1fps MJPEG.
      this.scrcpyIncompatible.add(udid);
      log.warn(
        `[${udid}] scrcpy H.264 unavailable (${e?.message ?? e}); falling back to screenrecord H.264 source.`,
      );
      return this.openScreenrecordCapture(udid, onPacket);
    }
  }

  /**
   * Start scrcpy and resolve only once it produces its FIRST packet (proof it
   * works). Reject if it closes/errors/times-out before that — the signal a
   * device is scrcpy-incompatible (e.g. the Exynos `stack corruption` abort),
   * which {@link openScrcpyCapture} turns into a screenrecord fallback.
   */
  protected async startScrcpyOrThrow(
    udid: string,
    onPacket: (p: H264Packet) => void,
  ): Promise<{ kill: () => void }> {
    const { ScrcpyServerSession, scrcpyMaxSizeFromDims } = await import('./ScrcpyServerSession');
    const device = await findOwnDevice(udid);
    const maxSize = scrcpyMaxSizeFromDims(
      Number(device?.screenWidth),
      Number(device?.screenHeight),
    );
    const parser = new H264NalParser();
    const session = new ScrcpyServerSession(udid);
    return new Promise<{ kill: () => void }>((resolve, reject) => {
      let settled = false;
      const fail = (e: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          session.stop();
        } catch {
          /* best-effort */
        }
        reject(e instanceof Error ? e : new Error(String(e)));
      };
      // scrcpy forces an initial keyframe, so a healthy device produces its first
      // packet within ~1–2s; this bound only catches a hung (never-frames) scrcpy.
      const timer = setTimeout(() => fail(new Error('scrcpy produced no frames within 8s')), 8000);
      session.on('data', (b: Buffer) => {
        for (const p of parser.push(b)) {
          onPacket(p);
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ kill: () => session.stop() });
          }
        }
      });
      session.on('close', () => {
        if (!settled) {
          fail(new Error('scrcpy closed before producing frames'));
          return;
        }
        // Crash after it was streaming: stop the session. On the client's
        // reconnect this device is now marked incompatible, so it gets screenrecord.
        if (this.sessions.get(udid)?.status === 'running') {
          log.warn(`[${udid}] scrcpy stream closed unexpectedly; stopping H.264 session.`);
          this.scrcpyIncompatible.add(udid);
          this.stop(udid);
        }
      });
      session.start(maxSize).catch(fail);
    });
  }

  /**
   * Spawn screenrecord with the resolved adb binary (never a bare `adb` — the
   * GUI-launch PATH trap; see 1.8.2) and feed its Annex-B output through a
   * fresh {@link H264NalParser}. Restarts on process exit (cap/rotation) while
   * the session is still running.
   */
  protected async openScreenrecordCapture(
    udid: string,
    onPacket: (p: H264Packet) => void,
  ): Promise<{ kill: () => void }> {
    const { default: AndroidDeviceManager } = await import('../AndroidDeviceManager');
    const adb: any = await Container.get(AndroidDeviceManager).getAdbForDevice(udid);
    const adbPath: string = adb?.executable?.path || 'adb';
    const hostArgs: string[] =
      adb?.adbHost && adb?.adbPort ? ['-H', adb.adbHost, '-P', String(adb.adbPort)] : [];
    const size = await this.resolveCaptureSize(udid);

    let killed = false;
    let proc: ChildProcess | undefined;
    let restartFailures = 0; // consecutive restarts that produced no frames

    const spawnOnce = () => {
      const parser = new H264NalParser();
      let producedFrame = false;
      proc = spawn(adbPath, [
        ...hostArgs,
        '-s',
        udid,
        'exec-out',
        'screenrecord',
        '--output-format=h264',
        '--size',
        size,
        '--bit-rate',
        '4000000',
        '--time-limit',
        '180',
        '-',
      ]);
      proc.stdout?.on('data', (d: Buffer) => {
        producedFrame = true;
        for (const p of parser.push(d)) onPacket(p);
      });
      proc.on('error', (e) => log.warn(`[${udid}] H.264 capture spawn error: ${e.message}`));
      proc.on('close', () => {
        if (killed || this.sessions.get(udid)?.status !== 'running') return;
        // A stream that produced frames just hit the ~3-min cap (or rotation) —
        // restart fast. A spawn that produced nothing is failing; count it and
        // back off, then give up so we never spin-loop forever.
        if (producedFrame) {
          restartFailures = 0;
        } else if (++restartFailures > MAX_RESTART_FAILURES) {
          log.error(
            `[${udid}] H.264 capture failed ${restartFailures}x without frames (size ${size}); giving up.`,
          );
          this.stop(udid);
          return;
        }
        const wait = producedFrame
          ? RESTART_MIN_INTERVAL_MS
          : Math.min(5000, RESTART_MIN_INTERVAL_MS * 2 ** restartFailures);
        setTimeout(() => {
          if (!killed && this.sessions.get(udid)?.status === 'running') spawnOnce();
        }, wait);
      });
    };

    spawnOnce();
    return {
      kill: () => {
        killed = true;
        try {
          proc?.kill('SIGKILL');
        } catch {
          /* best-effort */
        }
      },
    };
  }

  /**
   * screenrecord `--size`, derived from the device's real resolution so the
   * aspect ratio is preserved (a hardcoded size distorts non-2.166 devices and
   * can be rejected by the AVC encoder). Downscales to a max width, even dims.
   */
  private async resolveCaptureSize(udid: string): Promise<string> {
    try {
      const device = await findOwnDevice(udid);
      const sw = Number(device?.screenWidth);
      const sh = Number(device?.screenHeight);
      if (Number.isFinite(sw) && Number.isFinite(sh) && sw > 0 && sh > 0) {
        let w = Math.min(MAX_CAPTURE_WIDTH, sw);
        let h = Math.round((sh / sw) * w);
        if (w % 2 !== 0) w -= 1;
        if (h % 2 !== 0) h -= 1;
        return `${w}x${h}`;
      }
    } catch {
      /* fall through to default */
    }
    return DEFAULT_CAPTURE_SIZE;
  }
}

export default AndroidH264StreamService;
