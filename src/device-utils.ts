/* eslint-disable no-prototype-builtins */
import {
  cachePath,
  checkIfPathIsAbsolute,
  isAppiumRunningAt,
  isXenonRunning,
  isMac,
} from './helpers';
import { ServerCLI } from './types/CLIArgs';
import { Platform } from './types/Platform';
import { androidCapabilities, iOSCapabilities } from './XenonCapabilityManager';
import waitUntil from 'async-wait-until';
import { ISessionCapability } from './interfaces/ISessionCapability';
import { IDeviceFilterOptions } from './interfaces/IDeviceFilterOptions';
import { IDevice } from './interfaces/IDevice';
import { Container } from 'typedi';
import { XenonManager } from './device-managers';
import {
  addNewDevice,
  blockDevice,
  cleanExpiredReservations,
  getAllDevices,
  getDevice,
  getDevices,
  isDeviceReserved,
  removeDevice,
  setSimulatorState,
  unblockDevice,
  updatedAllocatedDevice,
} from './data-service/device-service';
import log from './logger';
import DevicePlatform from './enums/Platform';
import _ from 'lodash';
import fs from 'fs';
import { LocalStorage } from 'node-persist';
import CapabilityManager from './device-managers/cloud/CapabilityManager';
import AndroidDeviceManager from './device-managers/AndroidDeviceManager';
import IOSDeviceManager from './device-managers/IOSDeviceManager';
import { IOSDiscoveryService } from './device-managers/ios/IOSDiscoveryService';
import NodeDevices from './device-managers/NodeDevices';
import { IPluginArgs } from './interfaces/IPluginArgs';
import { DeviceStoreFactory } from './data-service/device-store';
import { v4 as uuidv4 } from 'uuid';

const pendingStore = DeviceStoreFactory.getPendingSessionStore();

const customCapability = {
  deviceTimeOut: 'appium:deviceAvailabilityTimeout',
  deviceQueryInterval: 'appium:deviceRetryInterval',
  iphoneOnly: 'appium:iPhoneOnly',
  ipadOnly: 'appium:iPadOnly',
  udids: 'appium:udids',
  minSDK: 'appium:minSDK',
  maxSDK: 'appium:maxSDK',
  filterByHost: 'appium:filterByHost',
  tags: 'appium:tags',
};

let timer: any;
let cronTimerToReleaseBlockedDevices: any;
let cronTimerToUpdateDevices: any;
let cronTimerToCleanPendingSessions: any;
let cronTimerToCleanupBuilds: any;

export const getDeviceTypeFromApp = (app: string): 'real' | 'simulator' | undefined => {
  /* If the test is targeting safarim, then app capability will be empty */
  if (!app) {
    return;
  }
  return app.endsWith('.app') || app.endsWith('.zip') ? 'simulator' : 'real';
};

export function isAndroid(cliArgs: ServerCLI): boolean {
  return cliArgs.Platform.toLowerCase() === DevicePlatform.ANDROID;
}

export function deviceType(pluginArgs: IPluginArgs, device: string): boolean {
  const iosDeviceType = pluginArgs.iosDeviceType;
  return iosDeviceType === device || iosDeviceType === 'both';
}

export function isIOS(pluginArgs: IPluginArgs): boolean {
  return isMac() && pluginArgs.platform.toLowerCase() === DevicePlatform.IOS;
}

export function isAndroidAndIOS(pluginArgs: IPluginArgs): boolean {
  return isMac() && pluginArgs.platform.toLowerCase() === DevicePlatform.BOTH;
}

export function isDeviceConfigPathAbsolute(path: string): boolean | undefined {
  if (checkIfPathIsAbsolute(path)) {
    return true;
  } else {
    throw new Error(`Device Config Path ${path} should be absolute`);
  }
}

/**
 * For given capability, wait untill a free device is available from the database
 * and update the capability json with required device informations
 * @param capability
 * @returns
 */
