import { IDevice } from '../interfaces/IDevice';
import { IDeviceFilterOptions } from '../interfaces/IDeviceFilterOptions';
import log from '../logger';
import { setUtilizationTime } from '../device-utils';
import { DeviceStoreFactory } from './device-store';

import NotificationService from '../services/NotificationService';

const store = DeviceStoreFactory.getStore();

export async function removeDevice(devices: { udid: string; host: string }[]) {
  for (const device of devices) {
    log.info(`Removing device ${device.udid} from host ${device.host}`);
    await store.removeDevices({ udid: device.udid, host: device.host });
    NotificationService.dispatchEvent('device_offline', device);
  }
}

export async function removeDevicesByHost(host: string) {
  log.info(`Removing all devices from host ${host}`);
  // We can't easily dispatch events here without fetching first,
  // but for now we'll stick to single device removal alerting
  await store.removeDevices({ host });
}

export async function addNewDevice(devices: IDevice[], host?: string): Promise<IDevice[]> {
  const normalizedDevices = devices.map((device) => {
    const d = { ...device };
    if (d.host === undefined && host !== undefined) d.host = host;
    return Object.assign({ userBlocked: false, offline: false }, d);
  });

  const added = await store.addDevices(normalizedDevices);

  // Notify for new devices
  for (const device of added) {
    NotificationService.dispatchEvent('device_new', device);
  }

  log.debug(`Sync: Added ${added.length} new devices to store`);
  return added;
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

export async function getDevices(filterOptions: IDeviceFilterOptions): Promise<IDevice[]> {
  return await store.getDevices(filterOptions);
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

export async function updateDeviceProgress(
  udid: string,
  host: string,
  progress: string,
  extra: Partial<IDevice> = {},
) {
  log.debug(`[${udid}] progress: ${progress}`);
  await store.updateDevice(udid, host, { sessionProgress: progress, ...extra });
  // We don't dispatch an event for every progress update to avoid flooding the socket,
  // but the dashboard poller/refresh will pick it up.
}

export async function updateCmdExecutedTime(sessionId: string) {
  await store.updateDevices({ session_id: sessionId }, (device: IDevice) => {
    device.lastCmdExecutedAt = new Date().getTime();
  });
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
export async function blockDevice(udid: string, host: string) {
  await store.updateDevice(udid, host, {
    busy: true,
    lastCmdExecutedAt: undefined,
    sessionProgress: '',
  });
}

export async function unblockDevice(udid: string, host: string) {
  await unblockDeviceMatchingFilter({ udid, host });
}

export async function unblockDeviceMatchingFilter(filter: object) {
  const devices = await store.getDevices(filter as IDeviceFilterOptions);

  if (devices.length > 0) {
    await Promise.all(
      devices.map(async (device) => {
        const sessionStart = device.sessionStartTime;
        const currentTime = new Date().getTime();
        let utilization = currentTime - sessionStart;
        if (sessionStart === 0) utilization = 0;

        const totalUtilization = device.totalUtilizationTimeMilliSec + utilization;
        await setUtilizationTime(device.udid, totalUtilization);

        await store.updateDevice(device.udid, device.host, {
          session_id: null as any,
          busy: false,
          lastCmdExecutedAt: null as any,
          sessionStartTime: 0,
          totalUtilizationTimeMilliSec: totalUtilization,
          newCommandTimeout: null as any,
          sessionProgress: '',
        } as Partial<IDevice>);

        log.debug(`Unblocked device ${device.udid}`);
      }),
    ).catch((error) => {
      log.error(`Unable to unblock device: ${error}`);
    });
  }
}

/**
 * Reserve a device for exclusive manual use
 * @param udid Device UDID
 * @param host Device host
 * @param reservedBy Username or identifier
 * @param durationMs Duration in milliseconds
 * @param reason Optional reservation reason
 */
export async function reserveDevice(
  udid: string,
  host: string,
  reservedBy: string,
  durationMs: number,
  reason?: string,
) {
  const reservedUntil = Date.now() + durationMs;
  log.info(
    `Reserving device ${udid} for ${reservedBy} until ${new Date(reservedUntil).toISOString()}`,
  );
  await store.updateDevice(udid, host, {
    reservedBy,
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
