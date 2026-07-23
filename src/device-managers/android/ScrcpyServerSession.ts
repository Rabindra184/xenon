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
 * Arg NAMES verified against the vendored scrcpy 2.7 jar's dex; the version
 * constant and this argv move together (see scrcpyVersion.ts / vendor/README.md).
 * No `scid` → the server listens on `localabstract:scrcpy` (per-device namespace).
 *
 * KEEP THIS ARGV SHORT — hard cap enforced below. Samsung's Android 10
 * libstagefright patch (`ACodec::reconfigEncoder4OtherApps`) copies the
 * encoder process's cmdline into a fixed ~256-byte stack buffer; if the
 * app_process command line reaches that length, the copy trips the stack
 * canary and the server dies at MediaCodec configure with
 * `stack corruption detected (-fstack-protector)` (SIGABRT). Verified on
 * SM-G965F/Android 10: identical options stream at ≤248 chars and abort at
 * ≥267 — the abort depends only on total length, never on which options.
 * That is why args that merely restate scrcpy 2.7 defaults (`video=true`,
 * `video_codec=h264`, `cleanup=true`) are omitted rather than spelled out.
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
    `max_size=${opts.maxSize}`,
    'video_bit_rate=4000000',
    'max_fps=30',
    'send_device_meta=false',
    'send_codec_meta=false',
    'send_frame_meta=false',
    'send_dummy_byte=true',
  ];
}

/**
 * Samsung's buggy cmdline copy (see buildScrcpyServerArgs doc) aborts at
 * ~256 chars; crash observed at 267, clean at 248. Budget 240 leaves margin
 * for a wider `max_size` while staying safely under the observed floor.
 */
export const SCRCPY_CMDLINE_BUDGET = 240;

/** The on-device `app_process …` cmdline length for a built argv (drops the host-side `shell` + CLASSPATH env prefix). */
export function scrcpyCmdlineLength(argv: string[]): number {
  const appProcessIdx = argv.indexOf('app_process');
  return argv.slice(appProcessIdx).join(' ').length;
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
  private closeEmitted = false;
  private adbPath = 'adb';
  private hostArgs: string[] = [];
  private base: string[] = []; // [...hostArgs, '-s', udid]

  constructor(private udid: string) {
    super();
  }

  /** Guarantees at most one public 'close' event, and none once the session was intentionally stopped. */
  private emitClosedOnce(): void {
    if (this.closeEmitted || this.stopped) return;
    this.closeEmitted = true;
    this.emit('close');
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
      // 1) push jar (idempotent enough; overwrite is cheap and safe). Push
      //    destination and the CLASSPATH must be the same path — use the one
      //    constant so editing it can never point CLASSPATH at an unpushed jar.
      await execFileAsync(this.adbPath, [...this.base, 'push', scrcpyServerJarPath(), SCRCPY_DEVICE_JAR_PATH]);
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
      this.proc.on('close', () => { this.emitClosedOnce(); });
      this.proc.on('error', (e) => {
        // A ChildProcess emitting 'error' with zero listeners crashes the process — always have one.
        log.warn(`[${this.udid}] scrcpy-server proc error: ${e.message}`);
        this.emitClosedOnce();
      });

      // 3) forward a local port to the device socket, then connect
      //    (parseAdbForwardPort is defined in this file — Task 3 — so call it directly)
      const { stdout } = await execFileAsync(this.adbPath, [...this.base, 'forward', 'tcp:0', `localabstract:${LOCAL_ABSTRACT}`]);
      const port = parseAdbForwardPort(stdout);
      this.forwardSpec = `tcp:${port}`;
      if (this.stopped) throw new Error('session stopped during start');

      await this.connectWithRetry(port);
      if (this.stopped) throw new Error('stopped during start');
    } catch (e) {
      this.cleanup();
      throw e;
    }
  }

  private connectWithRetry(port: number, attempt = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.stopped) { reject(new Error('stopped')); return; }
      const sock = net.connect(port, '127.0.0.1');
      let settled = false;
      // `adb forward` accepts the LOCAL tcp connection immediately (~5ms) and only
      // THEN dials the device-side scrcpy socket; if scrcpy-server hasn't bound it
      // yet, adb closes us with zero bytes. So 'connect' is NOT proof the server is
      // ready — a connect that closes/errors before any byte means "not ready yet"
      // and we retry. A connection counts as real only once scrcpy's readiness
      // dummy byte (send_dummy_byte=true) arrives. This is why the dummy byte exists.
      const retry = (reason: string) => {
        if (settled) return;
        settled = true;
        sock.removeListener('data', onFirstData);
        sock.removeListener('error', retryErr);
        sock.removeListener('close', retryClose);
        sock.destroy(); // don't leak the failed socket
        if (attempt < 19 && !this.stopped) { // 20 attempts total (0..19)
          setTimeout(() => this.connectWithRetry(port, attempt + 1).then(resolve, reject), 100);
        } else {
          reject(new Error(`scrcpy connect failed after ${attempt + 1} attempts: ${reason}`));
        }
      };
      const retryErr = (e: Error) => retry(e.message || 'socket error');
      const retryClose = () => retry('closed before data');
      const onFirstData = (first: Buffer) => {
        if (settled) return;
        settled = true;
        sock.removeListener('error', retryErr);
        sock.removeListener('close', retryClose);
        if (this.stopped) { sock.destroy(); reject(new Error('stopped during connect')); return; }
        this.socket = sock;
        // The first byte is scrcpy's readiness dummy byte; the raw H.264 Annex-B
        // stream (SPS/PPS/IDR…) begins at byte 1 of this same chunk.
        const rest = first.subarray(1);
        sock.on('data', (chunk: Buffer) => { if (!this.stopped) this.emit('data', chunk); });
        sock.on('error', (e) => log.warn(`[${this.udid}] scrcpy socket error: ${e.message}`)); // steady-state: log; 'close' follows
        sock.on('close', () => { this.emitClosedOnce(); });
        if (rest.length && !this.stopped) this.emit('data', rest);
        resolve();
      };
      sock.once('error', retryErr);
      sock.once('close', retryClose);
      sock.once('data', onFirstData);
    });
  }

  private cleanup(): void {
    this.stopped = true; // must be first: gates emitClosedOnce + connectWithRetry + connect-handler against a proc/socket event racing this cleanup
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
