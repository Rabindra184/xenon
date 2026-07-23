import { spawn, ChildProcess, execFile } from 'child_process';
import { EventEmitter } from 'events';
import net from 'net';
import { promisify } from 'util';
import { Container } from 'typedi';
import log from '../../logger';
import { SCRCPY_SERVER_VERSION, scrcpyServerJarPath } from './scrcpyVersion';

const execFileAsync = promisify(execFile);
const LOCAL_ABSTRACT = 'scrcpy'; // device-side socket name scrcpy listens on

export const SCRCPY_DEVICE_JAR_PATH = '/data/local/tmp/scrcpy-server-manual.jar';

/**
 * The argv passed to the resolved adb AFTER any `-s <udid>` — a headless,
 * video-only scrcpy-server launch. All three metadata channels are disabled
 * (`send_device_meta=false`, `send_codec_meta=false`, `send_frame_meta=false`)
 * so the socket carries plain Annex-B H.264 that the existing H264NalParser
 * consumes unchanged. `send_dummy_byte=true` (the tunnel_forward readiness byte)
 * is explicit because the socket reader skips exactly one leading byte.
 * Arg NAMES verified against the vendored scrcpy 3.3.4 jar's dex; the version
 * constant and this argv move together (see scrcpyVersion.ts / vendor/README.md).
 * No `scid` → the server listens on `localabstract:scrcpy` (per-device namespace).
 */
export function buildScrcpyServerArgs(opts: {
  version: string;
  jarDevicePath: string;
  maxSize: number;
}): string[] {
  return [
    'shell',
    `CLASSPATH=${opts.jarDevicePath}`,
    'app_process',
    '/',
    'com.genymobile.scrcpy.Server',
    opts.version,
    'tunnel_forward=true',
    'audio=false',
    'control=false',
    'video=true',
    'video_codec=h264',
    `max_size=${opts.maxSize}`,
    'video_bit_rate=4000000',
    'max_fps=30',
    'send_device_meta=false',
    'send_codec_meta=false',
    'send_frame_meta=false',
    'send_dummy_byte=true',
    'cleanup=true',
  ];
}

/**
 * scrcpy `max_size` caps the device's LONGER edge (single int, aspect preserved).
 * Derive it so the SHORTER edge lands near `targetShortEdge` (matches today's
 * ~720-wide screenrecord downscale). Never upscales.
 */
export function scrcpyMaxSizeFromDims(sw: number, sh: number, targetShortEdge = 720): number {
  const shortE = Math.min(sw, sh);
  const longE = Math.max(sw, sh);
  if (!Number.isFinite(shortE) || !Number.isFinite(longE) || shortE <= 0 || longE <= 0) {
    return targetShortEdge * 2; // safe default longer-edge cap
  }
  if (shortE <= targetShortEdge) return longE; // no upscale
  return Math.round(longE * (targetShortEdge / shortE));
}

