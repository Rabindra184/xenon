import { Container, Service } from 'typedi';
import { prisma as defaultPrisma } from '../../prisma';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { PortAllocatorClient } from '../../services/ports/PortAllocatorClient';
import type { IDevice } from '../../interfaces/IDevice';
import { generateToken, hashToken, verifyToken } from './leaseToken';
import log from '../../logger';
import { PhoneServerPorts } from './phoneServerPorts';
import { LeaseFilters, clientFilters, nameMatches, teamScope } from './leaseFilters';
import { leaseKey } from './activeLeases';
import { filledCount, maxMatching } from './memberMatch';
import { LeaseQueue } from './LeaseQueue';
import type { MemberRequest, TryNowRequest, TryNowOutcome } from './LeaseQueue';
import {
  GrantedBody,
  MemberWithDevice,
  WaitingBody,
  grantedBody,
  waitingBody,
} from './leaseResponse';

export interface CreateLeaseRequest {
  /** One phone: a lease of one member. Send this or `members`, never both. */
  filters?: LeaseFilters;
  /** 1 to MAX_MEMBERS members, each phone matched to one. */
  members?: MemberRequest[];
  /**
   * How long the request may wait in the queue, 0 to MAX_WAIT_MS. 0 (the
   * default) tries once, as a lease always did.
   */
  waitMs?: number;
  durationMs: number;
  heartbeatSeconds: number;
  actorId: string;
  teamId: string | null;
  /**
   * The caller's teams (`req.auth.teamIds`), which bound the device match.
   * undefined = unscoped (admin, auth disabled). Taken from the credential,
   * never from `filters`, which is client input.
   */
  callerTeamIds?: string[];
  buildId?: string;
  reason?: string;
}

/**
 * What an Appium session presents when it names a lease in
 * `xe:options.leaseId`. Any one of these proves it may use the lease.
 */
export interface LeaseSessionProof {
  /** May use a lease someone else created: see canOverrideLease (device-access/leaseOverride.ts). */
  canOverride: boolean;
  /** ApiKey row id of a verified xe:options.{accessKey,token} pair. */
  apiKeyId: string | null;
  /** User id from a verified xe:options pair or xe:options.sessionToken. */
  userId: string | null;
  /** The cleartext xe:options.leaseToken, if the session sent one. */
  leaseToken: string | null;
}

/** What `create` answers: granted (`201`) or waiting in the queue (`202`). */
export type CreateLeaseOutcome =
  | { status: 'granted'; body: GrantedBody }
  | { status: 'waiting'; body: WaitingBody };

/** What LeaseService asks of the lease queue (LeaseQueue). */
export interface LeaseGrants {
  tryNow(request: TryNowRequest): Promise<TryNowOutcome>;
  pass(): Promise<void>;
  positionOf(leaseId: string): Promise<number | null>;
  giveUp(leaseId: string): Promise<'expired' | 'not-waiting'>;
  /** Why a phone's port reservation failed, while grants skip it (LeaseGranter.skipReason). */
  readonly granter?: { skipReason(key: string): string | undefined };
}

/** How many members a lease may have. */
export const MAX_MEMBERS = 8;
/** How long a lease request may wait in the queue (`waitMs`): 60 minutes. */
export const MAX_WAIT_MS = 3_600_000;

/** The request's members: `members`, or `filters` as a lease of one. */
function membersOf(req: CreateLeaseRequest): MemberRequest[] {
  if (req.filters !== undefined && req.members !== undefined) {
    throw new RangeError('a lease request sends filters or members, not both');
  }
  const members = req.members ?? (req.filters !== undefined ? [{ filters: req.filters }] : []);
  if (members.length < 1 || members.length > MAX_MEMBERS) {
    throw new RangeError(`a lease has 1 to ${MAX_MEMBERS} members`);
  }
  return members;
}

export interface ResolvedLease {
  deviceUdid: string;
  deviceHost: string;
  capabilityBag: any;
}

export interface NodePairAuthProvider {
  nodePairAuth: (nodeHost: string) => Promise<{ accessKey: string; token: string }>;
}

