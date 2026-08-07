import { Service, Container } from 'typedi';
import { ProcessRegistry } from './ProcessRegistry';
import { spawn, ChildProcess } from 'child_process';
import log from '../logger';
import path from 'path';
import os from 'os';
import * as fs from 'fs';
import { config } from '../config';
import { DeviceStoreFactory } from '../data-service/device-store';
import { ResourceIsolationService } from './ResourceIsolationService';
import { resolveFfmpegPath } from '../helpers/ffmpegPath';

/**
 * Resolve the on-disk path the recorder will write to.
 * Extracted as a pure function so it can be unit-tested without spawning ffmpeg.
 */
export function resolveOutputPath(sessionId: string, override?: string): string {
  return (
    override ??
    path.join(config.sessionAssetsPath, sessionId, 'video', `${sessionId}.mp4`)
  );
}

/**
 * Build the ffmpeg argv for a single-device MJPEG → mp4 recording.
 *
 * Extracted as a pure function so it can be unit-tested without spawning ffmpeg.
 *
 * Timing correctness: an HTTP MJPEG stream carries no real timestamps, so the
 * mjpeg demuxer assumes a fixed 25 fps and stamps frames 1/25 s apart. The
 * recorded duration then becomes (frames received)/25, which drifts from real
 * time whenever the source's actual rate differs from 25 fps — a ~12.5 fps
 * stream records at 2× speed, a >25 fps stream at slow motion. Stamping each
 * frame with its wall-clock arrival time (`-use_wallclock_as_timestamps`) and
 * keeping variable frame timing on output (`-vsync vfr`) makes the mp4
 * duration track real elapsed time regardless of the source frame rate.
 *
 * Regression note (D1 follow-up, verified 2026-08-06 live on a real Samsung
 * Galaxy S9+ `star2ltexx`, source ~15.6 fps, Homebrew ffmpeg 8.0.1): with these
 * flags the mp4 duration tracks wall-clock — 60.72 s for 60.9 s wall (1.00×),
 * and 180.68 s for 181.7 s wall (1.01×, no drift at 3-min scale), both through
 * the full RecordingOrchestrator path. Dropping `-use_wallclock_as_timestamps`
 * reproduces the bug on the same source: 38.96 s for 60.7 s wall (1.56× fast,
 * = 25/15.6). The earlier "294.72 s for ~9:25 (1.92×)" report was a pre-flag /
 * stale-`lib` build, not a live defect in this argv. Guarded by
 * `test/unit/video-pipeline-args.spec.ts`. Do NOT add a constant
 * `-r`/`-framerate` here — that forces a fixed fps and reintroduces the 2× bug.
 */
export function buildRecordArgs(opts: {
  mjpegUrl: string;
  outputPath: string;
  isMac: boolean;
}): string[] {
  const args = [
    '-y',
    '-loglevel', 'error',
    '-reconnect', '1',
    '-reconnect_at_eof', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-probesize', '32',
    '-analyzeduration', '0',
    // Stamp frames with wall-clock arrival time (must precede -i).
    '-use_wallclock_as_timestamps', '1',
    '-f', 'mjpeg',
    '-i', opts.mjpegUrl,
    '-pix_fmt', 'yuv420p',
  ];
  if (opts.isMac) {
    args.push('-c:v', 'h264_videotoolbox', '-realtime', '1', '-q:v', '50');
  } else {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25');
  }
  // Preserve the (variable) wall-clock timing rather than forcing constant fps.
  // Keep the deprecated `-vsync vfr` (NOT `-fps_mode vfr`): `-vsync` is accepted
  // by all ffmpeg 4–8 builds, whereas `-fps_mode` is fatal ("Unrecognized
  // option") on ffmpeg <5.1 — still shipped by some Linux nodes. The deprecation
  // warning is suppressed by the `-loglevel error` above.
  args.push('-vsync', 'vfr');
  // Fragmented mp4 during capture: instant playback + crash resiliency.
  // stopRecording remuxes to a standard (faststart) mp4 so QuickTime / Finder
  // Preview can open the file after Stop.
  args.push('-movflags', 'frag_keyframe+empty_moov+default_base_moof');
  args.push(opts.outputPath);
  return args;
}