/** Parse the local TCP port that `adb forward tcp:0 …` prints on stdout. */
export function parseAdbForwardPort(stdout: string): number {
  const port = parseInt(String(stdout).trim(), 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Unparseable adb forward port: ${JSON.stringify(stdout)}`);
  }
  return port;
}

export class ScrcpyServerSession extends EventEmitter {
  private proc?: ChildProcess;
  private socket?: net.Socket;
  private forwardSpec?: string; // e.g. 'tcp:41337'
  private stopped = false;
  private adbPath = 'adb';
  private hostArgs: string[] = [];
  private base: string[] = []; // [...hostArgs, '-s', udid]

  constructor(private udid: string) {
    super();
  }

  async start(maxSize: number): Promise<void> {
    const { default: AndroidDeviceManager } = await import('../AndroidDeviceManager');
    const adb: any = await Container.get(AndroidDeviceManager).getAdbForDevice(this.udid);
    if (this.stopped) throw new Error('session stopped during start');
    if (!adb?.executable?.path) throw new Error(`[${this.udid}] adb executable path not resolved`);
    this.adbPath = adb.executable.path;
    this.hostArgs = adb?.adbHost && adb?.adbPort ? ['-H', adb.adbHost, '-P', String(adb.adbPort)] : [];
    this.base = [...this.hostArgs, '-s', this.udid];

    try {
      // 1) push jar (idempotent enough; overwrite is cheap and safe)
      await execFileAsync(this.adbPath, [...this.base, 'push', scrcpyServerJarPath(), '/data/local/tmp/scrcpy-server-manual.jar']);
      if (this.stopped) throw new Error('session stopped during start');

      // 2) app_process (long-lived). buildScrcpyServerArgs + SCRCPY_DEVICE_JAR_PATH
      //    are defined in THIS file (Task 2) — reference them directly (no self-import).
      const serverArgs = buildScrcpyServerArgs({
        version: SCRCPY_SERVER_VERSION,
        jarDevicePath: SCRCPY_DEVICE_JAR_PATH,
        maxSize,
      });
      this.proc = spawn(this.adbPath, [...this.base, ...serverArgs]);
      this.proc.stdout?.resume(); // scrcpy-server writes video to the socket, not stdout; drain so it can't backpressure
      this.proc.stderr?.on('data', (d: Buffer) => log.debug(`[${this.udid}] scrcpy-server: ${d.toString().trim()}`));
      this.proc.on('close', () => { if (!this.stopped) this.emit('close'); });
      this.proc.on('error', (e) => {
        // A ChildProcess emitting 'error' with zero listeners crashes the process — always have one.
        log.warn(`[${this.udid}] scrcpy-server proc error: ${e.message}`);
        if (!this.stopped) this.emit('close');
      });

      // 3) forward a local port to the device socket, then connect
      //    (parseAdbForwardPort is defined in this file — Task 3 — so call it directly)
      const { stdout } = await execFileAsync(this.adbPath, [...this.base, 'forward', 'tcp:0', `localabstract:${LOCAL_ABSTRACT}`]);
      const port = parseAdbForwardPort(stdout);
      this.forwardSpec = `tcp:${port}`;
      if (this.stopped) throw new Error('session stopped during start');

      await this.connectWithRetry(port);
    } catch (e) {
      this.cleanup();
      throw e;
    }
  }

  private connectWithRetry(port: number, attempt = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.stopped) { reject(new Error('stopped')); return; }
      const sock = net.connect(port, '127.0.0.1');
      const onConnectError = (e: Error) => {
        sock.destroy(); // don't leak the failed socket
        // The server may not be listening yet immediately after spawn — retry briefly.
        if (attempt < 19 && !this.stopped) { // 20 attempts total (0..19)
          setTimeout(() => this.connectWithRetry(port, attempt + 1).then(resolve, reject), 100);
        } else {
          reject(e);
        }
      };
      sock.once('error', onConnectError);
      sock.once('connect', () => {
        sock.removeListener('error', onConnectError); // leave connection phase — steady-state handlers take over below
        this.socket = sock;
        let dummySkipped = false;
        sock.on('data', (chunk: Buffer) => {
          // tunnel_forward=true sends a single readiness dummy byte (0x00) first.
          if (!dummySkipped) { dummySkipped = true; chunk = chunk.subarray(1); }
          if (chunk.length) this.emit('data', chunk);
        });
        sock.on('error', (e) => log.warn(`[${this.udid}] scrcpy socket error: ${e.message}`)); // steady-state: log; 'close' follows
        sock.on('close', () => { if (!this.stopped) this.emit('close'); });
        resolve();
      });
    });
  }

  private cleanup(): void {
    try { this.socket?.destroy(); } catch { /* best-effort */ }
    try { this.proc?.kill('SIGKILL'); } catch { /* best-effort */ }
    if (this.forwardSpec) {
      const spec = this.forwardSpec;
      this.forwardSpec = undefined; // clear first so a repeated stop()/cleanup() doesn't re-spawn adb
      execFile(this.adbPath, [...this.base, 'forward', '--remove', spec], () => undefined);
    }
  }

  stop(): void {
    this.stopped = true;
    this.cleanup();
  }
}
