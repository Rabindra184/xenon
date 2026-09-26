import { isSelfManualLock } from '../device-access/deviceAccessPolicy';

export interface ActiveRow {
  id: string;
  group_id: string;
  device_udid: string;
  started_at: Date;
  annotations?: Array<{
    recording_id: string;
    shape: string;
    geometry: string;
    color: string;
    text: string | null;
    timecode_ms: number;
    end_timecode_ms?: number | null;
  }>;
}

export interface ActiveGroup {
  groupId: string;
  startedAt: string;
  recordings: Array<{ id: string; udid: string }>;
  annotations: Array<{
    recordingId: string;
    shape: string;
    geometry: string;
    color: string;
    text: string | null;
    timecodeMs: number;
  }>;
}

/**
 * Recording groups the caller can pick back up after a reload. A group is the
 * caller's when they hold the manual lock on any of its devices. Admins are not
 * special here, as in tile rehydration: a mosaic must never adopt another
 * user's recording. Only open marks come back, because a cleared mark is no
 * longer on screen.
 */
export function selectOwnActiveGroups(
  rows: ActiveRow[],
  lockOf: (udid: string) => string | null | undefined,
  actor: { userId?: string; apiKeyId?: string },
): ActiveGroup[] {
  const groups = new Map<string, ActiveRow[]>();
  for (const r of rows) {
    const list = groups.get(r.group_id) ?? [];
    list.push(r);
    groups.set(r.group_id, list);
  }
  const out: ActiveGroup[] = [];
  for (const [groupId, list] of groups) {
    const mine = list.some((r) =>
      isSelfManualLock(lockOf(r.device_udid), r.device_udid, actor.userId, actor.apiKeyId),
    );
    if (!mine) continue;
    const started = Math.min(...list.map((r) => new Date(r.started_at).getTime()));
    out.push({
      groupId,
      startedAt: new Date(started).toISOString(),
      recordings: list.map((r) => ({ id: r.id, udid: r.device_udid })),
      annotations: list.flatMap((r) =>
        (r.annotations ?? [])
          .filter((a) => a.end_timecode_ms === null || a.end_timecode_ms === undefined)
          .map((a) => ({
            recordingId: a.recording_id,
            shape: a.shape,
            geometry: a.geometry,
            color: a.color,
            text: a.text ?? null,
            timecodeMs: a.timecode_ms,
          })),
      ),
    });
  }
  return out;
}
