import os from 'os';
import { Service } from 'typedi';
import { prisma } from '../prisma';
import log from '../logger';
import { RemoteSession } from './RemoteSession';
import { CloudSession } from './CloudSession';
import { XenonSession } from './XenonSession';
import { IDevice } from '../interfaces/IDevice';
import { DeviceStoreFactory } from '../data-service/device-store';
import { nodeWebDriverUrl } from '../gateway/nodeWebDriverUrl';
import { getXenonCapabilities } from '../XenonCapabilityManager';
import { nodeMetricsSourceOf } from '../services/metrics/nodeMetrics';

/**
 * The `failure_category` of a session a restart ended: one still running at
 * boot that couldn't be picked up again. The failure analysis writes every
 * other category (`ANALYSIS_CATEGORIES`).
 */
export const HUB_RESTART_CATEGORY = 'HUB_RESTART';

/**
 * SessionManager with persistence and recovery capabilities.
 *
 * Key Design Decisions:
 * 1. LocalSessions CANNOT be recovered (Appium driver dies with the hub).
 *    On recovery, orphaned local sessions are marked as failed.
 * 2. RemoteSessions and CloudSessions CAN be recovered because they only
 *    need sessionId and baseUrl to continue proxying commands.
 * 3. Session state is persisted to SQLite via Prisma for durability.
 */
@Service()
export class SessionManager {
  private sessionMap: Map<string, XenonSession> = new Map();
  private log = log.scope('SessionManager');

  /**
   * Add a session to the in-memory map.
   * Note: Session is already persisted to DB via event-manager.onSessionCreated
   */
  addSession(sessionId: string, session: XenonSession) {
    this.sessionMap.set(sessionId, session);
    this.log.debug(`Added session ${sessionId} to memory (total: ${this.sessionMap.size})`);
  }

  /**
   * Remove a session from the in-memory map.
   */
  removeSession(sessionId: string) {
    this.sessionMap.delete(sessionId);
    this.log.debug(`Removed session ${sessionId} from memory (total: ${this.sessionMap.size})`);
  }

  isValidSession(sessionId: string) {
    return this.sessionMap.has(sessionId);
  }

  getSession(sessionId: string) {
    return this.sessionMap.get(sessionId);
  }

  getAllSessions(): XenonSession[] {
    return Array.from(this.sessionMap.values());
  }

  getSessionCount(): number {
    return this.sessionMap.size;
  }

  /**
   * Recover active sessions from the database after hub restart.
   *
   * @param currentNodeId - The ID of the current hub node
   * @param nodeBasePath - The base path for WebDriver URLs
   *
   * Strategy:
   * - Sessions on THIS node (LocalSessions) are marked as failed because
   *   the Appium driver is gone.
   * - Sessions on REMOTE nodes are recovered as RemoteSessions.
   * - Sessions on CLOUD providers are recovered as CloudSessions.
   */
  async recoverActiveSessions(
    currentNodeId: string,
    nodeBasePath: string,
    isLocalHost: (host: string) => boolean = () => false,
  ): Promise<number> {
    this.log.info('🔄 Attempting to recover active sessions from database...');

    try {
      // Find all sessions that are still "running" (not ended)
      const activeSessions = await prisma.session.findMany({
        where: {
          status: 'running',
          endTime: null,
        },
      });

      if (activeSessions.length === 0) {
        this.log.info('✅ No active sessions to recover.');
        return 0;
      }

      this.log.info(`📋 Found ${activeSessions.length} active sessions in database.`);

      let recoveredCount = 0;
      let failedCount = 0;

      for (const dbSession of activeSessions) {
        try {
          // Get the device associated with this session
          const device = await DeviceStoreFactory.getStore().findDevice({
            udid: dbSession.device_udid,
          });

          if (!device) {
            this.log.warn(
              `⚠️ Session ${dbSession.id}: Device ${dbSession.device_udid} not found. Marking as failed.`,
            );
            await this.markSessionAsFailed(dbSession.id, 'Device not found after hub restart');
            failedCount++;
            continue;
          }

          // Check if this session was on THE CURRENT NODE (LocalSession). The
          // node id is new on every boot, so a phone this server drives is
          // also known by its host; otherwise a local session from before the
          // restart would be rebuilt as a remote one pointing back at this hub.
          const isLocalSession =
            dbSession.node_id === currentNodeId ||
            device.nodeId === currentNodeId ||
            (!device.cloud && isLocalHost(device.host));

          if (isLocalSession) {
            // LocalSessions cannot be recovered - the Appium driver is gone
            this.log.warn(
              `⏹️ Session ${dbSession.id}: Was a LocalSession on this node. Marking as failed (driver lost).`,
            );
            await this.markSessionAsFailed(
              dbSession.id,
              'Hub restarted - local Appium driver session was lost',
            );

            // Also unblock the device
            await DeviceStoreFactory.getStore().updateDevice(device.udid, device.host, {
              busy: false,
              session_id: undefined,
            });

            failedCount++;
            continue;
          }

          // Parse session capabilities from JSON
          let sessionResponse: Record<string, any> = {};
          try {
            sessionResponse = JSON.parse(dbSession.session_capabilities || '{}');
          } catch (e) {
            this.log.warn(`Session ${dbSession.id}: Could not parse session_capabilities`);
          }

          let desiredCaps: Record<string, any> = {};
          try {
            desiredCaps = JSON.parse(dbSession.desired_capabilities || '{}');
          } catch (e) {
            this.log.warn(`Session ${dbSession.id}: Could not parse desired_capabilities`);
          }

          const xenonCapabilities = getXenonCapabilities({
            alwaysMatch: desiredCaps,
            firstMatch: [{}],
          });

          // The node's own base path, which need not be this hub's.
          const baseUrl = await nodeWebDriverUrl(device, nodeBasePath);

          // Create the appropriate session type
          let recoveredSession: XenonSession;

          if (device.cloud) {
            // CloudSession
            recoveredSession = new CloudSession({
              sessionId: dbSession.id,
              device: device,
              sessionResponse: sessionResponse,
              xenonOption: xenonCapabilities,
              baseUrl: baseUrl,
            });
            this.log.info(`☁️ Recovered CloudSession ${dbSession.id} on ${device.cloud}`);
          } else {
            // RemoteSession
            recoveredSession = new RemoteSession({
              sessionId: dbSession.id,
              device: device,
              sessionResponse: sessionResponse,
              xenonOption: xenonCapabilities,
              baseUrl: baseUrl,
            });
            this.log.info(`🌐 Recovered RemoteSession ${dbSession.id} on node ${device.nodeId}`);
          }

          // Its owner, as the row recorded it.
          recoveredSession.apiKeyId = dbSession.api_key_id ?? null;
          recoveredSession.userId = dbSession.user_id ?? null;

          // Add to in-memory map
          this.addSession(dbSession.id, recoveredSession);
          await this.adoptHeartbeat(dbSession.id);
          // A node session whose figures the hub was collecting goes on from
          // the newest sample stored here; the node's memory fills the gap.
          if (!device.cloud && dbSession.is_profiling_available) {
            await this.resumeNodeMetrics(dbSession.id, device, recoveredSession, sessionResponse);
          }
          recoveredCount++;
        } catch (sessionErr: any) {
          this.log.error(`❌ Failed to recover session ${dbSession.id}: ${sessionErr.message}`);
          await this.markSessionAsFailed(dbSession.id, `Recovery failed: ${sessionErr.message}`);
          failedCount++;
        }
      }

      this.log.info(
        `✅ Session recovery complete. Recovered: ${recoveredCount}, Failed: ${failedCount}`,
      );

      return recoveredCount;
    } catch (err: any) {
      this.log.error(`❌ Session recovery error: ${err.message}`);
      return 0;
    }
  }

