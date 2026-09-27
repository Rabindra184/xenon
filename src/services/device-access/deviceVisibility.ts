/**
 * Whether a caller can see a device, by team.
 *
 * The team rule, stated once for every per-device decision: the /control team
 * guard, reservations, and `filterRowsByVisibleDevice` (which the session,
 * recording and reservation lists use). The device stores state the same rule
 * as a filter (`callerTeamIds`), and so do the /grid listings; keep them in
 * step with this.
 *
 * - `teamIds === undefined` is an admin or an auth-disabled server, and sees
 *   everything. That is the only way to be unscoped. `resolveActor().isAdmin`
 *   is deliberately not an input: it also counts an `admin` scope, and a guard
 *   that honoured one while the device list did not would let a caller drive a
 *   phone the list hides from them.
 * - A device with no team is the shared pool, which everyone sees — including
 *   a member in no team (`teamIds === []`).
 * - Otherwise the device's team must be one of the caller's.
 *
 * Falsy rather than strictly null for "no team", matching the listing filters
 * (`!d.teamId` in grid.ts). The team assignment route never writes an empty
 * string, so the two readings only differ on data that cannot exist.
 */
export function isDeviceVisible(
  deviceTeamId: string | null | undefined,
  teamIds: string[] | undefined,
): boolean {
  if (teamIds === undefined) return true;
  if (!deviceTeamId) return true;
  return teamIds.includes(deviceTeamId);
}
