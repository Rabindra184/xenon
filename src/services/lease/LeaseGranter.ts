import type { IDevice } from '../../interfaces/IDevice';
import type { AllocateOptions } from '../ports/PortAllocatorClient';
import log from '../../logger';
import { leaseKey } from './activeLeases';
import { lockExactPhone } from './lockExactPhone';
import { AllocatedPorts, buildCapabilityBag, leasePortPurposes } from './buildCapabilityBag';
import type { NodePairAuthProvider } from './LeaseService';
import {
  PhoneServerPortClient,
  PhoneServerPorts,
  PortsLease,
  portRowsWhere,
} from './phoneServerPorts';

/** How long grant passes leave a phone whose port reservation failed (or its whole server). */
export const SKIP_FAILED_PHONE_MS = 60_000;

/** The codes of a request that never reached, or never heard from, the server. */
const TRANSPORT_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ERR_NETWORK',
  'ETIMEDOUT',
]);

/**
 * Whether a reservation failed because the phone's server couldn't be
 * reached or didn't answer: a timeout, a connection refused or reset, a name
 * that doesn't resolve, or a 5xx. Its other phones would fail the same way.
 * A 4xx is the server answering about that phone, and anything else (no
 * credentials for it, a malformed answer) is that phone's too.
 */
export function isTransportFailure(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; response?: { status?: unknown } };
  const status = e?.response?.status;
  if (typeof status === 'number') return status >= 500;
  if (typeof e?.code === 'string' && TRANSPORT_CODES.has(e.code)) return true;
  return typeof e?.message === 'string' && /timeout/i.test(e.message);
}

/** The host part of a `leaseKey` (`udid@host`): the phone's server. */
function hostOf(key: string): string {
  return key.slice(key.indexOf('@') + 1);
}

/**
 * What a `trying` request's row is created from once it is granted: the
 * Lease columns the request decided (LeaseService.create's).
 */
export interface GroupLeaseCreateData {
  tokenHash: string;
  actorId: string;
  teamId: string | null;
  buildId?: string | null;
  reason?: string | null;
  heartbeatSeconds: number;
  /** JSON, each member's filters in order. */
  requestedMembers?: string | null;
  /** JSON, the caller's teams; null is unscoped. */
  callerTeamIds?: string | null;
  durationMs?: number | null;
}

/**
 * The lease a grant is for.
 * - `waiting`: a row in the queue. It may already hold some of the phones
 *   (`heldKeys`, `leaseKey`s), locked and written as its member rows.
 * - `trying`: a `waitMs: 0` request with no row yet. Its row is written only
 *   if it is granted, from `createData`, with the `id` given here.
 */
export interface GroupLeaseRow {
  id: string;
  status: 'waiting' | 'trying';
  durationMs: number;
  buildId?: string | null;
  heldKeys: Set<string>;
  /** Required when `status` is `trying`. */
  createData?: GroupLeaseCreateData;
}

export type GrantOutcome = 'granted' | 'failed' | 'gone';

/** What a grant asks of the phones' servers; PortAllocatorClient has it all. */
export interface GrantPortClient extends PhoneServerPortClient {
  allocate(opts: AllocateOptions): Promise<AllocatedPorts>;
}

/** One member of a grant, and what this grant took for it. */
interface Member {
  device: IDevice;
  key: string;
  /** Already held for the lease, so locked before this grant. */
  held: boolean;
  /** Locked by this grant. */
  locked: boolean;
  /** Reserved by this grant on the phone's server. */
  ports?: AllocatedPorts;
}

interface MemberRow {
  index: number;
  udid: string;
  host: string;
  allocatedPorts: string;
  capabilityBag: string;
}

/**
 * Turns "these phones, one per member" into an active lease, all members or
 * none. It locks each phone the lease doesn't hold yet, reserves every
 * member's driver ports on its phone's own server, and then, in one write,
 * activates the lease with its member rows (a waiting row only while it is
 * still waiting; a `trying` request's row is created active). Last, it marks
 * this server's reserved port rows with the lease.
 *
 * What fails rolls back only what this grant took: the ports it reserved
 * (deleted here, and freed on the phone's server: PhoneServerPorts.free) and
 * the locks it took (`releaseLeaseLock`). The phones the lease holds stay
 * held, so it keeps its place: unless the lease is no longer waiting
 * (`gone`: released, or expired by the sweeper while ports were being
 * reserved), when its holds are released too, since nobody else will.
 *
 * A phone whose reservation failed is skipped by grant passes for
 * SKIP_FAILED_PHONE_MS (`isSkipped`), so a broken server can't make them
 * loop. When the server couldn't be reached at all (isTransportFailure),
 * every phone on it is skipped: each would cost the pass another timeout
 * while it holds the allocation lock. `reservationFailures` counts the
 * grants whose reservation failed, so a lock hold tries at most one
 * (LeaseQueue). The caller holds the allocation lock.
 */