export async function allocateDeviceForSession(
  capability: ISessionCapability,
  deviceTimeOutMs: number,
  deviceQueryIntervalMs: number,
  pluginArgs: IPluginArgs,
): Promise<IDevice> {
  const firstMatch = Object.assign({}, capability.firstMatch[0], capability.alwaysMatch);
  const filters = getDeviceFiltersFromCapability(firstMatch, pluginArgs);

  const timeout = firstMatch[customCapability.deviceTimeOut] || deviceTimeOutMs;
  const intervalBetweenAttempts =
    firstMatch[customCapability.deviceQueryInterval] || deviceQueryIntervalMs;

  let device: IDevice | null = null;
  const store = DeviceStoreFactory.getStore();

  try {
    await waitUntil(
      async () => {
        const maxSessions = getDeviceManager().getMaxSessionCount();
        const busyDevicesCount = await getBusyDevicesCount();
        if (maxSessions !== undefined && busyDevicesCount === maxSessions) {
          log.info(
            `Waiting for session available, already at max session count of: ${maxSessions}`,
          );
          return false;
        }

        // Get matching devices and find one that is not reserved
        const matchingDevices = await getDevices(filters);
        const availableCandidate = matchingDevices.find((d) => !isDeviceReserved(d));
        if (availableCandidate) {
          // Principal Intelligence: Multi-node consistent locking
          // Attempt to atomically claim this specific device
          device = await store.findAndLockDevice({ ...filters, udid: [availableCandidate.udid] });
          return device !== null;
        }

        log.info(`Waiting for free device. Filter: ${JSON.stringify(filters)}}`);
        return false;
      },
      { timeout, intervalBetweenAttempts },
    );
  } catch (err) {
    // figure out whether the device is simply busy or non-existent
    const filterCopy = { ...filters };
    delete filterCopy.busy;
    delete filterCopy.userBlocked;

    const possibleDevice = await getDevice(filterCopy);

    let failureReason = 'No device matching request.';
    if (possibleDevice?.busy || possibleDevice?.userBlocked) {
      failureReason = 'Device is busy or blocked.';
    } else if (possibleDevice && isDeviceReserved(possibleDevice)) {
      failureReason = `Device is reserved by ${possibleDevice.reservedBy}.`;
    }

    throw new Error(`${failureReason}. Device request: ${JSON.stringify(filterCopy)}`);
  }

  // We have a locked device here
  if (device !== null) {
    const lockedDevice: IDevice = device;
    // Principal Health Check Integration: Ensure device is READY before allocation
    if (!lockedDevice.cloud) {
      const platform = lockedDevice.platform.toLowerCase();
      const managers = await getDeviceManager().deviceInstances();
      const manager = managers.find((m) => {
        if (platform === DevicePlatform.ANDROID) return m instanceof AndroidDeviceManager;
        if (platform === DevicePlatform.IOS || platform === 'tvos')
          return m instanceof IOSDeviceManager;
        return false;
      });

      if (manager && manager.readyForSession) {
        const isReady = await manager.readyForSession(lockedDevice);
        if (!isReady) {
          log.error(
            `❌ [Allocation] Device ${lockedDevice.udid} failed pre-session health check. Unblocking.`,
          );
          await unblockDevice(lockedDevice.udid, lockedDevice.host);
          throw new Error(
            `Device ${lockedDevice.udid} is unhealthy and could not be autonomously recovered.`,
          );
        }
      }
    }

    // Since findAndLockDevice already sets busy: true, we don't need blockDevice(device.udid, device.host);
    log.info(`📱 Locked device ${lockedDevice.udid} at host ${lockedDevice.host} for new session`);

    await updateCapabilityForDevice(capability, lockedDevice);

    let newCommandTimeout = firstMatch['appium:newCommandTimeout'];
    if (!newCommandTimeout) {
      newCommandTimeout = pluginArgs.newCommandTimeoutSec;
    }
    await updatedAllocatedDevice(lockedDevice, { newCommandTimeout });

    return lockedDevice;
  } else {
    // This should theoretically not be reached if waitUntil succeeded
    throw new Error(`Device allocation failed unexpectedly for filters: ${JSON.stringify(filters)}`);
  }
}

/**
 * Adjust the capability for the device
 * @param capability
 * @param device
 * @returns
 */
export async function updateCapabilityForDevice(capability: any, device: IDevice) {
  if (!device.cloud) {
    // Fetch additional info lazily if method exists on manager
    const platform = device.platform.toLowerCase();
    const manager = (await getDeviceManager().deviceInstances()).find((m) => {
      if (platform === DevicePlatform.ANDROID) return m instanceof AndroidDeviceManager;
      if (platform === DevicePlatform.IOS || platform === 'tvos')
        return m instanceof IOSDeviceManager;
      return false;
    });

    if (manager && manager.getAdditionalDeviceInfo) {
      const additionalInfo = await manager.getAdditionalDeviceInfo(device);
      Object.assign(device, additionalInfo);
    }

    if (platform == DevicePlatform.ANDROID) {
      await androidCapabilities(capability, device);
    } else {
      await iOSCapabilities(capability, device);
    }
  } else {
    log.info('Updating cloud capability for Device');
    return new CapabilityManager(capability, device).getCapability();
  }
}

