import { prisma as defaultPrisma } from '../../prisma';

/**
 * A lease's phones are its LeaseMember rows: member 0, 1, ... in the order
 * the request named them. Every reader of a lease relies on them.
 *
 * A lease taken before group leases has no member rows: its one phone is in
 * its own `deviceUdid`, `deviceHost`, `allocatedPorts` and `capabilityBag`
 * columns. At boot, before anything reads a lease, each `active` lease with
 * no member gets member 0 written from those columns, held since the lease
 * was created. An ended lease holds no phone, so it gets none.
 *
 * Returns how many member rows it wrote, so a second run writes none. Two
 * servers sharing a database may run it at once: the unique (leaseId, index)
 * lets only one of them write a lease's member 0, and the other counts it as
 * already there.
 */
export async function backfillLeaseMembers(db: any = defaultPrisma): Promise<number> {
  const leases: Array<{
    id: string;
    deviceUdid: string;
    deviceHost: string;
    allocatedPorts: string;
    capabilityBag: string;
    createdAt: Date;
  }> = await db.lease.findMany({
    where: { status: 'active', members: { none: {} } },
    select: {
      id: true,
      deviceUdid: true,
      deviceHost: true,
      allocatedPorts: true,
      capabilityBag: true,
      createdAt: true,
    },
  });

  let written = 0;
  for (const lease of leases) {
    try {
      await db.leaseMember.create({
        data: {
          leaseId: lease.id,
          index: 0,
          udid: lease.deviceUdid,
          host: lease.deviceHost,
          allocatedPorts: lease.allocatedPorts,
          capabilityBag: lease.capabilityBag,
          heldAt: lease.createdAt.getTime(),
        },
      });
      written += 1;
    } catch (err: any) {
      // Another server wrote it between the read and this write.
      if (err?.code !== 'P2002') throw err;
    }
  }
  return written;
}