export class LeaseGranter {
  private readonly logger = log.scope('LeaseGranter');
  private readonly phoneServerPorts: PhoneServerPorts;
  /** leaseKey → until when (epoch ms) the phone is skipped. */
  private readonly skipped = new Map<string, number>();
  /** leaseKey → why its last port reservation failed, while it is skipped. */
  private readonly skipReasons = new Map<string, string>();
  /** A phone's server (its `host`) → until when every phone on it is skipped. */
  private readonly skippedHosts = new Map<string, number>();
  /** A phone's server → why it couldn't be reached, while it is skipped. */
  private readonly hostReasons = new Map<string, string>();
  /** How many grants have failed on a port reservation, by this granter's life. */
  reservationFailures = 0;

  constructor(
    private readonly db: any,
    private readonly store: any,
    private readonly portClient: GrantPortClient,
    private readonly authProvider: NodePairAuthProvider,
  ) {
    this.phoneServerPorts = new PhoneServerPorts(portClient, authProvider);
  }

  /** Whether grant passes should leave this phone (`leaseKey`) for now: it, or its server, is skipped. */
  isSkipped(key: string, now: number = Date.now()): boolean {
    return this.phoneSkipped(key, now) || this.hostSkipped(hostOf(key), now);
  }

  /** Why the phone (`leaseKey`) is skipped: its failed reservation's message, while it is. */
  skipReason(key: string, now: number = Date.now()): string | undefined {
    if (this.phoneSkipped(key, now)) return this.skipReasons.get(key);
    const host = hostOf(key);
    return this.hostSkipped(host, now) ? this.hostReasons.get(host) : undefined;
  }

  private phoneSkipped(key: string, now: number): boolean {
    const until = this.skipped.get(key);
    return until !== undefined && now < until;
  }

  private hostSkipped(host: string, now: number): boolean {
    const until = this.skippedHosts.get(host);
    return until !== undefined && now < until;
  }

  /** For tests: resolves once every call to a phone's server has answered. */
  async settled(): Promise<void> {
    await this.phoneServerPorts.settled();
  }

  /**
   * `phones[i]` fills member `i`. Throws only for a call that gives no phone,
   * or a `trying` request without its row; whatever fails after that is
   * rolled back and answered.
   */
  async grant(lease: GroupLeaseRow, phones: IDevice[]): Promise<GrantOutcome> {
    if (phones.length === 0) throw new Error(`lease ${lease.id}: a grant needs a phone per member`);
    if (lease.status === 'trying' && !lease.createData) {
      throw new Error(`lease ${lease.id}: a trying request needs its createData`);
    }
    const members: Member[] = phones.map((device) => {
      const key = leaseKey(device.udid, device.host);
      return { device, key, held: lease.heldKeys.has(key), locked: false };
    });

    try {
      for (const member of members) {
        if (member.held) continue;
        const locked = await this.lockPhone(member.device);
        if (!locked) {
          // Taken since the pass read it: not the phone's fault.
          await this.rollBack(lease, members, { holdsToo: false });
          return 'failed';
        }
        member.device = locked;
        member.locked = true;
      }
    } catch (err) {
      this.logger.warn(`lease ${lease.id}: couldn't lock its phones: ${(err as Error).message}`);
      await this.rollBack(lease, members, { holdsToo: false });
      return 'failed';
    }

    const reserved = await Promise.allSettled(
      members.map((member) => this.reservePorts(lease, member)),
    );
    let reservationFailed = false;
    reserved.forEach((result, index) => {
      const member = members[index];
      if (result.status === 'fulfilled') {
        member.ports = result.value;
        return;
      }
      reservationFailed = true;
      const why = String((result.reason as Error)?.message ?? result.reason);
      const wholeServer = isTransportFailure(result.reason);
      this.skip(member.key, why, wholeServer);
      this.logger.warn(
        `lease ${lease.id}: couldn't reserve ports for member ${index} (${member.device.udid} on ` +
          `${member.device.host}), skipping ${wholeServer ? 'every phone on that server' : 'that phone'} ` +
          `for ${SKIP_FAILED_PHONE_MS / 1000} s: ${why}`,
      );
    });
    if (reservationFailed) {
      this.reservationFailures += 1;
      await this.rollBack(lease, members, { holdsToo: false });
      return 'failed';
    }

    const now = Date.now();
    const rows = members.map((member, index) => this.memberRow(lease, member, index));
    let activated: boolean;
    try {
      activated = await this.activate(lease, rows, now + lease.durationMs, now);
    } catch (err) {
      this.logger.warn(`lease ${lease.id}: couldn't be activated: ${(err as Error).message}`);
      await this.rollBack(lease, members, { holdsToo: false });
      return 'failed';
    }
    if (!activated) {
      this.logger.info(
        `lease ${lease.id} stopped waiting before its grant; giving back its phones`,
      );
      await this.rollBack(lease, members, { holdsToo: true });
      return 'gone';
    }
    await this.markPortRows(lease, members);

    // A phone the lease held that the grant didn't use is the pool's again.
    const used = new Set(members.map((member) => member.key));
    for (const key of lease.heldKeys) {
      if (!used.has(key)) await this.releaseLock(lease, key);
    }
    return 'granted';
  }

