import { Service } from 'typedi';
import { prisma as defaultPrisma } from '../../prisma';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { PortAllocatorClient } from '../../services/ports/PortAllocatorClient';
import { generateToken, hashToken, verifyToken } from './leaseToken';
import { buildCapabilityBag, AllocatedPorts } from './buildCapabilityBag';
import { withLeaseToken } from './leaseSessionCaps';
import { PortPurpose } from '../ports/PortAllocatorService';
import log from '../../logger';

export interface CreateLeaseRequest {
  filters: { platform: 'android' | 'ios'; sdk?: string; deviceName?: string; udid?: string; deviceType?: string; tags?: string[] };
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
 * `xenon:options.leaseId`. Any one of these proves it may use the lease.
 */
export interface LeaseSessionProof {
  /** May use a lease someone else created: see canOverrideLease (device-access/leaseOverride.ts). */
  canOverride: boolean;
  /** ApiKey row id of a verified df:options pair. */
  apiKeyId: string | null;
  /** User id from a verified df:options pair or xenon:options.sessionToken. */
  userId: string | null;
  /** The cleartext xenon:options.leaseToken, if the session sent one. */
  leaseToken: string | null;
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

/**
 * The caller's teams as a device-store filter. Unscoped (admin, auth disabled)
 * is no key at all: the stores treat a present `callerTeamIds` as a list.
 */
function teamScope(callerTeamIds: string[] | undefined): { callerTeamIds?: string[] } {
  return callerTeamIds === undefined ? {} : { callerTeamIds };
}

/** The client's filters without a team list, which only the credential may set. */
function clientFilters(filters: CreateLeaseRequest['filters']): Record<string, unknown> {
  const out: Record<string, unknown> = { ...filters };
  delete out.callerTeamIds;
  return out;
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

  constructor(
    private readonly db: any = defaultPrisma,
    private readonly store: any = DeviceStoreFactory.getStore(),
    private readonly portClient: any = new PortAllocatorClient(),
    private readonly authProvider: NodePairAuthProvider = defaultNodePairAuthProvider(),
  ) {}

  async create(req: CreateLeaseRequest) {
    const durationMs = Math.max(MIN_DURATION_MS, Math.min(req.durationMs, MAX_LEASE_MS));
    const heartbeatSeconds = Math.max(MIN_HEARTBEAT_SECONDS, Math.min(req.heartbeatSeconds, MAX_HEARTBEAT_SECONDS));

    // Step 1: atomic find + lock, among the phones the caller can see.
    const teams = teamScope(req.callerTeamIds);
    const device = await this.store.findAndLockDevice({ ...clientFilters(req.filters), ...teams });
    if (!device) {
      // Distinguish "no device matches the filter" (404) from "matching
      // devices exist but are all busy or already leased" (409). Spec §4.2.
      // Counted within the caller's teams too, so the answer can't reveal
      // that another team has a phone of this platform.
      const anyMatching = await this.store.getDevices({ platform: req.filters.platform, ...teams });
      if (anyMatching && anyMatching.length > 0) {
        throw new AllMatchingBusy(`all devices matching ${JSON.stringify(req.filters)} are busy`);
      }
      throw new NoMatchingDevice(`no device matching ${JSON.stringify(req.filters)}`);
    }

    // Step 2: port RPC (or local-call if device.host == this host)
    let ports: AllocatedPorts;
    try {
      const purposes: PortPurpose[] = String(device.platform).toLowerCase() === 'android'
        ? ['systemPort', 'chromedriverPort', 'mjpegServerPort']
        : ['wdaLocalPort', 'mjpegServerPort'];
      const auth = await this.authProvider.nodePairAuth(device.host);
      ports = await this.portClient.allocate({
        nodeHost: device.host,
        udid: device.udid,
        purposes,
        durationMs,
        nodePairAuth: auth,
      });
    } catch (err) {
      // Rollback the device lock
      await this.store.updateDevice(device.udid, device.host, { busy: false });
      throw new DeviceUnhealthy(`port allocation failed: ${(err as Error).message}`, err as Error);
    }

    // Step 3: build token + insert lease row
    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = Date.now();
    const expiresAt = now + durationMs;

    let lease;
    try {
      lease = await this.db.lease.create({
        data: {
          tokenHash,
          deviceUdid: device.udid,
          deviceHost: device.host,
          actorId: req.actorId,
          teamId: req.teamId,
          buildId: req.buildId,
          reason: req.reason,
          status: 'active',
          expiresAt,
          heartbeatSeconds,
          lastHeartbeatAt: now,
          allocatedPorts: JSON.stringify(ports),
          capabilityBag: '',
        },
      });
    } catch (err) {
      await this.store.updateDevice(device.udid, device.host, { busy: false });
      await this.db.portLease.deleteMany({ where: { port: { in: Object.values(ports) } } });
      throw err;
    }

    // Step 4: build the cap bag now that we have lease.id, persist + return.
    // If this update fails (rare, transient DB error), roll the lease back so
    // we don't leave a zombie row with capabilityBag='' that would crash on
    // any later JSON.parse in authorizeSessionUse().
    const bag = buildCapabilityBag(device, ports, lease.id, req.buildId);
    try {
      await this.db.lease.update({
        where: { id: lease.id },
        data: { capabilityBag: JSON.stringify(bag) },
      });
      // Step 5: backfill leaseId on the PortLease rows
      await this.db.portLease.updateMany({
        where: { port: { in: Object.values(ports) } },
        data: { leaseId: lease.id },
      });
    } catch (err) {
      try { await this.db.lease.delete({ where: { id: lease.id } }); } catch {}
      try { await this.db.portLease.deleteMany({ where: { port: { in: Object.values(ports) } } }); } catch {}
      try { await this.store.updateDevice(device.udid, device.host, { busy: false }); } catch {}
      throw err;
    }

    return {
      leaseId: lease.id,
      leaseToken: token,
      device: {
        udid: device.udid, host: device.host, platform: device.platform,
        sdk: device.sdk, name: device.name,
        screen: { width: device.screenWidth, height: device.screenHeight },
        realDevice: device.realDevice,
      },
      expiresAt,
      heartbeatSeconds,
      allocatedPorts: ports,
      // The stored bag has no token; this copy carries it, so a client that
      // passes appiumCapabilities through unchanged proves it holds the lease.
      appiumCapabilities: withLeaseToken(bag, token),
    };
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

  async heartbeat(leaseId: string, token: string): Promise<{ heartbeatedAt: number; expiresAt: number }> {
    const lease = await this.loadActiveLease(leaseId, token);
    const now = Date.now();
    if (lease.expiresAt < now) {
      throw new LeaseGone(`lease ${leaseId} expired at ${lease.expiresAt}`);
    }
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

  async extend(leaseId: string, token: string, additionalMs: number): Promise<{ expiresAt: number }> {
    const lease = await this.loadActiveLease(leaseId, token);
    const now = Date.now();
    const createdAtMs = typeof lease.createdAt === 'number' ? lease.createdAt : new Date(lease.createdAt).getTime();
    const ceiling = createdAtMs + MAX_LEASE_MS;
    const newExpiresAt = Math.min(now + Math.max(1, additionalMs), ceiling);
    const result = await this.db.lease.updateMany({
      where: { id: leaseId, status: 'active' },
      data: { expiresAt: newExpiresAt, lastHeartbeatAt: now },
    });
    if (result && result.count === 0) {
      throw new LeaseGone(`lease ${leaseId} no longer active`);
    }
    return { expiresAt: newExpiresAt };
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
    await this.db.portLease.deleteMany({ where: { leaseId } });
    await this.store.updateDevice(lease.deviceUdid, lease.deviceHost, { busy: false });
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
