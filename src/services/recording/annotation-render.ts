import { Service, Container } from 'typedi';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { RecordingStore } from './recording-store';
import log from '../../logger';

const renderLog = log.scope('AnnotationRender');

/**
 * Lazy: builds an annotated mp4 to a tmp path on demand and returns a stream.
 * Only invoked when the user clicks "Download annotated MP4". Source video
 * stays clean; annotations live as metadata in the proof bundle by default.
 */
@Service()
export class AnnotationRenderService {
  constructor(
    private readonly store: RecordingStore = Container.get(RecordingStore),
  ) {}

  async renderForRecording(
    recordingId: string,
  ): Promise<{ stream: Readable; cleanup: () => void }> {
    const rec: any = await this.store.findById(recordingId);
    if (!rec) throw new Error(`Recording ${recordingId} not found`);
    if (!fs.existsSync(rec.file_path)) {
      throw new Error(`Source video missing for ${recordingId}: ${rec.file_path}`);
    }

    // Build an ffmpeg filter chain. Coordinates in geometry are normalized 0..1
    // and we use ffmpeg expression vars (iw, ih) so output respects whatever
    // resolution the source ended up at.
    const parts: string[] = [];
    for (const a of rec.annotations ?? []) {
      let g: any = {};
      try {
        g = JSON.parse(a.geometry);
      } catch {
        continue;
      }
      const tStart = (a.timecode_ms ?? 0) / 1000;
      if (a.shape === 'RECT') {
        const x = `iw*${this.f(g.x)}`;
        const y = `ih*${this.f(g.y)}`;
        const w = `iw*${this.f(g.w)}`;
        const h = `ih*${this.f(g.h)}`;
        parts.push(
          `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${a.color || 'red'}:t=4:enable='gte(t,${tStart})'`,
        );
      } else if (a.shape === 'TEXT' && a.text) {
        const safe = String(a.text).replace(/'/g, "\\'").replace(/:/g, '\\:');
        parts.push(
          `drawtext=text='${safe}':x=iw*${this.f(g.x)}:y=ih*${this.f(g.y)}:fontcolor=${a.color || 'white'}:fontsize=24:enable='gte(t,${tStart})'`,
        );
      }
    }

    const outPath = path.join(
      path.dirname(rec.file_path),
      `${recordingId}.annotated.mp4`,
    );
    const args = ['-y', '-i', rec.file_path];
    if (parts.length > 0) args.push('-vf', parts.join(','));
    args.push('-c:a', 'copy', outPath);

    await new Promise<void>((resolve, reject) => {
      const p = spawn('ffmpeg', args);
      let stderr = '';
      p.stderr.on('data', (d) => (stderr += d.toString()));
      p.on('close', (code) => {
        if (code === 0) resolve();
        else {
          renderLog.warn(`ffmpeg exited ${code} for ${recordingId}: ${stderr.slice(-400)}`);
          reject(new Error(`ffmpeg exited ${code}`));
        }
      });
    });

    const stream = fs.createReadStream(outPath);
    return {
      stream,
      cleanup: () => {
        try {
          fs.unlinkSync(outPath);
        } catch {
          /* ignore */
        }
      },
    };
  }

  private f(n: any): string {
    const num = Number(n);
    if (!Number.isFinite(num)) return '0';
    return num.toFixed(4);
  }
}