  /** Goes on collecting a node session's figures after a hub restart, from the newest stored. */
  private async resumeNodeMetrics(
    sessionId: string,
    device: IDevice,
    session: XenonSession,
    capabilities: Record<string, any>,
  ): Promise<void> {
    try {
      const newest = await prisma.sessionMetric.aggregate({
        where: { session_id: sessionId },
        _max: { at: true },
      });
      // Loaded here: SessionMetricsService imports the device managers.
      const { SessionMetricsService } = await import('../services/metrics/SessionMetricsService');
      Container.get(SessionMetricsService).start({
        sessionId,
        device,
        capabilities,
        source: nodeMetricsSourceOf(session),
        after: newest._max.at ?? null,
      });
    } catch (err: any) {
      this.log.warn(`Session ${sessionId}: CPU and memory not resumed: ${err.message}`);
    }
  }

  /**
   * A recovered session is this process's from now on: its row's heartbeat
   * is stamped with this process, now. The row still carried the heartbeat
   * of the process that ran before the restart, so after an outage longer
   * than 3 heartbeat intervals the orphan sweep (OrphanSweeper, at boot and
   * on every interval) took it for an orphan: it failed the session recovery
   * had just rebuilt and freed its phone, while the node kept the session.
   *
   * Stamping, rather than handing the sweeps a list of ids to skip, makes the
   * row say what is true, so every reader of it agrees: both sweeps, and the
   * heartbeat's own check for rows nobody updates. From here the heartbeat
   * keeps it fresh, and ends the session if its node no longer has it. A
   * failed write is logged; the heartbeat's next write repairs it.
   */
  private async adoptHeartbeat(sessionId: string): Promise<void> {
    try {
      await prisma.session.update({
        where: { id: sessionId },
        data: {
          last_heartbeat_at: new Date(),
          heartbeat_pid: process.pid,
          heartbeat_host: os.hostname(),
        },
      });
    } catch (err: any) {
      this.log.warn(`Could not stamp recovered session ${sessionId}'s heartbeat: ${err.message}`);
    }
  }

  /**
   * Mark a session as failed in the database
   */
  private async markSessionAsFailed(sessionId: string, reason: string): Promise<void> {
    try {
      await prisma.session.update({
        where: { id: sessionId },
        data: {
          status: 'failed',
          endTime: new Date(),
          failure_reason: reason,
          failure_category: HUB_RESTART_CATEGORY,
        },
      });
    } catch (err: any) {
      this.log.error(`Failed to mark session ${sessionId} as failed: ${err.message}`);
    }
  }

  /**
   * Get statistics about current sessions
   */
  getStats(): { total: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {
      local: 0,
      remote: 0,
      cloud: 0,
    };

    for (const session of Array.from(this.sessionMap.values())) {
      const type = session.getType().toLowerCase();
      byType[type] = (byType[type] || 0) + 1;
    }

    return {
      total: this.sessionMap.size,
      byType,
    };
  }
}

// Export singleton for backward compatibility
// New code should use Container.get(SessionManager)
import { Container } from 'typedi';
export const SESSION_MANAGER = Container.get(SessionManager);
