import { Container } from 'typedi';
import { prisma } from '../../prisma';
import { PluginContext } from '../../PluginContext';
import { isOwnDevice, localDeviceHosts } from '../../device-managers/localDeviceHosts';

/**
 * What the Sessions page shows besides the rows themselves: the outcome of a
 * session, the period filter, who ran a session and where, and the period
 * summary. The handlers live in dashboard.ts; this is what they compute.
 */

export type SessionOutcome = 'passed' | 'failed' | 'running' | 'other';

/**
 * The verdict of a persisted `Session.status`. The dashboard's
 * `sessionStatusBucket` (web/src/components/builds/derive.ts) is the same
 * rule, so a build's counts and its rows agree.
 */
export function sessionOutcome(status: string | null | undefined): SessionOutcome {
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
      return 'other';
  }
}

export class InvalidSinceError extends Error {
  constructor() {
    super('since must be an ISO 8601 date');
  }
}

/** The `since` query parameter: null when absent; a date, or InvalidSinceError. */
export function parseSince(raw: unknown): Date | null {
  if (raw === undefined || raw === '') return null;
  const at = typeof raw === 'string' ? Date.parse(raw) : NaN;
  if (!Number.isFinite(at)) throw new InvalidSinceError();
  return new Date(at);
}

export interface SessionOwner {
  name: string;
  email: string;
}

interface ListedSession {
  id: string;
  node_id: string;
  device_udid: string;
  user_id?: string | null;
  api_key_id?: string | null;
}

/**
 * Each listed session with who ran it (`owner`) and where (`ranOn`): 'here'
 * for this server, the node's host for another server's phone, null when
 * that isn't known any more. Four queries for the whole list, never one per
 * row. Members can't read the users list, so the dashboard can't name owners
 * itself.
 */
export async function describeSessions<T extends ListedSession>(
  rows: T[],
): Promise<Array<T & { owner: SessionOwner | null; ranOn: string | null }>> {
  const [owners, places] = await Promise.all([ownersOf(rows), placesOf(rows)]);
  return rows.map((row) => ({
    ...row,
    owner: owners.get(row.id) ?? null,
    ranOn: places.get(row.id) ?? null,
  }));
}

// SessionOwnerResolver.ownerOf's rule, for a list: the row's user, else, for
// a row written before user_id existed, its key's owner.
async function ownersOf(rows: ListedSession[]): Promise<Map<string, SessionOwner>> {
  const legacyKeyIds = [
    ...new Set(rows.filter((r) => !r.user_id && r.api_key_id).map((r) => r.api_key_id as string)),
  ];
  const keyOwner = new Map<string, string>();
  if (legacyKeyIds.length > 0) {
    const keys: Array<{ id: string; userId: string }> = await prisma.apiKey.findMany({
      where: { id: { in: legacyKeyIds } },
      select: { id: true, userId: true },
    });
    for (const key of keys) keyOwner.set(key.id, key.userId);
  }

  const ownerId = (r: ListedSession) =>
    r.user_id ?? (r.api_key_id ? keyOwner.get(r.api_key_id) : undefined);
  const userIds = [...new Set(rows.map(ownerId).filter((id): id is string => !!id))];
  const users: Array<{ id: string; name: string; email: string }> =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
  const byId = new Map(users.map((u) => [u.id, { name: u.name || u.email, email: u.email }]));

  const out = new Map<string, SessionOwner>();
  for (const row of rows) {
    const owner = byId.get(ownerId(row) ?? '');
    if (owner) out.set(row.id, owner);
  }
  return out;
}

