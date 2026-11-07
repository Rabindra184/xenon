import { Container, Service } from 'typedi';
import { prisma as defaultPrisma } from '../../prisma';
import { DeviceStoreFactory } from '../../data-service/device-store';
import type { IDevice } from '../../interfaces/IDevice';
import log from '../../logger';
import { PortAllocatorClient } from '../ports/PortAllocatorClient';
import { defaultNodePairAuthProvider, NodePairAuthProvider } from './LeaseService';
import { LeaseQueue } from './LeaseQueue';
import { phoneFreed } from './leaseQueueKick';
import { leaseMembersOf, LeaseMemberRow, releaseLeaseMembers } from './leaseRelease';
import { PhoneServerPorts, PhoneServerPortClient } from './phoneServerPorts';

interface SweptLease {
  heartbeatSeconds: number | null;
  lastHeartbeatAt: number;
  expiresAt: number;
}

/** True when the client missed three heartbeats. */
function missedHeartbeats(lease: Omit<SweptLease, 'expiresAt'>, now: number): boolean {
  const thresholdMs = (lease.heartbeatSeconds ?? 30) * 1000 * 3;
  return lease.lastHeartbeatAt + thresholdMs < now;
}

/**
 * Why an active lease is over, or null while it isn't: its client missed
 * three heartbeats, or it passed expiresAt. The second is the rule
 * LeaseService already applies (heartbeat and extend refuse such a lease,
 * authorizeSessionUse won't resolve it); without it here, a client that kept
 * heartbeating held the phone for up to 3 x heartbeatSeconds past the end.
 */
export function leaseReapReason(lease: SweptLease, now: number): string | null {
  // The end time first: past it, heartbeats are refused, so a lease that
  // expired has missed its heartbeats too by the next sweep.
  if (lease.expiresAt < now) return `expired at ${new Date(lease.expiresAt).toISOString()}`;
  if (missedHeartbeats(lease, now)) return 'missed heartbeats';
  return null;
}

/**
 * Why a waiting lease gives up, or null while it waits: its wait ran out
 * (`waitUntil`), or its client missed three heartbeats. A waiting row has no
 * end time of its own (`expiresAt` is set by the grant).
 */
export function waiterGiveUpReason(
  lease: { waitUntil: number | null; heartbeatSeconds: number | null; lastHeartbeatAt: number },
  now: number,
): string | null {
  if (lease.waitUntil != null && lease.waitUntil < now) {
    return `its wait ran out at ${new Date(lease.waitUntil).toISOString()}`;
  }
  if (missedHeartbeats(lease, now)) return 'missed heartbeats';
  return null;
}

/**
 * Why a lease member's phone is lost, or null while it isn't: its Device
 * row is gone (unplugged, its node gone), it is unhealthy, or an admin
 * blocked it. Pure: whether a missing row has been missing long enough is
 * the sweeper's (a hub clears its own rows at boot and finds them again).
 */
export function memberLossReason(
  member: { index: number; udid: string; host: string },
  device: IDevice | null,
): string | null {
  const who = `member ${member.index} (${member.udid})`;
  if (!device) return `${who} disconnected`;
  if (device.healthStatus === 'Unhealthy') return `${who} is unhealthy`;
  if (device.userBlocked) return `${who} was blocked by an admin`;
  return null;
}

/** What the sweeper asks of the lease queue (LeaseQueue), which owns waiting leases and their holds. */
export interface SweptQueue {
  giveUp(leaseId: string, options?: { kick?: boolean }): Promise<'expired' | 'not-waiting'>;
  dropHold(leaseId: string, memberId: string): Promise<boolean>;
}

/** A member as the sweep reads it: a member row, with its id, or member 0 of a lease from before groups. */
type SweptMember = LeaseMemberRow & { id?: string };

/** What one sweep gathers as it goes. */
interface SweepState {
  /** `leaseId:udid@host` of each member and hold whose row this sweep found missing. */
  missing: Set<string>;
  /** Whether it let a phone go, so the queue is kicked once at the end. */
  freed: boolean;
}

