import { Container, Service } from 'typedi';
import * as os from 'os';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { DeviceStoreFactory } from '../data-service/device-store';
import log from '../logger';
import { IPluginArgs } from '../interfaces/IPluginArgs';
import { DASHBORD_EVENT_MANAGER } from '../dashboard/event-manager';
import { SessionStatus } from '../types/SessionStatus';
import { prisma } from '../prisma';
import { SessionLifecycleService } from './SessionLifecycleService';

import type { XenonSession } from '../sessions/XenonSession';

/** At most this many sessions are probed at once. */
export const HEARTBEAT_PROBE_CONCURRENCY = 8;

/**
 * Probes every session this process holds, every interval, and ends one
 * whose probe fails THRESHOLD_DEAD times in a row, or at once when the
 * server running it answers that it no longer has it (`gone`, a node's
 * session-status route saying `exists: false`). Transport failures,
 * timeouts and an older node's WebDriver probe are still counted.
 *
 * - **One cycle at a time.** A remote session's probe can take seconds on a
 *   slow node, so a cycle can outlast the interval. A tick that finds the
 *   last cycle still running skips: overlapping cycles counted each failure
 *   twice (a session was ended in half the time) and could end one session
 *   twice.
 * - **Stamped first.** Every held session's row is stamped with this process
 *   (`last_heartbeat_at`, `heartbeat_pid`, `heartbeat_host`) on every tick,
 *   before any probe and whether or not a cycle runs, in one write. The
 *   stamp says the process is alive and holds the session; whether the
 *   session is healthy is the probe's to decide. Stamped after each probe,
 *   one slow node made every later session's stamp late.
 * - **Probed side by side**, at most HEARTBEAT_PROBE_CONCURRENCY at once.
 */
@Service()
export class SessionHeartbeatService {
  private log = log.scope('SessionHeartbeat');
  private interval: NodeJS.Timeout | undefined;
  private cycle: Promise<void> | undefined;

  public start(pluginArgs: IPluginArgs) {
    const intervalMs = pluginArgs.sessionHeartbeatIntervalMs || 30000;
    this.log.info(`Starting Session Heartbeat Service (Interval: ${intervalMs}ms)`);
    this.interval = setInterval(() => void this.checkAllSessions(), intervalMs);
  }

  public stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  private failureCounts: Map<string, number> = new Map();
  private readonly THRESHOLD_SUSPECT = 3;
  private readonly THRESHOLD_DEAD = 6;

  /**
   * Stamps the held sessions, then runs a cycle, or, while one runs, resolves
   * with that one. The stamp is written on every tick, so a cycle held up by
   * a slow probe or a session's ending doesn't stop it.
   */
  private checkAllSessions(): Promise<void> {
    const stamped = this.stamp(SESSION_MANAGER.getAllSessions().map((s) => s.getId()));
    if (this.cycle) {
      this.log.debug('The previous heartbeat cycle is still running; skipping this one');
      return Promise.all([stamped, this.cycle]).then(() => undefined);
    }
    this.cycle = stamped
      .then(() => this.runCycle())
      .catch((err: any) => this.log.error(`Heartbeat cycle failed: ${err?.message ?? err}`))
      .finally(() => {
        this.cycle = undefined;
      });
    return this.cycle;
  }

  private async runCycle(): Promise<void> {
    // 1. Local memory check (fast path)
    const localSessions = SESSION_MANAGER.getAllSessions();
    const activeSessionIds = new Set(localSessions.map((s) => s.getId()));

    // Cleanup failure counts for closed sessions
    for (const sid of this.failureCounts.keys()) {
      if (!activeSessionIds.has(sid)) {
        this.failureCounts.delete(sid);
      }
    }

    await forEachLimited(localSessions, HEARTBEAT_PROBE_CONCURRENCY, (session) =>
      this.checkSession(session),
    );

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

  private async stamp(sessionIds: string[]): Promise<void> {
    if (sessionIds.length === 0) return;
    try {
      await prisma.session.updateMany({
        where: { id: { in: sessionIds } },
        data: {
          last_heartbeat_at: new Date(),
          heartbeat_pid: process.pid,
          heartbeat_host: os.hostname(),
        },
      });
    } catch (err: any) {
      this.log.debug(`Heartbeat write failed for ${sessionIds.length} session(s): ${err.message}`);
    }
  }

  private async checkSession(session: XenonSession): Promise<void> {
    // Principal Grace Period: If a session is already stopping, give it 60 seconds to finish
    // its own cleanup (video processing, etc.) before we force it out.
    if (session.isStopping && session.stoppedAt && Date.now() - session.stoppedAt < 60000) {
      return;
    }

    const sessionId = session.getId();
    try {
      const result = await session.checkHealth();

      if (result.isHealthy) {
        if ((this.failureCounts.get(sessionId) || 0) > 0) {
          this.log.info(`✨ Session ${sessionId} recovered and is now HEALTHY.`);
        }
        this.failureCounts.set(sessionId, 0);
        return;
      }

      const count = (this.failureCounts.get(sessionId) || 0) + 1;
      this.failureCounts.set(sessionId, count);

      // The node said it no longer has the session: no count to wait out.
      // Counted, the hub kept the node's phone claimed for ~3 minutes after
      // the session had died there.
      if (result.gone || count >= this.THRESHOLD_DEAD) {
        this.log.error(
          result.gone
            ? `💔 Session ${sessionId} is gone: ${result.message}`
            : `💔 Session ${sessionId} reached DEAD state after ${count} failures. Error: ${result.errorType} - ${result.message}`,
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
        this.log.warn(
          `🕵️ Session ${sessionId} is SUSPECT (${count}/${this.THRESHOLD_DEAD}). Evidence: ${result.errorType} - ${result.message}`,
        );
      } else {
        this.log.debug(`⚠️ Session ${sessionId} is DEGRADED (${count}/${this.THRESHOLD_DEAD}).`);
      }
    } catch (err: any) {
      this.log.error(`Unexpected error checking health for session ${sessionId}: ${err.message}`);
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

/** Runs `fn` over `items`, at most `limit` at a time. */
async function forEachLimited<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
