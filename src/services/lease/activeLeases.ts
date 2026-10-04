import { prisma as defaultPrisma } from '../../prisma';

/**
 * Which phones a live SDK lease holds, for the readers that must treat a
 * leased phone as held whatever its `busy` column says.
 *
 * A lease locks its phone with `busy` alone (deviceClaims.ts), and several
 * writes clear `busy` without knowing about leases: a lease-bound session's
 * own release, a node's report. Allocation never takes such a phone
 * (findAndLockDevice skips active leases), and these readers apply the same
 * rule: the idle sweeper, the ownership guard, and a session release that
 * should hand the phone back to its lease rather than to the pool.
 *
 * "Live" is LeaseService's rule: active and not past `expiresAt`. A lapsed
 * lease the sweeper hasn't reaped yet holds nothing.
 */
export interface ActiveLease {
  id: string;
  deviceUdid: string;
  deviceHost: string;
  /** The creating API key's id, or the creating user's id (sdk-leases.ts). */
  actorId: string;
}

export const leaseKey = (udid: string, host: string) => `${udid}@${host}`;

/** Every live lease, keyed by `leaseKey(udid, host)`. */
export async function activeLeasesByDevice(
  db: any = defaultPrisma,
  now: number = Date.now(),
): Promise<Map<string, ActiveLease>> {
  const rows: ActiveLease[] = await db.lease.findMany({
    where: { status: 'active', expiresAt: { gte: now } },
    select: { id: true, deviceUdid: true, deviceHost: true, actorId: true },
  });
  return new Map(rows.map((l) => [leaseKey(l.deviceUdid, l.deviceHost), l]));
}

/** The live lease on one phone, or null. */
export async function activeLeaseOn(
  udid: string,
  host: string,
  db: any = defaultPrisma,
  now: number = Date.now(),
): Promise<ActiveLease | null> {
  return (
    (await db.lease.findFirst({
      where: { deviceUdid: udid, deviceHost: host, status: 'active', expiresAt: { gte: now } },
      select: { id: true, deviceUdid: true, deviceHost: true, actorId: true },
    })) ?? null
  );
}
