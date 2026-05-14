import { Service } from 'typedi';
import { prisma as defaultPrisma } from '../../prisma';
import { DeviceStoreFactory } from '../../data-service/device-store';
import log from '../../logger';

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
      select: { id: true, deviceUdid: true, deviceHost: true, heartbeatSeconds: true, lastHeartbeatAt: true },
    });

    for (const lease of candidates) {
      const thresholdMs = (lease.heartbeatSeconds ?? 30) * 1000 * 3;
      if (lease.lastHeartbeatAt + thresholdMs >= now) continue;
      try {
        await this.db.lease.update({ where: { id: lease.id }, data: { status: 'expired' } });
        await this.db.portLease.deleteMany({ where: { leaseId: lease.id } });
        await this.store.updateDevice(lease.deviceUdid, lease.deviceHost, { busy: false });
        this.logger.info(`reaped lease ${lease.id} (missed heartbeats); device ${lease.deviceUdid}@${lease.deviceHost} unblocked`);
      } catch (err) {
        this.logger.warn(`failed to reap lease ${lease.id}: ${(err as Error).message}`);
      }
    }
  }
}
