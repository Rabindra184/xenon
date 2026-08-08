import { inspectManualLock, isManualLock } from '../../services/recording/manualLock';
import {
  isSelfManualLock,
  isOwnSession,
  type DeviceAccessDenyCode,
} from '../../services/device-access/deviceAccessPolicy';

export type StreamStartAction =
  | { action: 'proceed' }
  /** Manual lock with no live stream: an orphan. Clear it, then proceed. */
  | { action: 'reclaim' }
  | { action: 'deny'; code: DeviceAccessDenyCode; holderId: string };

export interface StreamStartConflictInput {
  udid: string;
  busy: boolean;
  sessionId: string | null | undefined;
  /** An in-memory iOS/Android stream session exists for this device. */
  hasLiveManualStream: boolean;
  sessionOwnerUserId?: string | null;
  actorUserId?: string;
  actorApiKeyId?: string;
  isAdmin: boolean;
}

const PROCEED: StreamStartAction = { action: 'proceed' };

/**
 * Conflict decision for POST /:udid/stream/start.
 *
 * Separate from evaluateDeviceAccess because "busy" means something different
 * here: a manual lock whose stream is gone is an orphan to reclaim rather than
 * a conflict, and starting a preview over your own Appium session is legitimate
 * (#149 — resolveBlockSessionId keeps the real session id, so the manual stream
 * coexists under the session's lock).
 *
 * "Mine" is judged via isSelfManualLock / isOwnSession from
 * deviceAccessPolicy.ts — the same helpers the /control mutation guard uses —
 * so there is exactly one definition of ownership in the codebase.
 */
export function decideStreamStartConflict(i: StreamStartConflictInput): StreamStartAction {
  if (!i.busy) return PROCEED;

  if (isManualLock(i.sessionId)) {
    // Orphan: lock persisted but nothing is serving (server restart, crashed
    // stop, H.264 stop that skipped unlock). Any caller may reclaim it.
    if (!i.hasLiveManualStream) return { action: 'reclaim' };
    if (i.isAdmin) return PROCEED;

    if (isSelfManualLock(i.sessionId, i.udid, i.actorUserId, i.actorApiKeyId)) return PROCEED;

    const asUser = inspectManualLock(i.sessionId, i.actorUserId, i.udid);
    if (asUser?.legacy) return PROCEED;

    return {
      action: 'deny',
      code: 'device_held_by_another_user',
      holderId: asUser?.actorId ?? '',
    };
  }

  // A real Appium session holds the device.
  if (i.isAdmin) return PROCEED;
  if (isOwnSession(i.sessionOwnerUserId, i.actorUserId)) return PROCEED;
  return { action: 'deny', code: 'device_in_use_by_session', holderId: i.sessionOwnerUserId ?? '' };
}
