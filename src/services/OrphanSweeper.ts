import { Service } from 'typedi';
import { prisma } from '../prisma';
import log from '../logger';
import { DASHBORD_EVENT_MANAGER } from '../dashboard/event-manager';
import { SessionStatus } from '../types/SessionStatus';

export interface SweepOptions {
  heartbeatIntervalMs: number;
  staleMultiplier?: number;
  /**
   * When set, only sweeps sessions whose heartbeat_host matches this value
   * AND whose heartbeat_pid is different from `excludePid` (or any pid when undefined).
   * Used by startup reconciliation to target only prior-PID orphans on this host.
   */
  hostScope?: { host: string; excludePid?: number };
}

@Service()
export class OrphanSweeper {
  private log = log.scope('OrphanSweeper');

  async sweep({ heartbeatIntervalMs, staleMultiplier = 3, hostScope }: SweepOptions): Promise<void> {
    const cutoff = new Date(Date.now() - staleMultiplier * heartbeatIntervalMs);

    const where: any = {
      status: 'running',
      OR: [
        { last_heartbeat_at: { lt: cutoff } },
        { last_heartbeat_at: null, updatedAt: { lt: cutoff } },
      ],
    };
    if (hostScope) {
      where.heartbeat_host = hostScope.host;
      if (hostScope.excludePid !== undefined) {
        where.heartbeat_pid = { not: hostScope.excludePid };
      }
    }

    let stale: Array<{ id: string; device_udid: string }> = [];
    try {
      stale = (await prisma.session.findMany({
        where,
        select: { id: true, device_udid: true },
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