// Node ids are new on every boot, so a session's node_id names its server
// only until that server restarts. Past that, its phone's row says where it
// is: the row of that node id, else the phone's only row. A udid on more than
// one server (an emulator's) with no row of that node id isn't guessed.
async function placesOf(rows: ListedSession[]): Promise<Map<string, string>> {
  const context = Container.get(PluginContext);
  const nodeIds = [...new Set(rows.map((r) => r.node_id).filter(Boolean))];
  const udids = [...new Set(rows.map((r) => r.device_udid).filter(Boolean))];
  if (udids.length === 0 && nodeIds.length === 0) return new Map();

  const devices: Array<{ udid: string; host: string; nodeId: string | null }> =
    await prisma.device.findMany({
      where: { OR: [{ nodeId: { in: nodeIds } }, { udid: { in: udids } }] },
      select: { udid: true, host: true, nodeId: true },
    });
  const local = localDeviceHosts(context.pluginArgs, context.port);

  const out = new Map<string, string>();
  for (const row of rows) {
    if (row.node_id && row.node_id === context.nodeId) {
      out.set(row.id, 'here');
      continue;
    }
    const sameUdid = devices.filter((d) => d.udid === row.device_udid);
    const device =
      sameUdid.find((d) => d.nodeId && d.nodeId === row.node_id) ??
      (sameUdid.length === 1 ? sameUdid[0] : undefined);
    if (!device) continue;
    out.set(row.id, isOwnDevice(local, context.nodeId, device) ? 'here' : hostLabel(device.host));
  }
  return out;
}

/** A host as people read it: no scheme, no trailing slash. */
function hostLabel(host: string): string {
  return host.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, '');
}

export interface PeriodCounts {
  total: number;
  passed: number;
  failed: number;
  running: number;
}

export interface SessionSummary {
  since: string | null;
  current: PeriodCounts & { medianMs: number | null; p90Ms: number | null };
  previous: PeriodCounts | null;
  runningNow: { sessions: number; devices: number };
}

/**
 * Durations come from at most this many of the period's newest ended
 * sessions, so a long period costs one bounded read; past it they are an
 * estimate from the newest.
 */
const DURATION_SAMPLE = 10_000;

/** Nearest-rank percentile of ascending values; null for none. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/**
 * The Sessions page's summary strip: the period from `since` to now, the
 * period of the same length before it, and what runs now, over the sessions
 * `scope` admits (the caller's visibility, and a build when one is chosen).
 * Without `since` the period is all time and there is none before it.
 */
export async function summarizeSessions(
  scope: Record<string, unknown>,
  since: Date | null,
  now = Date.now(),
): Promise<SessionSummary> {
  const within = (from: Date | null, to: Date | null) => {
    const createdAt: Record<string, Date> = {};
    if (from) createdAt.gte = from;
    if (to) createdAt.lt = to;
    return Object.keys(createdAt).length ? { AND: [scope, { createdAt }] } : scope;
  };
  const counts = async (where: Record<string, unknown>): Promise<PeriodCounts> => {
    // groupBy's generated type can't be satisfied with a `where` built at
    // run time; the result's shape is fixed by `by` and `_count`.
    const groups = (await (prisma.session.groupBy as any)({
      by: ['status'],
      where,
      _count: { _all: true },
    })) as Array<{ status: string; _count: { _all: number } }>;
    const out: PeriodCounts = { total: 0, passed: 0, failed: 0, running: 0 };
    for (const g of groups) {
      out.total += g._count._all;
      const outcome = sessionOutcome(g.status);
      if (outcome !== 'other') out[outcome] += g._count._all;
    }
    return out;
  };

  const current = within(since, null);
  const previousFrom = since ? new Date(since.getTime() - (now - since.getTime())) : null;
  const [currentCounts, previous, ended, running] = await Promise.all([
    counts(current),
    since ? counts(within(previousFrom, since)) : Promise.resolve(null),
    prisma.session.findMany({
      where: { AND: [current, { endTime: { not: null } }, { status: { not: 'running' } }] },
      select: { startTime: true, endTime: true },
      orderBy: { createdAt: 'desc' },
      take: DURATION_SAMPLE,
    }) as Promise<Array<{ startTime: Date; endTime: Date | null }>>,
    prisma.session.findMany({
      where: { AND: [scope, { status: 'running' }] },
      select: { device_udid: true },
    }) as Promise<Array<{ device_udid: string }>>,
  ]);

  const durations = ended
    .map((s) => (s.endTime ? s.endTime.getTime() - s.startTime.getTime() : -1))
    .filter((ms) => ms >= 0)
    .sort((a, b) => a - b);

  return {
    since: since ? since.toISOString() : null,
    current: {
      ...currentCounts,
      medianMs: percentile(durations, 50),
      p90Ms: percentile(durations, 90),
    },
    previous,
    runningNow: {
      sessions: running.length,
      devices: new Set(running.map((s) => s.device_udid)).size,
    },
  };
}
