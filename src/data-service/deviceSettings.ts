import { IPluginArgs } from '../interfaces/IPluginArgs';
import { devicesClearedAtBoot, LocalDeviceHosts } from '../device-managers/localDeviceHosts';
import log from '../logger';
import { IDeviceStore } from './device-store.interface';
import { SETTING_FIELDS } from './deviceFieldOwners';

/**
 * The settings people give a phone, kept apart from its Device row.
 *
 * A phone's Device row is deleted whenever the phone goes: unplugged or
 * rebooted, offline or unauthorized in adb, an iPhone detached, a simulator
 * no longer reported, a restart of the server, and on a hub its node gone or
 * missing one health probe. Through 2.13 that row was the only place an admin's
 * team, tags and maintenance, and a member's reservation, were kept, so each
 * of those reset them. A team is a device boundary
 * (services/device-access/deviceVisibility.ts): a team's phone came back in
 * the shared pool, visible to every member.
 *
 * So a write of a setting column (SETTING_FIELDS) through the store's
 * updateDevice is also saved in DeviceSetting, before the row is written, and
 * a new row for the phone starts from what is saved, in the write that
 * creates it: no moment exists in which the phone is listed without its team.
 *
 * - **Keyed as the row is**, by udid and host, never by udid alone. An
 *   emulator's udid repeats on every machine that runs one, and a hub and a
 *   node on one Mac both list the same iPhone, each under its own host. Not
 *   by nodeId either: a server makes a new one at every start. A phone that
 *   comes back under another host (its node's address changed) is a new
 *   phone.
 * - **On a hub**, the settings of a node's phone are the hub's, saved by the
 *   hub's own writes. A node's report never writes them
 *   (deviceFieldOwners.ts), on a new row or a known one.
 * - **Reservations are kept until they end**, not ended when the phone goes.
 *   A reservation lasts at most a day and has its holder; a phone rebooted
 *   during it (often by the holder) used to come back free for anyone's
 *   session. One that ended while the phone was away is not restored.
 *   Leases, the newer way to hold a phone, live in their own table and
 *   outlived the row already.
 * - **Forgetting them** is `removeDevicesFromDatabaseBeforeRunningThePlugin`:
 *   at start, the saved settings of the phones the server clears go too.
 */

/**
 * A phone's settings (SETTING_FIELDS), as a store keeps them: Prisma keeps
 * tags as JSON text, the in-memory store as an array.
 */
export interface SavedSettings {
  teamId?: string | null;
  tags?: unknown;
  userBlocked?: boolean | null;
  reservationReason?: string | null;
  reservedBy?: string | null;
  reservedByUserId?: string | null;
  reservedUntil?: number | null;
}

/**
 * The setting columns a new row for the phone starts with: all of them, so
 * what was cleared stays cleared, and a reservation only while it holds.
 */
export function restoredColumns(saved: SavedSettings, now: number): Record<string, unknown> {
  const holds = typeof saved.reservedUntil === 'number' && saved.reservedUntil > now;
  return {
    teamId: saved.teamId ?? null,
    // A copy: the in-memory store keeps the array itself.
    tags: Array.isArray(saved.tags) ? [...saved.tags] : (saved.tags ?? null),
    userBlocked: saved.userBlocked === true,
    reservationReason: holds ? (saved.reservationReason ?? null) : null,
    reservedBy: holds ? (saved.reservedBy ?? null) : null,
    reservedByUserId: holds ? (saved.reservedByUserId ?? null) : null,
    reservedUntil: holds ? saved.reservedUntil : null,
  };
}

/** Whether two sets of setting columns differ (restoredColumns' shape). */
export function settingsDiffer(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return SETTING_FIELDS.some((field) => JSON.stringify(a[field]) !== JSON.stringify(b[field]));
}

function hasTags(tags: unknown): boolean {
  if (tags == null) return false;
  if (Array.isArray(tags)) return tags.length > 0;
  return tags !== '' && tags !== '[]';
}

/** Whether a row carries a setting that is worth keeping (adoptSettings). */
export function hasSettings(row: SavedSettings, now: number): boolean {
  return (
    row.teamId != null ||
    row.userBlocked === true ||
    hasTags(row.tags) ||
    (typeof row.reservedUntil === 'number' && row.reservedUntil > now)
  );
}

/**
 * The device table as a server starts. It forgets the phones
 * devicesClearedAtBoot names, but first saves the settings of rows that have
 * none saved (rows written through 2.13 kept them only on the row). With
 * `removeDevicesFromDatabaseBeforeRunningThePlugin`, the saved settings of
 * those phones are forgotten with them.
 */
export async function resetDevicesAtBoot(
  store: IDeviceStore,
  args: Pick<IPluginArgs, 'hub' | 'removeDevicesFromDatabaseBeforeRunningThePlugin'>,
  local: LocalDeviceHosts,
): Promise<void> {
  const cleared = devicesClearedAtBoot(args, local);
  const adopted = await store.adoptSettings();
  if (adopted > 0) {
    log.info(`Saved the team, tags, maintenance or reservation of ${adopted} phone(s)`);
  }
  if (args.removeDevicesFromDatabaseBeforeRunningThePlugin) {
    await store.forgetSettings(cleared);
    log.info(
      'removeDevicesFromDatabaseBeforeRunningThePlugin is on: forgot the saved settings of ' +
        (cleared ? "this server's own phones" : 'every phone'),
    );
  }
  await store.clearStorage(cleared);
}
