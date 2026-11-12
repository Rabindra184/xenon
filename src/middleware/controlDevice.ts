/// <reference path="../types/express.d.ts" />
import type { Request, Response } from 'express';
import log from '../logger';
import { DeviceStoreFactory } from '../data-service/device-store';
import { isDeviceVisible } from '../services/device-access/deviceVisibility';

/**
 * The device a /control request targets, as the router-level guards read it.
 *
 * deviceTeamGuard and deviceAccessGuard both need the device: one for its
 * team, the other for its lock. They must agree on which device that is, and
 * a member's request should not pay for the lookup twice. So both parse the
 * udid (and host) here and share one lookup per request, memoized on
 * `res.locals`. The hub's gate and the handlers read the same answer
 * (controlDeviceOf), so every layer acts on the one row the team guard
 * resolved.
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
  /** Why it is busy on a hub (deviceClaims.ts heldHere). */
  nodeBusy?: boolean | null;
  claimedAt?: number | null;
  claimSessionId?: string | null;
  /** Which server has the phone (nodePhoneControl). */
  udid?: string;
  host?: string | null;
  nodeId?: string | null;
  cloud?: unknown;
}

export type FindControlDevice = (udid: string) => Promise<ControlDevice | null | undefined>;

/** The store lookup both guards use unless a test injects its own. */
export const findControlDeviceInStore: FindControlDevice = (udid) =>
  DeviceStoreFactory.getStore().findDevice({ udid });

/**
 * A phone by udid and, when given, host (the spec's "The rule").
 *
 * A Device row is keyed by udid and host, and an emulator's udid repeats
 * across servers: a hub and its node can both report emulator-5554. So:
 *
 * - With a host: the row with exactly that udid and host (the row's `host`
 *   string as the device list reports it, no normalising), or none.
 * - Without one: among that udid's rows the caller can see, one is found,
 *   none is none, and two or more are ambiguous, naming their hosts in row
 *   order so the caller can ask again with one.
 *
 * A row the caller can't see (`isDeviceVisible`; `teamIds` undefined sees
 * every row) is never returned and never named: a host naming a hidden phone
 * is `none`, the unknown answer.
 */
export type PhoneLookup =
  | { kind: 'found'; device: ControlDevice }
  | { kind: 'none' }
  | { kind: 'ambiguous'; hosts: string[] };

export interface FindPhoneOptions {
  host?: string;
  /** The caller's teams; undefined is an admin or auth disabled. */
  teamIds?: string[];
}

/** Every row of a udid, on any host. */
export type FindPhoneRows = (udid: string) => Promise<ControlDevice[]>;

/** The store lookup findPhone uses unless a test injects its own. */
export const findPhoneRowsInStore: FindPhoneRows = (udid) =>
  DeviceStoreFactory.getStore().findDevices({ udid });

/**
 * Resolve a phone (see PhoneLookup). A lookup that throws rejects, for the
 * caller to answer. The hidden-device udid is none without a lookup.
 */
export async function findPhone(
  udid: string,
  opts: FindPhoneOptions,
  rows: FindPhoneRows = findPhoneRowsInStore,
): Promise<PhoneLookup> {
  if (udid === HIDDEN_DEVICE_UDID) return { kind: 'none' };
  const visible = (await rows(udid)).filter((row) =>
    isDeviceVisible(row.teamId ?? null, opts.teamIds),
  );
  if (opts.host !== undefined) {
    const device = visible.find((row) => row.host === opts.host);
    return device ? { kind: 'found', device } : { kind: 'none' };
  }
  if (visible.length === 0) return { kind: 'none' };
  if (visible.length === 1) return { kind: 'found', device: visible[0] };
  return { kind: 'ambiguous', hosts: visible.map((row) => row.host ?? '') };
}

/**
 * The phone a redeemed stream ticket names, for the sockets that redeem one
 * (the H.264 and logcat sockets, and the hub's relay of them to a node):
 * the row with the ticket's udid and `host`, or null.
 *
 * Unscoped, as a ticket caller is: stream/ticket is team-checked when it
 * mints, and the host it signs is the row it resolved. A ticket minted
 * without a host (before tickets carried one) resolves by udid alone, and a
 * udid two servers report is then no phone, never one of them: the ticket
 * doesn't say which it was minted for.
 */
export async function ticketPhone(
  udid: string,
  host: string | undefined,
  rows: FindPhoneRows = findPhoneRowsInStore,
): Promise<ControlDevice | null> {
  const found = await findPhone(udid, { host }, rows);
  return found.kind === 'found' ? found.device : null;
}

/** The 409 body for an ambiguous phone: the hosts the caller may name. */
export function ambiguousPhoneBody(
  udid: string,
  hosts: string[],
): { error: 'ambiguous_phone'; message: string; hosts: string[] } {
  return {
    error: 'ambiguous_phone',
    message: `Two servers have a phone named ${udid}. Name the one you mean with its host.`,
    hosts,
  };
}

/**
 * A `host` query parameter: undefined when absent, null when it isn't a
 * non-empty string (empty, repeated, an object), else the host.
 */
export function readHostParam(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) return null;
  return value;
}

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

/** The phone a /control request names: its udid and, when given, its host. */
export interface ControlTarget {
  udid: string;
  host?: string;
  /** A stream-ticket request: see ticketView. */
  ticket?: true;
  /** A stream-ticket request whose `?host=` isn't its ticket's host. */
  refused?: true;
}

/**
 * The host a request names its phone by, or null when `?host=` isn't a
 * non-empty string.
 *
 * A stream ticket names its phone, and its request never chooses another:
 * the host is the ticket's own (`ticketHost`, absent on a ticket minted
 * without one), never the query. A `?host=` that isn't the ticket's host
 * (any `?host=` when the ticket has none, an invalid one included) marks the
 * request `refused`, which resolves as no phone. Ticket callers are unscoped,
 * so honouring their query would reach another team's phone of the same
 * udid. Every other caller: `?host=`, else none.
 */
