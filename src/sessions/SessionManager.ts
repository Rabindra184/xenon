import { Service } from 'typedi';
import { prisma } from '../prisma';
import log from '../logger';
import { RemoteSession } from './RemoteSession';
import { CloudSession } from './CloudSession';
import { XenonSession } from './XenonSession';
import { IDevice } from '../interfaces/IDevice';
import { DeviceStoreFactory } from '../data-service/device-store';
import { nodeUrl } from '../helpers';
import { getXenonCapabilities } from '../XenonCapabilityManager';

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
  async recoverActiveSessions(currentNodeId: string, nodeBasePath: string): Promise<number> {
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

          // Check if this session was on THE CURRENT NODE (LocalSession)
          const isLocalSession =
            dbSession.node_id === currentNodeId || device.nodeId === currentNodeId;

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

          const baseUrl = nodeUrl(device, nodeBasePath);

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

          // Add to in-memory map
          this.addSession(dbSession.id, recoveredSession);
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
          failure_category: 'HUB_RESTART',
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