/**
 * Resolve the hub→node credentials the lease port-allocator RPC needs. These are
 * the same per-node pair-auth credentials the rest of the hub uses for hub→node
 * calls (`NodeDevices`/`AndroidDeviceManager`), provisioned via
 * `XENON_HUB_ACCESS_KEY`/`XENON_HUB_TOKEN` (an ADMIN/devices token). With auth
 * disabled the node accepts any credentials, so empty strings are fine and
 * leasing works locally without provisioned keys.
 */
export function resolveNodePairAuth(cfg: {
  hubAccessKey?: string;
  hubToken?: string;
  authDisabled: boolean;
}): { accessKey: string; token: string } {
  if (cfg.hubAccessKey && cfg.hubToken) {
    return { accessKey: cfg.hubAccessKey, token: cfg.hubToken };
  }
  if (cfg.authDisabled) {
    return { accessKey: '', token: '' };
  }
  throw new Error(
    'lease port allocation needs the hub node-pair credentials: set ' +
      'XENON_HUB_ACCESS_KEY and XENON_HUB_TOKEN (an ADMIN/devices token)',
  );
}

/**
 * Default provider wired into `LeaseService`. Previously the default threw
 * unconditionally ("nodePairAuth provider not configured"), which made the SDK
 * lease API (`POST /sdk/leases`, and therefore `xenon_acquire_device`) fail on
 * every deployment. It now supplies the hub's configured node-pair credentials.
 */
export function defaultNodePairAuthProvider(): NodePairAuthProvider {
  return {
    nodePairAuth: async () => {
      const { config } = await import('../../config');
      return resolveNodePairAuth(config);
    },
  };
}

// What a token for an unknown lease id is compared against: a real hash's
// length, of a random token nobody holds.
const UNKNOWN_LEASE_TOKEN_HASH = hashToken(generateToken());

const MAX_LEASE_MS = 24 * 60 * 60 * 1000;
const MIN_DURATION_MS = 60_000;
const MIN_HEARTBEAT_SECONDS = 10;
const MAX_HEARTBEAT_SECONDS = 300;

export class NoMatchingDevice extends Error {}
export class AllMatchingBusy extends Error {}
export class DeviceUnhealthy extends Error {
  constructor(message: string, public readonly cause?: Error) { super(message); }
}
export class LeaseTokenMismatch extends Error {}
export class LeaseGone extends Error {}

@Service()
export class LeaseService {
  private logger = log.scope('LeaseService');
  private readonly db: any;
  private readonly store: any;
  private readonly portClient: any;
  private readonly authProvider: NodePairAuthProvider;
  private leaseQueue?: LeaseGrants;
  /** Built with no dependencies of its own (TypeDI's): the server's queue is its queue. */
  private readonly serverQueue: boolean;

  /**
   * Built by TypeDI with none of these, it uses the server's own database,
   * store and lease queue (`Container.get(LeaseQueue)`, the one the server
   * starts). Given any of them (tests), it grants through a queue of its own
   * over the same ones, unless `queue` is given too.
   */
  constructor(
    db?: any,
    store?: any,
    portClient?: any,
    authProvider?: NodePairAuthProvider,
    queue?: LeaseGrants,
  ) {
    this.serverQueue = [db, store, portClient, authProvider].every((dep) => dep === undefined);
    this.db = db ?? defaultPrisma;
    this.store = store ?? DeviceStoreFactory.getStore();
    this.portClient = portClient ?? new PortAllocatorClient();
    this.authProvider = authProvider ?? defaultNodePairAuthProvider();
    this.leaseQueue = queue;
  }

  /** Where every grant is decided. Read lazily: LeaseQueue imports this module. */
  private get queue(): LeaseGrants {
    this.leaseQueue ??= this.serverQueue
      ? Container.get(LeaseQueue)
      : new LeaseQueue(this.db, this.store, this.portClient, this.authProvider);
    return this.leaseQueue;
  }

