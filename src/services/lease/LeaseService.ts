import { Service } from 'typedi';
import { prisma as defaultPrisma } from '../../prisma';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { PortAllocatorClient } from '../../services/ports/PortAllocatorClient';
import { generateToken, hashToken, verifyToken } from './leaseToken';
import { buildCapabilityBag, AllocatedPorts } from './buildCapabilityBag';
import { PortPurpose } from '../ports/PortAllocatorService';
import log from '../../logger';

export interface CreateLeaseRequest {
  filters: { platform: 'android' | 'ios'; sdk?: string; deviceName?: string; udid?: string; deviceType?: string; tags?: string[] };
  durationMs: number;
  heartbeatSeconds: number;
  actorId: string;
  teamId: string | null;
  buildId?: string;
  reason?: string;
}

export interface NodePairAuthProvider {
  nodePairAuth: (nodeHost: string) => Promise<{ accessKey: string; token: string }>;
}

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
    private readonly authProvider: NodePairAuthProvider = {
      nodePairAuth: async () => { throw new Error('nodePairAuth provider not configured'); },
    },
  ) {}

  async create(req: CreateLeaseRequest) {
    const durationMs = Math.max(MIN_DURATION_MS, Math.min(req.durationMs, MAX_LEASE_MS));
    const heartbeatSeconds = Math.max(MIN_HEARTBEAT_SECONDS, Math.min(req.heartbeatSeconds, MAX_HEARTBEAT_SECONDS));

    // Step 1: atomic find + lock
    const device = await this.store.findAndLockDevice(req.filters);
    if (!device) {
      // Distinguish "no device matches the filter" (404) from "matching
      // devices exist but are all busy or already leased" (409). Spec §4.2.
      const anyMatching = await this.store.getDevices({ platform: req.filters.platform });
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
    // any later JSON.parse in resolve().
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
      appiumCapabilities: bag,
    };
  }

  private async loadActiveLease(leaseId: string, token: string) {
    const lease = await this.db.lease.findUnique({ where: { id: leaseId } });
    if (!lease) throw new LeaseGone(`no lease ${leaseId}`);
    if (lease.status !== 'active') throw new LeaseGone(`lease ${leaseId} is ${lease.status}`);
    if (!verifyToken(token, lease.tokenHash)) throw new LeaseTokenMismatch();
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
   * Resolve a lease for the Appium-session-create code path. No token check —
   * the SDK passes leaseId in caps, not the token (the token never travels
   * through W3C session-create).
   */
  async resolve(leaseId: string): Promise<{ deviceUdid: string; deviceHost: string; capabilityBag: any } | null> {
    const lease = await this.db.lease.findUnique({ where: { id: leaseId } });
    if (!lease || lease.status !== 'active' || lease.expiresAt < Date.now()) return null;
    return {
      deviceUdid: lease.deviceUdid,
      deviceHost: lease.deviceHost,
      capabilityBag: JSON.parse(lease.capabilityBag),
    };
  }
}
