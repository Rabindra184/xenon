// Typed fetch wrappers for the new free-form recording REST contract.
// Mirrors the shape established in `bug-report.ts`: filename detection from
// Content-Disposition for downloads, JSON for everything else.

import type { PhoneRef } from '../lib/phone';

const BASE = '/xenon/api/recordings';

export interface BusyEntry {
  udid: string;
  /** The busy phone's server. */
  host?: string;
  reason: string;
  sessionId?: string;
  blockId?: string;
}

export interface StartedRecording {
  id: string;
  udid: string;
  /** The recorded phone's server; with the udid, which phone it is. */
  host: string;
  status: string;
  sessionId?: string;
}

export interface StartResponse {
  groupId: string;
  recordings: StartedRecording[];
  startedAt: string;
  /** True when the server started a multi-device composite ffmpeg. */
  compositeEnabled?: boolean;
}

/**
 * A start the server refused, told apart by `error`: `device_busy` (409, with
 * `busyDevices`), `concurrency_cap` (409, with `active` and `limit`),
 * `ambiguous_phone` (409, two servers have the udid and no host was sent),
 * `duplicate_phone` (400, a phone named twice, no message), or another code
 * with its own `message`.
 */
export interface ConflictBody {
  error: string;
  busyDevices?: BusyEntry[];
  limit?: number;
  active?: number;
  hosts?: string[];
  message?: string;
}

export class RecordingConflict extends Error {
  constructor(public readonly body: ConflictBody) {
    super(body.message ?? body.error);
  }

  /** The server's `error` code. */
  get error(): string {
    return this.body.error;
  }
}

