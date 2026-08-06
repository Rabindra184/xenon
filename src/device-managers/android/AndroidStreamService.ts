import { spawn } from 'child_process';
import http from 'http';
import sharp from 'sharp';
import log from '../../logger';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { unblockDevice } from '../../data-service/device-service';
import { deviceLock } from './DeviceLockManager';
import { Service, Container } from 'typedi';
import { ResourceIsolationService } from '../../services/ResourceIsolationService';
import { PortAllocator } from '../../services/PortAllocator';
import { resolveFfmpegPath } from '../../helpers/ffmpegPath';

// JPEG quality for the in-process sharp encoder (0-100). ~78 approximates the
// old ffmpeg `-q:v 8` (mjpeg quantizer scale) — the low-lag/quality knob.
const JPEG_QUALITY = 78;

interface AndroidStreamSession {
  udid: string;
  mjpegPort: number;
  server: http.Server | null;
  status: 'starting' | 'running' | 'stopped' | 'error';
  lastViewerAt: number;
  viewerCount: number;
  latestFrame?: Buffer;
  latestFrameTimestamp?: number;
  // Resolved once at startup so the capture loop never spawns a PATH-relative
  // 'adb' (which ENOENTs when the server is launched from a GUI without the
  // Android SDK on PATH). adbHostArgs carries '-H <host> -P <port>' for a
  // remote adb instance, or [] for local.
  adbPath: string;
  adbHostArgs: string[];
}

@Service({ name: 'AndroidStreamService' })
class AndroidStreamService {
  private sessions: Map<string, AndroidStreamSession> = new Map();
  private startPromises: Map<string, Promise<{ mjpegPort: number }>> = new Map();
  // UDIDs for which a sharp encode failure has already been warned, so a
  // systemic problem is visible once without per-frame log spam.
  private sharpFailureWarned: Set<string> = new Set();

  constructor() {
    this.startWatchdog();
  }

  private startWatchdog() {
    setInterval(async () => {
      const now = Date.now();
      for (const [udid, session] of this.sessions.entries()) {
        if (session.status === 'running') {
          if (now - session.lastViewerAt > 600000 && session.viewerCount === 0) {
            log.info(`[${udid}] Stopping idle stream (No active viewers for 600s)`);
            this.stopStream(udid);
          }
        }
      }
    }, 3600000);
  }

  /**
   * Resolve the actual adb binary path (and remote-host args) via the same
   * appium-adb instance every other ADB call uses. This avoids spawning a bare
   * 'adb', which relies on the process PATH — absent when Xenon is launched from
   * a GUI (e.g. the Xenon Control app), producing `spawn adb ENOENT` while
   * device discovery still works (appium-adb resolves via ANDROID_HOME).
   */
  private async resolveAdbInvocation(
    udid: string,
  ): Promise<{ adbPath: string; adbHostArgs: string[] }> {
    try {
      const { default: AndroidDeviceManager } = await import('../AndroidDeviceManager');
      const adb: any = await Container.get(AndroidDeviceManager).getAdbForDevice(udid);
      const adbPath = adb?.executable?.path || 'adb';
      const adbHostArgs =
        adb?.adbHost && adb?.adbPort ? ['-H', adb.adbHost, '-P', String(adb.adbPort)] : [];
      return { adbPath, adbHostArgs };
    } catch (e: any) {
      log.warn(
        `[${udid}] Could not resolve adb binary path (${e.message}); falling back to a PATH ` +
          "lookup. If streaming fails with 'spawn adb ENOENT', ensure ANDROID_HOME " +
          '(or ANDROID_SDK_ROOT) is set so adb can be located.',
      );
      return { adbPath: 'adb', adbHostArgs: [] };
    }
  }

  /**
   * Whether the capture loop should idle this iteration instead of grabbing a
   * frame. We idle only when the stream is live ('running') and nobody is
   * watching. During 'starting' warmup we always capture, so the first frame is
   * cached before any viewer attaches — otherwise startStream's first-frame
   * wait times out against a loop that refuses to capture (the old ~5s dead
   * startup).
   */
  private shouldIdleCapture(session: AndroidStreamSession): boolean {
    return session.status === 'running' && session.viewerCount === 0;
  }

