import { prisma } from '../../prisma';
import { isDeviceVisible } from './deviceVisibility';

/** Who is asking, as `req.auth` carries it. `teamIds` undefined is an admin or an auth-disabled server. */
export interface SessionCaller {
  userId?: string;
  teamIds?: string[];
}

/**
 * Whether the caller may see a session, by REST's team rule on its phone:
 * - an admin (teamIds undefined) sees every session;
 * - anyone else sees a session whose phone is shared or on one of their teams
 *   (a udid on several hosts counts when any of its rows does, as
 *   filterRowsByVisibleDevice counts it);
 * - a session whose phone has no Device row (unplugged and reaped, or no udid
 *   recorded) is its owner's only, as recordings treat an unplugged phone.
 *
 * A caller who may not see a session must get the same answer as for an
 * unknown one.
 */
export async function canSeeSession(
  session: { device_udid: string | null; user_id?: string | null },
  caller: SessionCaller | undefined,
): Promise<boolean> {
  if (!caller || caller.teamIds === undefined) return true;
  const teamIds = caller.teamIds;
  const devices = session.device_udid
    ? await prisma.device.findMany({
        where: { udid: session.device_udid },
        select: { udid: true, teamId: true },
      })
    : [];
  if (devices.length === 0) return !!caller.userId && session.user_id === caller.userId;
  return devices.some((d: { teamId: string | null }) => isDeviceVisible(d.teamId, teamIds));
}

/**
 * The same rule as {@link canSeeSession}, as a Prisma `where` on Session, so a
 * list's `take` and a count apply to the caller's sessions only. Undefined for
 * an admin: no filter. Combine it with a handler's own filters under `AND`,
 * never by spreading, so neither `OR` overwrites the other.
 */
export async function visibleSessionWhere(
  caller: SessionCaller | undefined,
): Promise<{ OR: Array<Record<string, unknown>> } | undefined> {
  if (!caller || caller.teamIds === undefined) return undefined;
  const teamIds = caller.teamIds;
  const devices: Array<{ udid: string; teamId: string | null }> = await prisma.device.findMany({
    select: { udid: true, teamId: true },
  });
  const known = Array.from(new Set(devices.map((d) => d.udid)));
  const visible = Array.from(
    new Set(devices.filter((d) => isDeviceVisible(d.teamId, teamIds)).map((d) => d.udid)),
  );
  const OR: Array<Record<string, unknown>> = [{ device_udid: { in: visible } }];
  if (caller.userId) OR.push({ user_id: caller.userId, device_udid: { notIn: known } });
  return { OR };
}
