import { Service, Container } from 'typedi';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { RecordingStore } from './recording-store';
import { resolveFfmpegPath } from '../../helpers/ffmpegPath';
import { probeVideoDurationSec } from './probeDuration';
import log from '../../logger';

const renderLog = log.scope('AnnotationRender');

// All ffmpeg spawns go through the bundled binary (resolveFfmpegPath) — a bare
// name ENOENTs under the Mac-app launch (no shell PATH). ffprobe is not bundled,
// so duration is derived from ffmpeg itself (see probeDurationSec).

/**
 * A late annotation (drawn after the capture ended — e.g. while the ~2×-speed
 * bug shortened the mp4) is pinned this many seconds before EOF so
 * `gte(t,tStart)` still fires on a real frame instead of never rendering.
 */
const LATE_ANNOTATION_MARGIN_SEC = 0.5;

export interface AnnotationRow {
  shape: string;
  geometry: string;
  color?: string | null;
  text?: string | null;
  timecode_ms?: number | null;
}

/**
 * Burns annotation metadata into an mp4 (ffmpeg drawbox / drawellipse / lines).
 * Used by the dashboard download paths so "Download video" includes what the
 * user drew while recording.
 */
@Service()
export class AnnotationRenderService {
  constructor(
    private readonly store: RecordingStore = Container.get(RecordingStore),
  ) {}

  /**
   * In-flight renders keyed by output path. The E prewarm and a user Download
   * can both reach {@link resolvePlayablePath} before the annotated mp4 is
   * finalized; coalescing here keeps them on one `ffmpeg` pass instead of two
   * `-y` writers clobbering the same file (which would serve a corrupt video).
   */
  private readonly renderInFlight = new Map<string, Promise<void>>();

  /**
   * Return a playable file path for download. If the recording has annotations,
   * burns them into `<id>.annotated.mp4` (cached when newer than the source).
   * Otherwise returns the clean source path.
   */
  async resolvePlayablePath(recordingId: string): Promise<{
    filePath: string;
    annotated: boolean;
  }> {
    const rec: any = await this.store.findById(recordingId);
    if (!rec) throw new Error(`Recording ${recordingId} not found`);
    if (!rec.file_path || !fs.existsSync(rec.file_path)) {
      throw new Error(`Source video missing for ${recordingId}`);
    }
    const annotations = (rec.annotations ?? []) as AnnotationRow[];
    if (annotations.length === 0) {
      return { filePath: rec.file_path, annotated: false };
    }
    const outPath = path.join(
      path.dirname(rec.file_path),
      `${recordingId}.annotated.mp4`,
    );
    const stampPath = `${outPath}.stamp`;
    // Invalidate when source or annotation set changes (annotations land after
    // the mp4 is finalized, so source mtime alone is not enough).
    const stamp = this.cacheStamp(rec.file_path, annotations);
    let needsRender = true;
    try {
      if (
        fs.existsSync(outPath) &&
        fs.existsSync(stampPath) &&
        fs.readFileSync(stampPath, 'utf8') === stamp
      ) {
        needsRender = false;
      }
    } catch {
      needsRender = true;
    }
    if (needsRender) {
      await this.renderCached(outPath, stampPath, stamp, rec.file_path, annotations);
    }
    return { filePath: outPath, annotated: true };
  }

  /**
   * Render `outPath` at most once across concurrent callers (keyed by outPath).
   * Prevents two `ffmpeg -y` processes from writing the same annotated mp4 while
   * a download streams it — see {@link renderInFlight}.
   */
  private renderCached(
    outPath: string,
    stampPath: string,
    stamp: string,
    sourcePath: string,
    annotations: AnnotationRow[],
  ): Promise<void> {
    const existing = this.renderInFlight.get(outPath);
    if (existing) return existing;
    const task = (async () => {
      // A render that finished between the caller's cache check and now may have
      // already produced a valid file — re-check before spending another pass.
      try {
        if (
          fs.existsSync(outPath) &&
          fs.existsSync(stampPath) &&
          fs.readFileSync(stampPath, 'utf8') === stamp
        ) {
          return;
        }
      } catch {
        /* fall through to render */
      }
      await this.renderToFile(sourcePath, outPath, annotations);
      fs.writeFileSync(stampPath, stamp, 'utf8');
    })().finally(() => this.renderInFlight.delete(outPath));
    this.renderInFlight.set(outPath, task);
    return task;
  }

