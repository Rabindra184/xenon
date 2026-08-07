import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { Container } from 'typedi';
import { resolveFfmpegPath } from '../../helpers/ffmpegPath';
import { ProcessRegistry } from '../ProcessRegistry';

/**
 * How long a video actually is, according to the file rather than the clock.
 *
 * Why this exists: a recording's duration used to be wall-clock — the time
 * between start and stop — which agrees with the file only while capture keeps
 * up. When the device stopped answering mid-recording, a 35s mp4 was reported
 * as 5m36s (issue #204). Wall-clock is not lost by this: `started_at` and
 * `ended_at` are both persisted, so it stays derivable, whereas the media
 * duration is not recoverable after the fact without re-reading the file.
 *
 * There is deliberately no ffprobe dependency — it is not bundled, and a bare
 * binary name ENOENTs under the Mac-app launch (no shell PATH) — so the numbers
 * come out of ffmpeg's own output. Extracted from AnnotationRenderService,
 * which needed the same thing to clamp late annotations.
 */

/** Ceiling on a single probe, so a wedged ffmpeg can never hang a Stop. */
export const PROBE_TIMEOUT_MS = 10_000;

/** Duration from ffmpeg's "Duration: HH:MM:SS.ss" header line. */
export function parseFfmpegHeaderDurationSec(stderr: string): number | undefined {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3]);
  // 0 is not an answer — let the caller fall back rather than record a zero.
  return Number.isFinite(sec) && sec > 0 ? sec : undefined;
}

/** Duration from the last `out_time_us` of an `-f null` decode pass. */
export function parseFfmpegProgressDurationSec(stdout: string): number | undefined {
  const matches = [...stdout.matchAll(/out_time_us=(\d+)/g)];
  if (!matches.length) return undefined;
  const sec = Number(matches[matches.length - 1][1]) / 1e6;
  return Number.isFinite(sec) && sec > 0 ? sec : undefined;
}

/**
 * Spawn the bundled ffmpeg and register it with ProcessRegistry so a server
 * shutdown terminates it — probes are fired off the recording-stop path and
 * would otherwise be orphaned. Registration is best-effort: unit tests that
 * never wire the DI container still get a working probe.
 */
function spawnFfmpeg(args: string[], label: string): ChildProcess {
  const proc = spawn(resolveFfmpegPath(), args);
  let registry: any;
  let trackId: string | undefined;
  try {
    registry = Container.get(ProcessRegistry);
    trackId = registry.track({ kind: 'ffmpeg', sessionId: label, process: proc });
  } catch {
    /* registry unavailable (unit tests) — proceed untracked */
  }
  const untrack = () => {
    try {
      if (registry && trackId) registry.untrack(trackId);
    } catch {
      /* ignore */
    }
  };
  proc.on('close', untrack);
  proc.on('error', untrack);
  return proc;
}

function runProbe(
  args: string[],
  label: string,
  parse: (io: { stdout: string; stderr: string }) => number | undefined,
  timeoutMs: number,
): Promise<number | undefined> {
  return new Promise((resolve) => {
    let proc: ChildProcess;
    try {
      proc = spawnFfmpeg(args, label);
    } catch {
      return resolve(undefined);
    }

    let settled = false;
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      done(undefined);
    }, timeoutMs);
    const done = (value?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => (stdout += d.toString()));
    proc.stderr?.on('data', (d) => (stderr += d.toString()));
    proc.on('error', () => done(undefined));
    proc.on('close', () => done(parse({ stdout, stderr })));
  });
}

/**
 * Probe a video's duration in seconds. Reads the container header first, then
 * falls back to a decode pass for fragmented mp4s (e.g. a failed remux) whose
 * header carries no duration. Undefined on any failure or timeout, so callers
 * can degrade rather than record a wrong number.
 */
export async function probeVideoDurationSec(
  filePath: string,
  opts: { timeoutMs?: number } = {},
): Promise<number | undefined> {
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const base = path.basename(filePath);

  // `ffmpeg -i <file>` with no output prints stream info then exits non-zero;
  // we only want the Duration line on stderr.
  const fromHeader = await runProbe(
    ['-hide_banner', '-i', filePath],
    `probe:${base}`,
    ({ stderr }) => parseFfmpegHeaderDurationSec(stderr),
    timeoutMs,
  );
  if (fromHeader !== undefined) return fromHeader;

  return runProbe(
    ['-hide_banner', '-nostats', '-i', filePath, '-f', 'null', '-progress', 'pipe:1', '-'],
    `probe-decode:${base}`,
    ({ stdout }) => parseFfmpegProgressDurationSec(stdout),
    timeoutMs,
  );
}

/** Same, in milliseconds — the unit the recording rows store. */
export async function probeVideoDurationMs(
  filePath: string,
  opts: { timeoutMs?: number } = {},
): Promise<number | undefined> {
  const sec = await probeVideoDurationSec(filePath, opts);
  return sec === undefined ? undefined : Math.round(sec * 1000);
}
