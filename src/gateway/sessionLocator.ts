import SessionType from '../enums/SessionType';
import type { IDevice } from '../interfaces/IDevice';
import type { XenonSession } from '../sessions/XenonSession';

/**
 * Where a session runs, for the hub's session gateway.
 *
 * The live answer is SESSION_MANAGER: every session this hub routes to a node
 * or a cloud is registered there when it is created. After a hub restart the
 * answer is the database: the session's own row (still open) names its phone,
 * and the phone's row names the server that drives it. Nothing here is a
 * routing table of its own; what is remembered is only the database's answer
 * for a session id, which cannot change.
 *
 * A session this hub does not know as remote is local: Appium's own routes
 * answer it, including with "invalid session id" when nobody has it.
 */

export type SessionLocation =
  | { kind: 'local' }
  | {
      kind: 'remote';
      /** The node's (or cloud's) WebDriver base URL. */
      url: string;
      /** A cloud provider, which is not a Xenon node and gets no hub token. */
      cloud: boolean;
      /** The registered session, when SESSION_MANAGER has it. */
      session?: XenonSession;
    };

export const LOCAL: SessionLocation = { kind: 'local' };

export interface SessionRow {
  device_udid: string;
  node_id: string | null;
}

export interface SessionLocatorDeps {
  /** SESSION_MANAGER.getSession */
  getSession(sessionId: string): XenonSession | undefined;
  /** The session's row, only while it is open (endTime null). */
  findOpenSession(sessionId: string): Promise<SessionRow | null>;
  /** The phone a session row names. */
  findDevice(udid: string, nodeId: string | null): Promise<IDevice | null>;
  /** Whether this server drives the phone itself. */
  isLocalDevice(device: IDevice): boolean;
  /** The WebDriver base URL of the server that drives the phone. */
  webDriverUrlOf(device: IDevice): Promise<string>;
  maxRemembered?: number;
}

export class SessionLocator {
  private readonly remembered = new Map<string, SessionLocation>();
  private readonly maxRemembered: number;

  constructor(private readonly deps: SessionLocatorDeps) {
    this.maxRemembered = deps.maxRemembered ?? 1_000;
  }

  async locate(sessionId: string): Promise<SessionLocation> {
    const live = this.deps.getSession(sessionId);
    if (live) return this.locationOf(live);

    const known = this.remembered.get(sessionId);
    if (known) return known;

    let location: SessionLocation = LOCAL;
    const row = await this.deps.findOpenSession(sessionId);
    if (row) {
      const device = await this.deps.findDevice(row.device_udid, row.node_id);
      if (device && !this.deps.isLocalDevice(device)) {
        location = {
          kind: 'remote',
          url: await this.deps.webDriverUrlOf(device),
          cloud: !!device.cloud,
        };
      }
    }
    this.remember(sessionId, location);
    return location;
  }

  forget(sessionId: string): void {
    this.remembered.delete(sessionId);
  }

  private locationOf(session: XenonSession): SessionLocation {
    const type = session.getType();
    const getUrl = (session as { getWebDriverUrl?: () => string }).getWebDriverUrl;
    if (type === SessionType.LOCAL || typeof getUrl !== 'function') return LOCAL;
    // A session recovered as remote whose phone is this server's own (a local
    // session from before a restart) must not be sent back to this server.
    if (this.deps.isLocalDevice(session.getDevice())) return LOCAL;
    return {
      kind: 'remote',
      url: getUrl.call(session),
      cloud: type === SessionType.CLOUD,
      session,
    };
  }

  private remember(sessionId: string, location: SessionLocation): void {
    if (this.remembered.size >= this.maxRemembered) {
      const oldest = this.remembered.keys().next().value as string;
      this.remembered.delete(oldest);
    }
    this.remembered.set(sessionId, location);
  }
}

/** The database side of SessionLocatorDeps, on a Prisma client. */
export function sessionRowsFrom(
  db: any,
): Pick<SessionLocatorDeps, 'findOpenSession' | 'findDevice'> {
  return {
    findOpenSession: async (sessionId) => {
      if (!sessionId) return null;
      const row = await db.session.findFirst({
        where: { id: sessionId, endTime: null },
        select: { device_udid: true, node_id: true },
      });
      return row ?? null;
    },
    findDevice: async (udid, nodeId) => {
      if (nodeId) {
        const onNode = await db.device.findFirst({ where: { udid, nodeId } });
        if (onNode) return onNode;
      }
      return (await db.device.findFirst({ where: { udid } })) ?? null;
    },
  };
}
