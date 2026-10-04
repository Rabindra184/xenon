import type { LeaseHold } from './deviceAccessPolicy';

/**
 * The lease hold on a device row for an ownership decision, or null. Throws
 * when either lookup does: the caller fails closed.
 */
export async function leaseHoldFor(
  device: { udid?: string; host?: string | null } | null | undefined,
  findActiveLease: (udid: string, host: string) => Promise<{ actorId: string } | null>,
  resolveLeaseHolder: (actorId: string) => Promise<string | null>,
): Promise<LeaseHold | null> {
  if (!device?.udid || !device.host) return null;
  const lease = await findActiveLease(device.udid, device.host);
  if (!lease) return null;
  return { actorId: lease.actorId, holderUserId: await resolveLeaseHolder(lease.actorId) };
}
