import { Container, Service } from 'typedi';
import { prisma as defaultPrisma } from '../../prisma';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { PortAllocatorClient } from '../../services/ports/PortAllocatorClient';
import type { IDevice } from '../../interfaces/IDevice';
import { generateToken, hashToken, verifyToken } from './leaseToken';
import log from '../../logger';
import { PhoneServerPorts, PortsLease, leasePorts } from './phoneServerPorts';
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
  /** Runs a grant pass soon. */
  kick(): void;
  /** Calls `fn` after a pass changes the lease's status or holds; the answer unsubscribes. */
  onChange(leaseId: string, fn: () => void): () => void;
  /** Why a phone's port reservation failed, while grants skip it (LeaseGranter.skipReason). */
  readonly granter?: { skipReason(key: string): string | undefined };
}

/** How many members a lease may have. */
export const MAX_MEMBERS = 8;
/** How long a lease request may wait in the queue (`waitMs`): 60 minutes. */
export const MAX_WAIT_MS = 3_600_000;
/**
 * How long `GET /sdk/leases/:id?waitMs=` may wait for a change: short
 * enough that no proxy cuts the request.
 */
export const GET_WAIT_MAX_MS = 25_000;

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
/** The lease has ended: released, expired, or `ended` (a group that lost a member, `reason`). */
export class LeaseGone extends Error {
  constructor(
    message?: string,
    public readonly reason?: string,
  ) {
    super(message);
  }
}
/** The lease is still waiting in the queue: it can't be extended until it is granted. */
export class LeaseWaiting extends Error {}

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
   * The lease row, with its members, if `token` proves it. The token is
   * checked first: a caller who can't prove the lease (unknown id, wrong
   * token) always gets LeaseTokenMismatch, whatever state the lease is in.
   * Only the token's holder learns it is waiting, active or gone. An unknown
   * id is compared against a dummy hash, so it costs the same as a wrong
   * token.
   */
  private async loadProvenLease(leaseId: string, token: string) {
    const lease = await this.db.lease.findUnique({
      where: { id: leaseId },
      include: { members: true },
    });
    const proven = verifyToken(token, lease ? lease.tokenHash : UNKNOWN_LEASE_TOKEN_HASH);
    if (!lease || !proven) throw new LeaseTokenMismatch();
    return lease;
  }

  /** The lease has ended: released, expired, or ended with the reason a group lost a member. */
  private gone(lease: any): LeaseGone {
    return new LeaseGone(`lease ${lease.id} is ${lease.status}`, lease.endReason ?? undefined);
  }

  /**
   * A heartbeat: the lease's `lastHeartbeatAt` set to now, while it waits in
   * the queue, or while it is active and not past its `expiresAt`. The
   * sweeper marks leases by missed heartbeats, not by expiresAt, so a lapsed
   * lease can still read 'active'; it is gone all the same, and a heartbeat
   * must not keep it. Answers the lease as it was written, and a waiter's
   * place in the queue.
   *
   * A waiter whose wait has run out (out of the queue, still `waiting`)
   * gives up here, as create's does, and is gone. A lease that changes
   * between the read and the write (a pass granted it, the sweeper ended it)
   * is read again.
   */
  private async touch(
    leaseId: string,
    token: string,
  ): Promise<{ lease: any; heartbeatedAt: number; position?: number }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const lease = await this.loadProvenLease(leaseId, token);
      const now = Date.now();
      if (lease.status === 'waiting') {
        const position = await this.queue.positionOf(leaseId);
        if (position === null) {
          if ((await this.queue.giveUp(leaseId)) === 'expired') {
            // The next waiter may now be the head.
            this.queue.kick();
            throw new LeaseGone(`lease ${leaseId} is expired`);
          }
          continue;
        }
        const touched = await this.db.lease.updateMany({
          where: { id: leaseId, status: 'waiting' },
          data: { lastHeartbeatAt: now },
        });
        if (touched && touched.count === 0) continue;
        return { lease, heartbeatedAt: now, position };
      }
      if (lease.status !== 'active') throw this.gone(lease);
      if (lease.expiresAt < now) {
        throw new LeaseGone(`lease ${leaseId} expired at ${lease.expiresAt}`);
      }
      // Guarded by status='active' so a concurrent sweeper expiration is observed.
      const touched = await this.db.lease.updateMany({
        where: { id: leaseId, status: 'active' },
        data: { lastHeartbeatAt: now },
      });
      if (touched && touched.count === 0) continue;
      return { lease, heartbeatedAt: now };
    }
    throw new LeaseGone(`lease ${leaseId} no longer active`);
  }

  /**
   * Keeps the lease: active, or waiting in the queue, where a waiter that
   * misses three heartbeats leaves it. A waiter's answer also says it is
   * waiting and its `position` (its `expiresAt` is 0 until it is granted).
   */
  async heartbeat(
    leaseId: string,
    token: string,
  ): Promise<{ heartbeatedAt: number; expiresAt: number; status?: 'waiting'; position?: number }> {
    const { lease, heartbeatedAt, position } = await this.touch(leaseId, token);
    if (position === undefined) return { heartbeatedAt, expiresAt: lease.expiresAt };
    return { heartbeatedAt, expiresAt: lease.expiresAt, status: 'waiting', position };
  }

  /**
   * The lease as `create` would answer it: granted, with every member, or
   * waiting, with its place. It counts as a heartbeat.
   *
   * With `waitMs` (at most GET_WAIT_MAX_MS) a waiting lease is answered as
   * soon as a pass changes it (granted, or its holds moved), or at the limit
   * with its state then. `signal` (the request closing) ends the wait early.
   * Either way its listener and timer go with the call.
   */
  async get(
    leaseId: string,
    token: string,
    waitMs = 0,
    signal?: AbortSignal,
  ): Promise<CreateLeaseOutcome> {
    const wait = Math.min(Math.max(0, Math.floor(waitMs) || 0), GET_WAIT_MAX_MS);
    if (wait === 0) return this.answer(leaseId, token);

    let changed = false;
    let wake = () => {
      changed = true;
    };
    // Before the first read, so a change between the read and the wait isn't missed.
    const unsubscribe = this.queue.onChange(leaseId, () => wake());
    try {
      const first = await this.answer(leaseId, token);
      if (first.status !== 'waiting' || signal?.aborted) return first;
      if (!changed) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', done);
            resolve();
          };
          const timer = setTimeout(done, wait);
          wake = done;
          signal?.addEventListener('abort', done);
        });
      }
      // Nobody is left to answer.
      if (signal?.aborted) return first;
      return await this.answer(leaseId, token);
    } finally {
      unsubscribe();
    }
  }

  /** `get` without the wait: the lease, after a heartbeat. */
  private async answer(leaseId: string, token: string): Promise<CreateLeaseOutcome> {
    const { lease, position } = await this.touch(leaseId, token);
    if (position !== undefined) {
      return { status: 'waiting', body: waitingBody(lease, token, position) };
    }
    return {
      status: 'granted',
      body: await this.granted({ ...lease, members: leaseMembersOf(lease) }, token),
    };
  }

  /**
   * Makes the lease last at least `durationMs` from now, never less than it
   * already does, and at most 24 hours after it was created. Through 2.18 the
   * end was set to now + durationMs, so a duration shorter than the time
   * left cut the lease short. When the end moves, each member's server is
   * asked to hold that member's ports until then (`holdPortsUntil`).
   *
   * A lease still waiting in the queue has no end yet: LeaseWaiting.
   */
  async extend(leaseId: string, token: string, durationMs: number): Promise<{ expiresAt: number }> {
    const lease = await this.loadProvenLease(leaseId, token);
    if (lease.status === 'waiting') {
      throw new LeaseWaiting(
        `lease ${leaseId} is waiting in the queue: extend it once it is granted`,
      );
    }
    if (lease.status !== 'active') throw this.gone(lease);
    const now = Date.now();
    // Lapsed but not yet swept: extend must not revive it.
    if (lease.expiresAt < now) {
      throw new LeaseGone(`lease ${leaseId} expired at ${lease.expiresAt}`);
    }
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
   * Each member's ports were reserved on its phone's server for the lease's
   * first duration plus 5 minutes; past that the server forgets them and can
   * hand them out again. This asks each to hold them until the lease's new end.
   */
  private holdPortsUntil(lease: any, expiresAt: number): void {
    for (const member of leaseMembersOf(lease)) {
      this.phoneServerPorts.hold(portsLease(lease, member), expiresAt);
    }
  }

  /** For tests: resolves once every call to a phone's server has answered. */
  async phoneServerCallsSettled(): Promise<void> {
    await this.phoneServerPorts.settled();
  }

  /**
   * Gives the lease up. A waiting lease leaves the queue (`expired`) and lets
   * go of the phones it holds (LeaseQueue.giveUp). An active one is
   * `released`, and for every member its ports are freed, here and on its
   * phone's server, and the lease's lock dropped. Then a grant pass runs, so
   * a waiter can have the phones. A lease that has already ended is
   * LeaseGone.
   */
  async release(leaseId: string, token: string): Promise<void> {
    let lease = await this.loadProvenLease(leaseId, token);
    if (lease.status === 'waiting') {
      if ((await this.queue.giveUp(leaseId)) === 'expired') {
        // The phones it held, and the head's place if it had it, go to the next waiter.
        this.queue.kick();
        return;
      }
      // A pass granted it meanwhile: release it as granted.
      lease = await this.loadProvenLease(leaseId, token);
    }
    if (lease.status !== 'active') throw this.gone(lease);
    // If the sweeper got here first (no row changed), the cascade below is
    // still idempotent and safe: port rows may already be gone, phones may
    // already be unlocked. That is a successful release.
    await this.db.lease.updateMany({
      where: { id: leaseId, status: 'active' },
      data: { status: 'released' },
    });
    const members = leaseMembersOf(lease);
    try {
      for (const member of members) {
        const ports = portsLease(lease, member);
        const numbers = leasePorts(ports);
        // This server's rows for the member's ports. A node's phone's ports
        // are in the node's database, without the lease's id, so the node is
        // asked too, unless every one was deleted here.
        const deleted =
          numbers.length === 0
            ? null
            : await this.db.portLease.deleteMany({
                where: { leaseId, leasedToUdid: member.udid, port: { in: numbers } },
              });
        this.phoneServerPorts.free(ports, deleted?.count ?? 0);
      }
      // Any other row this server holds for the lease.
      await this.db.portLease.deleteMany({ where: { leaseId } });
      // Only the lease's lock: a session still on a phone keeps it busy.
      // Every member is tried, and the first failure answered.
      let failure: unknown;
      for (const member of members) {
        try {
          await this.store.releaseLeaseLock(member.udid, member.host);
        } catch (err) {
          this.logger.warn(
            `lease ${leaseId}: couldn't release ${member.udid} on ${member.host}: ${(err as Error).message}`,
          );
          failure ??= err;
        }
      }
      if (failure) throw failure;
    } finally {
      this.queue.kick();
    }
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

/** A member as release, extend and the answers read it. */
interface LeaseMemberRow {
  index: number;
  udid: string;
  host: string;
  allocatedPorts: string;
  capabilityBag: string;
}

/**
 * The lease's members: its member rows, or, for a lease written before
 * groups that has none yet, member 0 from its own device columns.
 */
function leaseMembersOf(lease: any): LeaseMemberRow[] {
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

/** One member's ports, as PhoneServerPorts takes them. */
function portsLease(lease: { id: string }, member: LeaseMemberRow): PortsLease {
  return {
    id: lease.id,
    deviceUdid: member.udid,
    deviceHost: member.host,
    allocatedPorts: member.allocatedPorts,
  };
}

function toResolved(lease: any): ResolvedLease {
  return {
    deviceUdid: lease.deviceUdid,
    deviceHost: lease.deviceHost,
    capabilityBag: JSON.parse(lease.capabilityBag),
  };
}