/**
 * Every 30 s (ServerManager): ends the leases nobody uses any more.
 *
 * - A **waiting** lease whose wait ran out, or whose client missed three
 *   heartbeats, gives up through the queue (LeaseQueue.giveUp): `expired`,
 *   its holds let go. A held phone that is lost is dropped
 *   (LeaseQueue.dropHold), and the lease keeps waiting.
 * - An **active** lease past expiresAt or with three missed heartbeats is
 *   `expired`; one with a member whose phone is lost (memberLossReason) is
 *   `ended`, with `endReason` naming that member. Either way every member is
 *   released (releaseLeaseMembers), by the sweep whose conditional update
 *   ended it, and only that one.
 *
 * A phone whose row is missing counts as lost only when it was missing on
 * this process's previous sweep too: a hub clears its own rows at boot and
 * finds the phones again, so the first sweep after a start never ends
 * anything for a missing row. An unhealthy or blocked phone is lost at once.
 *
 * A sweep that let a phone go calls phoneFreed() once, so the queue runs a
 * grant pass.
 */
@Service()
export class LeaseOrphanSweeper {
  private logger = log.scope('LeaseOrphanSweeper');

  private readonly db: any;
  private readonly store: any;
  private readonly portClient: PhoneServerPortClient;
  private readonly authProvider: NodePairAuthProvider;
  private readonly phoneServerPorts: PhoneServerPorts;
  private leaseQueue?: SweptQueue;
  /** Built with no dependencies of its own (TypeDI's): the server's queue is its queue. */
  private readonly serverQueue: boolean;
  /** What the previous sweep found missing (SweepState.missing). */
  private missing = new Set<string>();

  /**
   * Built by TypeDI with none of these, it uses the server's own database,
   * store and lease queue (`Container.get(LeaseQueue)`). Given any of them
   * (tests), it uses a queue of its own over the same ones, unless `queue`
   * is given too.
   */
  constructor(
    db?: any,
    store?: any,
    portClient?: PhoneServerPortClient,
    authProvider?: NodePairAuthProvider,
    queue?: SweptQueue,
  ) {
    this.serverQueue = [db, store, portClient, authProvider].every((dep) => dep === undefined);
    this.db = db ?? defaultPrisma;
    this.store = store ?? DeviceStoreFactory.getStore();
    this.portClient = portClient ?? new PortAllocatorClient();
    this.authProvider = authProvider ?? defaultNodePairAuthProvider();
    this.phoneServerPorts = new PhoneServerPorts(this.portClient, this.authProvider);
    this.leaseQueue = queue;
  }

  /** Read lazily: only a sweep with a waiting lease needs it. */
  private get queue(): SweptQueue {
    this.leaseQueue ??= this.serverQueue
      ? Container.get(LeaseQueue)
      : new LeaseQueue(this.db, this.store, this.portClient, this.authProvider);
    return this.leaseQueue;
  }

  /** For tests: resolves once every call to a phone's server has answered. */
  async phoneServerCallsSettled(): Promise<void> {
    await this.phoneServerPorts.settled();
  }

  async sweep(): Promise<void> {
    const now = Date.now();
    const candidates = await this.db.lease.findMany({
      where: { status: { in: ['waiting', 'active'] } },
      select: {
        id: true,
        status: true,
        deviceUdid: true,
        deviceHost: true,
        heartbeatSeconds: true,
        lastHeartbeatAt: true,
        expiresAt: true,
        waitUntil: true,
        allocatedPorts: true,
        members: true,
      },
    });

    const state: SweepState = { missing: new Set(), freed: false };
    for (const lease of candidates) {
      const waiting = lease.status === 'waiting';
      try {
        if (waiting) await this.sweepWaiter(lease, now, state);
        else await this.sweepActive(lease, now, state);
      } catch (err) {
        const what = waiting ? `sweep waiting lease ${lease.id}` : `reap lease ${lease.id}`;
        this.logger.warn(`failed to ${what}: ${(err as Error).message}`);
      }
    }
    // Only what this sweep found missing carries over: a row that came back,
    // or a lease that ended, starts again from nothing.
    this.missing = state.missing;
    if (state.freed) phoneFreed();
  }

