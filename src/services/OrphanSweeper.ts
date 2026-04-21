import { Service } from 'typedi';
import { prisma } from '../prisma';
import log from '../logger';
import { DASHBORD_EVENT_MANAGER } from '../dashboard/event-manager';
import { SessionStatus } from '../types/SessionStatus';

export interface SweepOptions {
  heartbeatIntervalMs: number;
  staleMultiplier?: number;
}

@Service()
export class OrphanSweeper {
  private log = log.scope('OrphanSweeper');

  async sweep({ heartbeatIntervalMs, staleMultiplier = 3 }: SweepOptions): Promise<void> {
    const cutoff = new Date(Date.now() - staleMultiplier * heartbeatIntervalMs);

    let stale: Array<{ id: string; device_udid: string; node_id: string }> = [];
    try {
      stale = (await prisma.session.findMany({
        where: {
          status: 'running',
          OR: [
            { last_heartbeat_at: { lt: cutoff } },
            { last_heartbeat_at: null, updatedAt: { lt: cutoff } },
          ],
        },
        select: { id: true, device_udid: true, node_id: true },
      })) as any;
    } catch (err: any) {
      this.log.error(`findMany failed: ${err.message}`);
      return;
    }

    if (stale.length === 0) return;

    this.log.info(`Sweeping ${stale.length} orphaned session(s)`);

    for (const s of stale) {
      try {
        await prisma.session.update({
          where: { id: s.id },
          data: {
            status: 'failed',
            failure_reason: 'Session heartbeat timeout',
            endTime: new Date(),
          },
        });

        await prisma.device.updateMany({
          where: { udid: s.device_udid },
          data: {
            busy: false,
            session_id: null,
            owningSessionId: null,
            lockedAt: null,
          },
        });

        await DASHBORD_EVENT_MANAGER.onSessionStopped(
          s.id,
          SessionStatus.FAILED,
          'Session heartbeat timeout',
        );
      } catch (err: any) {
        this.log.error(`Failed to sweep session ${s.id}: ${err.message}`);
      }
    }
  }
}