  async renderForRecording(
    recordingId: string,
  ): Promise<{ stream: Readable; cleanup: () => void }> {
    const { filePath, annotated } = await this.resolvePlayablePath(recordingId);
    const stream = fs.createReadStream(filePath);
    return {
      stream,
      cleanup: () => {
        // Only delete ephemeral annotated files produced for the legacy export
        // route when we want to free disk — keep the cache for dashboard
        // downloads. No-op cleanup keeps streams simple.
        void annotated;
      },
    };
  }

  /** Pure helper — exported for unit tests. */
  buildFilterParts(annotations: AnnotationRow[], videoDurationSec?: number): string[] {
    const parts: string[] = [];
    for (const a of annotations) {
      let g: any = {};
      try {
        g = JSON.parse(a.geometry);
      } catch {
        continue;
      }
      const tStart = this.clampTimecodeSec((a.timecode_ms ?? 0) / 1000, videoDurationSec);
      const color = this.sanitizeColor(a.color || 'red');
      const enable = `enable='gte(t\\,${tStart})'`;

      if (a.shape === 'CIRCLE') {
        // geometry: center (x,y), radii (w,h). Prefer drawbox over drawellipse —
        // many ffmpeg builds (esp. Homebrew) ship without the drawellipse filter.
        const cx = Number(g.x) || 0;
        const cy = Number(g.y) || 0;
        const rx = Math.max(0.005, Number(g.w) || 0);
        const ry = Math.max(0.005, Number(g.h) || 0);
        const left = Math.max(0, cx - rx);
        const top = Math.max(0, cy - ry);
        const bw = Math.min(1, rx * 2);
        const bh = Math.min(1, ry * 2);
        parts.push(
          `drawbox=x=iw*${this.f(left)}:y=ih*${this.f(top)}:w=iw*${this.f(bw)}:h=ih*${this.f(bh)}:color=${color}@0.35:t=fill:${enable}`,
        );
        parts.push(
          `drawbox=x=iw*${this.f(left)}:y=ih*${this.f(top)}:w=iw*${this.f(bw)}:h=ih*${this.f(bh)}:color=${color}:t=6:${enable}`,
        );
        continue;
      }

      if (a.shape === 'ARROW') {
        // geometry: start (x,y), delta (w,h) — draw bounding highlight + tip box
        const x0 = Number(g.x) || 0;
        const y0 = Number(g.y) || 0;
        const x1 = x0 + (Number(g.w) || 0);
        const y1 = y0 + (Number(g.h) || 0);
        const left = Math.min(x0, x1);
        const top = Math.min(y0, y1);
        const bw = Math.max(0.01, Math.abs(x1 - x0));
        const bh = Math.max(0.01, Math.abs(y1 - y0));
        parts.push(
          `drawbox=x=iw*${this.f(left)}:y=ih*${this.f(top)}:w=iw*${this.f(bw)}:h=ih*${this.f(bh)}:color=${color}@0.35:t=fill:${enable}`,
        );
        parts.push(
          `drawbox=x=iw*${this.f(left)}:y=ih*${this.f(top)}:w=iw*${this.f(bw)}:h=ih*${this.f(bh)}:color=${color}:t=6:${enable}`,
        );
        parts.push(
          `drawbox=x=iw*${this.f(x1)}-14:y=ih*${this.f(y1)}-14:w=28:h=28:color=${color}:t=fill:${enable}`,
        );
        continue;
      }

      if (a.shape === 'TEXT' && a.text) {
        const safe = String(a.text).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
        parts.push(
          `drawtext=text='${safe}':expansion=none:x=iw*${this.f(g.x)}:y=ih*${this.f(g.y)}:fontcolor=${color}:fontsize=28:${enable}`,
        );
        continue;
      }

      // RECT + FREEHAND (bounding box) — filled wash + thick border so burn-in
      // stays obvious after yuv420 / downscale.
      const x = `iw*${this.f(g.x)}`;
      const y = `ih*${this.f(g.y)}`;
      const w = `iw*${this.f(g.w)}`;
      const h = `ih*${this.f(g.h)}`;
      parts.push(`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}@0.35:t=fill:${enable}`);
      parts.push(`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=6:${enable}`);
    }
    return parts;
  }