/**
 * Build the ffmpeg argv for a composite (mosaic) recording that stacks N MJPEG
 * inputs into a single mp4. Extracted as a pure function (mirroring
 * buildRecordArgs) so the timing-critical flags on the multi-device mosaic path
 * are unit-testable without spawning ffmpeg.
 *
 * Same wall-clock timing contract as buildRecordArgs: every input is stamped
 * with `-use_wallclock_as_timestamps 1` (before its own `-i`) and the output
 * keeps `-vsync vfr`, so the composite duration tracks real elapsed time on
 * ~13–16 fps Android MJPEG sources instead of the demuxer's 25 fps assumption
 * (the 1.9×/2× fast-playback bug). See buildRecordArgs for the full rationale
 * and the live regression numbers. The filtergraph (scale/pad/stack) is built
 * by the caller and passed through verbatim as `-filter_complex`.
 */
export function buildCompositeArgs(opts: {
  inputs: CompositeInput[];
  filterGraph: string;
  outputPath: string;
  isMac: boolean;
}): string[] {
  const args: string[] = ['-y', '-loglevel', 'error'];
  // Per-input args: mjpeg + reconnect. `-use_wallclock_as_timestamps` stamps
  // each input's frames with real arrival time so the composite duration tracks
  // wall-clock (see buildRecordArgs for the full rationale).
  for (const inp of opts.inputs) {
    args.push(
      '-reconnect', '1',
      '-reconnect_at_eof', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-probesize', '32',
      '-analyzeduration', '0',
      '-use_wallclock_as_timestamps', '1',
      '-f', 'mjpeg',
      '-i', `http://127.0.0.1:${inp.mjpegPort}`,
    );
  }
  args.push(
    '-filter_complex', opts.filterGraph,
    '-map', '[v]',
    '-pix_fmt', 'yuv420p',
  );
  if (opts.isMac) {
    args.push('-c:v', 'h264_videotoolbox', '-realtime', '1', '-q:v', '50');
  } else {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25');
  }
  // Preserve wall-clock frame timing rather than forcing constant fps. Keep the
  // deprecated `-vsync vfr` (NOT `-fps_mode vfr`) for ffmpeg-version compat —
  // `-fps_mode` is fatal on ffmpeg <5.1 (see buildRecordArgs for the rationale).
  args.push('-vsync', 'vfr');
  args.push('-movflags', 'frag_keyframe+empty_moov+default_base_moof');
  args.push(opts.outputPath);
  return args;
}

/** Graceful ffmpeg stop: write `q` to stdin, then SIGINT, then SIGKILL. */
const FFMPEG_STOP_TIMEOUT_MS = 15_000;
/** Grace after `q` (or the initial SIGINT) before escalating to the next signal. */
const FFMPEG_QUIT_GRACE_MS = 2_000;

/**
 * Remux a fragmented recording into a standard mp4 (`+faststart`) so common
 * desktop players can open it. No-op if the file is missing/tiny or remux fails
 * (leaves the original fMP4 in place).
 */
export async function remuxToStandardMp4(filePath: string): Promise<void> {
  if (!filePath || !fs.existsSync(filePath)) return;
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return;
  }
  // Empty / header-only stubs aren't worth remuxing.
  if (size < 1024) return;

  const tmpPath = `${filePath}.remux.tmp.mp4`;
  try {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  } catch {
    /* ignore */
  }

  const args = [
    '-y',
    '-loglevel',
    'error',
    '-i',
    filePath,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    tmpPath,
  ];

  await new Promise<void>((resolve, reject) => {
    let isolation: { command: string; args: string[] };
    try {
      const isolationService = Container.get(ResourceIsolationService);
      isolation = isolationService.wrapSpawn(resolveFfmpegPath(), args, 'Performance');
    } catch {
      isolation = { command: resolveFfmpegPath(), args };
    }
    const proc = spawn(isolation.command, isolation.args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`remux exited ${code}: ${stderr.trim() || 'no stderr'}`));
    });
  });

  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err: any) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

