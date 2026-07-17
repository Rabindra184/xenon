import type { ISession } from '../../interfaces/ISession';
import { formatDateTime } from '../../utils/time';

export type StatusKey = 'all' | 'passed' | 'failed' | 'running';

/** UI bucket for a session; 'other' = shown under "All" only (no pass/fail verdict). */
export type StatusBucket = 'passed' | 'failed' | 'running' | 'other';

/**
 * Canonical map from the raw persisted `Session.status` to a UI bucket.
 *
 * The backend `SessionStatus` enum persists `success` / `failed` / `running`
 * (plus `timeout` and `unmarked`), and error paths write `error`; older/aliased
 * rows may use `ended` / `passed`. Every consumer — the count pills, the filter,
 * and the row status pill — MUST route through here so they stay in agreement.
 * Bucketing `success` as `passed` was the fix for the "Passed 0 / no sessions
 * match" bug where successful sessions were invisible under the Passed filter.
 */
export function sessionStatusBucket(status: string | null | undefined): StatusBucket {
  switch (status) {
    case 'success':
    case 'passed':
    case 'ended':
      return 'passed';
    case 'failed':
    case 'error':
    case 'timeout':
      return 'failed';
    case 'running':
      return 'running';
    default:
      // e.g. 'unmarked' or any unknown status: no pass/fail verdict.
      return 'other';
  }
}

export function buildStatusCounts(sessions: ISession[]): Record<StatusKey, number> {
  const out: Record<StatusKey, number> = { all: sessions.length, passed: 0, failed: 0, running: 0 };
  for (const s of sessions) {
    const bucket = sessionStatusBucket(s.status);
    if (bucket !== 'other') out[bucket] += 1;
  }
  return out;
}

/** Does a session pass the given status-filter tab? 'all' matches everything. */
export function sessionMatchesStatus(s: ISession, key: StatusKey): boolean {
  if (key === 'all') return true;
  return sessionStatusBucket(s.status) === key;
}

/**
 * Apply the build-detail status filter + free-text search to a session list.
 * Shared by the SessionTable (what it renders) and the filter bar's
 * "X of Y sessions" counter so the two can never disagree.
 */
export function filterSessions(
  sessions: ISession[],
  statusFilter: StatusKey,
  searchQuery: string,
): ISession[] {
  const q = searchQuery.trim().toLowerCase();
  return sessions.filter((s) => {
    if (!sessionMatchesStatus(s, statusFilter)) return false;
    if (q) {
      const hay = (
        s.id + ' ' +
        (s.name ?? '') + ' ' +
        (s.device_name ?? '') + ' ' +
        (s.device_platform ?? '') + ' ' +
        (s.device_version ?? '') + ' ' +
        (s.node_id ?? '')
      ).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function deviceNameOrFallback(s: ISession): string {
  const n = s.device_name?.trim();
  return n && n.length > 0 ? n : 'Unknown Device';
}

export function platformLabel(s: ISession): string {
  const p = s.device_platform ?? '';
  if (!p) return '—';
  const lower = p.toLowerCase();
  if (lower === 'ios') return 'iOS';
  if (lower === 'tvos') return 'tvOS';
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function osVersionLabel(s: ISession): string {
  return s.device_version ? `v${s.device_version}` : '';
}

export function formatAbsoluteTime(iso: string | Date | null | undefined): string {
  return formatDateTime(iso);
}

export function sessionDurationMs(s: ISession): number | null {
  if (!s.startTime) return null;
  const start = Date.parse(s.startTime);
  if (!Number.isFinite(start)) return null;
  const end = s.endTime ? Date.parse(s.endTime) : Date.now();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

export function humanDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  const totalS = ms / 1000;
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS - h * 3600 - m * 60;
  const sPart = s.toFixed(1);
  if (h > 0) return `${h}h ${m}m ${sPart}s`;
  if (m > 0) return `${m}m ${sPart}s`;
  return `${sPart}s`;
}

export function shortId(id: string, head = 10, tail = 4): string {
  if (!id) return '';
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

export function humanizeFailureCategory(cat?: string | null): string {
  if (!cat) return '';
  return cat
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