  private async renderToFile(
    sourcePath: string,
    outPath: string,
    annotations: AnnotationRow[],
  ): Promise<void> {
    // Probe the recorded span so late marks (timecode past EOF) get clamped in
    // instead of vanishing. Best-effort: on failure, buildFilterParts falls
    // back to unclamped timecodes (prior behavior).
    const durationSec = await this.probeDurationSec(sourcePath);
    const parts = this.buildFilterParts(annotations, durationSec);
    if (parts.length === 0) {
      fs.copyFileSync(sourcePath, outPath);
      return;
    }
    const args = [
      '-y',
      '-loglevel',
      'error',
      '-i',
      sourcePath,
      '-vf',
      parts.join(','),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      outPath,
    ];
    await new Promise<void>((resolve, reject) => {
      const p = this.spawnFfmpeg(args, `annotate:${path.basename(outPath)}`);
      let stderr = '';
      p.stderr?.on('data', (d) => (stderr += d.toString()));
      p.on('error', reject);
      p.on('close', (code) => {
        if (code === 0) resolve();
        else {
          renderLog.warn(`ffmpeg exited ${code}: ${stderr.slice(-400)}`);
          reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-200)}`));
        }
      });
    });
  }

  /**
   * Spawn the bundled ffmpeg and register it with ProcessRegistry so a server
   * shutdown terminates it — burn-in/probe jobs are fired off the recording-stop
   * path (Fix E prewarm) and would otherwise be orphaned. Auto-untracks on
   * close/error. The registry is lazily required so unit tests that never spawn
   * don't pull the DI graph.
   */
  private spawnFfmpeg(args: string[], label: string): ChildProcess {
    const proc = spawn(resolveFfmpegPath(), args);
    let registry: any;
    let trackId: string | undefined;
    try {
      registry = Container.get(require('../ProcessRegistry').ProcessRegistry);
      trackId = registry.track({ kind: 'ffmpeg', sessionId: label, process: proc });
    } catch {
      /* registry not wired — best-effort tracking only */
    }
    const untrack = () => {
      if (!trackId || !registry) return;
      try {
        registry.untrack(trackId);
      } catch {
        /* ignore */
      }
      trackId = undefined;
    };
    proc.once('close', untrack);
    proc.once('error', untrack);
    return proc;
  }

  /**
   * Clamp an annotation start time (seconds). In-range marks (including the
   * final seconds) pass through unchanged; only a mark whose timecode overshoots
   * the recorded video — a wall-clock timecode past a short capture's EOF — is
   * pinned to `duration - margin` so it still renders near the end instead of
   * never. With no (or non-positive) duration the raw value is preserved: the
   * caller couldn't probe it, so don't guess.
   */
  private clampTimecodeSec(rawSec: number, durationSec?: number): number {
    const t = Math.max(0, rawSec);
    if (!Number.isFinite(durationSec as number) || (durationSec as number) <= 0) {
      return t;
    }
    if (t <= (durationSec as number)) return t;
    return Math.max(0, (durationSec as number) - LATE_ANNOTATION_MARGIN_SEC);
  }

  /**
   * Probe a video's duration (seconds). Lives in probeDuration.ts now — the
   * recording-stop path needs the same number to persist a real duration
   * instead of wall-clock (issue #204), and two copies of a two-stage ffmpeg
   * probe would drift.
   */
  private async probeDurationSec(filePath: string): Promise<number | undefined> {
    return probeVideoDurationSec(filePath);
  }

  private sanitizeColor(c: string): string {
    // ffmpeg color names or 0xRRGGBB / #RRGGBB
    const s = String(c || 'red').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return `0x${s.slice(1)}`;
    if (/^0x[0-9a-fA-F]{6}$/i.test(s)) return s;
    return s.replace(/[^a-zA-Z0-9_]/g, '') || 'red';
  }

  private cacheStamp(sourcePath: string, annotations: AnnotationRow[]): string {
    const srcMtime = fs.statSync(sourcePath).mtimeMs;
    const parts = annotations.map(
      (a: any) =>
        `${a.id ?? ''}:${a.timecode_ms ?? 0}:${a.shape}:${a.geometry}:${a.color ?? ''}:${a.text ?? ''}`,
    );
    // Bump prefix when burn-in style changes so cached .annotated.mp4 is rebuilt.
    return `v2|${srcMtime}|${parts.join('|')}`;
  }

  private f(n: any): string {
    const num = Number(n);
    if (!Number.isFinite(num)) return '0';
    return num.toFixed(4);
  }
}
