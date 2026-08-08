/// <reference path="../../types/express.d.ts" />
import type { Request } from 'express';

export interface DeviceAccessActor {
  userId?: string;
  apiKeyId?: string;
  isAdmin: boolean;
}

/**
 * Map a request to the identity ownership is judged against.
 *
 * `userId` is the authority — it is populated on every credential path.
 * `apiKeyId` is carried only so locks written by versions that keyed on
 * apiKey.id are still recognised as their owner's.
 *
 * Admin detection splits scopes on ',' rather than using String.includes, so a
 * scope like 'nonadmin' cannot grant a bypass. It also reads scopes from
 * req.auth first, which is the only place a cookie session's grant appears —
 * req.apiKey is never populated for one, so an ADMIN on the dashboard would
 * otherwise fail an admin check.
 *
 * Every ownership decision in the codebase resolves its actor here:
 * deviceAccessGuard, stream/start, stream/stop and the recordings router. If
 * you are about to derive an actor some other way, you are re-introducing the
 * split-brain this exists to remove.
 */
export function resolveActor(req: Request): DeviceAccessActor {
  const auth = req.auth;
  const rawScopes = auth?.scopes ?? req.apiKey?.scopes ?? '';
  const scopes = new Set(rawScopes.split(',').map((s) => s.trim()));
  return {
    userId: auth?.userId,
    apiKeyId: auth?.apiKeyId ?? req.apiKey?.id,
    isAdmin: auth?.role === 'SUPER_ADMIN' || scopes.has('admin'),
  };
}