/** The 4xx answers that say why a request was refused, as a RecordingConflict. */
async function refusedWith(r: Response): Promise<ConflictBody | undefined> {
  if (r.status === 409) return (await r.json()) as ConflictBody;
  if (r.status !== 400) return undefined;
  const body = await r.json().catch(() => null);
  // Only the start's own refusal: other 400s keep their HTTP status message.
  return body?.error === 'duplicate_phone' ? (body as ConflictBody) : undefined;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const refused = await refusedWith(r);
  if (refused) throw new RecordingConflict(refused);
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}`);
  }
  return r.json();
}

/** Records `phones`, each named by udid and host: two servers can share a udid. */
export function startRecording(
  phones: PhoneRef[],
  opts?: { sessionId?: string; note?: string },
): Promise<StartResponse> {
  return postJson(BASE, { udids: phones.map(({ udid, host }) => ({ udid, host })), ...opts });
}

export function stopRecording(groupId: string): Promise<{
  groupId: string;
  recordings: Array<{
    id: string;
    udid: string;
    host?: string;
    status: string;
    durationMs?: number;
    sizeBytes?: number;
  }>;
}> {
  return postJson(`${BASE}/${encodeURIComponent(groupId)}/stop`);
}

export interface AnnotationInput {
  recordingId: string;
  timecodeMs: number;
  shape: 'RECT' | 'CIRCLE' | 'ARROW' | 'TEXT' | 'FREEHAND';
  geometry: string;
  color: string;
  text?: string;
  /** PNG data URL of the mark as the preview drew it; burned into the video as-is. */
  image?: string;
}

export function addAnnotation(groupId: string, ann: AnnotationInput) {
  return postJson(`${BASE}/${encodeURIComponent(groupId)}/annotation`, ann);
}

/** Ends every mark still on screen at `timecodeMs`, in the video as in the preview. */
export function clearAnnotations(
  groupId: string,
  timecodeMs: number,
): Promise<{ cleared: number }> {
  return postJson(`${BASE}/${encodeURIComponent(groupId)}/annotations/clear`, { timecodeMs });
}

export interface ActiveRecordingGroup {
  groupId: string;
  startedAt: string;
  compositeEnabled: boolean;
  recordings: Array<{ id: string; udid: string; host: string }>;
  annotations: Array<{
    recordingId: string;
    shape: string;
    geometry: string;
    color: string;
    text: string | null;
    timecodeMs: number;
  }>;
}

export interface ActiveRecordingsResponse {
  serverNow: number;
  groups: ActiveRecordingGroup[];
}

/** The caller's running recordings, so a reloaded page can pick one back up. */
export async function getActiveRecordings(): Promise<ActiveRecordingsResponse> {
  const r = await fetch(`${BASE}/active`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
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

/** Videos-only zip (mp4 files — no manifest / JSON extras). */
export function videosZipUrl(groupId: string): string {
  return `${BASE}/${encodeURIComponent(groupId)}/videos.zip`;
}

/** Single-file mp4 when the group has exactly one playable video. */
export function videoMp4Url(groupId: string, udid?: string): string {
  const q = udid ? `?udid=${encodeURIComponent(udid)}` : '';
  return `${BASE}/${encodeURIComponent(groupId)}/video.mp4${q}`;
}

export function compositeMp4Url(groupId: string): string {
  return `${BASE}/${encodeURIComponent(groupId)}/composite.mp4`;
}

export function annotatedMp4Url(groupId: string, recordingId: string): string {
  return `${BASE}/${encodeURIComponent(groupId)}/exports/annotated.mp4?recordingId=${encodeURIComponent(recordingId)}`;
}

// ---------------------------------------------------------------------------
// Recordings library: browsing, filtering and deleting past recording groups.
// ---------------------------------------------------------------------------

export type GroupStatus = 'recording' | 'done' | 'failed';

export interface PhoneSummary {
  recordingId: string;
  udid: string;
  name: string;
  platform: string | null;
  status: string;
  offsetMs: number;
  durationMs: number | null;
  failReason: string | null;
  annotationCount: number;
  /** The session this phone's recording observed, where its Session row exists. */
  sessionId?: string | null;
  /** That session's build, for the session page's address. */
  sessionBuildId?: string | null;
}

export interface RecordingSummary {
  groupId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  status: GroupStatus;
  phones: PhoneSummary[];
  startedBy: { id: string; name: string } | null;
  bookmarkCount: number;
  annotationCount: number;
  keptUntil: string;
  sizeBytes: number;
  hasComposite: boolean;
}

export interface LibraryFacets {
  phones: Array<{ udid: string; name: string; count: number }>;
  people: Array<{ id: string; name: string; count: number }>;
  unknownCount: number;
  when: { any: number; '24h': number; '7d': number; '30d': number };
}

export interface LibraryResponse {
  recordings: RecordingSummary[];
  nextCursor: string | null;
  total: number;
  facets: LibraryFacets;
  retention: { days: number; maxCount: number };
}

export interface LibraryQuery {
  udid?: string;
  /** Groups that recorded this session. */
  sessionId?: string;
  startedBy?: string;
  since?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface GroupBookmark {
  id: string;
  recordingId: string;
  timecodeMs: number;
  label: string;
  note: string | null;
}

export interface GroupAnnotation {
  id: string;
  recordingId: string;
  timecodeMs: number;
  endTimecodeMs: number | null;
  shape: string;
  geometry: string;
  color: string;
  text: string | null;
}

export interface RecordingDetail {
  groupId: string;
  summary: RecordingSummary;
  bookmarks: GroupBookmark[];
  annotations: GroupAnnotation[];
}

/** A request the server refused; `code` is its `error` field when it sent one. */
export class RecordingRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(code ?? `HTTP ${status}`);
  }
}

async function refusal(r: Response): Promise<RecordingRequestError> {
  let code: string | undefined;
  try {
    code = (await r.json())?.error;
  } catch {
    // Not JSON.
  }
  return new RecordingRequestError(r.status, code);
}

export async function listRecordings(q: LibraryQuery = {}): Promise<LibraryResponse> {
  const params = new URLSearchParams();
  (Object.keys(q) as Array<keyof LibraryQuery>).forEach((k) => {
    const v = q[k];
    if (v !== undefined && v !== '') params.set(k, String(v));
  });
  const qs = params.toString();
  const r = await fetch(qs ? `${BASE}?${qs}` : BASE);
  if (!r.ok) throw await refusal(r);
  return r.json();
}

export async function getRecording(groupId: string): Promise<RecordingDetail> {
  const r = await fetch(`${BASE}/${encodeURIComponent(groupId)}`);
  if (!r.ok) throw await refusal(r);
  return r.json();
}

export async function deleteRecording(groupId: string): Promise<void> {
  const r = await fetch(`${BASE}/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
  if (!r.ok) throw await refusal(r);
}

/** The clean video (no burned-in marks), seekable; `download` makes it an attachment. */
export function sourceMp4Url(groupId: string, recordingId: string, download = false): string {
  return `${BASE}/${encodeURIComponent(groupId)}/source.mp4?recordingId=${encodeURIComponent(recordingId)}${download ? '&download=1' : ''}`;
}