function waitForFfmpegExit(proc: ChildProcess, label: string): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const timers: NodeJS.Timeout[] = [];
    const finish = () => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      resolve();
    };
    proc.once('exit', finish);

    // Primary: ask ffmpeg to finalize gracefully. Writing `q` to its stdin makes
    // ffmpeg stop reading input and flush the mp4 trailer right away, instead of
    // sitting in the `-reconnect_at_eof` retry loop until the SIGKILL timeout
    // (the ~16s stop hang). Needs the process spawned with a writable stdin pipe.
    let sentQuit = false;
    try {
      const stdin = proc.stdin;
      if (stdin && !stdin.destroyed && stdin.writable) {
        // ffmpeg may exit (closing the read end) as we write — swallow EPIPE.
        stdin.on('error', () => {});
        stdin.write('q');
        sentQuit = true;
      }
    } catch {
      /* fall through to signals */
    }

    // Escalation 1: SIGINT. Immediately if `q` couldn't be sent, otherwise after
    // a short grace so a responsive ffmpeg exits on `q` alone (no signal needed).
    timers.push(
      setTimeout(
        () => {
          if (settled) return;
          try {
            proc.kill('SIGINT');
          } catch {
            finish();
          }
        },
        sentQuit ? FFMPEG_QUIT_GRACE_MS : 0,
      ),
    );

    // Escalation 2: SIGKILL if still alive at the hard timeout.
    timers.push(
      setTimeout(() => {
        if (settled) return;
        log.warn(`[VideoPipeline] ${label} still running after graceful stop — sending SIGKILL`);
        try {
          proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, FFMPEG_STOP_TIMEOUT_MS),
    );

    // Absolute backstop so the promise always resolves.
    timers.push(setTimeout(finish, FFMPEG_STOP_TIMEOUT_MS + 2_000));
  });
}

export interface VideoPipelineOptions {
  sessionId: string;
  udid: string;
  resolution?: string;
  bitrate?: string;
  mjpegPort?: number; // Principal Efficiency: Optional pre-resolved port
  // When provided, ffmpeg writes directly to this path (and its parent dir is
  // created if missing). When omitted, the existing default path under
  // config.sessionAssetsPath is used. Used by the free-form RecordingOrchestrator
  // to keep mosaic recordings out of the session asset tree.
  outputPath?: string;
  /**
   * Called when ffmpeg exits *without* stopRecording having asked it to —
   * typically because the source ended (the device stopped answering, so the
   * MJPEG server disconnected its clients) or because ffmpeg crashed. The
   * caller owns whatever bookkeeping it wrote when the recording started;
   * nothing else will tell it the process is gone. See issue #203.
   */
  onExit?: (code: number | null) => void;
}

export interface CompositeInput {
  /** Local MJPEG port the device's stream is reachable on (loopback). */
  mjpegPort: number;
  /** Device UDID — used in logs only. */
  udid: string;
}

export interface CompositeOptions {
  /** Group identifier; serves as the ffmpeg-process key for stop(). */
  groupId: string;
  /** Ordered MJPEG inputs. The display order in the composite follows this. */
  inputs: CompositeInput[];
  /** Final mp4 path. Parent dir is created if missing. */
  outputPath: string;
  /**
   * Cell width in the composite grid, in pixels. Each input is letterboxed
   * to cellWidth × cellHeight before stacking. Default 540×960 (portrait).
   */
  cellWidth?: number;
  cellHeight?: number;
}

/**
 * Intelligent Video Pipeline Service
 *
 * Objectives:
 * 1. Hardware-accelerated encoding (VideoToolbox on Mac).
 * 2. Zero-copy asset management (direct storage).
 * 3. Instant Playback via fragmented MP4.
 */
@Service()
export class VideoPipelineService {
  private activeRecordings: Map<string, ChildProcess> = new Map();
  private recordingPaths: Map<string, string> = new Map();
  // Composite-recording (mosaic-wide single mp4) state, keyed by groupId.
  // Kept separate from activeRecordings so per-device and composite lifecycles
  // don't accidentally share a key namespace.
  private activeComposites: Map<string, ChildProcess> = new Map();
  private compositePaths: Map<string, string> = new Map();
  private isMac: boolean;

