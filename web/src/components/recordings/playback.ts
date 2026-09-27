import type { GroupAnnotation } from '../../api-service/recordings';
import type { AnnotationShape, OverlayAnnotation } from '../mosaic/recording-group-store';

/** Every phone follows one clock; a video further off it than this is moved back. */
export const RESYNC_MS = 250;
/** While nothing plays, a seek lands exactly: within one frame. */
export const PAUSED_RESYNC_MS = 20;
/** ← and → skip this far. */
export const SKIP_MS = 5000;

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/** "0:42", "4:12", "1:02:03". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export type TilePhase = 'before' | 'playing' | 'after';

/** Where a phone is at a group time: not joined yet, playing, or finished. */
export function tilePhase(groupMs: number, offsetMs: number, durationMs: number | null): TilePhase {
  if (groupMs < offsetMs) return 'before';
  if (durationMs !== null && groupMs >= offsetMs + durationMs) return 'after';
  return 'playing';
}

/** A phone's own video time at a group time. */
export function videoTimeMs(groupMs: number, offsetMs: number): number {
  return groupMs - offsetMs;
}

export function needsResync(
  actualMs: number,
  expectedMs: number,
  toleranceMs: number = RESYNC_MS,
): boolean {
  return Math.abs(actualMs - expectedMs) > toleranceMs;
}

export function positionPct(ms: number, durationMs: number): number {
  if (!(durationMs > 0)) return 0;
  return Math.min(100, Math.max(0, (ms / durationMs) * 100));
}

export function clampTime(ms: number, durationMs: number): number {
  return Math.min(Math.max(0, ms), Math.max(0, durationMs));
}

/** Marks on screen at a group time: from their time until their end, or to the end. */
export function visibleAt<T extends { timecodeMs: number; endTimecodeMs: number | null }>(
  list: T[],
  groupMs: number,
): T[] {
  return list.filter(
    (a) => a.timecodeMs <= groupMs && (a.endTimecodeMs === null || groupMs < a.endTimecodeMs),
  );
}

/** A stored mark as the overlay draws it; null when its geometry can't be read. */
export function toOverlay(a: GroupAnnotation): OverlayAnnotation | null {
  let geometry: OverlayAnnotation['geometry'];
  try {
    geometry = JSON.parse(a.geometry);
  } catch {
    return null;
  }
  if (!geometry || typeof geometry.x !== 'number' || typeof geometry.y !== 'number') return null;
  return {
    shape: a.shape as AnnotationShape,
    color: a.color,
    geometry,
    text: a.text ?? undefined,
  };
}
