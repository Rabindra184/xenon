import type { LeaseHold } from './deviceAccessPolicy';

/** A live lease on a phone, as activeLeaseOn finds it (activeLeases.ts). */
export interface FoundLease {
  actorId: string;
  status?: 'waiting' | 'active';
}

/**
 * The lease hold on a device row for an ownership decision, or null. Throws
 * when either lookup does: the caller fails closed.
 */
export async function leaseHoldFor(
  device: { udid?: string; host?: string | null } | null | undefined,
  findActiveLease: (udid: string, host: string) => Promise<FoundLease | null>,
  resolveLeaseHolder: (actorId: string) => Promise<string | null>,
): Promise<LeaseHold | null> {
  if (!device?.udid || !device.host) return null;
  const lease = await findActiveLease(device.udid, device.host);
  if (!lease) return null;
  return {
    actorId: lease.actorId,
    holderUserId: await resolveLeaseHolder(lease.actorId),
    // A phone held for a waiting lease is refused in its own words.
    ...(lease.status ? { status: lease.status } : {}),
  };
}
