import { prisma } from '../../prisma';
import { isDeviceVisible } from './deviceVisibility';
import type { SessionCaller } from './sessionVisibility';

/**
 * The Xenon-private key a pending-session row names its requester under.
 * createSession writes it on that row only, last, so a client can't supply its
 * own; it is never in the capabilities handed to the driver, a peer node or
 * the Session row. The queue routes strip it from every row they return.
 */
export const REQUESTER_KEY = 'xenon:requester';

/** Who asked for a waiting session, as createSession resolved them. No lookup. */
export interface PendingRequester {
  /** The user behind the credential; null for a session that presented none. */
  userId: string | null;
  /**
   * The one team the credential is narrowed to (a team-bound key, a session
   * token's teamId claim, or `xe:options.team`). Null means the user's own teams,
   * read when the queue is, as computeTeamIds reads them for REST.
   */
  teamId: string | null;
}

/** The requester a row carries, or undefined for a row queued before they were recorded. */
export function requesterOf(row: Record<string, unknown>): PendingRequester | undefined {
  const r = row[REQUESTER_KEY] as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return undefined;
  const okId = (v: unknown) => v === null || typeof v === 'string';
  if (!okId(r.userId) || !okId(r.teamId)) return undefined;
  return { userId: r.userId as string | null, teamId: r.teamId as string | null };
}

/** A copy of the row without its requester; the stored row is left alone. */
export function withoutRequester<T extends Record<string, unknown>>(row: T): T {
  const copy: Record<string, unknown> = { ...row };
  delete copy[REQUESTER_KEY];
  return copy as T;
}

function targetUdid(row: Record<string, unknown>): string | undefined {
  const udid = row['appium:udid'];
  return typeof udid === 'string' && udid ? udid : undefined;
}

/**
 * Which waiting requests the caller sees in detail: "own teams + a count".
 *
 * - An admin (teamIds undefined) sees them all, with no lookup.
 * - A member sees a request that (a) names (`appium:udid`) a phone she can
 *   see by isDeviceVisible, or (b) she made, or whose requester's teams
 *   overlap hers: the credential's narrowed team if it has one, else the
 *   requester's memberships.
 * - A request with no recorded requester (queued before they were) is only
 *   counted for a member, even when it names her phone.
 *
 * Everything not shown is `otherCount`. The order of the queue is kept. One
 * phone lookup and one membership lookup at most, for the whole queue.
 */
export async function partitionPendingForCaller<T extends Record<string, unknown>>(
  rows: T[],
  caller: SessionCaller | undefined,
): Promise<{ visible: T[]; otherCount: number }> {
  if (!caller || caller.teamIds === undefined) return { visible: rows, otherCount: 0 };
  const teamIds = caller.teamIds;
  const userId = caller.userId;

  const candidates = rows
    .map((row) => ({ row, requester: requesterOf(row) }))
    .filter((c): c is { row: T; requester: PendingRequester } => c.requester !== undefined);

  // (a) the phones the queue names, one lookup.
  const udids = Array.from(new Set(candidates.map((c) => targetUdid(c.row)).filter(Boolean)));
  const visibleUdids = new Set<string>();
  if (udids.length > 0) {
    const devices: Array<{ udid: string; teamId: string | null }> = await prisma.device.findMany({
      where: { udid: { in: udids as string[] } },
      select: { udid: true, teamId: true },
    });
    for (const d of devices) if (isDeviceVisible(d.teamId, teamIds)) visibleUdids.add(d.udid);
  }

  const shown = new Set<T>();
  const undecided: Array<{ row: T; requester: PendingRequester }> = [];
  for (const c of candidates) {
    const udid = targetUdid(c.row);
    const own = !!userId && c.requester.userId === userId;
    if ((udid && visibleUdids.has(udid)) || own) shown.add(c.row);
    else undecided.push(c);
  }

  // (b) the requesters' teams, one lookup. A member in no team overlaps nobody.
  if (teamIds.length > 0 && undecided.length > 0) {
    const toLookUp = Array.from(
      new Set(
        undecided
          .filter((c) => !c.requester.teamId && c.requester.userId)
          .map((c) => c.requester.userId as string),
      ),
    );
    const teamsOf = new Map<string, string[]>();
    if (toLookUp.length > 0) {
      const rowsFound: Array<{ userId: string; teamId: string }> = await prisma.teamMember.findMany(
        {
          where: { userId: { in: toLookUp } },
          select: { userId: true, teamId: true },
        },
      );
      for (const m of rowsFound)
        teamsOf.set(m.userId, [...(teamsOf.get(m.userId) ?? []), m.teamId]);
    }
    for (const c of undecided) {
      const scope = c.requester.teamId
        ? [c.requester.teamId]
        : c.requester.userId
          ? (teamsOf.get(c.requester.userId) ?? [])
          : [];
      if (scope.some((t) => teamIds.includes(t))) shown.add(c.row);
    }
  }

  const visible = rows.filter((row) => shown.has(row));
  return { visible, otherCount: rows.length - visible.length };
}