function requestTarget(req: Request): Omit<ControlTarget, 'udid'> | null {
  if (req.auth?.kind === 'stream-ticket') {
    const claim = req.auth.ticketHost;
    const ticketHost = typeof claim === 'string' && claim.length > 0 ? claim : undefined;
    const target: Omit<ControlTarget, 'udid'> = { ticket: true };
    if (ticketHost !== undefined) target.host = ticketHost;
    const asked = req.query?.host;
    if (asked !== undefined && asked !== ticketHost) target.refused = true;
    return target;
  }
  const host = readHostParam(req.query?.host);
  if (host === null) return null;
  return host === undefined ? {} : { host };
}

/**
 * A lookup as a stream-ticket request sees it: no phone when its `?host=`
 * was refused, and no phone for an ambiguous udid, never the 409 that lists
 * every server's host (hidden ones included: a ticket caller is unscoped).
 * Anyone else's lookup is unchanged.
 */
export function ticketView(
  found: PhoneLookup,
  seenBy: Pick<ControlTarget, 'ticket' | 'refused'> = {},
): PhoneLookup {
  if (!seenBy.ticket) return found;
  if (seenBy.refused || found.kind === 'ambiguous') return { kind: 'none' };
  return found;
}

/**
 * The decoded udid segment (`udid` is '' when the path has none) and the host,
 * or null once a 400 has been sent: `invalid_udid` for a segment that can't
 * be percent-decoded, `invalid_host` for a `?host=` that isn't one non-empty
 * string. Express 4 doesn't catch a rejection from async middleware, so the
 * caller must stop on null rather than let the error escape and hang the
 * request.
 */
export function readControlUdid(req: Request, res: Response, who: string): ControlTarget | null {
  const memo = res.locals[PARSED] as { path: string; target: ControlTarget } | undefined;
  if (memo && memo.path === req.path) return memo.target;
  let udid: string;
  try {
    udid = decodeURIComponent(segments(req)[0] ?? '');
  } catch (e: any) {
    log.warn(`${who}: malformed udid segment in ${req.path}: ${e?.message ?? e}`);
    res.status(400).json({ success: false, error: 'invalid_udid' });
    return null;
  }
  const rest = requestTarget(req);
  if (rest === null) {
    log.warn(`${who}: invalid host parameter on ${req.path}`);
    res.status(400).json({ success: false, error: 'invalid_host' });
    return null;
  }
  const target: ControlTarget = { udid, ...rest };
  res.locals[PARSED] = { path: req.path, target };
  return target;
}

interface LookupMemo {
  udid: string;
  host?: string;
  lookup: Promise<PhoneLookup>;
  /** The answer, once it has come: what the handlers read (controlDeviceOf). */
  settled?: PhoneLookup;
}

/**
 * Every row of a udid, from a lookup that returns one row per udid. For a
 * test that injects the older single-row lookup: one row is never ambiguous.
 */
export function rowsFromFindDevice(findDevice: FindControlDevice): FindPhoneRows {
  return async (udid) => {
    const device = await findDevice(udid);
    return device ? [device] : [];
  };
}

/**
 * The phone `udid` and `host` name (findPhone), resolved at most once per
 * request. The team guard resolves it with the caller's teams; the ownership
 * guard, the hub's gate and the handlers then read the same answer, so they
 * all act on one row. A lookup that throws rejects for every caller, and
 * each guard answers that with its own 503.
 *
 * The memo is keyed by udid and host, not by `teamIds` or `rows`: the first
 * call's lookup serves the whole request. The hidden-device udid is `none`
 * without a lookup: for an unknown udid the later layers get the team
 * guard's memoized answer, so a hidden phone and an unknown udid cost the
 * same single query.
 *
 * `seenBy` is the request's ControlTarget: a stream-ticket request's answer
 * is its ticketView, memoized as such, so no layer or handler ever sees a
 * row such a request may not reach.
 */
export function lookupControlDevice(
  res: Response,
  udid: string,
  host: string | undefined,
  teamIds: string[] | undefined,
  rows: FindPhoneRows = findPhoneRowsInStore,
  seenBy?: Pick<ControlTarget, 'ticket' | 'refused'>,
): Promise<PhoneLookup> {
  if (udid === HIDDEN_DEVICE_UDID) return Promise.resolve({ kind: 'none' });
  const memo = res.locals[LOOKUP] as LookupMemo | undefined;
  if (memo && memo.udid === udid && memo.host === host) return memo.lookup;
  const entry = { udid, host } as LookupMemo;
  entry.lookup = Promise.resolve()
    .then(() => findPhone(udid, { host, teamIds }, rows))
    .then((found) => ticketView(found, seenBy))
    .then((found) => {
      entry.settled = found;
      return found;
    });
  res.locals[LOOKUP] = entry;
  return entry.lookup;
}

/**
 * The row this request's phone resolved to, for the handlers: undefined when
 * it resolved to none (unknown, hidden, or a host no row has), when it was
 * ambiguous, or when no lookup ran. With `udid`, only the lookup of that
 * udid counts: the hidden-device udid never has a row.
 */
export function controlDeviceOf(res: Response, udid?: string): ControlDevice | undefined {
  if (udid === HIDDEN_DEVICE_UDID) return undefined;
  const memo = res.locals[LOOKUP] as LookupMemo | undefined;
  if (!memo || (udid !== undefined && memo.udid !== udid)) return undefined;
  return memo.settled?.kind === 'found' ? memo.settled.device : undefined;
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
