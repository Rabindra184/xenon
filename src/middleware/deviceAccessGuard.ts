/// <reference path="../types/express.d.ts" />
import type { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import log from '../logger';
import { DeviceStoreFactory } from '../data-service/device-store';
import { isManualLock } from '../services/recording/manualLock';
import { SessionOwnerResolver } from '../services/device-access/SessionOwnerResolver';
import { evaluateDeviceAccess, denyBody } from '../services/device-access/deviceAccessPolicy';
import { resolveActor } from '../services/device-access/actor';

const STATE_CHANGING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/**
 * Mutations under /control that this guard must NOT handle.
 *
 * Every entry needs a reason. Adding one without a reason re-opens the hole
 * this guard exists to close.
 */
export const UNGUARDED_CONTROL_MUTATIONS: readonly string[] = [
  'stream/start', // own conflict handling — see app/routers/streamStartConflict.ts
  'stream/stop', // richer check already: self | legacy | admin, plus orphan release
  'stream/ticket', // mints a viewing credential; viewing is a read
];

export interface DeviceAccessGuardDeps {
  findDevice?: (
    udid: string,
  ) => Promise<{ busy?: boolean; session_id?: string | null } | null | undefined>;
  resolveSessionOwner?: (sessionId: string) => Promise<string | null>;
  describeHolder?: (holderId: string) => Promise<string | null>;
}

/**
 * Refuse /control mutations against a device somebody else holds.
 *
 * Guards by HTTP method rather than by an enumerated path list, so an endpoint
 * added later is protected by default. That property is the whole point: the
 * gap this closes existed because ownership had to be remembered in ~20
 * handlers and was remembered in none of them.
 */
export function deviceAccessGuard(deps: DeviceAccessGuardDeps = {}) {
  const findDevice =
    deps.findDevice ?? ((udid: string) => DeviceStoreFactory.getStore().findDevice({ udid }));
  const resolveSessionOwner =
    deps.resolveSessionOwner ?? ((sid: string) => Container.get(SessionOwnerResolver).ownerOf(sid));
  const describeHolder =
    deps.describeHolder ?? ((id: string) => Container.get(SessionOwnerResolver).displayName(id));

  return async function (req: Request, res: Response, next: NextFunction) {
    if (!STATE_CHANGING.has(req.method)) return next();

    // Router-level middleware has no req.params, so read the path directly.
    // Inside the /control router req.path is `/<udid>/<action…>`.
    const parts = req.path.split('/').filter(Boolean);
    const udid = decodeURIComponent(parts[0] ?? '');
    const action = parts.slice(1).join('/');
    if (!udid || !action) return next();
    if (UNGUARDED_CONTROL_MUTATIONS.includes(action)) return next();

    const actor = resolveActor(req);
    if (!actor.userId) {
      return res.status(401).json({ success: false, error: 'unauthenticated' });
    }

    let device;
    try {
      device = await findDevice(udid);
    } catch (e: any) {
      log.warn(`deviceAccessGuard: device lookup failed for ${udid}: ${e?.message ?? e}`);
      return next(); // never break control on a store hiccup; the handler 404s or errors
    }
    if (!device) return next(); // handler owns the 404

    let sessionOwnerUserId: string | null = null;
    if (device.busy && device.session_id && !isManualLock(device.session_id)) {
      sessionOwnerUserId = await resolveSessionOwner(device.session_id);
    }

    const decision = evaluateDeviceAccess({
      udid,
      busy: !!device.busy,
      sessionId: device.session_id,
      sessionOwnerUserId,
      actorUserId: actor.userId,
      actorApiKeyId: actor.apiKeyId,
      isAdmin: actor.isAdmin,
    });
    if (decision.allow) return next();

    const holderName = decision.holderId ? await describeHolder(decision.holderId) : null;
    log.warn(
      `Device access denied: ${actor.userId} -> ${req.method} ${req.originalUrl} ` +
        `on ${udid} (${decision.code}, holder=${decision.holderId || 'unknown'})`,
    );
    return res.status(409).json(denyBody(decision.code, decision.holderId, holderName));
  };
}
