/**
 * Manual-lock ownership, client side.
 *
 * A manual lock is `manual_<actorId>_<udid>`, where actorId is the holder's
 * userId. Legacy `manual_<udid>` (no actor) is treated as foreign — we cannot
 * prove it is ours.
 */
export function isSelfManualLock(
  blockId: string | null | undefined,
  udid: string,
  myUserId: string | null,
): boolean {
  if (!myUserId || !blockId) return false;
  return blockId === `manual_${myUserId}_${udid}`;
}

interface RehydratableRow {
  udid: string;
  busy?: boolean;
  session_id?: string | null;
}

/**
 * Should mount-time rehydration re-adopt this device as one of my tiles?
 *
 * Only for a device *I* hold. The filter this replaces asked merely whether
 * some manual lock existed, so a second user's mosaic silently adopted a
 * device the first user was streaming — presenting a live tile, and an ×
 * button whose stream/stop then returns 403 because the lock is not theirs.
 */
export function isRehydratableTile(row: RehydratableRow, myUserId: string | null): boolean {
  if (!row.busy) return false;
  return isSelfManualLock(row.session_id, row.udid, myUserId);
}
