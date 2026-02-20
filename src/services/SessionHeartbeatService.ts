import { Container, Service } from 'typedi';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { DeviceStoreFactory } from '../data-service/device-store';
import log from '../logger';
import { IPluginArgs } from '../interfaces/IPluginArgs';
import { DASHBORD_EVENT_MANAGER } from '../dashboard/event-manager';
import { SessionStatus } from '../types/SessionStatus';
import { prisma } from '../prisma';
import { SessionLifecycleService } from './SessionLifecycleService';

import { SessionHealthState, HealthErrorType } from '../sessions/XenonSession';

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

  private failureCounts: Map<string, number> = new Map();
  private readonly THRESHOLD_DEGRADED = 1;
  private readonly THRESHOLD_SUSPECT = 3;
  private readonly THRESHOLD_DEAD = 6;

  private async checkAllSessions() {
    // 1. Local memory check (fast path)
    const localSessions = SESSION_MANAGER.getAllSessions();
    const activeSessionIds = new Set(localSessions.map((s) => s.getId()));

    // Cleanup failure counts for closed sessions
    for (const sid of this.failureCounts.keys()) {
      if (!activeSessionIds.has(sid)) {
        this.failureCounts.delete(sid);
      }
    }

    for (const session of localSessions) {
      // Principal Grace Period: If a session is already stopping, give it 60 seconds to finish
      // its own cleanup (video processing, etc.) before we force it out.
      if (session.isStopping && session.stoppedAt && Date.now() - session.stoppedAt < 60000) {
        continue;
      }

      const sessionId = session.getId();
      try {
        const result = await session.checkHealth();

        if (result.isHealthy) {
          // Recovery: Reset failure count and restore HEALTHY state
          if (this.failureCounts.get(sessionId) || 0 > 0) {
            this.log.info(`✨ Session ${sessionId} recovered and is now HEALTHY.`);
          }
          this.failureCounts.set(sessionId, 0);
          session.healthState = SessionHealthState.HEALTHY;
          continue;
        }

        const count = (this.failureCounts.get(sessionId) || 0) + 1;
        this.failureCounts.set(sessionId, count);

        // State Machine Transition Logic
        if (count >= this.THRESHOLD_DEAD) {
          session.healthState = SessionHealthState.DEAD;
          this.log.error(
            `💔 Session ${sessionId} reached DEAD state after ${count} failures. Error: ${result.errorType} - ${result.message}`,
          );

          const reason = session.isStopping
            ? 'Shutdown timeout (Cleanup hung for > 60s)'
            : `Session terminal failure (${result.errorType}: ${result.message})`;

          // Trigger terminal cleanup
          const lifecycleService = Container.get(SessionLifecycleService);
          await lifecycleService.deleteSession(
            async () => {
              /* No-op driver deletion */
            },
            sessionId,
            SessionStatus.FAILED,
            reason,
          );

          this.failureCounts.delete(sessionId);
        } else if (count >= this.THRESHOLD_SUSPECT) {
          session.healthState = SessionHealthState.SUSPECT;
          this.log.warn(
            `🕵️ Session ${sessionId} is SUSPECT (${count}/${this.THRESHOLD_DEAD}). Evidence: ${result.errorType} - ${result.message}`,
          );
        } else if (count >= this.THRESHOLD_DEGRADED) {
          session.healthState = SessionHealthState.DEGRADED;
          this.log.debug(`⚠️ Session ${sessionId} is DEGRADED (${count}/${this.THRESHOLD_DEAD}).`);
        }
      } catch (err: any) {
        this.log.error(`Unexpected error checking health for session ${sessionId}: ${err.message}`);
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
}
