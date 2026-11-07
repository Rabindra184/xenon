import type { PortsLease } from './phoneServerPorts';
import { portRowsWhere } from './phoneServerPorts';

/** A lease member as its release reads it: a member row, or member 0 of a lease from before groups. */
export interface ReleasedMember {
  udid: string;
  host: string;
  /** JSON, as stored. */
  allocatedPorts: string;
}

/** A member row as the lease routes read it. */
export interface LeaseMemberRow extends ReleasedMember {
  index: number;
  /** JSON, as stored: no token. */
  capabilityBag: string;
}

/**
 * The lease's members: its member rows, or, for a lease written before
 * groups that has none yet, member 0 from its own device columns.
 */
export function leaseMembersOf(lease: any): LeaseMemberRow[] {
  const rows: LeaseMemberRow[] = lease?.members ?? [];
  if (rows.length > 0) return rows;
  if (!lease?.deviceUdid) return [];
  return [
    {
      index: 0,
      udid: lease.deviceUdid,
      host: lease.deviceHost,
      allocatedPorts: lease.allocatedPorts ?? '',
      capabilityBag: lease.capabilityBag ?? '',
    },
  ];
}

/** What releasing a lease's members needs. */
export interface LeaseReleaseDeps {
  db: any;
  store: { releaseLeaseLock(udid: string, host: string): Promise<boolean> };
  phoneServerPorts: { free(lease: PortsLease, deletedHere: number): void };
  logger: { warn(message: string): void };
}

/** One member's ports, as PhoneServerPorts takes them. */
export function memberPorts(lease: { id: string }, member: ReleasedMember): PortsLease {
  return {
    id: lease.id,
    deviceUdid: member.udid,
    deviceHost: member.host,
    allocatedPorts: member.allocatedPorts,
  };
}

/**
 * Gives back what an ended lease's members had: for each member, this
 * server's rows for its ports (by udid and host, so a twin udid on another
 * server keeps its own), then its ports on its phone's server unless every
 * one was deleted here (`PhoneServerPorts.free`); then any other row this
 * server holds for the lease; then each phone's lease lock
 * (`releaseLeaseLock`, which never frees a phone a session or hold still has).
 *
 * Every step is tried for every member: a failure is logged, the rest goes
 * on, and the first failure is thrown at the end. `freed` is how many locks
 * were actually released, so a caller knows whether a phone came free.
 *
 * The lease's status and the grant pass that may follow are the caller's.
 */
export async function releaseLeaseMembers(
  deps: LeaseReleaseDeps,
  lease: { id: string },
  members: ReleasedMember[],
): Promise<{ freed: number }> {
  const { db, store, phoneServerPorts, logger } = deps;
  let failure: unknown;
  const failed = (what: string, err: unknown) => {
    logger.warn(`lease ${lease.id}: couldn't ${what}: ${(err as Error)?.message ?? err}`);
    failure ??= err;
  };

  for (const member of members) {
    const ports = memberPorts(lease, member);
    const where = portRowsWhere(ports);
    let deletedHere = 0;
    if (where.port.in.length > 0) {
      try {
        const deleted = await db.portLease.deleteMany({ where: { leaseId: lease.id, ...where } });
        deletedHere = deleted?.count ?? 0;
      } catch (err) {
        failed(`delete the port rows of ${member.udid} on ${member.host}`, err);
      }
    }
    // A node's phone's ports are in the node's database, so the node is asked too.
    phoneServerPorts.free(ports, deletedHere);
  }

  try {
    await db.portLease.deleteMany({ where: { leaseId: lease.id } });
  } catch (err) {
    failed('delete its other port rows', err);
  }

  let freed = 0;
  for (const member of members) {
    try {
      if (await store.releaseLeaseLock(member.udid, member.host)) freed += 1;
    } catch (err) {
      failed(`release ${member.udid} on ${member.host}`, err);
    }
  }

  if (failure !== undefined) throw failure;
  return { freed };
}
