import { spawn } from 'child_process';
import http from 'http';
import log from '../../logger';
import { getFreePort } from '../../helpers';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { unblockDevice } from '../../data-service/device-service';
import { deviceLock } from './DeviceLockManager';
import { Service, Container } from 'typedi';
import { ResourceIsolationService } from '../../services/ResourceIsolationService';

// FFmpeg is optional - only used for raw-to-JPEG conversion
let FFMPEG_PATH: string | null = null;
try {
  // Dynamic require for optional dependency
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  FFMPEG_PATH = require('@ffmpeg-installer/ffmpeg').path;
} catch {
  // ffmpeg not installed - streaming will be unavailable
}

interface AndroidStreamSession {
  udid: string;
  mjpegPort: number;
  server: http.Server | null;
  status: 'starting' | 'running' | 'stopped' | 'error';
  lastViewerAt: number;
  viewerCount: number;
  latestFrame?: Buffer;
  latestFrameTimestamp?: number;
}

@Service({ name: 'AndroidStreamService' })
class AndroidStreamService {
  private sessions: Map<string, AndroidStreamSession> = new Map();
  private startPromises: Map<string, Promise<{ mjpegPort: number }>> = new Map();

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

  private async captureLoop(udid: string, session: AndroidStreamSession) {
    log.info(`[${udid}] Background capture loop started.`);
    while (session.status === 'running' || session.status === 'starting') {
      if (session.viewerCount === 0 && session.status === 'running') {
        await new Promise((r) => setTimeout(r, 1000));
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
              'adb',
              ['-s', udid, 'exec-out', 'screencap'],
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

            session.latestFrame = await this.convertRawToJpeg(
              pixels,
              w,
              h,
              targetW,
              targetH,
              pixFmt,
            );
            if (!session.latestFrameTimestamp) {
              log.info(`[${udid}] First Android frame successfully captured and converted.`);
            }
            session.latestFrameTimestamp = Date.now();
          }
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

        const mjpegPort = await getFreePort();

        // Aggressive cleanup: Kill any process already using this port
        try {
          const { exec } = require('child_process');
          const { promisify } = require('util');
          const execPromise = promisify(exec);
          const { stdout } = await execPromise(`lsof -ti :${mjpegPort}`);
          const pids = stdout.trim().split('\n');
          for (const pid of pids) {
            if (pid) {
              log.debug(`[${udid}] Killing stale process ${pid} on port ${mjpegPort}`);
              await execPromise(`kill -9 ${pid}`);
            }
          }
        } catch (e) {
          /* ignore */
        }

        const session: AndroidStreamSession = {
          udid,
          mjpegPort,
          server: null,
          status: 'starting',
          lastViewerAt: Date.now(),
          viewerCount: 0,
        };
        this.sessions.set(udid, session);

        session.server = http.createServer((req, res) => {
          session.viewerCount++;
          session.lastViewerAt = Date.now();

          res.writeHead(200, {
            'Content-Type': 'multipart/x-mixed-replace; boundary="BoundaryString"',
            'Cache-Control': 'no-cache',
            Connection: 'close',
            Pragma: 'no-cache',
          });

          const lastFrameTime = 0;
          const writeFrame = async () => {
            // Principle: Handle both starting and running states to avoid race conditions
            if (
              session.status === 'stopped' ||
              session.status === 'error' ||
              res.writableEnded ||
              !res.writable
            )
              return;

            if (session.latestFrame) {
              try {
                res.write('--BoundaryString\r\n');
                res.write('Content-Type: image/jpeg\r\n');
                res.write(`Content-Length: ${session.latestFrame.length}\r\n\r\n`);
                res.write(session.latestFrame);
                res.write('\r\n');
              } catch (e) {
                return; // Stop if socket broke
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

        // Use '127.0.0.1' for internal proxy to avoid routing issues
        await new Promise<void>((resolve, reject) => {
          session.server!.listen(mjpegPort, '127.0.0.1', () => {
            log.info(`[${udid}] MJPEG server listening on 127.0.0.1:${mjpegPort}`);
            resolve();
          });
          session.server!.on('error', (err) => {
            log.error(`[${udid}] MJPEG Server Error: ${err.message}`);
            reject(err);
          });
        });

        // Brief settlement delay for OS networking stack
        await new Promise((r) => setTimeout(r, 200));

        session.status = 'running';
        this.captureLoop(udid, session);

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
      this.sessions.delete(udid);
      log.info(`[${udid}] Stream terminated.`);
    }
  }

  public getStreamStatus(udid: string) {
    return this.sessions.get(udid);
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

  private async convertRawToJpeg(
    pixels: Buffer,
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
    pixFmt: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (!FFMPEG_PATH) return reject(new Error('No FFmpeg on path'));
      const isolationService = Container.get(ResourceIsolationService);
      const { command, args } = isolationService.wrapSpawn(
        FFMPEG_PATH,
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
