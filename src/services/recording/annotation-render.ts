import { Service, Container } from 'typedi';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { RecordingStore } from './recording-store';
import log from '../../logger';

const renderLog = log.scope('AnnotationRender');

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
      await this.renderToFile(rec.file_path, outPath, annotations);
      fs.writeFileSync(stampPath, stamp, 'utf8');
    }
    return { filePath: outPath, annotated: true };
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
  buildFilterParts(annotations: AnnotationRow[]): string[] {
    const parts: string[] = [];
    for (const a of annotations) {
      let g: any = {};
      try {
        g = JSON.parse(a.geometry);
      } catch {
        continue;
      }
      const tStart = (a.timecode_ms ?? 0) / 1000;
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
          `drawtext=text='${safe}':x=iw*${this.f(g.x)}:y=ih*${this.f(g.y)}:fontcolor=${color}:fontsize=28:${enable}`,
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
    const parts = this.buildFilterParts(annotations);
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
      const p = spawn('ffmpeg', args);
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
