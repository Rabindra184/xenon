/**
 * Manual-lock identity model.
 *
 * Block-id format used when a dashboard caller (mosaic preview, recording,
 * or single-device control) takes a soft lock on a device:
 *
 *     manual_<actorId>_<udid>
 *
 * - `actorId` is the API-key id of the caller (req.apiKey.id). Stable per
 *   user/key, comes from the Prisma ApiKey row.
 * - `udid` is the device the lock applies to.
 *
 * Decoding rules (ambiguity-free because the udid is always known at check
 * time): if blockId starts with `manual_` and ends with `_${udid}`, the
 * middle section is the actorId.
 *
 * Locks written by older code (`manual_<udid>`, no actor) are recognised as
 * `legacy` — never self, treated as foreign.
 */

const PREFIX = 'manual_';

export function formatManualLock(actorId: string, udid: string): string {
  if (!actorId) {
    throw new Error('formatManualLock: actorId is required');
  }
  return `${PREFIX}${actorId}_${udid}`;
}

export interface ManualLock {
  /** True if the lock was written by *this* actor for *this* device. */
  self: boolean;
  /** Extracted actorId, if the lock has the new format. Empty for legacy. */
  actorId: string;
  /** True for legacy `manual_<udid>` locks with no actor field. */
  legacy: boolean;
}

/**
 * Inspect a block-id against an actor + udid. Returns null when the block
 * isn't a manual-lock at all (e.g. an Appium session id).
 */
export function inspectManualLock(
  blockId: string | undefined | null,
  actorId: string | undefined,
  udid: string,
): ManualLock | null {
  if (!blockId || !blockId.startsWith(PREFIX)) return null;
  const tail = blockId.slice(PREFIX.length);
  // Legacy: `manual_<udid>` — no actor portion.
  if (tail === udid) {
    return { self: false, actorId: '', legacy: true };
  }
  // New: `manual_<actorId>_<udid>`.
  const suffix = `_${udid}`;
  if (tail.endsWith(suffix)) {
    const lockActor = tail.slice(0, tail.length - suffix.length);
    if (lockActor.length > 0) {
      return {
        self: !!actorId && lockActor === actorId,
        actorId: lockActor,
        legacy: false,
      };
    }
  }
  // Some other manual_-prefixed marker we don't recognise — treat foreign.
  return { self: false, actorId: '', legacy: false };
}

/** True iff `blockId` is a manual lock owned by `actorId` for `udid`. */
export function isOwnedBy(
  blockId: string | undefined | null,
  actorId: string | undefined,
  udid: string,
): boolean {
  return inspectManualLock(blockId, actorId, udid)?.self === true;
}