  /** The phone, locked by its exact udid and host (lockExactPhone), or null. */
  private lockPhone(device: IDevice): Promise<IDevice | null> {
    return lockExactPhone(this.store, device.udid, device.host);
  }

  private async reservePorts(lease: GroupLeaseRow, member: Member): Promise<AllocatedPorts> {
    const { udid, host, platform } = member.device;
    const nodePairAuth = await this.authProvider.nodePairAuth(host, udid);
    return this.portClient.allocate({
      nodeHost: host,
      udid,
      purposes: leasePortPurposes(platform),
      durationMs: lease.durationMs,
      leaseId: lease.id,
      nodePairAuth,
      // Once, with a short timeout: the pass holds the allocation lock. A
      // phone whose server doesn't answer is then skipped (SKIP_FAILED_PHONE_MS).
      once: true,
    });
  }

  private memberRow(lease: GroupLeaseRow, member: Member, index: number): MemberRow {
    const ports = member.ports ?? {};
    const bag = buildCapabilityBag(
      member.device,
      ports,
      lease.id,
      lease.buildId ?? undefined,
      index,
    );
    return {
      index,
      udid: member.device.udid,
      host: member.device.host,
      allocatedPorts: JSON.stringify(ports),
      capabilityBag: JSON.stringify(bag),
    };
  }

  /**
   * Activates the lease with all its members in one write: a nested write is
   * Prisma's own transaction, so a reader sees the lease waiting with its
   * holds, or active with every member, never in between. A waiting lease is
   * activated only while it is still waiting (false otherwise): its holder may
   * have given up, or the sweeper expired it, while ports were reserved.
   */
  private async activate(
    lease: GroupLeaseRow,
    rows: MemberRow[],
    expiresAt: number,
    now: number,
  ): Promise<boolean> {
    const first = rows[0];
    const memberZero = {
      deviceUdid: first.udid,
      deviceHost: first.host,
      allocatedPorts: first.allocatedPorts,
      capabilityBag: first.capabilityBag,
    };
    if (lease.status === 'trying') {
      await this.db.lease.create({
        data: {
          ...lease.createData,
          id: lease.id,
          status: 'active',
          expiresAt,
          lastHeartbeatAt: now,
          ...memberZero,
          members: { create: rows.map((row) => ({ ...row, heldAt: now })) },
        },
      });
      return true;
    }
    try {
      await this.db.lease.update({
        where: { id: lease.id, status: 'waiting' },
        data: {
          status: 'active',
          expiresAt,
          // The grant is the lease's start: its client's quiet while it
          // waited is not a missed heartbeat of the new lease. Through 2.36
          // a waiter granted near its third missed heartbeat was reaped by
          // the next sweep.
          lastHeartbeatAt: now,
          ...memberZero,
          members: {
            // A held phone's row keeps its heldAt; the pass may have matched it
            // to another member, so each index gets its phone.
            upsert: rows.map(({ index, ...fields }) => ({
              where: { leaseId_index: { leaseId: lease.id, index } },
              update: fields,
              create: { index, ...fields, heldAt: now },
            })),
            // No member outside 0..n-1, a move's temporary negative index
            // included (LeaseQueue.hold). Through 2.36 only those past the
            // end went, and a leftover became member -3 of the active lease.
            deleteMany: { OR: [{ index: { lt: 0 } }, { index: { gte: rows.length } }] },
          },
        },
      });
    } catch (err) {
      // No row is waiting under that id.
      if ((err as { code?: string })?.code === 'P2025') return false;
      throw err;
    }
    return true;
  }

