/**
 * A lease's states, why one ends, and when one is live: the rules every
 * reader and writer in src/services/lease shares.
 *
 * `waiting → active → released | expired | ended`, and `waiting → expired`.
 * `expired` covers several causes, so each terminal write also records
 * `endReason` (LeaseEndReason). Through 2.36 only `ended` carried one, and
 * `expired` alone could mean the client gave up, its wait ran out, it missed
 * heartbeats or it passed its end.
 */

/** Every status a Lease row can have. */
export type LeaseStatus = 'waiting' | 'active' | 'released' | 'expired' | 'ended';

/** A lease that still holds its phones. */
export type LiveLeaseStatus = Extract<LeaseStatus, 'waiting' | 'active'>;

/** A lease that has ended. */
export type EndedLeaseStatus = Exclude<LeaseStatus, LiveLeaseStatus>;

export const LIVE_LEASE_STATUSES: readonly LiveLeaseStatus[] = ['waiting', 'active'];

/** Every ended status: such a row is deleted after its retention (leaseRetention.ts). */
export const ENDED_LEASE_STATUSES: readonly EndedLeaseStatus[] = ['released', 'expired', 'ended'];

const MEMBER_LOST = 'member_lost: ';

/**
 * Why a lease ended, as its row's `endReason` says.
 * - `client_released`: its client released it (`DELETE`), waiting or active.
 * - `wait_ran_out`: a waiting lease's `waitUntil` passed.
 * - `missed_heartbeats`: its client missed three heartbeats.
 * - `past_end`: an active lease passed its `expiresAt`.
 * - `unreadable_request`: a waiting lease whose stored request no pass can
 *   read, given up when its client next asked.
 * - `member_lost: <which, and why>`: a group lost a phone (status `ended`).
 * - `grant_revoked`: the sign-in grant an agent's lease was taken under was
 *   revoked (LeaseService.endLeasesOfGrant): `released` if it was active,
 *   `expired` if it was waiting.
 * - `user_not_active`: an agent's lease taken under no grant (a key pair on
 *   /xenon/mcp) whose user became Inactive or was deleted
 *   (LeaseService.endAgentLeasesOf), likewise `released` or `expired`.
 */
export type LeaseEndReason =
  | 'client_released'
  | 'wait_ran_out'
  | 'missed_heartbeats'
  | 'past_end'
  | 'unreadable_request'
  | 'grant_revoked'
  | 'user_not_active'
  | `member_lost: ${string}`;

/** A group's end for a lost member: `member_lost: member 1 (udid) disconnected`. */
export function memberLost(what: string): LeaseEndReason {
  return `${MEMBER_LOST}${what}`;
}

/** The columns a terminal write sets. */
export function endedData(
  status: EndedLeaseStatus,
  endReason: LeaseEndReason,
): { status: EndedLeaseStatus; endReason: LeaseEndReason } {
  return { status, endReason };
}

/**
 * The `reason` a 410 carries, as through 2.36: only for an `ended` group, in
 * words ("member 1 (u2) disconnected"), never the code.
 */
export function goneReason(lease: {
  status: string;
  endReason?: string | null;
}): string | undefined {
  if (lease.status !== 'ended' || !lease.endReason) return undefined;
  return lease.endReason.startsWith(MEMBER_LOST)
    ? lease.endReason.slice(MEMBER_LOST.length)
    : lease.endReason;
}

/**
 * A waiting lease still inside its wait, as a Prisma `where`. A `waitUntil`
 * of null waits for ever. The queue (LeaseQueue), the readers that ask the
 * lease table (activeLeases.ts) and allocation's lease keys all read it so.
 */
export function waitingWhere(now: number) {
  return { status: 'waiting', OR: [{ waitUntil: null }, { waitUntil: { gte: now } }] };
}

/** A live lease, as a Prisma `where`: active and not past `expiresAt`, or waitingWhere. */
export function liveLeaseWhere(now: number) {
  return { OR: [{ status: 'active', expiresAt: { gte: now } }, waitingWhere(now)] };
}

/**
 * What the heartbeat rule reads of a lease. `heartbeatFree` is an agent's
 * lease (taken through /xenon/mcp): its client sends no heartbeats, so it
 * never misses them, and it ends at its `expiresAt`, on release, or when its
 * grant is revoked.
 */
export interface HeartbeatFields {
  heartbeatSeconds: number | null;
  lastHeartbeatAt: number;
  heartbeatFree?: boolean | null;
}

/**
 * How long an agent's lease lasts when it asks for no duration: 15 minutes.
 * It sends no heartbeats, so its end is what lets go of a phone an agent
 * forgot; xenon_extend_device moves it out.
 */
export const MCP_LEASE_DEFAULT_MS = 900_000;

/**
 * The Lease columns that make a lease an agent's: `heartbeatFree` and the
 * grant, written only when set, so every other lease's row is as before.
 */
export function agentLeaseColumns(request: { heartbeatFree?: boolean; grantId?: string }): {
  heartbeatFree?: true;
  grantId?: string;
} {
  return {
    ...(request.heartbeatFree === true ? { heartbeatFree: true as const } : {}),
    ...(request.grantId ? { grantId: request.grantId } : {}),
  };
}

/** True when the client missed three heartbeats; never for a heartbeat-free lease. */
export function missedHeartbeats(lease: HeartbeatFields, now: number): boolean {
  if (lease.heartbeatFree === true) return false;
  const thresholdMs = (lease.heartbeatSeconds ?? 30) * 1000 * 3;
  return lease.lastHeartbeatAt + thresholdMs < now;
}

/** Why a lease ends now, and the words the log says it in. */
export interface LeaseEnd {
  reason: LeaseEndReason;
  text: string;
}

/**
 * Why an active lease is over, or null while it isn't. The end time first:
 * past it, heartbeats are refused, so a lease that expired has missed its
 * heartbeats too by the next sweep.
 */
export function activeLeaseEnd(
  lease: HeartbeatFields & { expiresAt: number },
  now: number,
): LeaseEnd | null {
  if (lease.expiresAt < now) {
    return { reason: 'past_end', text: `expired at ${new Date(lease.expiresAt).toISOString()}` };
  }
  if (missedHeartbeats(lease, now))
    return { reason: 'missed_heartbeats', text: 'missed heartbeats' };
  return null;
}

/**
 * Why a waiting lease gives up, or null while it waits: its wait ran out
 * (`waitUntil`; null never does), or its client missed three heartbeats.
 */
export function waiterEnd(
  lease: HeartbeatFields & { waitUntil: number | null },
  now: number,
): LeaseEnd | null {
  if (lease.waitUntil != null && lease.waitUntil < now) {
    return {
      reason: 'wait_ran_out',
      text: `its wait ran out at ${new Date(lease.waitUntil).toISOString()}`,
    };
  }
  if (missedHeartbeats(lease, now))
    return { reason: 'missed_heartbeats', text: 'missed heartbeats' };
  return null;
}
