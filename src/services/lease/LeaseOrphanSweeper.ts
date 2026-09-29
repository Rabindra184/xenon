import { Service } from 'typedi';
import { prisma as defaultPrisma } from '../../prisma';
import { DeviceStoreFactory } from '../../data-service/device-store';
import log from '../../logger';

interface SweptLease {
  heartbeatSeconds: number | null;
  lastHeartbeatAt: number;
  expiresAt: number;
}

/**
 * Why an active lease is over, or null while it isn't: its client missed
 * three heartbeats, or it passed expiresAt. The second is the rule
 * LeaseService already applies (heartbeat and extend refuse such a lease,
 * authorizeSessionUse won't resolve it); without it here, a client that kept
 * heartbeating held the phone for up to 3 x heartbeatSeconds past the end.
 */
export function leaseReapReason(lease: SweptLease, now: number): string | null {
  const thresholdMs = (lease.heartbeatSeconds ?? 30) * 1000 * 3;
  if (lease.lastHeartbeatAt + thresholdMs < now) return 'missed heartbeats';
  if (lease.expiresAt < now) return `expired at ${new Date(lease.expiresAt).toISOString()}`;
  return null;
}

@Service()
export class LeaseOrphanSweeper {
  private logger = log.scope('LeaseOrphanSweeper');

  constructor(
    private readonly db: any = defaultPrisma,
    private readonly store: any = DeviceStoreFactory.getStore(),
  ) {}

  async sweep(): Promise<void> {
    const now = Date.now();
    const candidates = await this.db.lease.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        deviceUdid: true,
        deviceHost: true,
        heartbeatSeconds: true,
        lastHeartbeatAt: true,
        expiresAt: true,
      },
    });

    for (const lease of candidates) {
      const reason = leaseReapReason(lease, now);
      if (!reason) continue;
      try {
        await this.db.lease.update({ where: { id: lease.id }, data: { status: 'expired' } });
        await this.db.portLease.deleteMany({ where: { leaseId: lease.id } });
        // Only the lease's lock: a session that outlived its lease keeps the
        // phone, and its own release frees it.
        const freed = await this.store.releaseLeaseLock(lease.deviceUdid, lease.deviceHost);
        const device = `${lease.deviceUdid}@${lease.deviceHost}`;
        this.logger.info(
          `reaped lease ${lease.id} (${reason}); device ${device} ${
            freed ? 'unblocked' : 'still held (a session or a hold), left busy'
          }`,
        );
      } catch (err) {
        this.logger.warn(`failed to reap lease ${lease.id}: ${(err as Error).message}`);
      }
    }
  }
}
