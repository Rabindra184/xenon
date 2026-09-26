import { Service, Container } from 'typedi';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { RecordingStore } from './recording-store';
import { resolveFfmpegPath } from '../../helpers/ffmpegPath';
import { probeVideoDurationSec, probeVideoFrameSize } from './probeDuration';
import { annotationImagePath } from './annotationImage';
import { markShiftMs, readRecordingTiming, shiftAnnotations } from './recordingTiming';
import log from '../../logger';
import type { CompositeLayoutFile } from './RecordingOrchestrator';

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

/**
 * Font for TEXT marks. The bundled ffmpeg has libfreetype but no fontconfig,
 * so drawtext cannot find a font by name and must be given a file. Vendored
 * (see vendor/README.md) and copied beside the compiled module by build:copy,
 * so the same relative path works from src/ under ts-node and from lib/.
 */
export const ANNOTATION_FONT_PATH = path.join(__dirname, 'vendor', 'Inter-Regular.ttf');

/**
 * Escape a value for a filter option inside a filtergraph. ffmpeg unescapes
 * twice: the graph parser first (special: \ ' [ ] , ;), then the filter's
 * option parser (special: \ ' :). So escape for the option parser, then again
 * for the graph parser. Quoting instead is not enough: the graph parser strips
 * the quotes, and an apostrophe inside them ends the quote early.
 */
