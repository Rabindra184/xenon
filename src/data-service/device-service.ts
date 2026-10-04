import { IDevice } from '../interfaces/IDevice';
import { IDeviceFilterOptions } from '../interfaces/IDeviceFilterOptions';
import log from '../logger';
import { setUtilizationTime } from '../device-utils';
import { DeviceStoreFactory } from './device-store';
import { Container } from 'typedi';
import { CircuitBreaker } from './CircuitBreaker';

import { NotificationService } from '../services/NotificationService';
import { AddDevicesOptions, IDeviceStore } from './device-store.interface';
import { discoveryChanges } from './deviceFieldOwners';
import { CLAIM_RESET, ClaimRef } from './deviceClaims';
import { SocketServer } from '../services/SocketServer';
import { prisma } from '../prisma';
import { isManualLock, resolveBlockSessionId } from '../services/recording/manualLock';
import { isDeviceVisible } from '../services/device-access/deviceVisibility';
import { DeviceTeamResolver } from '../services/device-access/DeviceTeamResolver';
import { activeLeaseOn } from '../services/lease/activeLeases';

// Use a Proxy to ensure we're always using the latest store from the factory,
// which is critical for test isolation when the factory cache is cleared.
const store: IDeviceStore = new Proxy({} as IDeviceStore, {
  get: (target, prop) => {
    return (DeviceStoreFactory.getStore() as any)[prop];
  },
});

/**
 * The scope of a device event (team-scoped dashboard events). With the row's
 * own `teamId` the socket layer needs no lookup; a row without the field
 * falls back to DeviceTeamResolver.
 */
function deviceScope(udid: string, teamId: string | null | undefined) {
  return teamId === undefined ? { udid } : { udid, teamId };
}

export async function removeDevice(
  devices: { udid: string; host: string }[],
  options: { exactHost?: boolean } = {},
) {
  for (const device of devices) {
    log.info(`Removing device ${device.udid} from host ${device.host}`);
    const socket = Container.get(SocketServer);
    // Read the phone's team while its row still exists, so the removal
    // reaches the dashboards that could see it (an unknown phone fails
    // closed). Only a team-scoped dashboard needs it: with auth disabled
    // there is no lookup.
    const team = socket.hasScopedDashboard()
      ? await Container.get(DeviceTeamResolver).resolve(device.udid)
      : undefined;
    // The callers hold a udid and a host. The device_offline webhook promises
    // its name and platform too, so read them while the row still exists.
    const known = await store
      .findDevice({ udid: device.udid, host: device.host })
      .catch(() => null);
    await store.removeDevices({ udid: device.udid, host: device.host }, options);
    Container.get(NotificationService).dispatchEvent('device_offline', { ...known, ...device });
    void socket.emitToDashboardForDevices(
      'device_removed',
      device,
      deviceScope(device.udid, team?.known ? team.teamId : undefined),
    );
  }
}

/** What a node asks the hub to forget: one phone (`udid`), or all it has (no udid). */
export interface NodeRemoval {
  udid?: string;
  host?: string;
  /** The node's id, as its reports carry it. */
  nodeId?: string;
}

/**
 * The phones a node asks the hub to forget (`POST /register`, `type=remove`
 * for one phone, `type=unregister` when it shuts down). Only that node's: the
 * rows its `nodeId` names when it sends one, else those filed under exactly
 * its `host`, and never one of this server's own (`isOwn`). A udid-less
 * `remove` names no phone and takes nothing.
 *
 * The store matched a host that isn't a URL as a substring, and a remove with
 * no host by udid alone, so a node (an older one sends a bare IP) could delete
 * the hub's own phones, or another node's. Returns how many rows went.
 */
export async function removeNodeDevices(
  removals: NodeRemoval[],
  isOwn: (device: IDevice) => boolean,
): Promise<number> {
  const all = await store.getAllDevices();
  const gone = new Map<string, { udid: string; host: string }>();
  for (const removal of removals) {
    if (!removal.nodeId && !removal.host) continue;
    for (const device of all) {
      if (isOwn(device)) continue;
      if (removal.udid !== undefined && device.udid !== removal.udid) continue;
      const theirs = removal.nodeId
        ? device.nodeId === removal.nodeId
        : device.host === removal.host;
      if (theirs) gone.set(`${device.udid}\u0000${device.host}`, device);
    }
  }
  await removeDevice(
    [...gone.values()].map((d) => ({ udid: d.udid, host: d.host })),
    { exactHost: true },
  );
  return gone.size;
}