/**
 * Sets up node-persist storage in local cache
 * @returns storage
 */
export async function initializeStorage() {
  log.info('Initializing storage');
  const basePath = cachePath('storage');
  await fs.promises.mkdir(basePath, { recursive: true });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const storage = require('node-persist');
  const localStorage = storage.create({ dir: basePath });
  await localStorage.init();
  Container.set('LocalStorage', localStorage);
}

async function getStorage() {
  try {
    Container.get('LocalStorage');
  } catch (err) {
    log.error(`Failed to get LocalStorage: Error ${err}`);
    await initializeStorage();
  }
  return Container.get('LocalStorage') as LocalStorage;
}

/**
 * Gets utlization time for a device from storage
 * Returns 0 if the device has not been used an thus utilization time has not been saved
 * @param udid
 * @returns number
 */
export async function getUtilizationTime(udid: string) {
  try {
    const value = (await getStorage()).getItem(udid);
    if (value !== undefined && value && !isNaN(await value)) {
      return value;
    } else {
      //log.error(`Custom Exception: Utilizaiton time in cache is corrupted. Value = '${value}'.`);
    }
  } catch (err) {
    log.error(`Failed to fetch Utilization Time \n ${err}`);
  }

  return 0;
}

/**
 * Sets utilization time for a device to storage
 * @param udid
 * @param utilizationTime
 */
export async function setUtilizationTime(udid: string, utilizationTime: number) {
  await (await getStorage()).setItem(udid, utilizationTime);
}

/**
 * Method to get the device filters from the custom session capability
 * This filter will be used as in the query to find the free device from the databse
 * @param capability
 * @returns IDeviceFilterOptions
 */
export function getDeviceFiltersFromCapability(
  capability: any,
  pluginArgs: IPluginArgs,
): IDeviceFilterOptions {
  const platformName = capability['platformName'] || capability['appium:platformName'];
  const platform: Platform | undefined = platformName ? platformName.toLowerCase() : undefined;
  const udids = capability[customCapability.udids]
    ? capability[customCapability.udids].split(',').map(_.trim)
    : process.env.UDIDS?.split(',').map(_.trim);
  /* Based on the app file extension, we will decide whether to run the
   * test on real device or simulator.
   *
   * Applicaple only for ios.
   */
  const deviceType =
    platform == DevicePlatform.IOS
      ? getDeviceTypeFromApp(capability['appium:app'] as string)
      : undefined;

  if (deviceType?.startsWith('sim') && pluginArgs.iosDeviceType === 'real') {
    throw new Error(
      'iosDeviceType value is set to "real" but app provided is not suitable for real device.',
    );
  }

  if (deviceType?.startsWith('real') && pluginArgs.iosDeviceType == 'simulated') {
    throw new Error(
      'iosDeviceType value is set to "simulated" but app provided is not suitable for simulator device.',
    );
  }

  let name: string | undefined = undefined;
  if (capability[customCapability.ipadOnly]) {
    name = 'iPad';
  } else if (capability[customCapability.iphoneOnly]) {
    name = 'iPhone';
  }

  // Ensure udid is always an array of strings for the filter
  let udidFilter: string[] = [];
  if (udids?.length) {
    udidFilter = udids;
  } else if (capability['appium:udid']) {
    udidFilter = [capability['appium:udid']];
  } else if (capability['udid']) {
    udidFilter = [capability['udid']];
  }

  let caps: IDeviceFilterOptions = {
    platform,
    platformVersion: capability['appium:platformVersion']
      ? capability['appium:platformVersion']
      : undefined,
    name,
    deviceType,
    udid: udidFilter,
    busy: false,
    userBlocked: false,
    filterByHost: capability[customCapability.filterByHost],
    minSDK: capability[customCapability.minSDK] ? capability[customCapability.minSDK] : undefined,
    maxSDK: capability[customCapability.maxSDK] ? capability[customCapability.maxSDK] : undefined,
    tags: capability[customCapability.tags]
      ? capability[customCapability.tags].split(',').map(_.trim)
      : undefined,
  };

  if (name !== undefined) {
    caps = { ...caps, name };
  }
  return caps;
}

/**
 * Helper methods to manage devices
 */
function getDeviceManager() {
  return Container.get(XenonManager) as XenonManager;
}

export async function getBusyDevicesCount() {
  const allDevices = await getAllDevices();
  return allDevices.filter((device) => {
    return device.busy;
  }).length;
}