export function escapeFilterValue(value: string): string {
  const forOptions = value.replace(/[\\':]/g, '\\$&');
  return forOptions.replace(/[\\'[\],;]/g, '\\$&');
}

export interface AnnotationRow {
  id?: string;
  shape: string;
  geometry: string;
  color?: string | null;
  text?: string | null;
  timecode_ms?: number | null;
  /** When "Clear marks" ended the mark; null = visible to the end of the video. */
  end_timecode_ms?: number | null;
}

/** A rectangle in output pixels. */
export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the composite's `scale=W:H:force_original_aspect_ratio=decrease,
 * pad=W:H:(ow-iw)/2:(oh-ih)/2` puts a srcW x srcH picture inside a W x H cell.
 * Measured against the bundled ffmpeg: sizes round to nearest, offsets
 * truncate (no rounding to even).
 */
export function containBoxPx(cellW: number, cellH: number, srcW: number, srcH: number): PixelBox {
  const w = Math.min(cellW, Math.round((cellH * srcW) / srcH));
  const h = Math.min(cellH, Math.round((cellW * srcH) / srcW));
  return { x: Math.trunc((cellW - w) / 2), y: Math.trunc((cellH - h) / 2), w, h };
}

/** One composite cell's marks and where its picture sits in the composite. */
export interface CompositeCell {
  box: PixelBox;
  annotations: AnnotationRow[];
  imageFor: (a: AnnotationRow) => string | undefined;
}

export interface RenderGraph {
  /** Extra ffmpeg inputs after the source video, in order (input index = position + 1). */
  inputs: string[];
  graph: string;
  /** Label of the final video stream to `-map`. */
  output: string;
  /** True when a drawtext is present; the bundled ffmpeg has no fontconfig. */
  hasText: boolean;
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
    // Timecodes count from the dashboard's t=0; this video may have started
    // before it (multi-device groups) or after it (added devices). Only the
    // per-device video needs this: the composite starts at t=0.
    const annotations = shiftAnnotations(
      (rec.annotations ?? []) as AnnotationRow[],
      markShiftMs(readRecordingTiming(rec.file_path)),
    );
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
    if (!this.isFresh(outPath, stampPath, stamp)) {
      await this.renderCached(outPath, stampPath, stamp, () =>
        this.renderToFile(rec.file_path, outPath, annotations),
      );
    }
    return { filePath: outPath, annotated: true };
  }

  /**
   * The group's composite with every device's marks burned into its own cell.
   * Raw when the composite has no layout record (recorded before marks could
   * be placed in it) or no cell has marks.
   */
  async resolveCompositePath(groupId: string): Promise<{
    filePath: string;
    annotated: boolean;
  }> {
    // Lazy: keeps the orchestrator and pipeline graphs out of this module's load.
    const { compositeOutputPath, compositeLayoutPath } = await import('./RecordingOrchestrator');
    const { cellOrigin } = await import('../VideoPipelineService');
    const compositePath = compositeOutputPath(groupId);
    if (!fs.existsSync(compositePath)) throw new Error(`Composite missing for ${groupId}`);
    const raw = { filePath: compositePath, annotated: false };

    let layout: CompositeLayoutFile;
    try {
      layout = JSON.parse(fs.readFileSync(compositeLayoutPath(groupId), 'utf8'));
    } catch {
      return raw;
    }
    const recordings = (await this.store.listGroup(groupId)) as any[];
    const byId = new Map(recordings.map((r) => [r.id, r]));
    const cells: CompositeCell[] = [];
    for (const cell of layout.cells ?? []) {
      const rec = byId.get(cell.recordingId);
      const annotations = (rec?.annotations ?? []) as AnnotationRow[];
      if (!rec || annotations.length === 0) continue;
      // The per-device video and the composite read the same source, so its
      // frame size is the size the composite scaled into this cell.
      const size =
        rec.file_path && fs.existsSync(rec.file_path)
          ? await this.probeFrameSize(rec.file_path)
          : undefined;
      const inner = size
        ? containBoxPx(layout.cellW, layout.cellH, size.w, size.h)
        : { x: 0, y: 0, w: layout.cellW, h: layout.cellH };
      const origin = cellOrigin(cell.index, layout.cols, layout.cellW, layout.cellH);
      cells.push({
        box: { x: origin.x + inner.x, y: origin.y + inner.y, w: inner.w, h: inner.h },
        annotations,
        imageFor: (a) => this.imageFor(rec.file_path, a),
      });
    }
    if (cells.length === 0) return raw;

    const outPath = path.join(path.dirname(compositePath), 'composite.annotated.mp4');
    const stampPath = `${outPath}.stamp`;
    const stamp = this.compositeStamp(compositePath, cells);
    if (!this.isFresh(outPath, stampPath, stamp)) {
      await this.renderCached(outPath, stampPath, stamp, async () => {
        const durationSec = await this.probeDurationSec(compositePath);
        await this.renderPlan(compositePath, outPath, (withText) =>
          this.buildCompositeGraph(
            withText
              ? cells
              : cells.map((c) => ({
                  ...c,
                  annotations: this.withoutUndrawableText(c.annotations, c.imageFor),
                })),
            durationSec,
          ),
        );
      });
    }
    return { filePath: outPath, annotated: true };
  }

  private isFresh(outPath: string, stampPath: string, stamp: string): boolean {
    try {
      return (
        fs.existsSync(outPath) &&
        fs.existsSync(stampPath) &&
        fs.readFileSync(stampPath, 'utf8') === stamp
      );
    } catch {
      return false;
    }
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
    render: () => Promise<void>,
  ): Promise<void> {
    const existing = this.renderInFlight.get(outPath);
    if (existing) return existing;
    const task = (async () => {
      // A render that finished between the caller's cache check and now may have
      // already produced a valid file — re-check before spending another pass.
      if (this.isFresh(outPath, stampPath, stamp)) return;
      await render();
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
  buildFilterParts(
    annotations: AnnotationRow[],
    videoDurationSec?: number,
    /** Draw inside this pixel box (a composite cell's picture); default: the whole frame. */
    box?: PixelBox,
  ): string[] {
    // Frame-relative expressions by default; absolute pixels inside a box.
    const X = (v: number) => (box ? `${Math.round(box.x + v * box.w)}` : `iw*${this.f(v)}`);
    const Y = (v: number) => (box ? `${Math.round(box.y + v * box.h)}` : `ih*${this.f(v)}`);
    const W = (v: number) => (box ? `${Math.round(v * box.w)}` : `iw*${this.f(v)}`);
    const H = (v: number) => (box ? `${Math.round(v * box.h)}` : `ih*${this.f(v)}`);
    const parts: string[] = [];
    for (const a of annotations) {
      let g: any = {};
      try {
        g = JSON.parse(a.geometry);
      } catch {
        continue;
      }
      const enable = this.enableExpr(a, videoDurationSec);
      if (!enable) continue;
      const color = this.sanitizeColor(a.color || 'red');

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
          `drawbox=x=${X(left)}:y=${Y(top)}:w=${W(bw)}:h=${H(bh)}:color=${color}@0.35:t=fill:${enable}`,
        );
        parts.push(
          `drawbox=x=${X(left)}:y=${Y(top)}:w=${W(bw)}:h=${H(bh)}:color=${color}:t=6:${enable}`,
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
          `drawbox=x=${X(left)}:y=${Y(top)}:w=${W(bw)}:h=${H(bh)}:color=${color}@0.35:t=fill:${enable}`,
        );
        parts.push(
          `drawbox=x=${X(left)}:y=${Y(top)}:w=${W(bw)}:h=${H(bh)}:color=${color}:t=6:${enable}`,
        );
        parts.push(`drawbox=x=${X(x1)}-14:y=${Y(y1)}-14:w=28:h=28:color=${color}:t=fill:${enable}`);
        continue;
      }

      if (a.shape === 'TEXT' && a.text) {
        // drawtext's size variables are w/h (it rejects iw/ih), and it needs an
        // explicit font file on this ffmpeg.
        const font = escapeFilterValue(ANNOTATION_FONT_PATH);
        const text = escapeFilterValue(String(a.text));
        const gx = Number(g.x) || 0;
        const gy = Number(g.y) || 0;
        const tx = box ? `x=${X(gx)}` : `x=w*${this.f(gx)}`;
        const ty = box ? `y=${Y(gy)}` : `y=h*${this.f(gy)}`;
        parts.push(
          `drawtext=fontfile=${font}:text=${text}:expansion=none:${tx}:${ty}:fontcolor=${color}:fontsize=28:${enable}`,
        );
        continue;
      }

      // RECT + FREEHAND (bounding box) — filled wash + thick border so burn-in
      // stays obvious after yuv420 / downscale.
      const x = X(Number(g.x) || 0);
      const y = Y(Number(g.y) || 0);
      const w = W(Number(g.w) || 0);
      const h = H(Number(g.h) || 0);
      parts.push(`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}@0.35:t=fill:${enable}`);
      parts.push(`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=6:${enable}`);
    }
    return parts;
  }

  /** `enable=` expression for a mark, or null when its window is empty. */
  private enableExpr(a: AnnotationRow, videoDurationSec?: number): string | null {
    const start = this.clampTimecodeSec((a.timecode_ms ?? 0) / 1000, videoDurationSec);
    if (a.end_timecode_ms === null || a.end_timecode_ms === undefined) {
      return `enable='gte(t\\,${start})'`;
    }
    const end = Math.max(0, a.end_timecode_ms / 1000);
    // Half-open: `between` would still show the mark on the frame it was cleared.
    if (end <= start) return null;
    return `enable='gte(t\\,${start})*lt(t\\,${end})'`;
  }

  /**
   * The full filtergraph. Marks with an image are composited exactly as the
   * preview drew them. Marks without one (API clients, rows from before
   * images) fall back to drawbox. The fallback runs first so image marks,
   * which are what the user saw, sit on top.
   */
  buildRenderGraph(
    annotations: AnnotationRow[],
    videoDurationSec: number | undefined,
    imageFor: (a: AnnotationRow) => string | undefined,
  ): RenderGraph | null {
    const withImage: Array<{ file: string; enable: string }> = [];
    const drawn: AnnotationRow[] = [];
    for (const a of annotations) {
      const file = imageFor(a);
      if (!file) {
        drawn.push(a);
        continue;
      }
      const enable = this.enableExpr(a, videoDurationSec);
      if (enable) withImage.push({ file, enable });
    }
    const parts = this.buildFilterParts(drawn, videoDurationSec);
    const hasText = parts.some((p) => p.startsWith('drawtext='));
    const chunks: string[] = [];
    let cur = '[0:v]';
    if (parts.length > 0) {
      chunks.push(`[0:v]${parts.join(',')}[d0]`);
      cur = '[d0]';
    }
    withImage.forEach(({ enable }, i) => {
      const k = i + 1;
      // In scale2ref, iw/ih are the REFERENCE's size. main_w/main_h did not
      // scale on the bundled ffmpeg 4.4.
      chunks.push(`[${k}:v]${cur}scale2ref=w=iw:h=ih[o${k}][b${k}]`);
      chunks.push(`[b${k}][o${k}]overlay=0:0:${enable}[v${k}]`);
      cur = `[v${k}]`;
    });
    if (cur === '[0:v]') return null;
    return { inputs: withImage.map((w) => w.file), graph: chunks.join(';'), output: cur, hasText };
  }

  private async renderToFile(
    sourcePath: string,
    outPath: string,
    annotations: AnnotationRow[],
  ): Promise<void> {
    // Probe the recorded span so late marks (timecode past EOF) get clamped in
    // instead of vanishing. Best-effort: without a duration the timecodes are
    // used unclamped (prior behavior).
    const durationSec = await this.probeDurationSec(sourcePath);
    const imageFor = (a: AnnotationRow) => this.imageFor(sourcePath, a);
    await this.renderPlan(sourcePath, outPath, (withText) =>
      this.buildRenderGraph(
        withText ? annotations : this.withoutUndrawableText(annotations, imageFor),
        durationSec,
        imageFor,
      ),
    );
  }

  /**
   * Run a graph, or copy the source when there is nothing to draw. If it fails
   * with text in it, retry once without the text marks: one undrawable text
   * mark must not cost every other mark.
   */
  private async renderPlan(
    sourcePath: string,
    outPath: string,
    build: (withText: boolean) => RenderGraph | null,
  ): Promise<void> {
    const plan = build(true);
    if (!plan) {
      fs.copyFileSync(sourcePath, outPath);
      return;
    }
    try {
      await this.runGraph(sourcePath, outPath, plan);
    } catch (err: any) {
      if (!plan.hasText) throw err;
      renderLog.warn(
        `Text marks could not be drawn, rendering without them: ${err?.message ?? err}`,
      );
      const retry = build(false);
      if (!retry) {
        fs.copyFileSync(sourcePath, outPath);
        return;
      }
      await this.runGraph(sourcePath, outPath, retry);
    }
  }

  private withoutUndrawableText(
    annotations: AnnotationRow[],
    imageFor: (a: AnnotationRow) => string | undefined,
  ): AnnotationRow[] {
    return annotations.filter((a) => a.shape !== 'TEXT' || !!imageFor(a));
  }

  /**
   * One graph over the whole composite: every cell's box-drawn marks first,
   * then each image mark scaled to its cell's picture and overlaid there.
   */
  buildCompositeGraph(cells: CompositeCell[], videoDurationSec?: number): RenderGraph | null {
    const parts: string[] = [];
    const images: Array<{ file: string; enable: string; box: PixelBox }> = [];
    for (const cell of cells) {
      const drawn: AnnotationRow[] = [];
      for (const a of cell.annotations) {
        const file = cell.imageFor(a);
        if (!file) {
          drawn.push(a);
          continue;
        }
        const enable = this.enableExpr(a, videoDurationSec);
        if (enable) images.push({ file, enable, box: cell.box });
      }
      parts.push(...this.buildFilterParts(drawn, videoDurationSec, cell.box));
    }
    const hasText = parts.some((p) => p.startsWith('drawtext='));
    const chunks: string[] = [];
    let cur = '[0:v]';
    if (parts.length > 0) {
      chunks.push(`[0:v]${parts.join(',')}[d0]`);
      cur = '[d0]';
    }
    images.forEach(({ enable, box }, i) => {
      const k = i + 1;
      chunks.push(`[${k}:v]scale=${box.w}:${box.h}[o${k}]`);
      chunks.push(`${cur}[o${k}]overlay=${box.x}:${box.y}:${enable}[v${k}]`);
      cur = `[v${k}]`;
    });
    if (cur === '[0:v]') return null;
    return { inputs: images.map((i) => i.file), graph: chunks.join(';'), output: cur, hasText };
  }

  private async probeFrameSize(filePath: string): Promise<{ w: number; h: number } | undefined> {
    return probeVideoFrameSize(filePath);
  }

  private imageFor(sourcePath: string, a: AnnotationRow): string | undefined {
    if (!a.id) return undefined;
    const p = annotationImagePath(sourcePath, a.id);
    return fs.existsSync(p) ? p : undefined;
  }

  private async runGraph(sourcePath: string, outPath: string, plan: RenderGraph): Promise<void> {
    // A script file: no argv length limit with many marks, no shell quoting.
    const scriptPath = `${outPath}.filter.txt`;
    fs.writeFileSync(scriptPath, plan.graph, 'utf8');
    const args = ['-y', '-loglevel', 'error', '-i', sourcePath];
    for (const input of plan.inputs) args.push('-i', input);
    args.push(
      '-filter_complex_script',
      scriptPath,
      '-map',
      plan.output,
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
    );
    try {
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
    } finally {
      fs.rmSync(scriptPath, { force: true });
    }
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
    const parts = annotations.map((a) => this.markStamp(a, (m) => this.imageFor(sourcePath, m)));
    // Bump prefix when burn-in style changes so cached .annotated.mp4 is rebuilt.
    // v3: time windows + image overlays.
    return `v3|${srcMtime}|${parts.join('|')}`;
  }

  /** Composite cache stamp: the source, each cell's box, and every mark in it. */
  private compositeStamp(compositePath: string, cells: CompositeCell[]): string {
    const srcMtime = fs.statSync(compositePath).mtimeMs;
    const perCell = cells.map((c) => {
      const b = `${c.box.x},${c.box.y},${c.box.w},${c.box.h}`;
      return `${b}|${c.annotations.map((a) => this.markStamp(a, c.imageFor)).join('|')}`;
    });
    return `c1|${srcMtime}|${perCell.join('#')}`;
  }

  /** A late-arriving image or a later clear must bust the cache. */
  private markStamp(a: AnnotationRow, imageFor: (a: AnnotationRow) => string | undefined): string {
    const img = imageFor(a);
    const imgMtime = img ? fs.statSync(img).mtimeMs : 0;
    return `${a.id ?? ''}:${a.timecode_ms ?? 0}:${a.end_timecode_ms ?? ''}:${a.shape}:${a.geometry}:${a.color ?? ''}:${a.text ?? ''}:${imgMtime}`;
  }

  private f(n: any): string {
    const num = Number(n);
    if (!Number.isFinite(num)) return '0';
    return num.toFixed(4);
  }
}
