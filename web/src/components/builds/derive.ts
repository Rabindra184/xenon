import type { ISession } from '../../interfaces/ISession';
import type { IBuild } from '../../interfaces/IBuild';
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
      // Everything the row shows, so a search finds what the user can see.
      const hay = [
        s.id,
        sessionDisplayName(s).text,
        s.name,
        s.failure_reason,
        s.device_name,
        s.device_platform,
        s.device_version,
        s.node_id,
        s.ranOn,
        s.owner?.name,
        s.owner?.email,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** The capability, with or without its `appium:` prefix. */
function capOf(caps: Record<string, unknown>, key: string): string | null {
  const v = caps[`appium:${key}`] ?? caps[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Flat capabilities from a stored blob: flat, W3C, or W3C under `capabilities`. */
function flatCapabilities(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  let caps = parsed as Record<string, any>;
  if (caps.capabilities && typeof caps.capabilities === 'object') caps = caps.capabilities;
  if (caps.alwaysMatch || caps.firstMatch) {
    const first = Array.isArray(caps.firstMatch) ? caps.firstMatch[0] : undefined;
    return { ...(caps.alwaysMatch || {}), ...(first || {}) };
  }
  return caps;
}

/**
 * The app a session ran, as people know it: its package or bundle id, else
 * its file's name, else the browser. A library app's download URL ends in
 * `/download` and names nothing, so it doesn't count.
 */
export function appFromCapabilities(json: string | null | undefined): string | null {
  const caps = flatCapabilities(json);
  if (!caps) return null;
  const id = capOf(caps, 'appPackage') ?? capOf(caps, 'bundleId');
  if (id) return id;
  const app = capOf(caps, 'app');
  if (app) {
    const file = app.split(/[?#]/)[0].split(/[\\/]/).pop() ?? '';
    if (file && file !== 'download') return file;
  }
  return capOf(caps, 'browserName');
}

/**
 * What to call a session: the test's own name (`xe:options.name`), else the
 * app it ran (what the driver resolved before what was asked for), else a
 * short id.
 */
export function sessionDisplayName(
  s: Pick<ISession, 'id' | 'name' | 'desired_capabilities' | 'session_capabilities'>,
): { text: string; source: 'name' | 'app' | 'id' } {
  const name = s.name?.trim();
  if (name) return { text: name, source: 'name' };
  const app =
    appFromCapabilities(s.session_capabilities) ?? appFromCapabilities(s.desired_capabilities);
  if (app) return { text: app, source: 'app' };
  return { text: `Session ${s.id.slice(0, 8)}`, source: 'id' };
}

/** "Sep 29, 07:30", in local time. */
function monthDayTime(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "Sep 29, 07:30" for a timestamp, or a dash. */
export function formatMonthDayTime(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? monthDayTime(d) : '—';
}

/** Whether a build is named by its start time (buildDisplayName). */
export function isUnnamedBuild(b: Pick<IBuild, 'name'>): boolean {
  const name = b.name?.trim();
  return !name || name === 'Default Build';
}

/**
 * What to call a build. Sessions sent with no `xe:options.build` land in a
 * "Default Build" per run (a run ends after 30 idle minutes), so those are
 * named by when they started.
 */
export function buildDisplayName(b: Pick<IBuild, 'name' | 'createdAt'>): string {
  if (!isUnnamedBuild(b)) return (b.name as string).trim();
  const at = new Date(b.createdAt);
  return Number.isNaN(at.getTime()) ? 'Build' : `Build · ${monthDayTime(at)}`;
}

export type TimeFilter = 'all' | '24h' | '7d' | '30d';

export const TIME_FILTER_LABEL: Record<TimeFilter, string> = {
  all: 'All time',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

/** Each period's length. */
export const PERIOD_MS: Record<Exclude<TimeFilter, 'all'>, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

/** The start of the chosen period as an ISO string, or null for all time. */
export function sinceFor(filter: TimeFilter, now: number): string | null {
  return filter === 'all' ? null : new Date(now - PERIOD_MS[filter]).toISOString();
}

/** A duration as the table shows it: "26s", "2m 10s", "1h 2m". */
export function compactDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return '<1s';
  const totalS = Math.floor(ms / 1000);
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** A start time as the table shows it: the time today, else the date too. */
export function formatStartTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (d.getFullYear() !== now.getFullYear()) {
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${time}`;
  }
  if (d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return time;
  return monthDayTime(d);
}

/** Percent of the sessions with a verdict that passed; null with none. */
export function passRate(c: { passed: number; failed: number }): number | null {
  const rated = c.passed + c.failed;
  return rated > 0 ? (c.passed / rated) * 100 : null;
}

/** The pass rate's change in points from the period before; null if either has none. */
export function passRateDelta(
  current: { passed: number; failed: number },
  previous: { passed: number; failed: number } | null,
): number | null {
  const now = passRate(current);
  const before = previous ? passRate(previous) : null;
  return now === null || before === null ? null : now - before;
}

/** Where a session ran, for its row: this server, a node's host, or nothing. */
export function ranOnLabel(ranOn: string | null | undefined): string | null {
  if (!ranOn) return null;
  return ranOn === 'here' ? 'This server' : ranOn;
}