  private async captureLoop(udid: string, session: AndroidStreamSession) {
    log.info(`[${udid}] Background capture loop started.`);
    while (session.status === 'running' || session.status === 'starting') {
      if (this.shouldIdleCapture(session)) {
        // Live but unwatched — idle briefly so the next frame resumes quickly
        // once a viewer attaches.
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }

      // Respect device interaction lock
      if (deviceLock.isLocked(udid)) {
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }

      try {
        const startTime = Date.now();
        // High-Speed Binary Snapshot
        const screenshot = await deviceLock.acquire(udid, async () => {
          return await new Promise<Buffer>((resolve, reject) => {
            const isolationService = Container.get(ResourceIsolationService);
            const { command, args } = isolationService.wrapSpawn(
              session.adbPath,
              [...session.adbHostArgs, '-s', udid, 'exec-out', 'screencap'],
              'Performance',
            );
            const proc = spawn(command, args);
            const chunks: Uint8Array[] = [];
            proc.stdout.on('data', (c) => chunks.push(c));
            proc.on('close', (code) => {
              if (code === 0) resolve(Buffer.concat(chunks));
              else reject(new Error(`ADB Exit ${code}`));
            });
            proc.on('error', reject);
            setTimeout(() => {
              proc.kill();
              reject(new Error('ADB Timeout (15s)'));
            }, 15000);
          });
        });

        if (screenshot.length > 16) {
          const w = screenshot.readInt32LE(0);
          const h = screenshot.readInt32LE(4);
          const fmt = screenshot.readInt32LE(8);
          // Auto-detect header size (16 for modern Android, 12 for legacy)
          const headerSize = w * h * 4 + 16 === screenshot.length ? 16 : 12;
          const pixels = screenshot.slice(headerSize);

          if (pixels.length >= w * h * 4) {
            // Sanity check: Extreme small images or weird ratios are often corrupted buffers
            if (w < 100 || h < 100 || w > 8000 || h > 8000) {
              log.debug(`[${udid}] Suspicious frame detected (${w}x${h}). Skipping.`);
              continue;
            }

            const pixFmt = fmt === 1 ? 'rgba' : 'rgb565';
            // Optimization: Downscale to 720p maximum width for efficiency
            let targetW = w;
            let targetH = h;
            if (w > 720) {
              targetW = 720;
              targetH = Math.round((h / w) * targetW);
            }
            // FFmpeg requires even dimensions for some encoders/filters
            if (targetW % 2 !== 0) targetW--;
            if (targetH % 2 !== 0) targetH--;

            session.latestFrame = await this.encodeFrame(
              pixels,
              w,
              h,
              targetW,
              targetH,
              pixFmt,
              udid,
            );
            if (!session.latestFrameTimestamp) {
              log.info(`[${udid}] First Android frame successfully captured and converted.`);
            }
            session.latestFrameTimestamp = Date.now();
          }
        } else {
          log.warn(
            `[${udid}] Received empty or tiny screenshot (${screenshot.length} bytes). Is the screen 'flag_secure'?`,
          );
        }

        const elapsed = Date.now() - startTime;
        const delay = Math.max(5, 70 - elapsed); // Target ~14 FPS
        await new Promise((r) => setTimeout(r, delay));
      } catch (e: any) {
        log.debug(`[${udid}] Capture failure: ${e.message}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    log.info(`[${udid}] Background capture loop stopped.`);
  }

  public async startStream(udid: string): Promise<{ mjpegPort: number }> {
    if (this.startPromises.has(udid)) return this.startPromises.get(udid)!;

    const performStartup = async () => {
      try {
        const existing = this.sessions.get(udid);
        if (existing && (existing.status === 'running' || existing.status === 'starting')) {
          return { mjpegPort: existing.mjpegPort };
        }

        const device = await DeviceStoreFactory.getStore().findDevice({ udid });
        if (!device) throw new Error(`Device ${udid} not found in DB`);

        // Resolve the real adb binary once, up front, so the capture loop never
        // depends on the process PATH (see resolveAdbInvocation).
        const { adbPath, adbHostArgs } = await this.resolveAdbInvocation(udid);

        const portAllocator = Container.get(PortAllocator);
        let mjpegPort = 0;
        let session: AndroidStreamSession | null = null;

        // Bind our own HTTP MJPEG server. Never kill foreign listeners (iOS
        // iproxy often sits on 9100) — that made Android tiles show the iPhone
        // feed when a stale lease pointed at a busy port and waitUntilUsed
        // succeeded for someone else's socket. If bind fails, block the port
        // briefly and acquire a fresh one.
        for (let attempt = 0; attempt < 5; attempt++) {
          mjpegPort = await portAllocator.acquire('mjpeg', udid);
          const candidate: AndroidStreamSession = {
            udid,
            mjpegPort,
            server: null,
            status: 'starting',
            lastViewerAt: Date.now(),
            viewerCount: 0,
            adbPath,
            adbHostArgs,
          };
          this.sessions.set(udid, candidate);

          try {
            candidate.server = await this.createAndListenMjpegServer(candidate, mjpegPort);
            session = candidate;
            log.info(`[${udid}] MJPEG stream listening on port ${mjpegPort}`);
            break;
          } catch (bindErr: any) {
            log.warn(
              `[${udid}] MJPEG bind failed on ${mjpegPort} (attempt ${attempt + 1}): ${bindErr?.message ?? bindErr}`,
            );
            this.sessions.delete(udid);
            try {
              candidate.server?.close();
            } catch {
              /* ignore */
            }
            await portAllocator.release(mjpegPort).catch(() => undefined);
            await portAllocator.blockPort(mjpegPort, 'mjpeg').catch(() => undefined);
          }
        }

        if (!session || !session.server) {
          throw new Error(`Unable to bind Android MJPEG server for ${udid} after retries`);
        }

        // Start capturing while status is still 'starting' so the loop warms
        // the first frame eagerly. shouldIdleCapture() only idles once we're
        // 'running', so keeping 'starting' here avoids the old ~5s dead startup
        // where the loop skipped capture (0 viewers) until this wait timed out.
        this.captureLoop(udid, session);

        // Principal Resilience: Wait for the FIRST FRAME to be captured before
        // serving the stream. FFMPEG often fails to "open" the input if there
        // is no data immediately available.
        const firstFrameStartTime = Date.now();
        const firstFrameTimeout = 5000;
        while (Date.now() - firstFrameStartTime < firstFrameTimeout) {
          if (session.latestFrame) break; // We have a frame ready to serve
          await new Promise((r) => setTimeout(r, 50));
        }

        // Now go live: from here an unwatched stream idles between frames.
        session.status = 'running';

        if (!session.latestFrame) {
          log.warn(
            `[${udid}] Stream started but no frames captured after ${firstFrameTimeout}ms. Downstream video might be unstable.`,
          );
        } else {
          log.info(`[${udid}] MJPEG stream primed with first frame.`);
        }

        // Update device info in store to ensure other services (like VideoPipeline) can find the port
        const updatedDevice = await DeviceStoreFactory.getStore().findDevice({ udid });
        if (updatedDevice) {
          await DeviceStoreFactory.getStore().updateDevice(udid, updatedDevice.host, {
            mjpegServerPort: mjpegPort,
          });
        }

        return { mjpegPort };
      } catch (error: any) {
        log.error(`[${udid}] Stream failed to start: ${error.message}`);
        this.stopStream(udid);
        throw error;
      } finally {
        this.startPromises.delete(udid);
      }
    };

    const promise = performStartup();
    this.startPromises.set(udid, promise);
    return promise;
  }

  public async stopStream(udid: string): Promise<void> {
    const session = this.sessions.get(udid);
    if (session) {
      session.status = 'stopped';
      if (session.server) {
        session.server.close();
        session.server = null;
      }
      // Principal Fix: Only release the device lock if THIS STREAM SERVICE owns it.
      // If an Appium automation session owns the lock, don't touch it.
      try {
        const device = await DeviceStoreFactory.getStore().findDevice({ udid });
        if (device && device.session_id?.startsWith('manual_')) {
          log.info(`[${udid}] Stream Stop: Releasing manual control lock.`);
          await unblockDevice(udid, device.host);
        } else if (device && device.busy) {
          log.info(
            `[${udid}] Stream Stop: Device busy with session ${device.session_id}. NOT releasing lock.`,
          );
        }
      } catch (e) {
        /* Ignore unblocking failure on stop */
      }

      // Release the mjpeg port lease this stream acquired in startStream, so the
      // allocator can reuse the port immediately instead of waiting out the lease
      // TTL. Symmetric with IOSStreamService.stopStream. Only the stream-owned
      // 'mjpeg' lease is released here — the device-level 'system' port (leased
      // by AndroidDeviceManager) belongs to the device lifecycle, not the stream.
      try {
        await Container.get(PortAllocator).release(session.mjpegPort);
      } catch (e) {
        log.warn(`[${udid}] Failed to release mjpeg port lease on stop: ${e}`);
      }

      this.sessions.delete(udid);
      log.info(`[${udid}] Stream terminated.`);
    }
  }

  public getStreamStatus(udid: string) {
    return this.sessions.get(udid);
  }

  /**
   * Create the MJPEG HTTP server and wait until it is actually listening on
   * `port`. Rejects on EADDRINUSE / other bind errors so the caller can
   * release the lease and retry — never treat "something is listening" as
   * success when it isn't our server.
   */
  private createAndListenMjpegServer(
    session: AndroidStreamSession,
    port: number,
  ): Promise<http.Server> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        session.viewerCount++;
        session.lastViewerAt = Date.now();

        res.writeHead(200, {
          'Content-Type': 'multipart/x-mixed-replace; boundary="BoundaryString"',
          'Cache-Control': 'no-cache',
          Connection: 'close',
          Pragma: 'no-cache',
        });

        const writeFrame = () => {
          if (
            session.status === 'stopped' ||
            session.status === 'error' ||
            res.writableEnded ||
            !res.writable
          ) {
            return;
          }

          if (session.latestFrame) {
            try {
              res.write('--BoundaryString\r\n');
              res.write('Content-Type: image/jpeg\r\n');
              res.write(`Content-Length: ${session.latestFrame.length}\r\n\r\n`);
              res.write(session.latestFrame);
              res.write('\r\n');
            } catch {
              return;
            }
          }

          setTimeout(writeFrame, 60);
        };

        writeFrame();

        req.on('close', () => {
          session.viewerCount = Math.max(0, session.viewerCount - 1);
          session.lastViewerAt = Date.now();
        });
      });

      const onError = (err: Error) => {
        server.removeListener('listening', onListening);
        try {
          server.close();
        } catch {
          /* ignore */
        }
        reject(err);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve(server);
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
  }

  public updateViewerCount(udid: string, delta: number): void {
    const session = this.sessions.get(udid);
    if (session) {
      session.viewerCount = Math.max(0, session.viewerCount + delta);
      session.lastViewerAt = Date.now();
    }
  }

  public async cleanup(): Promise<void> {
    for (const udid of this.sessions.keys()) {
      await this.stopStream(udid);
    }
  }

  /**
   * Encode one raw screencap frame to a JPEG buffer. RGBA (the modern screencap
   * format, effectively all devices) is encoded in-process with sharp — no
   * subprocess, no per-frame ffmpeg spawn. Legacy rgb565 keeps the proven ffmpeg
   * path. Same raw-pixels-in / JPEG-buffer-out contract either way.
   */
  private async encodeFrame(
    pixels: Buffer,
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
    pixFmt: string,
    udid: string,
  ): Promise<Buffer> {
    if (pixFmt === 'rgba') return this.encodeRgbaWithSharp(pixels, srcW, srcH, dstW, udid);
    // rgb565 (legacy/rare) keeps the proven ffmpeg conversion, unchanged.
    return this.convertRawToJpegFfmpeg(pixels, srcW, srcH, dstW, dstH, pixFmt);
  }

  /**
   * In-process RGBA→JPEG via sharp (libvips threadpool, off the event loop).
   * Handles per-frame dimensions natively, so rotation needs no special-casing.
   */
  private async encodeRgbaWithSharp(
    pixels: Buffer,
    srcW: number,
    srcH: number,
    dstW: number,
    udid: string,
  ): Promise<Buffer> {
    try {
      // screencap rows are tightly packed (w*4/row), matching the ffmpeg
      // -video_size assumption; take exactly that many bytes for sharp's raw input.
      return await sharp(pixels.subarray(0, srcW * srcH * 4), {
        raw: { width: srcW, height: srcH, channels: 4 },
      })
        .resize({ width: dstW }) // height auto-derived; preserves aspect ratio
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();
    } catch (e: any) {
      if (!this.sharpFailureWarned.has(udid)) {
        this.sharpFailureWarned.add(udid);
        log.warn(`[${udid}] sharp JPEG encode failed (${e.message}); skipping frames.`);
      }
      throw e; // let captureLoop's catch skip the frame and back off
    }
  }

  private async convertRawToJpegFfmpeg(
    pixels: Buffer,
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
    pixFmt: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const isolationService = Container.get(ResourceIsolationService);
      const { command, args } = isolationService.wrapSpawn(
        resolveFfmpegPath(),
        [
          '-f',
          'rawvideo',
          '-pixel_format',
          pixFmt,
          '-video_size',
          `${srcW}x${srcH}`,
          '-i',
          'pipe:0',
          '-vf',
          `scale=${dstW}:-1`,
          '-f',
          'mjpeg',
          '-q:v',
          '8', // Goldilocks quality for low lag
          '-frames:v',
          '1',
          'pipe:1',
        ],
        'Performance',
      );

      const ff = spawn(command, args);
      const output: Uint8Array[] = [];
      ff.stdout.on('data', (d) => output.push(d));
      ff.on('close', (code) => {
        if (code === 0) resolve(Buffer.concat(output));
        else reject(new Error(`FFmpeg exit ${code}`));
      });
      ff.on('error', reject);
      ff.stdin.write(pixels);
      ff.stdin.end();
    });
  }
}

export default AndroidStreamService;
