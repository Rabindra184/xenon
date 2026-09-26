import * as fs from 'fs';
import * as path from 'path';
import type { AnnotationRow } from './annotation-render';

/**
 * When a recording's video started, relative to the group's t=0.
 *
 * Mark timecodes count from the dashboard's t=0, which it stamps when
 * `POST /recordings` returns. A device's video starts when its ffmpeg spawns,
 * which in a multi-device group is well before that (each device's spawn, then
 * the composite's 750 ms settle), so its marks showed about a second early.
 */
export interface RecordingTiming {
  version: 1;
  /** Wall-clock ms when this recording's ffmpeg was spawned. */
  spawnedAtMs: number;
  /** Wall-clock ms when the group's start() returned: the dashboard's t=0. */
  groupT0Ms: number;
}

/** Beyond this the file is corrupt, not a real start-up gap. */
const MAX_SHIFT_MS = 5 * 60 * 1000;

/** `<recordings>/<id>/timing.json`, removed with the recording's directory. */
export function recordingTimingPath(videoFilePath: string): string {
  return path.join(path.dirname(path.dirname(videoFilePath)), 'timing.json');
}

/** Best effort: without the file the video is rendered unshifted, as before. */
export function writeRecordingTiming(
  videoFilePath: string,
  timing: Omit<RecordingTiming, 'version'>,
): void {
  const file = recordingTimingPath(videoFilePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, ...timing }));
}

export function readRecordingTiming(videoFilePath: string): RecordingTiming | undefined {
  try {
    const t = JSON.parse(fs.readFileSync(recordingTimingPath(videoFilePath), 'utf8'));
    if (t?.version === 1 && Number.isFinite(t.spawnedAtMs) && Number.isFinite(t.groupT0Ms)) {
      return { version: 1, spawnedAtMs: t.spawnedAtMs, groupT0Ms: t.groupT0Ms };
    }
  } catch {
    /* missing or unreadable: no timing */
  }
  return undefined;
}

/**
 * How far to move a mark in this recording's own video: a mark at timecode T
 * happened T + (t0 - spawn) into it. Negative for a device added after t=0.
 */
export function markShiftMs(timing: RecordingTiming | undefined): number {
  if (!timing) return 0;
  const shift = Math.round(timing.groupT0Ms - timing.spawnedAtMs);
  return Math.abs(shift) > MAX_SHIFT_MS ? 0 : shift;
}

export function shiftAnnotations<T extends AnnotationRow>(annotations: T[], shiftMs: number): T[] {
  if (shiftMs === 0) return annotations;
  return annotations.map((a) => ({
    ...a,
    timecode_ms: (a.timecode_ms ?? 0) + shiftMs,
    end_timecode_ms:
      a.end_timecode_ms === null || a.end_timecode_ms === undefined
        ? a.end_timecode_ms
        : a.end_timecode_ms + shiftMs,
  }));
}