  /** Why the member's phone is lost (memberLossReason); a missing row only on its second sweep in a row. */
  private async lostReason(
    leaseId: string,
    member: SweptMember,
    state: SweepState,
  ): Promise<string | null> {
    const device: IDevice | null =
      (await this.store.findDevice({ udid: member.udid, host: member.host })) ?? null;
    const reason = memberLossReason(member, device);
    if (device) return reason;
    const key = `${leaseId}:${member.udid}@${member.host}`;
    state.missing.add(key);
    return this.missing.has(key) ? reason : null;
  }

  private async sweepWaiter(lease: any, now: number, state: SweepState): Promise<void> {
    const holds: SweptMember[] = lease.members ?? [];
    const reason = waiterGiveUpReason(lease, now);
    if (reason) {
      // The queue owns waiting leases: it lets the holds go under the lock.
      if ((await this.queue.giveUp(lease.id, { kick: false })) === 'expired') {
        if (holds.length > 0) state.freed = true;
        this.logger.info(
          `expired waiting lease ${lease.id} (${reason}); let go of ${holds.length} held phone(s)`,
        );
      }
      return;
    }
    for (const hold of [...holds].sort((a, b) => a.index - b.index)) {
      if (!hold.id) continue;
      const lost = await this.lostReason(lease.id, hold, state);
      if (!lost) continue;
      if (await this.queue.dropHold(lease.id, hold.id)) {
        state.freed = true;
        this.logger.info(
          `waiting lease ${lease.id} let go of ${hold.udid}@${hold.host} (${lost}); it keeps waiting`,
        );
      }
    }
  }

  private async sweepActive(lease: any, now: number, state: SweepState): Promise<void> {
    const members: SweptMember[] = [...leaseMembersOf(lease)].sort((a, b) => a.index - b.index);
    let data: { status: 'expired' } | { status: 'ended'; endReason: string };
    let reason = leaseReapReason(lease, now);
    if (reason) {
      data = { status: 'expired' };
    } else {
      // Every member is looked at, so each missing row is counted this sweep.
      let lost: string | null = null;
      for (const member of members) {
        const loss = await this.lostReason(lease.id, member, state);
        lost ??= loss;
      }
      if (!lost) return;
      reason = lost;
      data = { status: 'ended', endReason: lost };
    }

    // Conditional: a release, a heartbeat or another sweep may have ended it
    // since it was read. Only the update that ended it releases.
    try {
      await this.db.lease.update({ where: { id: lease.id, status: 'active' }, data });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2025') return;
      throw err;
    }

    let freed = 0;
    try {
      ({ freed } = await releaseLeaseMembers(
        {
          db: this.db,
          store: this.store,
          phoneServerPorts: this.phoneServerPorts,
          logger: this.logger,
        },
        lease,
        members,
      ));
    } catch (err) {
      // Some may have been let go before the failure.
      state.freed = true;
      throw err;
    }
    if (freed > 0) state.freed = true;

    // Only the lease's lock: a session that outlived its lease keeps the
    // phone, and its own release frees it.
    const verb = data.status === 'ended' ? 'ended' : 'reaped';
    if (members.length === 1) {
      const device = `${members[0].udid}@${members[0].host}`;
      this.logger.info(
        `${verb} lease ${lease.id} (${reason}); device ${device} ${
          freed ? 'unblocked' : 'still held (a session or a hold), left busy'
        }`,
      );
    } else {
      const devices = members.map((m) => `${m.udid}@${m.host}`).join(', ');
      this.logger.info(
        `${verb} lease ${lease.id} (${reason}); devices ${devices}: ${freed} of ${members.length} unblocked`,
      );
    }
  }
}