export async function addNewDevice(
  devices: IDevice[],
  host?: string,
  options: AddDevicesOptions = {},
): Promise<IDevice[]> {
  const normalizedDevices = devices.map((device) => {
    const d = { ...device };
    if (d.host === undefined && host !== undefined) d.host = host;
    return Object.assign({ userBlocked: false, offline: false }, d);
  });

  const added = await store.addDevices(normalizedDevices, options);

  // Notify for new devices
  for (const device of added) {
    Container.get(NotificationService).dispatchEvent('device_new', device);
    void Container.get(SocketServer).emitToDashboardForDevices(
      'device_added',
      device,
      deviceScope(device.udid, device.teamId),
    );
  }

  log.debug(`Sync: Added ${added.length} new devices to store`);
  return added;
}

/**
 * Writes one discovery pass. `known` is the device list the pass started from.
 * A phone not in it is added. A phone in it gets only the discovery columns
 * the pass changed (discoveryChanges): discovery hands its copy of the row
 * back, and writing an unchanged value would undo a hold, a lock, a team
 * change or a port written while it ran.
 */
export async function syncDiscoveredDevices(
  discovered: IDevice[],
  known: IDevice[],
  host: string,
): Promise<void> {
  const knownByKey = new Map(known.map((d) => [`${d.udid}@${d.host}`, d]));
  const fresh: IDevice[] = [];
  for (const device of discovered) {
    const was = knownByKey.get(`${device.udid}@${device.host ?? host}`);
    if (!was) {
      fresh.push(device);
      continue;
    }
    const changes = discoveryChanges(device, was);
    if (Object.keys(changes).length > 0) await store.updateDevice(was.udid, was.host, changes);
  }
  if (fresh.length > 0) await addNewDevice(fresh, host);
}

export async function setSimulatorState(devices: Array<IDevice>) {
  const allInStore = await store.getAllDevices();
  const simMap = new Map(
    allInStore.filter((d) => d.deviceType === 'simulator').map((d) => [d.udid, d]),
  );

  for (const device of devices) {
    if (device.deviceType !== 'simulator') continue;
    const found = simMap.get(device.udid);
    if (found && found.state !== device.state) {
      log.info(`Updating Simulator ${device.udid} state: ${found.state} -> ${device.state}`);
      await store.updateDevice(device.udid, device.host, { state: device.state });
    }
  }
}

export async function getAllDevices(): Promise<IDevice[]> {
  return await store.getAllDevices();
}

