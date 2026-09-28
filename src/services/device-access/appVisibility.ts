import { isDeviceVisible } from './deviceVisibility';

/**
 * Uploaded apps follow the device team rule, on the app's team: an admin or an
 * auth-disabled server (`teamIds` undefined) sees every app, anyone else sees
 * shared apps (no team) and their own teams' apps.
 *
 * A caller who may not see an app gets the same answer as for an unknown id,
 * on every route: listing leaves it out, download and delete 404 it with the
 * unknown body, and a session naming it by id is treated as naming nothing.
 */
export function canSeeApp<T extends { teamId?: string | null }>(
  app: T | null | undefined,
  teamIds: string[] | undefined,
): app is T {
  return !!app && isDeviceVisible(app.teamId, teamIds);
}

/**
 * The same rule as a Prisma `where` on App, so the list is filtered in the
 * query. Undefined for an admin: no filter. Combine it with other filters
 * under `AND`, never by spreading, so neither `OR` overwrites the other.
 */
export function visibleAppWhere(
  teamIds: string[] | undefined,
): { OR: Array<Record<string, unknown>> } | undefined {
  if (teamIds === undefined) return undefined;
  return { OR: [{ teamId: null }, { teamId: { in: teamIds } }] };
}
