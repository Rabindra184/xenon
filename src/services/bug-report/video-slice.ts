import { spawn as nodeSpawn, ChildProcess } from 'child_process';
import log from '../../logger';

export type SliceResult = { ok: true } | { ok: false; error: string };

type SpawnFn = (cmd: string, args: string[]) => ChildProcess;

export function sliceVideo(
  inputPath: string,
  startSec: number,
  endSec: number,
  outPath: string,
  spawnFn: SpawnFn = nodeSpawn,
): Promise<SliceResult> {
  return new Promise((resolve) => {
    const args = [
      '-y',
      '-ss', String(startSec),
      '-to', String(endSec),
      '-i', inputPath,
      '-c', 'copy',
      outPath,
    ];
    const proc = spawnFn('ffmpeg', args);
    let stderr = '';
    if (proc.stderr) {
      proc.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
    }
    proc.on('error', (err: Error) => {
      log.warn(`[BugReport] ffmpeg spawn failed: ${err.message}`);
      resolve({ ok: false, error: err.message });
    });
    proc.on('exit', (code: number | null) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        const tail = stderr.split('\n').slice(-3).join(' ').trim();
        resolve({ ok: false, error: `ffmpeg exit ${code}${tail ? `: ${tail}` : ''}` });
      }
    });
  });
}
