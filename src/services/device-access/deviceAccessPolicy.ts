import { inspectManualLock } from '../recording/manualLock';

/**
 * Access policy for /control mutations.
 *
 * Pure by design: no Express, no Prisma, no Container. The middleware
 * (src/middleware/deviceAccessGuard.ts) does the I/O and hands plain data in,
 * so the whole truth table is unit-testable without a device or a database.
 *
 * Ownership is keyed on the *user*, not the credential. `req.apiKey` is never
 * populated for dashboard cookie sessions, so a key-based identity would deny
 * a user their own device the moment they switched credential paths, and could
 * never match Session.api_key_id -> ApiKey.userId.
 */
export type DeviceAccessDenyCode = 'device_held_by_another_user' | 'device_in_use_by_session';

export interface DeviceAccessInput {
  udid: string;
  busy: boolean;
  /** device.session_id — a manual lock, an Appium session id, or null. */
  sessionId: string | null | undefined;
  /** Resolved owner of an Appium session id. null when unattributable. */
  sessionOwnerUserId?: string | null;
  actorUserId?: string;
  /**
   * The caller's current API-key id. Only used to recognise locks written by
   * versions that keyed on apiKey.id. Locks are ephemeral device-row state, so
   * this tolerance can be dropped a release after ship.
   */
  actorApiKeyId?: string;
  isAdmin: boolean;
}

export type DeviceAccessDecision =
  | { allow: true }
  | { allow: false; code: DeviceAccessDenyCode; holderId: string };

export interface DenyBody {
  success: false;
  error: DeviceAccessDenyCode;
  message: string;
  holder?: { userId: string; name: string | undefined };
}

const ALLOW: DeviceAccessDecision = { allow: true };

/**
 * True when a manual lock belongs to the caller. Checks BOTH candidate
 * identities: locks are written keyed on userId, but versions before this
 * change keyed them on apiKey.id. Collapsing this to a single
 * inspectManualLock call silently drops that upgrade tolerance.
 */
export function isSelfManualLock(
  sessionId: string | null | undefined,
  udid: string,
  actorUserId: string | undefined,
  actorApiKeyId: string | undefined,
): boolean {
  const asUser = inspectManualLock(sessionId, actorUserId, udid);
  const asKey = inspectManualLock(sessionId, actorApiKeyId, udid);
  return !!(asUser?.self || asKey?.self);
}

/** True when the caller owns the running Appium session. */
export function isOwnSession(
  sessionOwnerUserId: string | null | undefined,
  actorUserId: string | undefined,
): boolean {
  const owner = sessionOwnerUserId ?? '';
  return !!(owner && actorUserId && owner === actorUserId);
}

export function evaluateDeviceAccess(input: DeviceAccessInput): DeviceAccessDecision {
  if (input.isAdmin) return ALLOW;
  if (!input.busy) return ALLOW;

  const asUser = inspectManualLock(input.sessionId, input.actorUserId, input.udid);
  if (asUser) {
    // Ownerless orphan. stream/stop already lets any caller clear one; denying
    // here would strand the device for everybody.
    if (asUser.legacy) return ALLOW;
    if (isSelfManualLock(input.sessionId, input.udid, input.actorUserId, input.actorApiKeyId)) {
      return ALLOW;
    }
    return { allow: false, code: 'device_held_by_another_user', holderId: asUser.actorId };
  }

  // Not a manual lock: a real Appium session holds the device (or the row is
  // busy with no id at all, which is an inconsistent state we fail closed on).
  const owner = input.sessionOwnerUserId ?? '';
  if (isOwnSession(input.sessionOwnerUserId, input.actorUserId)) return ALLOW;
  return { allow: false, code: 'device_in_use_by_session', holderId: owner };
}

export interface OwnershipUnavailableBody {
  success: false;
  error: 'device_ownership_unavailable';
  message: string;
}

/**
 * 503 body for "we could not work out who owns this device".
 *
 * Two endpoints fail closed on the same fault (the /control mutation guard and
 * stream/start), and they must answer identically — a client that special-cases
 * `device_ownership_unavailable` should not have to care which one it hit. Kept
 * next to denyBody so the whole deny/unavailable vocabulary lives in one file.
 */
export function ownershipUnavailableBody(): OwnershipUnavailableBody {
  return {
    success: false,
    error: 'device_ownership_unavailable',
    message: 'Could not verify device ownership. Try again.',
  };
}

export function denyBody(
  code: DeviceAccessDenyCode,
  holderId: string,
  holderName: string | null,
): DenyBody {
  const who = holderName || 'another user';
  const message =
    code === 'device_held_by_another_user'
      ? `Device is being controlled by ${who}. Ask them to release it, or use an admin key to force-release.`
      : `Device is in use by an Appium session owned by ${who}.`;
  return {
    success: false,
    error: code,
    message,
    holder: holderId ? { userId: holderId, name: holderName ?? undefined } : undefined,
  };
}
