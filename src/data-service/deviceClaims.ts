import { IDevice } from '../interfaces/IDevice';
import { isManualLock } from '../services/recording/manualLock';

/**
 * Why a phone is busy, on the server that allocates it.
 *
 * Allocation reads `busy` (findAndLockDevice takes a phone only where it is
 * false, in one conditional update). On a hub a node's phone is busy for one
 * of two reasons, each kept in its own columns so neither can erase the
 * other:
 *
 * - **The claim**, this server's: `claimedAt` (when allocation took the phone)
 *   and `claimSessionId` (the session's id, written when the session exists).
 *   A claim with no session id yet is *pending*: its session is being
 *   created, which can take minutes on a first driver install.
 * - **The node's report**: `nodeBusy`, what the node last said
 *   (`POST /xenon/api/register`). Always false for a phone this server drives.
 *
 * `busy` is claim OR report. No write that can clear it reads the row first:
 *
 * - A node reporting its phone free clears `busy` only where nothing of the
 *   hub's holds it (UNHELD: no claim, and no hold such as a preview or a
 *   recording in `session_id`), in one conditional update. A report sent
 *   before the hub's claim (every 30 s by default) can no longer undo it.
 * - A release names the claim it ends (ClaimRef): a session's id, or when a
 *   pending claim was taken. A stale release, for a session that ended while
 *   the phone went on to another, matches nothing. Then `busy` is cleared
 *   only where nothing else holds the phone (UNHELD), again one conditional
 *   update: a node still reporting it busy keeps it busy.
 * - The idle sweeper leaves a pending claim alone until
 *   PENDING_CLAIM_TIMEOUT_MS, whatever the new-command timeout.
 *
 * A server with no nodes (standalone, or a node itself) never has `nodeBusy`
 * set, so `busy` is its claim as it always was.
 *
 * Only a session's allocation takes a claim. A lease locks with `busy` alone,
 * as before; a manual hold (a preview, a recording) writes `session_id`.
 */

/**
 * How long a claim may wait for its session to be created before the idle
 * sweeper frees it: a create that never finished (the hub restarted during
 * it, or it hung). Well past a create's own budget: the phone's wait
 * (`deviceAvailabilityTimeoutMs`) comes before the claim, and a first
 * UiAutomator2 or WebDriverAgent install fits in a few minutes.
 */
export const PENDING_CLAIM_TIMEOUT_MS = 10 * 60_000;

/** Which claim a release ends. */
export type ClaimRef =
  /** A session's claim. A row from before claims (session_id only) counts. */
  | { sessionId: string }
  /**
   * A pending claim, by when it was taken. null is a phone allocated with no
   * claim (a leased one): it matches a row with no claim and no session.
   */
  | { claimedAt: number | null };

/** A claim whose session is still being created. */
export function isPendingClaim(device: Pick<IDevice, 'claimedAt' | 'claimSessionId'>): boolean {
  return device.claimedAt != null && device.claimSessionId == null;
}

/** A pending claim older than PENDING_CLAIM_TIMEOUT_MS. */
export function pendingClaimExpired(
  device: Pick<IDevice, 'claimedAt' | 'claimSessionId'>,
  now: number,
): boolean {
  return isPendingClaim(device) && now - (device.claimedAt as number) > PENDING_CLAIM_TIMEOUT_MS;
}

/** Prisma `where` (beside udid and host) for the claim `ref` names. */
export function claimWhere(ref: ClaimRef): Record<string, unknown> {
  if ('sessionId' in ref) {
    return {
      OR: [{ claimSessionId: ref.sessionId }, { claimSessionId: null, session_id: ref.sessionId }],
    };
  }
  if (ref.claimedAt == null) return { claimSessionId: null, claimedAt: null, session_id: null };
  return { claimSessionId: null, claimedAt: ref.claimedAt };
}

/** claimWhere as a predicate, for the in-memory store. */
export function holdsClaim(device: IDevice, ref: ClaimRef): boolean {
  if ('sessionId' in ref) {
    return (
      device.claimSessionId === ref.sessionId ||
      (device.claimSessionId == null && device.session_id === ref.sessionId)
    );
  }
  if (device.claimSessionId != null) return false;
  if (ref.claimedAt == null) return device.claimedAt == null && device.session_id == null;
  return device.claimedAt === ref.claimedAt;
}

/** No claim of this server's on the phone, pending or not. */
export const NO_CLAIM = { claimSessionId: null, claimedAt: null } as const;

export function hasNoClaim(device: IDevice): boolean {
  return device.claimSessionId == null && device.claimedAt == null;
}

/**
 * Nothing holds the phone: no claim, no session or manual hold, and no node
 * reporting it busy. Only then may a release clear `busy`.
 */
export const UNHELD = { ...NO_CLAIM, session_id: null, nodeBusy: false } as const;

export function isUnheld(device: IDevice): boolean {
  return hasNoClaim(device) && device.session_id == null && device.nodeBusy !== true;
}

/**
 * Who holds a node's phone there, from the node's report of it: its
 * `session_id` when that is a preview hold (`manual_<user>_<udid>`), else
 * null. A session the node runs is not a hold. The hub keeps it as
 * `nodeHold`, apart from its own `session_id`, and shows it; the node decides
 * access, so a stale value can change a label and nothing else.
 */
export function nodeHoldOf(reportedSessionId: unknown): string | null {
  return typeof reportedSessionId === 'string' && isManualLock(reportedSessionId)
    ? reportedSessionId
    : null;
}

/** The row fields heldHere reads. */
export interface HoldRow {
  busy?: boolean;
  nodeBusy?: boolean | null;
  session_id?: string | null;
  claimedAt?: number | null;
  claimSessionId?: string | null;
}

/**
 * Busy for a reason this server has on record: its claim, a session or hold
 * in `session_id`, or plain `busy` on a phone of its own. False for a node's
 * phone busy only by the node's report (`nodeBusy`), a preview the node
 * holds say: this server knows no holder for it, and the node, which does,
 * judges every call forwarded there with its own guard. An ownership check
 * reads this, not `busy`, or it fails closed on every such phone, refusing
 * the preview's own holder. A server with no nodes never has nodeBusy, so
 * for it this is `busy`.
 */
export function heldHere(device: HoldRow): boolean {
  if (!device.busy) return false;
  if (device.nodeBusy !== true) return true;
  return device.session_id != null || device.claimedAt != null || device.claimSessionId != null;
}

/** What ending a claim resets: the claim, and the session's bookkeeping. */
export const CLAIM_RESET = {
  ...NO_CLAIM,
  session_id: null,
  lastCmdExecutedAt: null,
  sessionStartTime: 0,
  newCommandTimeout: null,
  sessionProgress: '',
  owningSessionId: null,
  lockedAt: null,
} as const;
