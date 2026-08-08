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

  const unavailable = (res: Response) =>
    res.status(503).json({
      success: false,
      error: 'device_ownership_unavailable',
      message: 'Could not verify device ownership. Try again.',
    });

  return async function (req: Request, res: Response, next: NextFunction) {
    if (!STATE_CHANGING.has(req.method)) return next();

    // Router-level middleware has no req.params, so read the path directly.
    // Inside the /control router req.path is `/<udid>/<action…>`.
    const parts = req.path.split('/').filter(Boolean);
    let udid: string;
    try {
      udid = decodeURIComponent(parts[0] ?? '');
    } catch (e: any) {
      // A udid segment that can't be percent-decoded is a malformed request,
      // not a server fault — respond here so it can't fall through unhandled
      // (Express 4 doesn't catch rejections thrown by async middleware).
      log.warn(`deviceAccessGuard: malformed udid segment in ${req.path}: ${e?.message ?? e}`);
      return res.status(400).json({ success: false, error: 'invalid_udid' });
    }
    const action = parts.slice(1).join('/');
    if (!udid || !action) return next();
    // Express routes case-insensitively; match the allowlist the same way so
    // e.g. `Stream/Start` still reaches stream/start's own richer handling
    // instead of falling into the generic ownership check below.
    if (UNGUARDED_CONTROL_MUTATIONS.includes(action.toLowerCase())) return next();

    const actor = resolveActor(req);
    if (!actor.userId) {
      return res.status(401).json({ success: false, error: 'unauthenticated' });
    }

    let device;
    try {
      device = await findDevice(udid);
    } catch (e: any) {
      // An authorization guard that cannot determine ownership must not allow
      // the request through: the handler runs its own separate device lookup,
      // so failing open here would skip the ownership check entirely whenever
      // this lookup — and only this lookup — has a transient hiccup.
      log.error(`deviceAccessGuard: device lookup failed for ${udid}: ${e?.message ?? e}`);
      return unavailable(res);
    }
    // Unknown device: there's no lock to violate, so the handler's own 404 is
    // the right answer. This is the one branch that intentionally falls
    // through instead of failing closed — every branch below needs a
    // resolved device to reason about ownership at all.
    if (!device) return next();

    let sessionOwnerUserId: string | null = null;
    if (device.busy && device.session_id && !isManualLock(device.session_id)) {
      try {
        sessionOwnerUserId = await resolveSessionOwner(device.session_id);
      } catch (e: any) {
        // Same reasoning as the device lookup above: not knowing who owns a
        // live session is exactly the case where we must not guess allow.
        log.error(
          `deviceAccessGuard: session owner lookup failed for ${device.session_id}: ${e?.message ?? e}`,
        );
        return unavailable(res);
      }
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

    // describeHolder is cosmetic — it only resolves a display name for the
    // deny message. A failure here must still deny (never flip to allow) but
    // must not hang the request either; fall back to no holder name.
    let holderName: string | null = null;
    if (decision.holderId) {
      try {
        holderName = await describeHolder(decision.holderId);
      } catch (e: any) {
        log.warn(
          `deviceAccessGuard: holder name lookup failed for ${decision.holderId}: ${e?.message ?? e}`,
        );
      }
    }
    log.warn(
      `Device access denied: ${actor.userId} -> ${req.method} ${req.originalUrl} ` +
        `on ${udid} (${decision.code}, holder=${decision.holderId || 'unknown'})`,
    );
    return res.status(409).json(denyBody(decision.code, decision.holderId, holderName));
  };
}
