// Typed fetch wrappers for the new free-form recording REST contract.
// Mirrors the shape established in `bug-report.ts`: filename detection from
// Content-Disposition for downloads, JSON for everything else.

const BASE = '/xenon/api/recordings';

export interface BusyEntry {
  udid: string;
  reason: string;
  sessionId?: string;
  blockId?: string;
}

export interface StartedRecording {
  id: string;
  udid: string;
  status: string;
}

export interface StartResponse {
  groupId: string;
  recordings: StartedRecording[];
  startedAt: string;
}

export interface ConflictBody {
  error: 'device_busy' | 'concurrency_cap';
  busyDevices?: BusyEntry[];
  limit?: number;
  active?: number;
  message?: string;
}

export class RecordingConflict extends Error {
  constructor(public readonly body: ConflictBody) {
    super(body.message ?? body.error);
  }
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 409) {
    throw new RecordingConflict((await r.json()) as ConflictBody);
  }
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}`);
  }
  return r.json();
}

export function startRecording(
  udids: string[],
  opts?: { sessionId?: string; note?: string },
): Promise<StartResponse> {
  return postJson(BASE, { udids, ...opts });
}

export function stopRecording(groupId: string) {
  return postJson(`${BASE}/${encodeURIComponent(groupId)}/stop`);
}

export function addBookmark(
  groupId: string,
  recordingId: string,
  timecodeMs: number,
  label: string,
  note?: string,
) {
  return postJson(`${BASE}/${encodeURIComponent(groupId)}/bookmark`, {
    recordingId,
    timecodeMs,
    label,
    note,
  });
}

export interface AnnotationInput {
  recordingId: string;
  timecodeMs: number;
  shape: 'RECT' | 'CIRCLE' | 'ARROW' | 'TEXT' | 'FREEHAND';
  geometry: string;
  color: string;
  text?: string;
}

export function addDevice(
  groupId: string,
  udid: string,
): Promise<{ recording: StartedRecording }> {
  return postJson(`${BASE}/${encodeURIComponent(groupId)}/add-device`, { udid });
}

export function addAnnotation(groupId: string, ann: AnnotationInput) {
  return postJson(`${BASE}/${encodeURIComponent(groupId)}/annotation`, ann);
}

export interface RecordingRow {
  id: string;
  group_id: string;
  device_udid: string;
  device_host: string;
  status: string;
  file_path: string;
  duration_ms: number | null;
  size_bytes: number | null;
  bookmarks: Array<{ id: string; label: string; timecode_ms: number; note?: string }>;
  annotations: Array<{
    id: string;
    timecode_ms: number;
    shape: string;
    geometry: string;
    color: string;
    text?: string;
  }>;
}

export async function getGroup(
  groupId: string,
): Promise<{ groupId: string; recordings: RecordingRow[] }> {
  const r = await fetch(`${BASE}/${encodeURIComponent(groupId)}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export function bundleZipUrl(groupId: string): string {
  return `${BASE}/${encodeURIComponent(groupId)}/bundle.zip`;
}

export function compositeMp4Url(groupId: string): string {
  return `${BASE}/${encodeURIComponent(groupId)}/composite.mp4`;
}

export function annotatedMp4Url(groupId: string, recordingId: string): string {
  return `${BASE}/${encodeURIComponent(groupId)}/exports/annotated.mp4?recordingId=${encodeURIComponent(recordingId)}`;
}