  /**
   * A lease of `members` (or of one phone, `filters`), granted all or none.
   *
   * `waitMs` 0 tries once: granted, or `AllMatchingBusy` when the phones
   * can't all be had now, or `DeviceUnhealthy` when they could but a port
   * reservation failed. A longer `waitMs` joins the queue: the request is
   * written as a `waiting` lease and a grant pass runs, which may grant it
   * at once. Either way the grant is the lease queue's (LeaseQueue), under
   * the allocation lock, so a grant and a session never take one phone.
   *
   * Before anything is written, a group no set of the caller's phones could
   * ever fill, busy or not, is `NoMatchingDevice`, with today's fixed
   * sentence, so a hidden phone and an unknown udid answer alike.
   */
  async create(req: CreateLeaseRequest): Promise<CreateLeaseOutcome> {
    // Whole numbers: heartbeatSeconds is an Int column, and a waiting
    // request's stored duration must be one for a pass to serve it.
    const durationMs = Math.round(
      Math.max(MIN_DURATION_MS, Math.min(req.durationMs, MAX_LEASE_MS)),
    );
    const heartbeatSeconds = Math.round(
      Math.max(MIN_HEARTBEAT_SECONDS, Math.min(req.heartbeatSeconds, MAX_HEARTBEAT_SECONDS)),
    );
    const members = membersOf(req);
    const waitMs = req.waitMs ?? 0;
    if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > MAX_WAIT_MS) {
      throw new RangeError(`waitMs must be an integer from 0 to ${MAX_WAIT_MS}`);
    }

    const matching = await this.assertCouldBeFilled(members, req.callerTeamIds);
    const busy = () =>
      new AllMatchingBusy(
        `all devices matching ${JSON.stringify(members.map((m) => m.filters))} are busy`,
      );

    const token = generateToken();
    const tokenHash = hashToken(token);

    if (waitMs === 0) {
      const outcome = await this.queue.tryNow({
        members,
        callerTeamIds: req.callerTeamIds,
        durationMs,
        buildId: req.buildId,
        actorId: req.actorId,
        teamId: req.teamId,
        reason: req.reason,
        heartbeatSeconds,
        tokenHash,
      });
      if (outcome === 'busy') throw busy();
      if (outcome === 'unhealthy') {
        // The reason the granter was given, for one of the phones it skips.
        const reason = matching
          .map((key) => this.queue.granter?.skipReason(key))
          .find((why) => why !== undefined);
        throw new DeviceUnhealthy(
          `port allocation failed: ${reason ?? "a matching device's server did not reserve its ports"}`,
        );
      }
      const lease = await this.db.lease.findUnique({
        where: { id: outcome.leaseId },
        include: { members: true },
      });
      // Granted and gone at once (the sweeper got there first): the phones
      // couldn't be had after all.
      if (lease?.status !== 'active') throw busy();
      return { status: 'granted', body: await this.granted(lease, token) };
    }

    const now = Date.now();
    const waiting = await this.db.lease.create({
      data: {
        tokenHash,
        // Member 0's columns, filled when it is granted.
        deviceUdid: '',
        deviceHost: '',
        allocatedPorts: '',
        capabilityBag: '',
        actorId: req.actorId,
        teamId: req.teamId,
        buildId: req.buildId,
        reason: req.reason,
        status: 'waiting',
        // Set by the grant, from durationMs.
        expiresAt: 0,
        heartbeatSeconds,
        lastHeartbeatAt: now,
        requestedMembers: JSON.stringify(members.map((m) => m.filters)),
        callerTeamIds: req.callerTeamIds === undefined ? null : JSON.stringify(req.callerTeamIds),
        waitUntil: now + waitMs,
        durationMs,
      },
    });
    // Never throws: a failed pass leaves the request waiting for the next.
    await this.queue.pass();