  constructor() {
    this.isMac = os.platform() === 'darwin';
  }

  /**
   * Start background recording for a session
   */
  public async startRecording(options: VideoPipelineOptions): Promise<void> {
    const { sessionId, udid } = options;

    if (this.activeRecordings.has(sessionId)) {
      log.warn(`[VideoPipeline] Recording already in progress for session ${sessionId}`);
      return;
    }

    // 1. Resolve Device MJPEG Port
    let mjpegPort = options.mjpegPort;
    if (!mjpegPort) {
      const device = await DeviceStoreFactory.getStore().findDevice({ udid });
      if (!device || !device.mjpegServerPort) {
        throw new Error(
          `[VideoPipeline] Cannot find MJPEG port for device ${udid}. Is the stream service running?`,
        );
      }
      mjpegPort = device.mjpegServerPort;
    }

    const mjpegUrl = `http://127.0.0.1:${mjpegPort}`;
    const outputPath = resolveOutputPath(sessionId, options.outputPath);
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    log.info(`[VideoPipeline] Starting HW-accelerated recording for ${sessionId} from ${mjpegUrl}`);

    // Small settlement delay to allow the source stream to prime
    await new Promise((r) => setTimeout(r, 500));

    // 2. Construct FFMPEG Args (see buildRecordArgs for the timing rationale).
    const args = buildRecordArgs({ mjpegUrl, outputPath, isMac: this.isMac });

    // Do not wrap recording ffmpeg in Economy/taskpolicy on macOS: background
    // QoS breaks VideoToolbox (no frames written → empty mp4 after Stop).
    // Recording is an explicit user action; leave it at default priority.
    const isolationService = Container.get(ResourceIsolationService);
    const { command, args: wrappedArgs } = isolationService.wrapSpawn(
      resolveFfmpegPath(),
      args,
      'Performance',
    );

    const ffmpegProc = spawn(command, wrappedArgs, {
      // stdin pipe so stop can send `q` for a graceful finalize; stderr for errors.
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    Container.get(ProcessRegistry).track({ kind: 'ffmpeg', sessionId, udid, process: ffmpegProc });

    ffmpegProc.stderr?.on('data', (data) => {
      const msg = data.toString();
      if (msg.toLowerCase().includes('error')) {
        log.error(`[VideoPipeline] FFMPEG Error [${sessionId}]: ${msg}`);
      }
    });

    ffmpegProc.on('exit', (code) => this.handleProcessExit(sessionId, code, options.onExit));

    this.activeRecordings.set(sessionId, ffmpegProc);
    this.recordingPaths.set(sessionId, outputPath);
  }

  /**
   * A recording's ffmpeg exited. Reports it to `onExit` only when nobody asked
   * for it.
   *
   * `stopRecording` drops the handle *before* awaiting the exit, so a still
   * present entry is the signal that this exit was not requested — the source
   * ended or ffmpeg died. Getting that backwards would run the caller's
   * source-ended path on every ordinary Stop as well.
   *
   * Split out from the listener so the decision is testable without spawning a
   * process.
   */
  private handleProcessExit(
    sessionId: string,
    code: number | null,
    onExit?: (code: number | null) => void,
  ): void {
    if (code !== 0 && code !== null) {
      log.warn(`[VideoPipeline] FFMPEG for ${sessionId} exited with code ${code}`);
    }
    const unrequested = this.activeRecordings.delete(sessionId);
    if (!unrequested || !onExit) return;

    log.info(
      `[VideoPipeline] FFMPEG for ${sessionId} exited on its own (${
        code === null ? 'signal' : `code ${code}`
      })`,
    );
    try {
      onExit(code);
    } catch (err: any) {
      log.warn(`[VideoPipeline] onExit handler threw for ${sessionId}: ${err?.message ?? err}`);
    }
  }

  /**
   * Stop recording and return the relative asset path
   */
  public async stopRecording(sessionId: string): Promise<string | null> {
    const proc = this.activeRecordings.get(sessionId);
    const recordedPath = this.recordingPaths.get(sessionId);

    if (!proc) {
      log.info(
        `[VideoPipeline] No active recording process for ${sessionId}, returning stored path if any.`,
      );
      // ffmpeg already exited on its own. The file still needs the faststart
      // remux the normal stop path performs, or it stays a fragmented mp4 that
      // some players will not scrub.
      if (recordedPath) {
        try {
          await remuxToStandardMp4(recordedPath);
        } catch (err: any) {
          log.warn(
            `[VideoPipeline] Remux failed for ${sessionId} (leaving fMP4): ${err?.message ?? err}`,
          );
        }
      }
      const relativePath = recordedPath
        ? path.relative(config.sessionAssetsPath, recordedPath)
        : null;
      this.recordingPaths.delete(sessionId);
      return relativePath;
    }

    log.info(`[VideoPipeline] Stopping recording for ${sessionId}`);
    // Drop the handle before awaiting: the exit that follows is one we asked
    // for, and the exit listener must not report it as a source-initiated end.
    this.activeRecordings.delete(sessionId);
    await waitForFfmpegExit(proc, `recording ${sessionId}`);
    this.recordingPaths.delete(sessionId);

    if (recordedPath) {
      try {
        await remuxToStandardMp4(recordedPath);
      } catch (err: any) {
        log.warn(
          `[VideoPipeline] Remux failed for ${sessionId} (leaving fMP4): ${err?.message ?? err}`,
        );
      }
    }

    return recordedPath ? path.relative(config.sessionAssetsPath, recordedPath) : null;
  }

  public isRecording(sessionId: string): boolean {
    return this.activeRecordings.has(sessionId) || this.recordingPaths.has(sessionId);
  }

  /**
   * Start a composite recording across N MJPEG inputs. Lays each input out
   * in a grid (1×N=1, 2×1, 2×2, or 3×2 depending on input count), letterboxes
   * each input to a fixed cell, and emits a single mp4 to outputPath.
   *
   * Returns immediately once ffmpeg is spawned. The output may take a moment
   * to start growing as ffmpeg waits for the first frame from each input.
   */
  public async startComposite(options: CompositeOptions): Promise<void> {
    const { groupId, inputs, outputPath } = options;
    if (this.activeComposites.has(groupId)) {
      log.warn(`[VideoPipeline] Composite already running for group ${groupId}`);
      return;
    }
    if (inputs.length < 2) {
      throw new Error(
        `[VideoPipeline] startComposite requires at least 2 inputs, got ${inputs.length}`,
      );
    }
    const layout = pickLayout(inputs.length);
    const cellW = options.cellWidth ?? 540;
    const cellH = options.cellHeight ?? 960;

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Settle so all sources have primed at least one frame.
    await new Promise((r) => setTimeout(r, 750));

    // Build the filtergraph: scale+pad each input to a uniform cell, then stack.
    const filterParts: string[] = [];
    for (let i = 0; i < inputs.length; i++) {
      filterParts.push(
        `[${i}:v]scale=${cellW}:${cellH}:force_original_aspect_ratio=decrease,` +
          `pad=${cellW}:${cellH}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v${i}]`,
      );
    }
    filterParts.push(buildStackFilter(inputs.length, layout, cellW, cellH));
    const filterGraph = filterParts.join(';');

    // Same wall-clock timing contract as the single-device recorder; see
    // buildCompositeArgs / buildRecordArgs for the rationale + regression numbers.
    const args = buildCompositeArgs({ inputs, filterGraph, outputPath, isMac: this.isMac });

    log.info(
      `[VideoPipeline] Composite [${groupId}] starting: ${inputs.length} inputs, layout=${layout}, ${cellW}×${cellH}/cell → ${outputPath}`,
    );

    const isolationService = Container.get(ResourceIsolationService);
    const { command, args: wrappedArgs } = isolationService.wrapSpawn(
      resolveFfmpegPath(),
      args,
      'Performance',
    );
    const proc = spawn(command, wrappedArgs, {
      // stdin pipe so stopComposite can send `q` for a graceful finalize.
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    Container.get(ProcessRegistry).track({
      kind: 'ffmpeg',
      sessionId: `composite_${groupId}`,
      udid: inputs.map((i) => i.udid).join(','),
      process: proc,
    });

    proc.stderr?.on('data', (data) => {
      const msg = data.toString();
      if (msg.toLowerCase().includes('error')) {
        log.error(`[VideoPipeline] FFMPEG composite error [${groupId}]: ${msg}`);
      }
    });
    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        log.warn(`[VideoPipeline] Composite [${groupId}] exited with code ${code}`);
      }
      this.activeComposites.delete(groupId);
    });

    this.activeComposites.set(groupId, proc);
    this.compositePaths.set(groupId, outputPath);
  }

  /**
   * Stop the composite recording for a group. Returns the output path so
   * callers can include it in manifests/bundles. Returns null if there was
   * no composite for the group.
   */
  public async stopComposite(groupId: string): Promise<string | null> {
    const proc = this.activeComposites.get(groupId);
    const outPath = this.compositePaths.get(groupId) ?? null;
    if (!proc) {
      // Nothing running, but we may still have a stored path from a prior call.
      this.compositePaths.delete(groupId);
      return outPath;
    }
    log.info(`[VideoPipeline] Stopping composite for ${groupId}`);
    await waitForFfmpegExit(proc, `composite ${groupId}`);
    this.activeComposites.delete(groupId);
    this.compositePaths.delete(groupId);

    if (outPath) {
      try {
        await remuxToStandardMp4(outPath);
      } catch (err: any) {
        log.warn(
          `[VideoPipeline] Composite remux failed for ${groupId} (leaving fMP4): ${err?.message ?? err}`,
        );
      }
    }
    return outPath;
  }

  public getCompositePath(groupId: string): string | null {
    return this.compositePaths.get(groupId) ?? null;
  }

  /**
   * Terminate all active recordings (used during system shutdown)
   */
  public async cleanup(): Promise<void> {
    log.info(
      `[VideoPipeline] Cleaning up ${this.activeRecordings.size} per-device + ${this.activeComposites.size} composite recordings`,
    );
    for (const [, proc] of this.activeRecordings.entries()) {
      proc.kill('SIGINT');
    }
    this.activeRecordings.clear();
    for (const [, proc] of this.activeComposites.entries()) {
      proc.kill('SIGINT');
    }
    this.activeComposites.clear();
  }
}

type CompositeLayout = '1x2' | '2x1' | '2x2' | '3x2';

function pickLayout(n: number): CompositeLayout {
  if (n === 2) return '2x1'; // side-by-side
  if (n <= 4) return '2x2';
  return '3x2'; // up to 6
}

/**
 * Build the final stacking filter clause that consumes the [v0..vN-1] cells
 * and produces a single [v] output, padded with black if N < grid cells.
 */
function buildStackFilter(
  n: number,
  layout: CompositeLayout,
  cellW: number,
  cellH: number,
): string {
  // Generate black padding inputs for any empty cells so xstack always gets
  // its full input list — simpler than dynamic layout-string permutations.
  const cells = layout === '2x1' ? 2 : layout === '2x2' ? 4 : 6;
  const padded: string[] = [];
  for (let i = 0; i < n; i++) padded.push(`[v${i}]`);
  for (let i = n; i < cells; i++) {
    // Synthesise a black cell with the same dimensions.
    padded.push(`[blank${i}]`);
  }

  const blanksPrefix: string[] = [];
  for (let i = n; i < cells; i++) {
    blanksPrefix.push(
      `color=c=black:s=${cellW}x${cellH}:r=15[blank${i}]`,
    );
  }

  let stack: string;
  if (layout === '2x1') {
    stack = `${padded.join('')}hstack=inputs=${cells}[v]`;
  } else if (layout === '2x2') {
    // 2 cols × 2 rows: positions 0_0|w0_0|0_h0|w0_h0
    stack = `${padded.join('')}xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[v]`;
  } else {
    // 3 cols × 2 rows
    stack =
      `${padded.join('')}xstack=inputs=6:layout=0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0[v]`;
  }
  return blanksPrefix.length ? `${blanksPrefix.join(';')};${stack}` : stack;
}