  /**
   * Marks this server's port rows of each member with the lease. The phone's
   * server was given the lease id when it reserved them, so this is the
   * backfill `create` does, and a failure leaves the lease as granted.
   */
  private async markPortRows(lease: GroupLeaseRow, members: Member[]): Promise<void> {
    for (const member of members) {
      try {
        await this.db.portLease.updateMany({
          where: this.portRowsWhere(lease, member),
          data: { leaseId: lease.id },
        });
      } catch (err) {
        this.logger.warn(
          `lease ${lease.id}: couldn't mark the port rows of ${member.key}: ${(err as Error).message}`,
        );
      }
    }
  }

  /** This server's port rows of a member's reservation (none for another server's phone). */
  private portRowsWhere(lease: GroupLeaseRow, member: Member) {
    return portRowsWhere(this.portsLease(lease, member));
  }

  private portsLease(lease: GroupLeaseRow, member: Member): PortsLease {
    return {
      id: lease.id,
      deviceUdid: member.device.udid,
      deviceHost: member.device.host,
      allocatedPorts: JSON.stringify(member.ports ?? {}),
    };
  }

  /**
   * Gives back what this grant took: each reserved member's ports and each
   * lock it took. With `holdsToo`, the lease's holds as well.
   */
  private async rollBack(
    lease: GroupLeaseRow,
    members: Member[],
    { holdsToo }: { holdsToo: boolean },
  ): Promise<void> {
    for (const member of members) {
      if (member.ports) {
        let deletedHere = 0;
        try {
          const deleted = await this.db.portLease.deleteMany({
            where: this.portRowsWhere(lease, member),
          });
          deletedHere = deleted?.count ?? 0;
        } catch (err) {
          this.logger.warn(
            `lease ${lease.id}: couldn't delete the port rows of ${member.key}: ${(err as Error).message}`,
          );
        }
        this.phoneServerPorts.free(this.portsLease(lease, member), deletedHere);
      }
      if (member.locked || (holdsToo && member.held)) await this.releaseLock(lease, member.key);
    }
    if (!holdsToo) return;
    const inGrant = new Set(members.map((member) => member.key));
    for (const key of lease.heldKeys) {
      if (!inGrant.has(key)) await this.releaseLock(lease, key);
    }
  }

  /** The lease's lock only: a session or hold on the phone keeps it busy. */
  private async releaseLock(lease: GroupLeaseRow, key: string): Promise<void> {
    const at = key.indexOf('@');
    const udid = key.slice(0, at);
    const host = key.slice(at + 1);
    try {
      await this.store.releaseLeaseLock(udid, host);
    } catch (err) {
      this.logger.warn(`lease ${lease.id}: couldn't release ${key}: ${(err as Error).message}`);
    }
  }

  private skip(key: string, reason: string, wholeServer: boolean): void {
    const now = Date.now();
    for (const [skipped, reasons] of [
      [this.skipped, this.skipReasons],
      [this.skippedHosts, this.hostReasons],
    ] as const) {
      for (const [k, until] of skipped) {
        if (until > now) continue;
        skipped.delete(k);
        reasons.delete(k);
      }
    }
    this.skipped.set(key, now + SKIP_FAILED_PHONE_MS);
    this.skipReasons.set(key, reason);
    if (!wholeServer) return;
    this.skippedHosts.set(hostOf(key), now + SKIP_FAILED_PHONE_MS);
    this.hostReasons.set(hostOf(key), reason);
  }
}
