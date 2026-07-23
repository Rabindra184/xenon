import { spawn, ChildProcess } from 'child_process';
import { Service, Container } from 'typedi';
import log from '../../logger';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { H264Multiplexer, H264Packet } from './H264Multiplexer';
import { H264NalParser } from './h264NalParser';

interface H264Session {
  status: 'running' | 'stopped';
  mux: H264Multiplexer;
  capture?: { kill: () => void };
  emptyAt?: number;
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

  constructor() {
    this.startWatchdog();
  }

  private startWatchdog() {
    setInterval(() => {
      const now = Date.now();
      for (const [udid, s] of this.sessions.entries()) {
        if (s.status !== 'running') continue;
        if (s.mux.clientCount > 0) {
          s.emptyAt = undefined;
        } else if (s.emptyAt === undefined) {
          s.emptyAt = now;
        } else if (now - s.emptyAt > IDLE_TIMEOUT_MS) {
          log.info(`[${udid}] Stopping idle H.264 stream (no viewers for ${IDLE_TIMEOUT_MS}ms)`);
          this.stop(udid);
        }
      }
    }, 60_000);
  }

  getMultiplexer(udid: string): H264Multiplexer | undefined {
    return this.sessions.get(udid)?.mux;
  }

  async start(udid: string): Promise<H264Multiplexer> {
    const inflight = this.startPromises.get(udid);
    if (inflight) return inflight;
    const existing = this.sessions.get(udid);
    if (existing && existing.status === 'running') return existing.mux;

    const promise = (async () => {
      const mux = new H264Multiplexer();
      const session: H264Session = { status: 'running', mux };
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

        session.capture = await this.openCapture(udid, onPacket);
        // Give the first keyframe/config a moment so callers get a ready stream,
        // but never block start-up indefinitely.
        await Promise.race([firstConfig, new Promise((r) => setTimeout(r, 3000))]);
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
    log.info(`[${udid}] H.264 stream terminated.`);
  }

  /**
   * Spawn screenrecord with the resolved adb binary (never a bare `adb` — the
   * GUI-launch PATH trap; see 1.8.2) and feed its Annex-B output through a
   * fresh {@link H264NalParser}. Restarts on process exit (cap/rotation) while
   * the session is still running.
   */
  protected async openCapture(
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
      const device = await DeviceStoreFactory.getStore().findDevice({ udid });
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
