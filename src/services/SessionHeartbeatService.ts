import { Container, Service } from 'typedi';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { DeviceStoreFactory } from '../data-service/device-store';
import log from '../logger';
import { IPluginArgs } from '../interfaces/IPluginArgs';
import { DASHBORD_EVENT_MANAGER } from '../dashboard/event-manager';
import { SessionStatus } from '../types/SessionStatus';
import { prisma } from '../prisma';

@Service()
export class SessionHeartbeatService {
  private log = log.scope('SessionHeartbeat');
  private interval: NodeJS.Timeout | undefined;

  public start(pluginArgs: IPluginArgs) {
    const intervalMs = pluginArgs.sessionHeartbeatIntervalMs || 30000;
    this.log.info(`Starting Session Heartbeat Service (Interval: ${intervalMs}ms)`);
    this.interval = setInterval(() => this.checkAllSessions(), intervalMs);
  }

  public stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  private async checkAllSessions() {
    // 1. Local memory check (fast path)
    const localSessions = SESSION_MANAGER.getAllSessions();
    for (const session of localSessions) {
      const sessionId = session.getId();
      try {
        const isHealthy = await session.checkHealth();
        if (!isHealthy) {
          this.log.warn(`💔 Local Session ${sessionId} failed health check. Cleaning up.`);
          await this.cleanupDeadSession(session);
        }
      } catch (err: any) {
        this.log.error(`Error checking health for local session ${sessionId}: ${err.message}`);
      }
    }

    // 2. Global Database Check (Senior Tier: Multi-Hub resilience)
    try {
      const zombieThreshold = new Date(Date.now() - 10 * 60 * 1000);
      const zombies = await prisma.session.findMany({
        where: {
          status: 'running',
          updatedAt: { lt: zombieThreshold },
        },
        include: { build: true },
      });

      if (zombies.length > 0) {
        this.log.info(
          `🕵️ Found ${zombies.length} global zombie sessions. Harmonizing fleet state...`,
        );
        for (const zombie of zombies) {
          await this.cleanupGlobalZombie(zombie);
        }
      }
    } catch (err: any) {
      this.log.error(`Global zombie cleanup failed: ${err.message}`);
    }
  }

  private async cleanupGlobalZombie(sessionData: any) {
    const { id, device_udid, node_id } = sessionData;
    try {
      // Unblock device in DB
      await DeviceStoreFactory.getStore().updateDevice(device_udid, node_id, {
        busy: false,
        session_id: null as any,
      });

      // Mark session as failed in DB
      await prisma.session.update({
        where: { id },
        data: {
          status: 'failed',
          endTime: new Date(),
          failure_reason: 'Session orphaned (Hub instance timeout)',
        },
      });

      this.log.info(`✅ Global zombie ${id} neutralized and device ${device_udid} released.`);
    } catch (err: any) {
      this.log.error(`Failed to cleanup global zombie ${id}: ${err.message}`);
    }
  }

  private async cleanupDeadSession(session: any) {
    const sessionId = session.getId();
    const device = session.getDevice();

    try {
      // 1. Notify Dashboard
      await DASHBORD_EVENT_MANAGER.onSessionStopped(
        sessionId,
        SessionStatus.FAILED,
        'Session became unresponsive (Heartbeat failure)',
      );

      // 2. Unblock Device
      await DeviceStoreFactory.getStore().updateDevice(device.udid, device.host, {
        busy: false,
        session_id: null as any,
      });

      // 3. Remove from memory
      SESSION_MANAGER.removeSession(sessionId);

      this.log.info(`✅ Successfully cleaned up dead session ${sessionId}`);
    } catch (err: any) {
      this.log.error(`Failed to cleanup dead session ${sessionId}: ${err.message}`);
    }
  }
}
