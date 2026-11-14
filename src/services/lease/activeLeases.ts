import { prisma as defaultPrisma } from '../../prisma';
import { LIVE_LEASE_STATUSES, LiveLeaseStatus, liveLeaseWhere } from './leaseStatus';

/**
 * Which phones a live SDK lease holds, for the readers that must treat a
 * leased phone as held whatever its `busy` column says.
 *
 * A lease's phones are its LeaseMember rows (leaseMembers.ts). A member of a
 * `waiting` lease is a phone held for it until the lease is granted; of an
 * `active` one, a leased phone. Both are the lease's, and every reader here
 * says so: allocation never takes such a phone (findAndLockDevice, by
 * leasedDeviceKeys), and the idle sweeper, the ownership guard, recordings and
 * a session release that should hand the phone back to its lease rather than
 * to the pool apply the same rule. Through 2.19 they read the Lease row's own
 * device columns, which name one phone and no held ones.
 *
 * A lease locks its phone with `busy` alone (deviceClaims.ts), and several
 * writes clear `busy` without knowing about leases: a lease-bound session's
 * own release, a node's report. That is why these readers ask the lease
 * table.
 *
 * "Live" is LeaseService's rule (liveLeaseWhere, leaseStatus.ts): active and
 * not past `expiresAt`, or waiting and not past `waitUntil`, where a
 * `waitUntil` of null waits for ever, as the queue reads it. A lapsed lease
 * the sweeper hasn't reaped yet holds nothing. Through 2.36 a waiting lease
 * with no `waitUntil` held nothing here, while the queue served it and
 * allocation skipped its phones.
 */
export interface ActiveLease {
  id: string;
  deviceUdid: string;
  deviceHost: string;
  /** The creating API key's id, or the creating user's id (sdk-leases.ts). */
  actorId: string;
  /** `waiting`: the phone is held for the lease; `active`: it is leased. */
  status: LiveLeaseStatus;
}

export const leaseKey = (udid: string, host: string) => `${udid}@${host}`;

interface MemberRow {
  udid: string;
  host: string;
  lease: { id: string; actorId: string; status: LiveLeaseStatus };
}

const MEMBER_SELECT = {
  udid: true,
  host: true,
  lease: { select: { id: true, actorId: true, status: true } },
};

function toActiveLease(row: MemberRow): ActiveLease {
  return {
    id: row.lease.id,
    deviceUdid: row.udid,
    deviceHost: row.host,
    actorId: row.lease.actorId,
    status: row.lease.status,
  };
}

/** Every phone a live lease holds, keyed by `leaseKey(udid, host)`. */
export async function activeLeasesByDevice(
  db: any = defaultPrisma,
  now: number = Date.now(),
): Promise<Map<string, ActiveLease>> {
  const rows: MemberRow[] = await db.leaseMember.findMany({
    where: { lease: liveLeaseWhere(now) },
    select: MEMBER_SELECT,
  });
  return new Map(rows.map((row) => [leaseKey(row.udid, row.host), toActiveLease(row)]));
}

/** The live lease holding one phone, or null. */
export async function activeLeaseOn(
  udid: string,
  host: string,
  db: any = defaultPrisma,
  now: number = Date.now(),
): Promise<ActiveLease | null> {
  const row: MemberRow | null = await db.leaseMember.findFirst({
    where: { udid, host, lease: liveLeaseWhere(now) },
    select: MEMBER_SELECT,
  });
  return row ? toActiveLease(row) : null;
}

/**
 * `leaseKey` of every phone an `active` or `waiting` lease holds, for
 * allocation (the stores' findAndLockDevice). No time check, as the stores
 * have always read leases: a lapsed lease keeps its phones from allocation
 * until the sweeper ends it (LeaseOrphanSweeper, every 30 s).
 */
export async function leasedDeviceKeys(db: any = defaultPrisma): Promise<Set<string>> {
  const rows: Array<{ udid: string; host: string }> = await db.leaseMember.findMany({
    where: { lease: { status: { in: [...LIVE_LEASE_STATUSES] } } },
    select: { udid: true, host: true },
  });
  return new Set(rows.map((row) => leaseKey(row.udid, row.host)));
}
