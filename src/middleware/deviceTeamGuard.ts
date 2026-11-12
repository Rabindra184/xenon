import type { Request, Response, NextFunction } from 'express';
import log from '../logger';
import { ownershipUnavailableBody } from '../services/device-access/deviceAccessPolicy';
import {
  FindControlDevice,
  FindPhoneRows,
  HIDDEN_DEVICE_UDID,
  ambiguousPhoneBody,
  findPhoneRowsInStore,
  lookupControlDevice,
  readControlUdid,
  replaceControlUdid,
  rowsFromFindDevice,
} from './controlDevice';

export interface DeviceTeamGuardDeps {
  /** Every row of a udid (findPhone's lookup). */
  findRows?: FindPhoneRows;
  /** A one-row-per-udid lookup, for a test; used only without findRows. */
  findDevice?: FindControlDevice;
}

/** What the guard rewrote, for restoreHiddenDeviceUrl to put back. */
const REWRITE = 'xenonHiddenDeviceRewrite';
interface Rewrite {
  original: string;
  rewritten: string;
}

/**
 * Keep every /control request away from a phone outside the caller's teams.
 *
 * Teams are a device boundary: a member may use the shared pool and their own
 * teams' phones, nothing else. Every method and every action goes through
 * here, including requests no route handles, with no exception list, so a
 * route added later is covered by default.
 *
 * A hidden phone must look exactly like one that doesn't exist, on every
 * request. So the guard doesn't answer it: it swaps the udid in `req.url` for
 * HIDDEN_DEVICE_UDID and lets the request go on. Every later layer then gives
 * its unknown-udid answer, down to the byte and the number of lookups: the
 * ownership guard, each handler's own 404 body, and Express's 404 and
 * automatic OPTIONS reply. `req.originalUrl` is untouched, so an answer that
 * echoes the path ("Cannot GET …", the API's JSON 404) echoes the real one,
 * exactly as it would for an unknown udid, and never shows the placeholder.
 *
 * The phone is resolved here by udid and host (findPhone, with the caller's
 * teams), once for the request: every later layer reads this answer. So:
 * - none (an unknown udid, a hidden phone, a host no visible row has): the
 *   swap above, for every caller. Nothing is hidden from an admin, and the
 *   handlers answer the placeholder exactly as they answer an unknown udid.
 * - ambiguous (two servers have the udid and no host was given): answered
 *   here, 409 ambiguous_phone naming the visible rows' hosts.
 * - found: on to the next layer.
 *
 * Mounted before deviceAccessGuard, whose 409 names the holder: that would
 * confirm the phone exists and say who has it.
 */
export function deviceTeamGuard(deps: DeviceTeamGuardDeps = {}) {
  const rows =
    deps.findRows ?? (deps.findDevice ? rowsFromFindDevice(deps.findDevice) : findPhoneRowsInStore);

  return async function (req: Request, res: Response, next: NextFunction) {
    const auth = (req as Request & { auth?: { userId?: string; teamIds?: string[] } }).auth;
    if (!auth) return res.status(401).json({ success: false, error: 'unauthenticated' });

    // Undefined for an admin, auth disabled or a stream ticket: every row.
    // Still resolved, so an admin is told about an ambiguous udid too.
    const teamIds = auth.teamIds;

    const target = readControlUdid(req, res, 'deviceTeamGuard');
    if (target === null) return; // 400 already sent
    const { udid, host } = target;
    if (!udid) return next();

    let found;
    try {
      found = await lookupControlDevice(res, udid, host, teamIds, rows);
    } catch (e: any) {
      // Fail closed. Letting this through would skip the team check whenever
      // the lookup had a hiccup.
      log.error(`deviceTeamGuard: device lookup failed for ${udid}: ${e?.message ?? e}`);
      return res.status(503).json(ownershipUnavailableBody());
    }
    if (found.kind === 'found') return next();
    if (found.kind === 'ambiguous') {
      return res.status(409).json(ambiguousPhoneBody(udid, found.hosts));
    }

    // Debug, not warn: a dashboard tile left open on a phone that has since
    // moved to another team polls stream/status every few seconds, and each
    // poll lands here. It is the expected answer, not an incident.
    if (teamIds !== undefined) {
      log.debug(
        `No visible device: ${auth.userId} -> ${req.method} ${req.originalUrl} on ${udid}` +
          (host === undefined ? '' : ` (host ${host})`),
      );
    }
    const rewrite: Rewrite = {
      original: req.url,
      rewritten: replaceControlUdid(req.url, HIDDEN_DEVICE_UDID),
    };
    res.locals[REWRITE] = rewrite;
    req.url = rewrite.rewritten;
    return next();
  };
}

/**
 * Put back the `req.url` deviceTeamGuard rewrote, once the control router has
 * fallen through. Express 4 doesn't restore `req.url` when a mounted router
 * exits, so without this every layer after /control would see the placeholder.
 *
 * Mount it after the router, at the parent:
 * `parent.use('/control', router, restoreHiddenDeviceUrl)`. There it runs only
 * after the router has passed the request on, so it can never come before a
 * control route. Never as a trailing `router.use` inside the router: a route
 * registered after that would receive the hidden phone's real udid.
 */
export function restoreHiddenDeviceUrl(req: Request, res: Response, next: NextFunction) {
  const rewrite = res.locals[REWRITE] as Rewrite | undefined;
  if (rewrite && req.url === rewrite.rewritten) req.url = rewrite.original;
  next();
}