export async function updateDeviceList(host: string, hubArgument?: string): Promise<IDevice[]> {
  const devices: IDevice[] = await getDeviceManager().getDevices(await getAllDevices());
  if (devices.length === 0) {
    log.warn('No devices found');
    return [];
  }

  // log.debug(`Updating device list with ${JSON.stringify(devices)} devices`);

  // first thing first. Update device list in local list
  await addNewDevice(devices, host);

  if (hubArgument) {
    if (await isXenonRunning(hubArgument)) {
      const nodeDevices = new NodeDevices(hubArgument);
      try {
        await nodeDevices.postDevicesToHub(devices, 'add');
      } catch (error) {
        log.error(`Cannot send device list update. Reason: ${error}`);
      }
    } else {
      log.warn(`Not sending device update since hub ${hubArgument} is not running`);
    }
  }

  return devices;
}

export async function refreshSimulatorState(pluginArgs: IPluginArgs, hostPort: number) {
  if (timer) {
    clearInterval(timer);
  }
  timer = setInterval(async () => {
    const iosDiscoveryService = Container.get(IOSDiscoveryService);
    const simulators = await iosDiscoveryService.getSimulators();
    await setSimulatorState(simulators);
  }, 10000);
}

export async function setupCronCheckStaleDevices(intervalMs: number, currentHost: string) {
  setInterval(async () => {
    await removeStaleDevices(currentHost);
  }, intervalMs);
}

/**
 * Remove devices where the host is not alive nor defined.
 * @param currentHost current host ip address
 */
export async function removeStaleDevices(currentHost: string) {
  const allDevices = await getAllDevices();
  const nodeDevices = allDevices.filter((device) => {
    // devices that's not from this node ip address
    return device.host !== undefined && !device.host.includes(currentHost);
  });

  const devicesWithNoHost = nodeDevices.filter((device) => {
    return device.host === undefined;
  });

  const nodeHosts = nodeDevices.filter((device) => !device.cloud).map((device) => device.host);
  const cloudHosts = nodeDevices.filter((device) => !!device.cloud).map((device) => device.host);
  const aliveHosts = (await Promise.allSettled(
    nodeHosts.map(async (host) => {
      return {
        host: host,
        alive: await isXenonRunning(host),
      };
    }),
  )) as { status: 'fulfilled' | 'rejected'; value: { host: string; alive: boolean } }[];
  const aliveCloudHosts = (await Promise.allSettled(
    cloudHosts.map(async (host) => {
      return {
        host: host,
        alive: await isAppiumRunningAt(host),
      };
    }),
  )) as { status: 'fulfilled' | 'rejected'; value: { host: string; alive: boolean } }[];

  // summarize alive hosts
  const allAliveHosts = [...aliveHosts, ...aliveCloudHosts]
    .filter((item) => item.status === 'fulfilled' && item.value.alive)
    .map((item) => item.value.host);
  // stale devices are devices that's not alive
  const staleDevices = nodeDevices.filter((device) => !allAliveHosts.includes(device.host));
  await removeDevice(staleDevices.map((device) => ({ udid: device.udid, host: device.host })));
  if (staleDevices.length > 0) {
    log.debug(
      `Removing device with udid(s): ${staleDevices
        .map((device) => device.udid)
        .join(', ')} because the node is not alive`,
    );
  }

  // remove devices with no host
  await removeDevice(devicesWithNoHost.map((device) => ({ udid: device.udid, host: device.host })));
  if (devicesWithNoHost.length > 0) {
    log.debug(
      `Removing device with udid(s): ${devicesWithNoHost
        .map((device) => device.udid)
        .join(', ')} because the device has no host`,
    );
  }
}

export async function unblockCandidateDevices() {
  const allDevices = await getAllDevices();
  return allDevices.filter((device) => {
    // log.debug(`Checking if device ${device.udid} from ${device.host} is a candidate to be released: ${isCandidate}`);
    return device.busy && !device.userBlocked && device.lastCmdExecutedAt != undefined;
  });
}

