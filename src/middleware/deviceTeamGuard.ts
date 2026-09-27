import type { Request, Response, NextFunction } from 'express';
import log from '../logger';
import { isDeviceVisible } from '../services/device-access/deviceVisibility';
import { ownershipUnavailableBody } from '../services/device-access/deviceAccessPolicy';
import {
  FindControlDevice,
  controlAction,
  findControlDeviceInStore,
  lookupControlDevice,
  readControlUdid,
} from './controlDevice';

/**
 * The 404 a /control handler gives an unknown udid, where it is not the
 * plain-text default. A hidden phone must answer byte for byte like a missing
 * one, or the difference tells a member that another team owns that udid.
 * test/integration/team-visibility-control.spec.ts holds every route to this.
 */
export const NOT_FOUND_BODY_BY_ACTION: ReadonlyMap<string, unknown> = new Map([
  ['display', { status: 'error', message: 'Device not found' }],
  ['appium-session', { status: 'error', message: 'Device not found' }],
]);
const DEFAULT_NOT_FOUND_BODY = 'Device not found';

export interface DeviceTeamGuardDeps {
  findDevice?: FindControlDevice;
}

/**
 * Refuse any /control request against a phone outside the caller's teams.
 *
 * Teams are a device boundary: a member may use the shared pool and their own
 * teams' phones, nothing else. Every method and every action goes through
 * here — reads, mutations, and the stream actions the ownership guard skips —
 * with no exception list, so a route added later is covered by default.
 *
 * A phone the caller can't see gets the handler's own "unknown device" 404,
 * never a 403 or 409: nothing may reveal that another team's phone exists.
 * Mounted before deviceAccessGuard for the same reason: that guard's 409 names
 * the holder, which would confirm the phone exists and say who is using it.
 */
export function deviceTeamGuard(deps: DeviceTeamGuardDeps = {}) {
  const findDevice = deps.findDevice ?? findControlDeviceInStore;

  return async function (req: Request, res: Response, next: NextFunction) {
    const auth = (req as Request & { auth?: { userId?: string; teamIds?: string[] } }).auth;
    if (!auth) return res.status(401).json({ success: false, error: 'unauthenticated' });

    // Unscoped (admin, auth disabled, a stream ticket): nothing to check, and
    // no reason to pay for a device lookup on every admin request.
    const teamIds = auth.teamIds;
    if (teamIds === undefined) return next();

    const udid = readControlUdid(req, res, 'deviceTeamGuard');
    if (udid === null) return; // 400 already sent
    if (!udid) return next();

    // Shared with deviceAccessGuard: one lookup per request for both guards.
    let device;
    try {
      device = await lookupControlDevice(res, udid, findDevice);
    } catch (e: any) {
      // Fail closed. The handler does its own lookup, so letting this through
      // would skip the team check whenever only this lookup had a hiccup.
      log.error(`deviceTeamGuard: device lookup failed for ${udid}: ${e?.message ?? e}`);
      return res.status(503).json(ownershipUnavailableBody());
    }
    // Unknown device: the handler's own 404 is the answer, and the hidden case
    // below imitates it.
    if (!device) return next();
    if (isDeviceVisible(device.teamId, teamIds)) return next();

    log.warn(
      `Device hidden by team: ${auth.userId} -> ${req.method} ${req.originalUrl} ` +
        `on ${udid} (device team ${device.teamId})`,
    );
    return res
      .status(404)
      .send(NOT_FOUND_BODY_BY_ACTION.get(controlAction(req)) ?? DEFAULT_NOT_FOUND_BODY);
  };
}
