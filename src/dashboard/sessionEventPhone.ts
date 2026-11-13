import { Container } from 'typedi';
import log from '../logger';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { SocketServer } from '../services/SocketServer';
import { findPhoneRowsInStore, type FindPhoneRows } from '../middleware/controlDevice';

/** What a session event's scope names: the phone's udid and, when found, its host. */
export interface SessionEventPhone {
  udid: string | undefined;
  host?: string;
}

/** The parts of a Session row that say where it ran. The table has no host column. */
export interface SessionPhoneRow {
  device_udid?: string | null;
  node_id?: string | null;
}

/**
 * The phone a session's live event is about, for its scope. An emulator's
 * udid repeats across servers, so the event names the host too:
 *
 * 1. the phone the session holds (`held`, else its device in SESSION_MANAGER);
 * 2. else the one Device row of the session's udid on the session's node
 *    (`node_id`), looked up only while a team-scoped dashboard is connected,
 *    since the host only decides who gets the event;
 * 3. else the udid alone, which DeviceTeamResolver resolves as findPhone
 *    does: its one row, and a udid two rows have reaches admins only.
 *
 * Never throws: a failed lookup is the udid alone.
 */
export async function sessionEventPhone(
  sessionId: string,
  row: SessionPhoneRow | null | undefined,
  opts: { held?: { udid?: string; host?: string | null } | null; rows?: FindPhoneRows } = {},
): Promise<SessionEventPhone> {
  const held = opts.held ?? heldDevice(sessionId);
  const udid = row?.device_udid || held?.udid || undefined;
  if (!udid) return { udid: undefined };
  if (held?.host && held.udid === udid) return { udid, host: held.host };

  const nodeId = row?.node_id;
  if (!nodeId || !Container.get(SocketServer).hasScopedDashboard()) return { udid };
  try {
    const onNode = (await (opts.rows ?? findPhoneRowsInStore)(udid)).filter(
      (r) => r.nodeId === nodeId && r.host,
    );
    return onNode.length === 1 ? { udid, host: onNode[0].host as string } : { udid };
  } catch (err: any) {
    log.warn(`[Dashboard] No phone row for session ${sessionId}'s event: ${err?.message ?? err}`);
    return { udid };
  }
}

function heldDevice(sessionId: string): { udid?: string; host?: string | null } | undefined {
  try {
    return SESSION_MANAGER.getSession(sessionId)?.getDevice();
  } catch {
    return undefined;
  }
}
