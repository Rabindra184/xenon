/// <reference path="../types/express.d.ts" />
import type { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import log from '../logger';
import { isManualLock } from '../services/recording/manualLock';
import {
  controlAction,
  findControlDeviceInStore,
  lookupControlDevice,
  readControlUdid,
} from './controlDevice';
import { SessionOwnerResolver } from '../services/device-access/SessionOwnerResolver';
import {
  evaluateDeviceAccess,
  denyBody,
  ownershipUnavailableBody,
  isLeaseHolder,
  type DeviceAccessDecision,
  type LeaseHold,
} from '../services/device-access/deviceAccessPolicy';
import { leaseHoldFor } from '../services/device-access/leaseHold';
import { resolveActor } from '../services/device-access/actor';
import { heldHere, type HoldRow } from '../data-service/deviceClaims';
import { activeLeaseOn } from '../services/lease/activeLeases';

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
  'stream/leave', // the same check as stream/stop
  'stream/ticket', // mints a viewing credential; viewing is a read
];

/**
 * Reads that take the ownership check anyway.
 *
 * The guard is mutations-only by design — screenshots, the MJPEG stream and
 * page source stay open so the mosaic picker and monitoring can look at a busy
 * device. The entries here are the exceptions: every other read exposes device
 * *state*, while these return the contents of somebody else's work.
 *
 * - `clipboard` returns whatever the holder most recently copied, which is
 *   routinely a password, a 2FA code or a token. There is no monitoring use
 *   for reading a stranger's pasteboard.
 * - `logs` dumps `adb logcat`, which routinely carries auth tokens, deep-link
 *   URLs and PII from whatever app is under test. It was left open when this
 *   guard shipped; the logcat WebSocket then treated the same data as
 *   ownership-checked, which made that check decorative — a reader denied at
 *   the socket could just GET the identical bytes here.
 *
 * Keep this list short and justify every entry. Widening it re-opens the
 * "reads are cheap" assumption the mosaic depends on.
 */
export const OWNERSHIP_CHECKED_READS: readonly string[] = ['clipboard', 'logs'];

/**
 * Unguarded mutations that still take the lease rule: starting a preview
 * takes a hold on the phone. stream/start's own conflict handling knows
 * holds and sessions, not leases, and on a hub the call goes on to the
 * node, which knows nothing of the hub's leases. So a stranger is refused a
 * leased phone here, before either, and the lease holder passes on to it.
 */
export const LEASE_CHECKED_MUTATIONS: readonly string[] = ['stream/start'];

export interface DeviceAccessGuardDeps {
  findDevice?: (udid: string) => Promise<(HoldRow & { host?: string | null }) | null | undefined>;
  resolveSessionOwner?: (sessionId: string) => Promise<string | null>;
  describeHolder?: (holderId: string) => Promise<string | null>;
  /** The live SDK lease on a phone, by its actorId, or null. */
  findActiveLease?: (udid: string, host: string) => Promise<{ actorId: string } | null>;
  /** The user behind a lease's actorId. */
  resolveLeaseHolder?: (actorId: string) => Promise<string | null>;
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
  const findDevice = deps.findDevice ?? findControlDeviceInStore;
  const resolveSessionOwner =
    deps.resolveSessionOwner ?? ((sid: string) => Container.get(SessionOwnerResolver).ownerOf(sid));
  const describeHolder =
    deps.describeHolder ?? ((id: string) => Container.get(SessionOwnerResolver).displayName(id));
  const findActiveLease =
    deps.findActiveLease ?? ((udid: string, host: string) => activeLeaseOn(udid, host));
  const resolveLeaseHolder =
    deps.resolveLeaseHolder ??
    ((id: string) => Container.get(SessionOwnerResolver).leaseHolderOf(id));

  const unavailable = (res: Response) => res.status(503).json(ownershipUnavailableBody());

  return async function (req: Request, res: Response, next: NextFunction) {
    // Router-level middleware has no req.params; controlAction reads the path.
    // It lowercases, as Express routes case-insensitively: `Stream/Start`
    // still reaches stream/start's own richer handling, and `Clipboard`
    // cannot slip past the read check below.
    const action = controlAction(req);

    // Decide whether this request is in scope BEFORE touching the udid, so an
    // ordinary read (screenshot, stream, logs, page source) short-circuits here
    // exactly as it did when this guard was mutations-only.
    const leaseOnly = req.method === 'POST' && LEASE_CHECKED_MUTATIONS.includes(action);
    const inScope = STATE_CHANGING.has(req.method)
      ? !UNGUARDED_CONTROL_MUTATIONS.includes(action) || leaseOnly
      : req.method === 'GET' && OWNERSHIP_CHECKED_READS.includes(action);
    if (!action || !inScope) return next();

    // A udid segment that can't be percent-decoded is a malformed request,
    // not a server fault: readControlUdid has already answered 400.
    const udid = readControlUdid(req, res, 'deviceAccessGuard');
    if (udid === null) return;
    if (!udid) return next();

    const actor = resolveActor(req);
    if (!actor.userId) {
      return res.status(401).json({ success: false, error: 'unauthenticated' });
    }

    // Shared with deviceTeamGuard: one lookup per request for both guards.
    let device;
    try {
      device = await lookupControlDevice(res, udid, findDevice);
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

    if (leaseOnly) {
      if (actor.isAdmin) return next();
      let held: LeaseHold | null;
      try {
        held = await leaseHoldFor({ udid, host: device.host }, findActiveLease, resolveLeaseHolder);
      } catch (e: any) {
        log.error(`deviceAccessGuard: lease lookup failed for ${udid}: ${e?.message ?? e}`);
        return unavailable(res);
      }
      if (!held || isLeaseHolder(held, actor.userId, actor.apiKeyId)) return next();
      return deny(req, res, udid, actor.userId, {
        allow: false,
        code: 'device_held_by_another_user',
        holderId: held.holderUserId ?? '',
        heldBy: 'lease',
      });
    }

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

    let lease: LeaseHold | null = null;
    if (!actor.isAdmin) {
      try {
        lease = await leaseHoldFor(
          { udid, host: device.host },
          findActiveLease,
          resolveLeaseHolder,
        );
      } catch (e: any) {
        // A leased phone is held whatever `busy` says: not knowing whether a
        // lease holds it is not knowing who owns it.
        log.error(`deviceAccessGuard: lease lookup failed for ${udid}: ${e?.message ?? e}`);
        return unavailable(res);
      }
    }

    const decision = evaluateDeviceAccess({
      udid,
      // Not device.busy: a node's phone busy only by its node's report is
      // the node's to judge (heldHere).
      busy: heldHere(device),
      sessionId: device.session_id,
      sessionOwnerUserId,
      actorUserId: actor.userId,
      actorApiKeyId: actor.apiKeyId,
      isAdmin: actor.isAdmin,
      lease,
    });
    if (decision.allow) return next();
    return deny(req, res, udid, actor.userId, decision);
  };

  async function deny(
    req: Request,
    res: Response,
    udid: string,
    actorUserId: string,
    decision: Extract<DeviceAccessDecision, { allow: false }>,
  ) {
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
      `Device access denied: ${actorUserId} -> ${req.method} ${req.originalUrl} ` +
        `on ${udid} (${decision.code}, holder=${decision.holderId || 'unknown'})`,
    );
    return res
      .status(409)
      .json(denyBody(decision.code, decision.holderId, holderName, decision.heldBy));
  }
}