    const reread = () =>
      this.db.lease.findUnique({ where: { id: waiting.id }, include: { members: true } });
    let lease = await reread();
    if (lease?.status === 'waiting') {
      const position = await this.queue.positionOf(lease.id);
      if (position !== null) {
        return { status: 'waiting', body: waitingBody(lease, token, position) };
      }
      // Still waiting but out of the queue: its wait ran out before it was
      // answered (a short waitMs, or time spent behind the allocation lock).
      // It gives up, letting go of what it holds, and is answered as busy.
      if ((await this.queue.giveUp(lease.id)) === 'expired') throw busy();
      // A pass granted it meanwhile.
      lease = await reread();
    }
    if (lease?.status === 'active') {
      return { status: 'granted', body: await this.granted(lease, token) };
    }
    throw busy();
  }

  /**
   * `NoMatchingDevice` unless the caller's phones, busy or not, could fill
   * every member, one phone each. Writes nothing. Answers the matching
   * phones' keys.
   */
  private async assertCouldBeFilled(
    members: MemberRequest[],
    callerTeamIds: string[] | undefined,
  ): Promise<string[]> {
    const candidates: string[][] = [];
    for (const member of members) {
      const filters = { ...clientFilters(member.filters), ...teamScope(callerTeamIds) };
      const matching: any[] = ((await this.store.getDevices(filters)) ?? []).filter(
        nameMatches(member.filters.deviceName),
      );
      candidates.push(matching.map((device) => leaseKey(device.udid, device.host)));
    }
    if (filledCount(maxMatching(candidates)) < members.length) {
      // A fixed sentence, so a hidden phone and an unknown udid answer alike.
      throw new NoMatchingDevice('No device matches the filters');
    }
    return [...new Set(candidates.flat())];
  }

  /** The `201` body of an active lease row (with its members), with each member's phone. */
  private async granted(lease: any, token: string): Promise<GrantedBody> {
    const members: MemberWithDevice[] = [];
    for (const member of lease?.members ?? []) {
      members.push({ ...member, device: await this.deviceRow(member.udid, member.host) });
    }
    return grantedBody(lease, members, token);
  }

  /** The phone's row, for its description in an answer; null if the store can't say. */
  private async deviceRow(udid: string, host: string): Promise<IDevice | null> {
    try {
      return (await this.store.findDevice({ udid, host })) ?? null;
    } catch (err) {
      this.logger.warn(`couldn't read ${udid} on ${host}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * The lease, if `token` proves it and it is still active. The token is
   * checked first: a caller who can't prove the lease (unknown id, wrong
   * token) always gets LeaseTokenMismatch, whatever state the lease is in.
   * Only the token's holder learns it is gone. An unknown id is compared
   * against a dummy hash, so it costs the same as a wrong token.
   */
  private async loadActiveLease(leaseId: string, token: string) {
    const lease = await this.db.lease.findUnique({ where: { id: leaseId } });
    const proven = verifyToken(token, lease ? lease.tokenHash : UNKNOWN_LEASE_TOKEN_HASH);
    if (!lease || !proven) throw new LeaseTokenMismatch();
    if (lease.status !== 'active') throw new LeaseGone(`lease ${leaseId} is ${lease.status}`);
    return lease;
  }

  /**
   * The lease, as loadActiveLease, if it also hasn't passed its expiresAt.
   * The sweeper marks leases by missed heartbeats, not by expiresAt, so a
   * lapsed lease can still read 'active'. It is gone all the same: heartbeat
   * must not keep it and extend must not revive it. Release still takes it,
   * so its holder can hand the device back early.
   */
  private async loadLiveLease(leaseId: string, token: string) {
    const lease = await this.loadActiveLease(leaseId, token);
    if (lease.expiresAt < Date.now()) {
      throw new LeaseGone(`lease ${leaseId} expired at ${lease.expiresAt}`);
    }
    return lease;
  }

  async heartbeat(leaseId: string, token: string): Promise<{ heartbeatedAt: number; expiresAt: number }> {
    const lease = await this.loadLiveLease(leaseId, token);
    const now = Date.now();
    // Guarded by status='active' so a concurrent sweeper expiration is observed.
    const result = await this.db.lease.updateMany({
      where: { id: leaseId, status: 'active' },
      data: { lastHeartbeatAt: now },
    });
    if (result && result.count === 0) {
      throw new LeaseGone(`lease ${leaseId} no longer active`);
    }
    return { heartbeatedAt: now, expiresAt: lease.expiresAt };
  }

  /**
   * Makes the lease last at least `durationMs` from now, never less than it
   * already does, and at most 24 hours after it was created. Through 2.18 the
   * end was set to now + durationMs, so a duration shorter than the time
   * left cut the lease short. When the end moves, the phone's server is
   * asked to hold the lease's ports until then (`holdPortsUntil`).
   */
  async extend(leaseId: string, token: string, durationMs: number): Promise<{ expiresAt: number }> {
    const lease = await this.loadLiveLease(leaseId, token);
    const now = Date.now();
    const createdAtMs = typeof lease.createdAt === 'number' ? lease.createdAt : new Date(lease.createdAt).getTime();
    const ceiling = createdAtMs + MAX_LEASE_MS;
    const wanted = Math.max(lease.expiresAt, now + Math.max(1, durationMs));
    const newExpiresAt = Math.min(wanted, Math.max(ceiling, lease.expiresAt));
    const result = await this.db.lease.updateMany({
      where: { id: leaseId, status: 'active' },
      data: { expiresAt: newExpiresAt, lastHeartbeatAt: now },
    });
    if (result && result.count === 0) {
      throw new LeaseGone(`lease ${leaseId} no longer active`);
    }
    if (newExpiresAt > lease.expiresAt) this.holdPortsUntil(lease, newExpiresAt);
    return { expiresAt: newExpiresAt };
  }

  private phoneServer?: PhoneServerPorts;

  /** The calls that reach the lease's ports on the phone's server. */
  private get phoneServerPorts(): PhoneServerPorts {
    this.phoneServer ??= new PhoneServerPorts(this.portClient, this.authProvider);
    return this.phoneServer;
  }

  /**
   * The lease's ports were reserved on the phone's server for its first
   * duration plus 5 minutes; past that the server forgets them and can hand
   * them out again. This asks it to hold them until the lease's new end.
   */
  private holdPortsUntil(lease: any, expiresAt: number): void {
    this.phoneServerPorts.hold(lease, expiresAt);
  }

  /** For tests: resolves once every call to a phone's server has answered. */
  async phoneServerCallsSettled(): Promise<void> {
    await this.phoneServerPorts.settled();
  }

  async release(leaseId: string, token: string): Promise<void> {
    const lease = await this.loadActiveLease(leaseId, token);
    const result = await this.db.lease.updateMany({
      where: { id: leaseId, status: 'active' },
      data: { status: 'released' },
    });
    // If sweeper got here first (count===0), the cascade below is still
    // idempotent and safe — port rows may already be gone, device may already
    // be unlocked. We treat that as a successful release.
    const deleted = await this.db.portLease.deleteMany({ where: { leaseId } });
    // The rows above are this server's. A node's phone's ports are in the
    // node's database, without the lease's id, so the node is asked too.
    this.phoneServerPorts.free(lease, deleted?.count ?? 0);
    // Only the lease's lock: a session still on the phone keeps it busy.
    await this.store.releaseLeaseLock(lease.deviceUdid, lease.deviceHost);
    void result;
  }

  /**
   * Resolve a lease for an Appium session that named it, if the session
   * proves it may use it: it may override (canOverrideLease), it presents the
   * lease token (the comparison heartbeat uses), or its identity is the
   * lease's creator. There is deliberately no resolver without the proof: a
   * lease id is not a secret.
   * `actorId` is the creating API key's id or the creating user's id,
   * depending on how the lease was made, so either may match.
   *
   * Returns null when the lease is missing, inactive or expired, or when the
   * proof fails — deliberately the same answer, so a caller cannot tell "not
   * yours" from "not active".
   */
  async authorizeSessionUse(
    leaseId: string,
    proof: LeaseSessionProof,
  ): Promise<ResolvedLease | null> {
    const lease = await this.findUsableLease(leaseId);
    if (!lease) return null;
    const actorId: string | null = lease.actorId ?? null;
    const holds =
      proof.canOverride ||
      (!!proof.leaseToken && verifyToken(proof.leaseToken, lease.tokenHash)) ||
      (!!actorId && (actorId === proof.apiKeyId || actorId === proof.userId));
    return holds ? toResolved(lease) : null;
  }

  private async findUsableLease(leaseId: string) {
    const lease = await this.db.lease.findUnique({ where: { id: leaseId } });
    if (!lease || lease.status !== 'active' || lease.expiresAt < Date.now()) return null;
    return lease;
  }
}

function toResolved(lease: any): ResolvedLease {
  return {
    deviceUdid: lease.deviceUdid,
    deviceHost: lease.deviceHost,
    capabilityBag: JSON.parse(lease.capabilityBag),
  };
}
