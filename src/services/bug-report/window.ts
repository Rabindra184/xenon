import {
  BugReportMode,
  ResolvedWindow,
  SLICE_DEFAULT_SEC,
  SLICE_MIN_SEC,
  SLICE_MAX_SEC,
} from './types';

interface SessionLike {
  startTime: string | Date;
  endTime: string | Date | null;
}

export function resolveWindow(
  session: SessionLike,
  mode: BugReportMode,
  windowSec: number | undefined,
  nowMs: number = Date.now(),
): ResolvedWindow {
  const startMs = new Date(session.startTime).getTime();
  const endMs = session.endTime ? new Date(session.endTime).getTime() : nowMs;

  if (mode === 'full') {
    return {
      startedAt: new Date(startMs).toISOString(),
      endedAt: new Date(endMs).toISOString(),
      durationMs: endMs - startMs,
      requestedDurationMs: endMs - startMs,
    };
  }

  const sec = windowSec ?? SLICE_DEFAULT_SEC;
  if (sec < SLICE_MIN_SEC || sec > SLICE_MAX_SEC) {
    throw new Error(`windowSec must be between ${SLICE_MIN_SEC} and ${SLICE_MAX_SEC}, got ${sec}`);
  }
  const requestedMs = sec * 1000;
  const sliceStartMs = Math.max(endMs - requestedMs, startMs);
  return {
    startedAt: new Date(sliceStartMs).toISOString(),
    endedAt: new Date(endMs).toISOString(),
    durationMs: endMs - sliceStartMs,
    requestedDurationMs: requestedMs,
  };
}