export async function releaseBlockedDevices(newCommandTimeout: number) {
  const busyDevices = await unblockCandidateDevices();

  log.debug(`Found ${busyDevices.length} device candidates to be released`);

  busyDevices.forEach(function (device) {
    // need to keep this to make typescript happy. good thing tho.
    if (device.lastCmdExecutedAt == undefined) {
      return;
    }

    const currentEpoch = new Date().getTime();
    const timeoutSeconds =
      device.newCommandTimeout != undefined ? device.newCommandTimeout : newCommandTimeout;
    const timeSinceLastCmdExecuted = (currentEpoch - device.lastCmdExecutedAt) / 1000;
    if (timeSinceLastCmdExecuted > timeoutSeconds) {
      // unblock regardless of whether the device has session or not
      log.info(
        `Unblocking device ${device.udid} at host ${device.host} because it has been idle for ${timeSinceLastCmdExecuted} seconds`,
      );

      // Principal Protection: If this device has an active dashboard session, stop it properly
      if (device.session_id) {
        const sessionId = device.session_id;

        // Mark as stopped/failed in dashboard
        import('./dashboard/event-manager').then((m) => {
          m.DASHBORD_EVENT_MANAGER.onSessionStoped(sessionId, 'failed' as any, 'Session timed out due to inactivity');
        });

        // Important: Remove from in-memory SessionManager so it doesn't leak
        import('./sessions/SessionManager').then((m) => {
          m.SESSION_MANAGER.removeSession(sessionId);
        });

        log.warn(`🕒 Session ${sessionId} timed out on device ${device.udid}`);
      }

      unblockDevice(device.udid, device.host);
    }
  });
}

export async function setupCronReleaseBlockedDevices(
  intervalMs: number,
  newCommandTimeoutSec: number,
) {
  if (cronTimerToReleaseBlockedDevices) {
    clearInterval(cronTimerToReleaseBlockedDevices);
  }
  await releaseBlockedDevices(newCommandTimeoutSec);
  cronTimerToReleaseBlockedDevices = setInterval(async () => {
    await releaseBlockedDevices(newCommandTimeoutSec);
  }, intervalMs);
}

export async function setupCronUpdateDeviceList(
  host: string,
  hubArgument: string,
  intervalMs: number,
) {
  if (cronTimerToUpdateDevices) {
    clearInterval(cronTimerToUpdateDevices);
  }
  log.info(
    `This node will send device list update to the hub (${hubArgument}) every ${intervalMs} ms`,
  );

  cronTimerToUpdateDevices = setInterval(async () => {
    await updateDeviceList(host, hubArgument);
  }, intervalMs);
}

export async function cleanPendingSessions(timeoutMs: number) {
  const pendingSessions = await pendingStore.getAllPendingSessions();
  const currentEpoch = new Date().getTime();
  const timedOutSessions = pendingSessions.filter((session) => {
    const timeSinceSessionCreated = currentEpoch - session.createdAt;
    log.debug(
      `Session queue ID:${session.capability_id} has been pending for ${timeSinceSessionCreated} ms`,
    );
    return timeSinceSessionCreated > timeoutMs;
  });

  if (timedOutSessions.length === 0) {
    log.debug('No pending sessions to clean');
  } else {
    log.debug(`Found ${timedOutSessions.length} pending sessions to clean`);
  }

  for (const session of timedOutSessions) {
    log.debug(`Removing pending session ${session.capability_id} because it has timed out`);
    await pendingStore.remove(session);
  }
}

export async function setupCronCleanPendingSessions(intervalMs: number, timeoutMs: number) {
  log.info(
    `Hub will clean pending sessions every ${intervalMs} ms with pending session timeout: ${timeoutMs} ms`,
  );
  if (cronTimerToCleanPendingSessions) {
    clearInterval(cronTimerToCleanPendingSessions);
  }

  cronTimerToCleanPendingSessions = setInterval(async () => {
    log.debug('Cleaning pending sessions...');
    await cleanPendingSessions(timeoutMs);
  }, intervalMs);
}

let cronTimerToCleanExpiredReservations: any;
export async function setupCronCleanExpiredReservations(intervalMs: number) {
  log.info(`Hub will clean expired reservations every ${intervalMs} ms`);
  if (cronTimerToCleanExpiredReservations) {
    clearInterval(cronTimerToCleanExpiredReservations);
  }

  cronTimerToCleanExpiredReservations = setInterval(async () => {
    log.debug('Cleaning expired reservations...');
    await cleanExpiredReservations();
  }, intervalMs);
}

/**
 * Sets up a cron job to purge older builds and sessions based on configuration
 */
export async function setupCronCleanupBuilds(pluginArgs: IPluginArgs) {
  const { buildCleanupSchedule = '0 0 * * *' } = pluginArgs;
  const { CleanupService } = await import('./services/CleanupService');
  const schedule = await import('node-schedule');
  const cleanupService = Container.get(CleanupService);

  if (cronTimerToCleanupBuilds) {
    cronTimerToCleanupBuilds.cancel();
  }

  log.info(`Build cleanup scheduled with expression: ${buildCleanupSchedule}`);

  cronTimerToCleanupBuilds = schedule.scheduleJob(buildCleanupSchedule, async () => {
    log.info('Running scheduled build cleanup...');
    await cleanupService.runCleanup(pluginArgs);
  });
}
