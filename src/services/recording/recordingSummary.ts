import type { RecordingTiming } from './recordingTiming';

/**
 * The recordings library's view of a recording: a group (the rows sharing a
 * group_id, one per phone), summarized, filtered and paged. Pure — the router
 * gathers the rows, names and retention settings; everything else is decided
 * here, where it can be tested without a DB.
 */

export type GroupStatus = 'recording' | 'done' | 'failed';

export interface PhoneSummary {
  recordingId: string;
  udid: string;
  name: string;
  platform: string | null;
  /** The row's own status: RECORDING, STOPPED, FAILED or DISCARDED. */
  status: string;
  /** Where this phone's video starts on the group's timeline; negative if before t=0. */
  offsetMs: number;
  durationMs: number | null;
  failReason: string | null;
  annotationCount: number;
}

export interface RecordingSummary {
  groupId: string;
  /** The group's t=0: the moment marks and bookmarks count from. */
  startedAt: string;
  endedAt: string | null;
  /**
   * The timeline's length: from the earliest frame (the negative offset of a
   * phone with a video, or t=0) to the latest end.
   */
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

export interface SummaryRow {
  id: string;
  group_id: string;
  device_udid: string;
  status: string;
  started_at: Date;
  ended_at: Date | null;
  duration_ms: number | null;
  size_bytes: number | null;
  fail_reason: string | null;
  started_by: string | null;
  /** The recording's timing.json, when it has one. */
  timing?: RecordingTiming;
  bookmarkLabels: string[];
  annotationCount: number;
}

export interface Retention {
  days: number;
  failedDays: number;
  maxCount: number;
}

export interface SummaryContext {
  devices: Map<string, { name: string; platform: string | null }>;
  users: Map<string, string>;
  retention: Retention;
  hasComposite: (groupId: string) => boolean;
}

export interface LibraryFilter {
  udid?: string;
  /** A user id, or 'unknown' for recordings nobody is recorded as starting. */
  startedBy?: string;
  /** Epoch ms; groups that started at or after it. */
  since?: number;
  q?: string;
}

export interface LibraryFacets {
  phones: Array<{ udid: string; name: string; count: number }>;
  people: Array<{ id: string; name: string; count: number }>;
  unknownCount: number;
  when: { any: number; '24h': number; '7d': number; '30d': number };
}

export interface LibraryPage {
  recordings: RecordingSummary[];
  nextCursor: string | null;
  /** Groups matching the filter, across all pages. */
  total: number;
  facets: LibraryFacets;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * A video starts at most a few seconds before t=0 (each phone's ffmpeg spawn,
 * then the composite's settle). A timing file claiming more is corrupt.
 */
const MAX_PREROLL_MS = 5 * 60 * 1000;
const FAILED_STATUSES = ['FAILED', 'DISCARDED'];

function timingOffset(t: RecordingTiming | undefined): number | undefined {
  if (!t) return undefined;
  const off = Math.round(t.spawnedAtMs - t.groupT0Ms);
  return off < -MAX_PREROLL_MS ? undefined : off;
}

export function groupStatus(rows: Array<Pick<SummaryRow, 'status'>>): GroupStatus {
  if (rows.some((r) => r.status === 'RECORDING')) return 'recording';
  if (rows.every((r) => FAILED_STATUSES.includes(r.status))) return 'failed';
  return 'done';
}

export function summarizeGroup(rows: SummaryRow[], ctx: SummaryContext): RecordingSummary {
  const byStart = rows.slice().sort((a, b) => a.started_at.getTime() - b.started_at.getTime());
  const first = byStart[0];
  const timed = byStart.find((r) => timingOffset(r.timing) !== undefined);
  const t0 = timed?.timing ? timed.timing.groupT0Ms : first.started_at.getTime();
  const status = groupStatus(rows);

  const phones: PhoneSummary[] = byStart
    .map((r) => {
      const device = ctx.devices.get(r.device_udid);
      return {
        recordingId: r.id,
        udid: r.device_udid,
        name: device?.name || r.device_udid,
        platform: device?.platform ?? null,
        status: r.status,
        offsetMs: timingOffset(r.timing) ?? r.started_at.getTime() - t0,
        durationMs: r.duration_ms,
        failReason: r.fail_reason,
        annotationCount: r.annotationCount,
      };
    })
    .sort((a, b) => a.offsetMs - b.offsetMs || a.name.localeCompare(b.name));

  // A phone already recording when the group reached t=0 starts before it.
  // Only phones with a video count: a failed one that spawned first would
  // open the timeline on nothing.
  const played = phones.filter((p) => p.durationMs !== null);
  const originMs = Math.min(0, ...played.map((p) => p.offsetMs));
  const ends = played.map((p) => p.offsetMs + (p.durationMs as number));
  const endedAts = rows
    .map((r) => r.ended_at)
    .filter((d): d is Date => d !== null)
    .map((d) => d.getTime());
  const owner = byStart.find((r) => r.started_by)?.started_by ?? null;
  const days = status === 'failed' ? ctx.retention.failedDays : ctx.retention.days;

  return {
    groupId: first.group_id,
    startedAt: new Date(t0).toISOString(),
    endedAt:
      status === 'recording' || endedAts.length === 0
        ? null
        : new Date(Math.max(...endedAts)).toISOString(),
    durationMs: status === 'recording' || ends.length === 0 ? null : Math.max(...ends) - originMs,
    status,
    phones,
    startedBy: owner ? { id: owner, name: ctx.users.get(owner) ?? 'Unknown user' } : null,
    bookmarkCount: rows.reduce((n, r) => n + r.bookmarkLabels.length, 0),
    annotationCount: rows.reduce((n, r) => n + r.annotationCount, 0),
    // CleanupService ages each row from its own started_at.
    keptUntil: new Date(first.started_at.getTime() + days * DAY_MS).toISOString(),
    sizeBytes: rows.reduce((n, r) => n + (r.size_bytes ?? 0), 0),
    hasComposite: ctx.hasComposite(first.group_id),
  };
}

/** Opaque to clients: "<startedAt ms>_<groupId>", so same-millisecond groups keep their order. */
export function cursorOf(s: RecordingSummary): string {
  return `${Date.parse(s.startedAt)}_${s.groupId}`;
}

function newestFirst(a: RecordingSummary, b: RecordingSummary): number {
  const d = Date.parse(b.startedAt) - Date.parse(a.startedAt);
  if (d !== 0) return d;
  return a.groupId < b.groupId ? 1 : a.groupId > b.groupId ? -1 : 0;
}

/** Strictly after the cursor in newest-first order. */
function afterCursor(s: RecordingSummary, cursor: string): boolean {
  const i = cursor.indexOf('_');
  const ms = Number(cursor.slice(0, i));
  if (i < 0 || !Number.isFinite(ms)) return true;
  const gid = cursor.slice(i + 1);
  const t = Date.parse(s.startedAt);
  return t < ms || (t === ms && s.groupId < gid);
}

function matches(s: RecordingSummary, labels: string[], f: LibraryFilter): boolean {
  if (f.udid && !s.phones.some((p) => p.udid === f.udid)) return false;
  if (f.startedBy === 'unknown') {
    if (s.startedBy !== null) return false;
  } else if (f.startedBy && s.startedBy?.id !== f.startedBy) {
    return false;
  }
  if (f.since !== undefined && Date.parse(s.startedAt) < f.since) return false;
  const q = f.q?.trim().toLowerCase();
  if (q) {
    const haystack = s.phones
      .map((p) => `${p.name}\n${p.udid}`)
      .concat(labels)
      .join('\n')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

function facetsOf(all: RecordingSummary[], now: number): LibraryFacets {
  const phones = new Map<string, { udid: string; name: string; count: number }>();
  const people = new Map<string, { id: string; name: string; count: number }>();
  let unknownCount = 0;
  const when = { any: all.length, '24h': 0, '7d': 0, '30d': 0 };
  for (const s of all) {
    s.phones.forEach((p) => {
      const f = phones.get(p.udid);
      if (f) f.count++;
      else phones.set(p.udid, { udid: p.udid, name: p.name, count: 1 });
    });
    if (s.startedBy) {
      const f = people.get(s.startedBy.id);
      if (f) f.count++;
      else people.set(s.startedBy.id, { ...s.startedBy, count: 1 });
    } else {
      unknownCount++;
    }
    const age = now - Date.parse(s.startedAt);
    if (age <= DAY_MS) when['24h']++;
    if (age <= 7 * DAY_MS) when['7d']++;
    if (age <= 30 * DAY_MS) when['30d']++;
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    phones: Array.from(phones.values()).sort(byName),
    people: Array.from(people.values()).sort(byName),
    unknownCount,
    when,
  };
}

export function buildLibrary(
  rows: SummaryRow[],
  ctx: SummaryContext,
  filter: LibraryFilter,
  page: { limit: number; cursor?: string; now: number },
): LibraryPage {
  const groups = new Map<string, SummaryRow[]>();
  rows.forEach((r) => {
    const list = groups.get(r.group_id);
    if (list) list.push(r);
    else groups.set(r.group_id, [r]);
  });
  const all = Array.from(groups.values()).map((g) => ({
    summary: summarizeGroup(g, ctx),
    labels: g.reduce<string[]>((acc, r) => acc.concat(r.bookmarkLabels), []),
  }));
  const matching = all
    .filter((x) => matches(x.summary, x.labels, filter))
    .map((x) => x.summary)
    .sort(newestFirst);
  const rest = page.cursor
    ? matching.filter((s) => afterCursor(s, page.cursor as string))
    : matching;
  const recordings = rest.slice(0, page.limit);
  return {
    recordings,
    nextCursor: rest.length > page.limit ? cursorOf(recordings[recordings.length - 1]) : null,
    total: matching.length,
    facets: facetsOf(
      all.map((x) => x.summary),
      page.now,
    ),
  };
}
