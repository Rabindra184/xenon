import type { Request, Response } from 'express';
import log from '../logger';
import { DeviceStoreFactory } from '../data-service/device-store';

/**
 * The device a /control request targets, as the router-level guards read it.
 *
 * deviceTeamGuard and deviceAccessGuard both need the device: one for its
 * team, the other for its lock. They must agree on which device that is, and
 * a member's request should not pay for the lookup twice. So both parse the
 * udid here and share one lookup per request, memoized on `res.locals`.
 * The handlers still do their own lookup.
 */

/**
 * The udid deviceTeamGuard puts in place of a phone the caller may not see,
 * so everything after it answers exactly as it would for an unknown udid.
 * Lowercase letters and underscores only, so it needs no percent-encoding.
 * No lookup through this module or control.ts's getDeviceInfo ever returns a
 * device for it, whatever the store holds.
 */
export const HIDDEN_DEVICE_UDID = '__xenon_hidden_device__';

/** What the guards read from a device row. */
export interface ControlDevice {
  teamId?: string | null;
  busy?: boolean;
  session_id?: string | null;
}

export type FindControlDevice = (udid: string) => Promise<ControlDevice | null | undefined>;

/** The store lookup both guards use unless a test injects its own. */
export const findControlDeviceInStore: FindControlDevice = (udid) =>
  DeviceStoreFactory.getStore().findDevice({ udid });

const PARSED = 'xenonControlUdid';
const LOOKUP = 'xenonControlDevice';

/** Split `/<udid>/<action…>` (router-level middleware has no req.params). */
function segments(req: Request): string[] {
  return req.path.split('/').filter(Boolean);
}

/**
 * The action after the udid, lowercased. Express matches routes
 * case-insensitively, so `Stream/Start` must be treated as `stream/start`.
 */
export function controlAction(req: Request): string {
  return segments(req).slice(1).join('/').toLowerCase();
}

/**
 * The decoded udid segment: '' when the path has none, or null once a 400
 * `invalid_udid` has been sent for a segment that can't be percent-decoded.
 * Express 4 doesn't catch a rejection from async middleware, so the caller
 * must stop on null rather than let the error escape and hang the request.
 */
export function readControlUdid(req: Request, res: Response, who: string): string | null {
  const memo = res.locals[PARSED] as { path: string; udid: string } | undefined;
  if (memo && memo.path === req.path) return memo.udid;
  let udid: string;
  try {
    udid = decodeURIComponent(segments(req)[0] ?? '');
  } catch (e: any) {
    log.warn(`${who}: malformed udid segment in ${req.path}: ${e?.message ?? e}`);
    res.status(400).json({ success: false, error: 'invalid_udid' });
    return null;
  }
  res.locals[PARSED] = { path: req.path, udid };
  return udid;
}

/**
 * The device for `udid`, looked up at most once per request. A lookup that
 * throws rejects for every caller, and each guard answers that with its own
 * 503. The hidden-device udid resolves to null without a lookup: for an
 * unknown udid the second guard gets the first guard's memoized result, so
 * both paths cost the same single query.
 */
export function lookupControlDevice(
  res: Response,
  udid: string,
  findDevice: FindControlDevice,
): Promise<ControlDevice | null | undefined> {
  if (udid === HIDDEN_DEVICE_UDID) return Promise.resolve(null);
  const memo = res.locals[LOOKUP] as
    | { udid: string; device: Promise<ControlDevice | null | undefined> }
    | undefined;
  if (memo && memo.udid === udid) return memo.device;
  const device = Promise.resolve().then(() => findDevice(udid));
  res.locals[LOOKUP] = { udid, device };
  return device;
}

/**
 * `url` with its first path segment (the udid, inside the /control router)
 * replaced by `udid`. The query string is kept.
 */
export function replaceControlUdid(url: string, udid: string): string {
  const q = url.indexOf('?');
  const path = q < 0 ? url : url.slice(0, q);
  const query = q < 0 ? '' : url.slice(q);
  const parts = path.split('/');
  const i = parts.findIndex((p) => p.length > 0);
  if (i < 0) return url;
  parts[i] = udid;
  return parts.join('/') + query;
}
