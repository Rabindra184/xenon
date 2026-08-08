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
 * scope like 'nonadmin' cannot grant a bypass. (control.ts's stream/stop check
 * still uses the substring form — noted as a follow-up in the spec.)
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