/** Attach Team.name for each assigned device (one batched query). */
export async function enrichDevicesWithTeamNames<T extends { teamId?: string | null }>(
  devices: T[],
): Promise<(T & { teamName: string | null })[]> {
  const teamIds = [
    ...new Set(
      devices.map((d) => d.teamId).filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
  if (teamIds.length === 0) {
    return devices.map((d) => ({ ...d, teamName: null }));
  }
  const rows = await prisma.team.findMany({
    where: { id: { in: teamIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(rows.map((r) => [r.id, r.name]));
  return devices.map((d) => ({
    ...d,
    teamName: d.teamId ? nameById.get(d.teamId) ?? null : null,
  }));
}

// Filter an array of rows down to those whose `udidField` references a
// device visible to the caller. Visibility:
//   teamIds === undefined → no filter (admin / unscoped) → return as-is.
//   teamIds === []        → only rows whose device.teamId IS NULL.
//   teamIds === [a, b]    → rows whose device.teamId IS NULL or in the set.
// Performs a single batched lookup for all referenced udids.
export async function filterRowsByVisibleDevice<T>(
  rows: T[],
  teamIds: string[] | undefined,
  udidField: keyof T,
): Promise<T[]> {
  if (teamIds === undefined) return rows;
  const udids = Array.from(
    new Set(rows.map((r) => String(r[udidField])).filter(Boolean)),
  );
  // A row with no udid has no phone to be visible through (fail closed).
  if (udids.length === 0) return [];
  const devices = await prisma.device.findMany({
    where: { udid: { in: udids } },
    select: { udid: true, teamId: true },
  });
  const visibleUdids = new Set(
    devices.filter((d) => isDeviceVisible(d.teamId, teamIds)).map((d) => d.udid),
  );
  return rows.filter((r) => visibleUdids.has(String(r[udidField])));
}

export async function getDevices(filterOptions: IDeviceFilterOptions): Promise<IDevice[]> {
  const devices = await store.getDevices(filterOptions);

  // Principal Intelligence: Multi-layered Reliability Filter
  const breaker = Container.get(CircuitBreaker);
  return devices.filter((device) => {
    // 1. Host Stability (Circuit Breaker)
    if (breaker.isOpen(device.host)) return false;

    // 2. Device Health (Proactive Status)
    // Only exclude if healthStatus is explicitly defined and not 'Healthy'
    if (device.healthStatus && device.healthStatus !== 'Healthy') {
      log.debug(
        `[DeviceService] Skipping unhealthy device ${device.udid}: ${device.healthCheckError}`,
      );
      return false;
    }

    return true;
  });
}

/**
 * Find device matching the filter options
 * @param filterOptions IDeviceFilterOptions
 * @returns IDevice | undefined
 */
export async function getDevice(filterOptions: IDeviceFilterOptions): Promise<IDevice | undefined> {
  const devices = await getDevices(filterOptions);
  // log.debug(`getDevice devices: ${JSON.stringify(devices)}`);
  if (devices.length === 0) {
    return undefined;
  } else {
    return devices[0];
  }
}

export async function updatedAllocatedDevice(device: IDevice, updateData: Partial<IDevice>) {
  log.info(`Updating allocated device: ${device.udid}`);
  await store.updateDevice(device.udid, device.host, updateData);
}

/**
 * Put a created session on the claim its phone was allocated with
 * (`device.claimedAt`), writing `updateData` with it. False, and nothing
 * written, when another session holds the phone now: its claim is not
 * overwritten.
 */
export async function claimDeviceForSession(
  device: IDevice,
  sessionId: string,
  updateData: Partial<IDevice>,
): Promise<boolean> {
  const claimed = await store.claimForSession(
    device.udid,
    device.host,
    device.claimedAt,
    sessionId,
    updateData,
  );
  if (!claimed) {
    log.error(
      `Session ${sessionId} was created on ${device.udid} at ${device.host}, but another ` +
        'session has claimed the device since. Leaving that claim in place.',
    );
  }
  return claimed;
}

export async function updateDeviceProgress(
  udid: string,
  host: string,
  progress: string,
  extra: Partial<IDevice> = {},
) {
  log.debug(`[${udid}] progress: ${progress}`);
  await store.updateDevice(udid, host, { sessionProgress: progress, ...extra });
  // Emit progress update via socket
  void Container.get(SocketServer).emitToDashboardForDevices(
    'device_progress',
    {
      udid,
      host,
      progress,
      ...extra,
    },
    { udid },
  );
}

export async function updateCmdExecutedTime(sessionId: string) {
  // One conditional write. Reading the row and writing all of it back would
  // put back a claim released, or a node's report taken, in between.
  await store.touchSession(sessionId, new Date().getTime());
}

/**
 * Apply user blocking device. Device busy status will not be affected.
 * @param udid string
 * @param host string
 */
export async function userBlockDevice(udid: string, host: string) {
  await store.updateDevice(udid, host, { userBlocked: true });
}

export async function userUnblockDevice(udid: string, host: string) {
  await store.updateDevice(udid, host, { userBlocked: false });
}

/**
 * Block device from being allocated to a session. Device busy status will be set to true.
 * @param udid
 * @param host
 */
export async function blockDevice(udid: string, host: string, sessionId?: string) {
  let effectiveSessionId: string | null = sessionId ?? null;
  // #149: a manual-stream lock must not overwrite a live Appium session's
  // session_id (shared-WDA coexistence). Only read-before-write on the manual
  // path — the normal session-block path keeps its single write.
  if (isManualLock(sessionId)) {
    const existing = await getDevice({ udid }); // udid uniquely identifies the device
    effectiveSessionId = resolveBlockSessionId(sessionId, existing?.session_id);
  }
  await store.updateDevice(udid, host, {
    busy: true,
    lastCmdExecutedAt: undefined,
    sessionProgress: '',
    session_id: effectiveSessionId ?? (null as any),
  });
  void Container.get(SocketServer).emitToDashboardForDevices(
    'device_blocked',
    {
      udid,
      host,
      session_id: effectiveSessionId ?? undefined,
    },
    { udid },
  );
}

/**
 * Free a phone whatever holds it: a manual hold (a preview, a recording) or
 * an admin's release. A session's phone is released with
 * releaseSessionDevices / releaseSessionDevice / releasePendingClaim instead,
 * keyed on its claim.
 *
 * With a host, only that row. A hub also stores its nodes' phones, and a node
 * on the same machine lists the same udid under its own host: matching the
 * udid alone freed that row too, with a session on it.
 */
export async function unblockDevice(udid: string, host?: string) {
  const devices = await store.findDevices(host === undefined ? { udid } : { udid, host });
  await forceRelease(devices);
}

/** unblockDevice for every phone matching `filter` (getDevices' filter). */
export async function unblockDeviceMatchingFilter(filter: object) {
  await forceRelease(await store.getDevices(filter as IDeviceFilterOptions));
}

async function forceRelease(devices: IDevice[]) {
  await Promise.all(
    devices.map(async (device) => {
      const totalUtilization = utilizationAfter(device);
      await setUtilizationTime(device.udid, totalUtilization);
      await store.updateDevice(device.udid, device.host, {
        ...CLAIM_RESET,
        busy: false,
        totalUtilizationTimeMilliSec: totalUtilization,
      } as unknown as Partial<IDevice>);
      log.debug(`Unblocked device ${device.udid}`);
      emitUnblocked(device);
    }),
  ).catch((error) => {
    log.error(`Unable to unblock device: ${error}`);
  });
}

/**
 * End a session's claim on its phone, keyed on the session's id: a release
 * for a session that has ended, arriving after its phone went to another one,
 * matches nothing. The phone stays busy while its node still reports it busy
 * (deviceClaims.ts). Never throws.
 */
export async function releaseSessionDevices(sessionId: string): Promise<void> {
  try {
    const rows = new Map<string, IDevice>();
    for (const device of [
      ...(await store.findDevices({ claimSessionId: sessionId })),
      ...(await store.findDevices({ session_id: sessionId })),
    ]) {
      rows.set(`${device.udid}@${device.host}`, device);
    }
    await Promise.all([...rows.values()].map((device) => releaseClaimOn(device, { sessionId })));
  } catch (error) {
    log.error(`Unable to release the device of session ${sessionId}: ${error}`);
  }
}

/** releaseSessionDevices for one phone. */
export async function releaseSessionDevice(
  udid: string,
  host: string,
  sessionId: string,
): Promise<boolean> {
  const device = await store.findDevice({ udid, host });
  return device ? releaseClaimOn(device, { sessionId }) : false;
}

/**
 * Give back a phone allocated for a session that was never created: the
 * pending claim it was allocated with (`claimedAt`, as the allocation read
 * it). If that claim has gone (timed out, and the phone taken since) nothing
 * is written.
 */
export async function releasePendingClaim(
  allocated: Pick<IDevice, 'udid' | 'host' | 'claimedAt'>,
): Promise<boolean> {
  const device = await store.findDevice({ udid: allocated.udid, host: allocated.host });
  return device ? releaseClaimOn(device, { claimedAt: allocated.claimedAt ?? null }) : false;
}

async function releaseClaimOn(device: IDevice, ref: ClaimRef): Promise<boolean> {
  const totalUtilization = utilizationAfter(device);
  const released = await store.releaseClaim(device.udid, device.host, ref, {
    totalUtilizationTimeMilliSec: totalUtilization,
  });
  if (!released) {
    log.info(
      `Not releasing ${device.udid} at ${device.host}: it no longer holds ${JSON.stringify(ref)}`,
    );
    return false;
  }
  await setUtilizationTime(device.udid, totalUtilization);
  log.debug(`Released ${JSON.stringify(ref)} on ${device.udid}`);
  if (await keepLeaseLock(device)) return true;
  emitUnblocked(device);
  return true;
}

/**
 * A session's phone that an SDK lease still holds goes back to the lease,
 * not to the pool: the release above cleared `busy`, which is the lease's
 * only lock (deviceClaims.ts). Allocation would skip the phone anyway, but
 * the device list, the ownership guard and the dashboard read `busy`. The
 * lease's own end (release, or LeaseOrphanSweeper) clears it. True when the
 * phone was kept for its lease.
 */
async function keepLeaseLock(device: IDevice): Promise<boolean> {
  try {
    if (!(await activeLeaseOn(device.udid, device.host))) return false;
    // lastCmdExecutedAt, so that if this lock outlives its lease (the undo
    // below fails) the idle sweeper still frees it: it skips the phone only
    // while a live lease holds it.
    await store.updateDevice(device.udid, device.host, {
      busy: true,
      lastCmdExecutedAt: Date.now(),
    });
    // The lease may have ended between the check and the write; its own
    // release ran before ours and cleared nothing. Then undo, by the same
    // conditional clear it uses. A release after this check runs after the
    // write, and clears it itself.
    if (!(await activeLeaseOn(device.udid, device.host))) {
      await store.releaseLeaseLock(device.udid, device.host);
      return false;
    }
    log.debug(`Kept ${device.udid} at ${device.host} busy for its lease`);
    return true;
  } catch (error) {
    log.warn(`Could not check ${device.udid} for a lease after its session: ${error}`);
    return false;
  }
}

/** The phone's total use once the session on it now ends. */
function utilizationAfter(device: IDevice): number {
  const started = device.sessionStartTime;
  return (device.totalUtilizationTimeMilliSec ?? 0) + (started ? Date.now() - started : 0);
}

function emitUnblocked(device: IDevice) {
  void Container.get(SocketServer).emitToDashboardForDevices(
    'device_unblocked',
    { udid: device.udid, host: device.host },
    deviceScope(device.udid, device.teamId),
  );
}

/**
 * Reserve a device for exclusive manual use
 * @param udid Device UDID
 * @param host Device host
 * @param reservedBy Username or identifier
 * @param durationMs Duration in milliseconds
 * @param reason Optional reservation reason
 * @param reservedByUserId The user taking it, who alone (or an admin) may release or extend it
 */
export async function reserveDevice(
  udid: string,
  host: string,
  reservedBy: string,
  durationMs: number,
  reason?: string,
  reservedByUserId?: string | null,
) {
  const reservedUntil = Date.now() + durationMs;
  log.info(
    `Reserving device ${udid} for ${reservedBy} until ${new Date(reservedUntil).toISOString()}`,
  );
  await store.updateDevice(udid, host, {
    reservedBy,
    reservedByUserId: reservedByUserId ?? null,
    reservedUntil,
    reservationReason: reason,
  });
}

/**
 * Release a device reservation
 * @param udid Device UDID
 * @param host Device host
 */
export async function releaseReservation(udid: string, host: string) {
  log.info(`Releasing reservation for device ${udid}`);
  await store.updateDevice(udid, host, {
    reservedBy: null as any,
    reservedByUserId: null,
    reservedUntil: null as any,
    reservationReason: null as any,
  } as Partial<IDevice>);
}

/**
 * Check if a device is currently reserved
 * @param device The device to check
 * @returns true if device is reserved and reservation has not expired
 */
export function isDeviceReserved(device: IDevice): boolean {
  if (!device.reservedUntil) return false;
  return Date.now() < device.reservedUntil;
}

/**
 * Get all currently reserved devices
 * @returns Array of reserved devices
 */
export async function getReservedDevices(): Promise<IDevice[]> {
  const allDevices = await store.getAllDevices();
  return allDevices.filter(isDeviceReserved);
}

/**
 * Clean up expired reservations
 */
export async function cleanExpiredReservations() {
  const allDevices = await store.getAllDevices();
  const expiredReservations = allDevices.filter((device) => {
    return device.reservedUntil && Date.now() >= device.reservedUntil;
  });

  for (const device of expiredReservations) {
    log.info(`Reservation expired for device ${device.udid}, releasing...`);
    await releaseReservation(device.udid, device.host);
  }

  if (expiredReservations.length > 0) {
    log.info(`Cleaned ${expiredReservations.length} expired reservations`);
  }
}
/**
 * Update tags for a device
 * @param udid string
 * @param host string
 * @param tags string[]
 */
export async function updateDeviceTags(udid: string, host: string, tags: string[]) {
  log.info(`Updating tags for device ${udid}: ${tags.join(', ')}`);
  await store.updateDevice(udid, host, { tags });
}
