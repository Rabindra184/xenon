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
import AsyncLock from 'async-lock';
import { ISessionCapability } from './interfaces/ISessionCapability';
import { IDeviceFilterOptions } from './interfaces/IDeviceFilterOptions';
import { IDevice } from './interfaces/IDevice';
import { Container } from 'typedi';
import { XenonManager } from './device-managers';
import {
  blockDevice,
  cleanExpiredReservations,
  getAllDevices,
  getDevice,
  getDevices,
  isDeviceReserved,
  releasePendingClaim,
  releaseSessionDevice,
  removeDevice,
  setSimulatorState,
  syncDiscoveredDevices,
  unblockDevice,
  updatedAllocatedDevice,
} from './data-service/device-service';
import {
  countsTowardMaxSessions,
  isPendingClaim,
  pendingClaimExpired,
  sessionCap,
} from './data-service/deviceClaims';
import { PluginContext } from './PluginContext';
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
import { isOwnDevice, LocalDeviceHosts } from './device-managers/localDeviceHosts';
import { config as xenonConfig } from './config';
import { IPluginArgs } from './interfaces/IPluginArgs';
import { DeviceStoreFactory } from './data-service/device-store';
import { IPendingSessionStore } from './data-service/device-store.interface';
import { v4 as uuidv4 } from 'uuid';
import type { LeaseSessionProof } from './services/lease/LeaseService';
import { leaseIdOf, leaseRefusalMessage } from './services/lease/leaseSessionCaps';
import { isDeviceVisible } from './services/device-access/deviceVisibility';
import { activeLeasesByDevice, leaseKey } from './services/lease/activeLeases';

// Use a Proxy to ensure we're always using the latest store from the factory,
// which is critical for test isolation when the factory cache is cleared.
const pendingStore: IPendingSessionStore = new Proxy({} as IPendingSessionStore, {
  get: (target, prop) => {
    return (DeviceStoreFactory.getPendingSessionStore() as any)[prop];
  },
});

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

// One at a time through "is there a free slot, and which phone": see allocateDeviceForSession.
const ALLOCATION_LOCK = new AsyncLock();
const ALLOCATION_LOCK_KEY = 'allocate';

// What a caller that passes no proof has: nothing. A lease then needs its token.
const NO_LEASE_PROOF: LeaseSessionProof = {
  canOverride: false,
  apiKeyId: null,
  userId: null,
  leaseToken: null,
};

/**
 * For given capability, wait untill a free device is available from the database
 * and update the capability json with required device informations
 * @param capability
 * @param leaseProof who the session is, and the lease token it sent; only a
 *   session naming a lease in `xe:options.leaseId` reads it
 * @returns
 */
export async function allocateDeviceForSession(
  capability: ISessionCapability,
  deviceTimeOutMs: number,
  deviceQueryIntervalMs: number,
  pluginArgs: IPluginArgs,
  callerTeamIds?: string[],
  leaseProof: LeaseSessionProof = NO_LEASE_PROOF,
): Promise<IDevice> {
  const firstMatch = Object.assign({}, capability.firstMatch?.[0] ?? {}, capability.alwaysMatch);

  // Lease-bound session: SDK acquired a lease via /xenon/api/sdk/leases and
  // passes its id through caps. Resolve directly; skip findAndLockDevice
  // (device is already locked) and skip port allocation in XenonCapabilityManager
  // (ports are already in firstMatch).
  const leaseIdCap = leaseIdOf(capability);
  if (leaseIdCap) {
    const leasedDevice = await findLeasedDevice(leaseIdCap, leaseProof, callerTeamIds);
    // One answer, from this one place, whether the lease is gone, someone
    // else's, or on a phone the caller can't see: nothing in the error, its
    // text or its stack tells them apart.
    if (!leasedDevice) throw new Error(leaseRefusalMessage(leaseIdCap));
    // As for an allocated phone below: the idle sweeper reads this session's
    // own timeout from the row, and its idle time from now, not from when the
    // lease was taken. Without it a leased session was ended after the
    // server-wide newCommandTimeoutSec, whatever the session asked for.
    await updatedAllocatedDevice(leasedDevice, {
      newCommandTimeout: sessionNewCommandTimeout(firstMatch, pluginArgs),
      lastCmdExecutedAt: Date.now(),
    });
    return leasedDevice;
  }

  const filters = getDeviceFiltersFromCapability(firstMatch, pluginArgs);
  // callerTeamIds === undefined → unscoped (admin / auth-disabled / back-compat).
  // callerTeamIds === []        → caller has no team, only shared pool visible.
  // callerTeamIds === [a, b]    → shared pool + any of those teams visible.
  if (callerTeamIds !== undefined) {
    filters.callerTeamIds = callerTeamIds;
  }

  const timeout = firstMatch[customCapability.deviceTimeOut] || deviceTimeOutMs;
  const intervalBetweenAttempts =
    firstMatch[customCapability.deviceQueryInterval] || deviceQueryIntervalMs;

  let device: IDevice | null = null;
  const store = DeviceStoreFactory.getStore();
  // Set once the wait has given up. waitUntil rejects on its timeout but
  // doesn't stop an attempt already running, which could then claim a phone
  // for a create that has failed: a pending claim nobody would ever use.
  let abandoned = false;

  try {
    await waitUntil(
      async () => {
        if (abandoned) return false;
        // The limit check and the claim are one step. Requests that each read
        // "one slot left" before any of them claimed would all take a phone and
        // run past the limit, and then no later check would see it fixed.
        return ALLOCATION_LOCK.acquire(ALLOCATION_LOCK_KEY, async () => {
          if (abandoned) return false;
          const maxSessions = sessionCap(getDeviceManager().getMaxSessionCount());
          if (maxSessions !== undefined) {
            const running = await getRunningSessionsCount();
            if (running >= maxSessions) {
              log.info(
                `Waiting for session available, already at max session count of: ${maxSessions}`,
              );
              return false;
            }
          }

          // Get matching devices that are not reserved
          const candidates = (await getDevices(filters)).filter((d) => !isDeviceReserved(d));
          if (candidates.length > 0) {
            // Principal Intelligence: Multi-node consistent locking
            // Atomically claim one of them: busy, with a pending claim for the
            // session being created (deviceClaims.ts). Every candidate, not just
            // the first: the lock skips a phone an SDK lease holds, and offering
            // it alone stalled the create while other phones were free. Exact
            // (udid, host) pairs: a udid repeats across hosts, and a reserved
            // twin of a candidate must not be locked in its place.
            const locked = await store.findAndLockDevice(
              { ...filters, udid: [...new Set(candidates.map((d) => d.udid))] },
              { claim: true, only: new Set(candidates.map((d) => `${d.udid}@${d.host}`)) },
            );
            if (locked && abandoned) {
              await releasePendingClaim(locked);
              return false;
            }
            device = locked;
            if (device !== null) return true;
          }

          log.info(`Waiting for free device. Filter: ${JSON.stringify(filters)}}`);
          return false;
        });
      },
      { timeout, intervalBetweenAttempts },
    );
  } catch (err) {
    abandoned = true;
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
          await releasePendingClaim(lockedDevice);
          throw new Error(
            `Device ${lockedDevice.udid} is unhealthy and could not be autonomously recovered.`,
          );
        }
      }
    }

    // Since findAndLockDevice already sets busy: true, we don't need blockDevice(device.udid, device.host);
    log.info(`📱 Locked device ${lockedDevice.udid} at host ${lockedDevice.host} for new session`);

    await updateCapabilityForDevice(capability, lockedDevice);

    await updatedAllocatedDevice(lockedDevice, {
      newCommandTimeout: sessionNewCommandTimeout(firstMatch, pluginArgs),
    });

    return lockedDevice;
  } else {
    // This should theoretically not be reached if waitUntil succeeded
    throw new Error(
      `Device allocation failed unexpectedly for filters: ${JSON.stringify(filters)}`,
    );
  }
}

/** The session's own `appium:newCommandTimeout` (seconds), else the server's. */
function sessionNewCommandTimeout(firstMatch: Record<string, any>, pluginArgs: IPluginArgs): number {
  return firstMatch['appium:newCommandTimeout'] || pluginArgs.newCommandTimeoutSec;
}

/**
 * The device a lease-bound session may use, or null when it may not: the lease
 * is missing, inactive or expired, the session did not prove it holds it, or
 * the phone is one the caller's teams can't see. The last holds even for the
 * token or the lease's creator — the phone may have moved team since — and
 * has no admin exception: `callerTeamIds` undefined is how an admin is
 * unscoped.
 */
async function findLeasedDevice(
  leaseId: string,
  proof: LeaseSessionProof,
  callerTeamIds: string[] | undefined,
): Promise<IDevice | null> {
  const { LeaseService } = await import('./services/lease/LeaseService');
  const resolved = await Container.get(LeaseService).authorizeSessionUse(leaseId, proof);
  if (!resolved) return null;
  const leasedDevice = await DeviceStoreFactory.getStore().findDevice({
    udid: resolved.deviceUdid,
    host: resolved.deviceHost,
  });
  if (!leasedDevice) {
    // Only a session that proved it holds the lease gets this far.
    throw new Error(
      `lease ${leaseId} references missing device ${resolved.deviceUdid}@${resolved.deviceHost}`,
    );
  }
  return isDeviceVisible(leasedDevice.teamId, callerTeamIds) ? leasedDevice : null;
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

  // iPad wins when both are asked for. The device store applies it; it is not
  // a name match (a real phone is named by its owner), see appleFamilyOf.
  let appleFamily: 'iphone' | 'ipad' | undefined = undefined;
  if (capability[customCapability.ipadOnly]) {
    appleFamily = 'ipad';
  } else if (capability[customCapability.iphoneOnly]) {
    appleFamily = 'iphone';
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

  if (appleFamily !== undefined) {
    caps = { ...caps, appleFamily };
  }
  return caps;
}

/**
 * Helper methods to manage devices
 */
function getDeviceManager() {
  return Container.get(XenonManager) as XenonManager;
}

/**
 * How many phones run an Appium session, or are being given one: what
 * `maxSessions` limits. A preview, a recording or an idle SDK lease keeps a
 * phone busy without being a session, so counting busy phones would be wrong
 * (see `countsTowardMaxSessions`). On a hub it covers its nodes' phones too.
 */
export async function getRunningSessionsCount() {
  const allDevices = await getAllDevices();
  return allDevices.filter(countsTowardMaxSessions).length;
}

export async function updateDeviceList(
  local: LocalDeviceHosts,
  hubArgument?: string,
  tlsRejectUnauthorized?: boolean,
): Promise<IDevice[]> {
  const allExistingDevices = await getAllDevices();
  const devices: IDevice[] = await getDeviceManager().getDevices(allExistingDevices);

  // first thing first. Update device list in local list
  await syncDiscoveredDevices(devices, allExistingDevices, local.origin);

  // Prune this server's own phones that discovery no longer reports: an
  // unplugged Android phone, or a simulator filtered out (e.g. booted-simulators
  // is on and it shut down). Only its own (isOwnDevice: by nodeId, or else by
  // exact host): a hub keeps its nodes' phones in the same table, and a node
  // on the same machine differs from the hub only by port.
  const nodeId = Container.get(PluginContext).nodeId;
  const discoveredUdids = new Set(devices.map((d) => d.udid));
  const staleLocalDevices = allExistingDevices.filter(
    (d) => isOwnDevice(local, nodeId, d) && !discoveredUdids.has(d.udid),
  );

  if (staleLocalDevices.length > 0) {
    log.info(
      `Removing ${staleLocalDevices.length} stale devices/simulators no longer discovered on this host.`,
    );
    await removeDevice(staleLocalDevices.map((d) => ({ udid: d.udid, host: d.host })));
  }

  if (hubArgument) {
    if (await isXenonRunning(hubArgument, tlsRejectUnauthorized)) {
      const nodeDevices = new NodeDevices(hubArgument, {
        tlsRejectUnauthorized,
        hubAccessKey: xenonConfig.hubAccessKey,
        hubToken: xenonConfig.hubToken,
      });
      try {
        await nodeDevices.postDevicesToHub(devices, 'add');
        if (staleLocalDevices.length > 0) {
          await nodeDevices.postDevicesToHub(staleLocalDevices as any, 'remove');
        }
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

export async function setupCronCheckStaleDevices(
  intervalMs: number,
  local: LocalDeviceHosts,
  tlsRejectUnauthorized?: boolean,
) {
  setInterval(async () => {
    await removeStaleDevices(local, tlsRejectUnauthorized);
  }, intervalMs);
}

/**
 * Remove devices where the host is not alive nor defined.
 * @param local the hosts this server files its own phones under
 */
export async function removeStaleDevices(local: LocalDeviceHosts, tlsRejectUnauthorized?: boolean) {
  const allDevices = await getAllDevices();
  const nodeId = Container.get(PluginContext).nodeId;
  const nodeDevices = allDevices.filter((device) => {
    // Phones another server drives: by nodeId, or else by exact host (a node
    // on this machine shares the IP, and an IP can be a prefix of another's).
    return device.host !== undefined && !isOwnDevice(local, nodeId, device);
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
        alive: await isXenonRunning(host, tlsRejectUnauthorized),
      };
    }),
  )) as { status: 'fulfilled' | 'rejected'; value: { host: string; alive: boolean } }[];
  const aliveCloudHosts = (await Promise.allSettled(
    cloudHosts.map(async (host) => {
      return {
        host: host,
        alive: await isAppiumRunningAt(host, tlsRejectUnauthorized),
      };
    }),
  )) as { status: 'fulfilled' | 'rejected'; value: { host: string; alive: boolean } }[];

  // summarize alive hosts
  const allAliveHosts = [...aliveHosts, ...aliveCloudHosts]
    .filter((item) => item.status === 'fulfilled' && item.value.alive)
    .map((item) => item.value.host);
  // A node's phones carry its nodeId, and live as long as the node does:
  // while any host of that node answers, its phone filed under a host that
  // can't be probed (an iPhone under a bare remoteMachineProxyIP) stays.
  const liveNodeIds = new Set(
    nodeDevices
      .filter((device) => device.nodeId && allAliveHosts.includes(device.host))
      .map((device) => device.nodeId),
  );
  // stale devices are devices that's not alive
  const staleDevices = nodeDevices.filter(
    (device) =>
      !allAliveHosts.includes(device.host) && !(device.nodeId && liveNodeIds.has(device.nodeId)),
  );
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
  // A phone an SDK lease holds is the lease's to time out (its heartbeats and
  // expiry, LeaseOrphanSweeper), not idle until a session runs on it. A lease
  // sets lastCmdExecutedAt when taken, so without this the sweeper freed a
  // leased phone the new-command timeout later, before a slow first session
  // had even started on it.
  let leases = new Map<string, unknown>();
  if (busyDevices.length) {
    try {
      leases = await activeLeasesByDevice();
    } catch (err) {
      // Not knowing which phones are leased, sweeping would free all of them:
      // their lastCmdExecutedAt is when the lease was taken. Next tick.
      log.warn(`Idle sweep skipped: could not read active leases: ${err}`);
      return;
    }
  }

  log.debug(`Found ${busyDevices.length} device candidates to be released`);

  for (const device of busyDevices) {
    // need to keep this to make typescript happy. good thing tho.
    if (device.lastCmdExecutedAt == undefined) {
      continue;
    }

    const currentEpoch = new Date().getTime();
    // A claim whose session is still being created is not idle: a first
    // driver install can outlast the new-command timeout. It has its own
    // timeout, for a create that never finished (deviceClaims.ts).
    if (isPendingClaim(device)) {
      if (pendingClaimExpired(device, currentEpoch)) {
        log.warn(
          `Releasing ${device.udid} at ${device.host}: its session was never created ` +
            `(claimed ${Math.round((currentEpoch - (device.claimedAt as number)) / 1000)} seconds ago)`,
        );
        await releasePendingClaim(device).catch((err) =>
          log.error(`Unable to release ${device.udid}: ${err}`),
        );
      }
      continue;
    }

    // Leased, with no session or hold on it: not idle.
    if (
      leases.has(leaseKey(device.udid, device.host)) &&
      !device.claimSessionId &&
      !device.session_id
    ) {
      continue;
    }

    const timeoutSeconds =
      device.newCommandTimeout != undefined ? device.newCommandTimeout : newCommandTimeout;
    const timeSinceLastCmdExecuted = (currentEpoch - device.lastCmdExecutedAt) / 1000;
    if (timeSinceLastCmdExecuted > timeoutSeconds) {
      // unblock regardless of whether the device has session or not
      log.info(
        `Unblocking device ${device.udid} at host ${device.host} because it has been idle for ${timeSinceLastCmdExecuted} seconds`,
      );
      // Before anything below can release the phone (onSessionStopped too).
      await restoreIdleSessionNetwork(device.claimSessionId ?? device.session_id);

      // Principal Protection: If this device has an active dashboard session, stop it properly
      if (device.session_id) {
        const sessionId = device.session_id;

        // Mark as stopped/failed in dashboard
        import('./dashboard/event-manager').then((m) => {
          m.DASHBORD_EVENT_MANAGER.onSessionStopped(
            sessionId,
            'failed' as any,
            'Session timed out due to inactivity',
          );
        });

        // Important: Remove from in-memory SessionManager so it doesn't leak
        import('./sessions/SessionManager').then((m) => {
          m.SESSION_MANAGER.removeSession(sessionId);
        });

        log.warn(`🕒 Session ${sessionId} timed out on device ${device.udid}`);
      }

      // Keyed on the session read here, so a release that loses the race to
      // the session's own end (and the phone's next claim) frees nothing.
      const claimant = device.claimSessionId ?? device.session_id;
      await (
        claimant
          ? releaseSessionDevice(device.udid, device.host, claimant)
          : unblockDevice(device.udid, device.host)
      ).catch((err) => log.error(`Unable to release ${device.udid}: ${err}`));
    }
  }
}

/**
 * The network an idle session changed on its phone (profile, interceptor
 * proxy), put back before the idle release frees the phone. Imported lazily,
 * as this module's other session services are. Never throws.
 */
async function restoreIdleSessionNetwork(sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) return;
  try {
    const { PhoneNetworkRestore } = await import('./services/network/PhoneNetworkRestore');
    await Container.get(PhoneNetworkRestore).restoreSession(sessionId, 'idle timeout');
  } catch (err) {
    log.warn(`Could not put back the network of idle session ${sessionId}: ${err}`);
  }
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
  local: LocalDeviceHosts,
  hubArgument: string,
  intervalMs: number,
  tlsRejectUnauthorized?: boolean,
) {
  if (cronTimerToUpdateDevices) {
    clearInterval(cronTimerToUpdateDevices);
  }
  log.info(
    `This node will send device list update to the hub (${hubArgument}) every ${intervalMs} ms`,
  );

  cronTimerToUpdateDevices = setInterval(async () => {
    await updateDeviceList(local, hubArgument, tlsRejectUnauthorized);
  }, intervalMs);
}

/**
 * Tells the hub this node is leaving, once for each host its phones are filed
 * under, with the node's id: the hub drops the phones this node reported
 * (by `nodeId`, else by exact host) and never another server's. Only URL
 * hosts are sent: a hub before that rule matched anything that isn't a URL as
 * a substring, which is how the node's bare IP also took the hub's own phones
 * on the same machine.
 */
export async function unregisterNodeFromHub(
  hubArgument: string,
  local: LocalDeviceHosts,
  tlsRejectUnauthorized?: boolean,
  nodeId?: string,
) {
  const hub = new NodeDevices(hubArgument, {
    tlsRejectUnauthorized,
    hubAccessKey: xenonConfig.hubAccessKey,
    hubToken: xenonConfig.hubToken,
  });
  for (const host of local.hosts) {
    if (/^https?:\/\//.test(host)) await hub.unRegisterNode(host, nodeId);
  }
}

/**
 * Principal discovery: Periodically poll for local devices to prune stales/offlines.
 * Critical for standalone Hubs where setupCronUpdateDeviceList isn't called.
 */
export async function setupCronLocalDiscovery(local: LocalDeviceHosts, intervalMs: number) {
  if (timer) {
    clearInterval(timer);
  }
  log.info(`Local device discovery poll started every ${intervalMs} ms`);
  timer = setInterval(async () => {
    await updateDeviceList(local);
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
 * Sets up a cron job to purge older builds and sessions based on configuration.
 * The schedule is the one saved on the dashboard's Maintenance page, else the
 * `buildCleanupSchedule` option. Calling it again replaces the job, which is
 * how a schedule saved at runtime takes effect (`rescheduleCleanupBuilds`).
 */
export async function setupCronCleanupBuilds(pluginArgs: IPluginArgs) {
  const { loadEffectiveSettings } = await import('./services/settings/labSettings');
  const { buildCleanupSchedule } = await loadEffectiveSettings(pluginArgs);
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

/**
 * Put a cleanup schedule just saved on the Maintenance page to work: the old
 * timer is cancelled and a new one installed. A server that runs no cleanup
 * (a cloud-provider hub, see `setupMaintenanceCrons`) stays without one.
 */
export async function rescheduleCleanupBuilds(pluginArgs: IPluginArgs) {
  if (pluginArgs.cloud?.cloudName) return;
  await setupCronCleanupBuilds(pluginArgs);
}

let cronTimerSweepOrphanSessions: any;
let cronTimerReconcileDevices: any;
let cronTimerSelectorVerification: any;

/**
 * Cross-checks the device store against SESSION_MANAGER and frees devices
 * that are busy with a session ID the driver layer no longer knows about.
 * Fills the gap between OrphanSweeper (Prisma heartbeat-driven) and
 * releaseBlockedDevices (command-idle-driven).
 */
export function setupCronReconcileDevices(intervalMs: number) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DeviceReconciler } = require('./services/DeviceReconciler') as {
    DeviceReconciler: new () => import('./services/DeviceReconciler').DeviceReconciler;
  };
  const reconciler = Container.get(DeviceReconciler);
  log.info(`Device reconcile scheduled every ${intervalMs}ms`);
  if (cronTimerReconcileDevices) {
    clearInterval(cronTimerReconcileDevices);
  }
  cronTimerReconcileDevices = setInterval(() => {
    reconciler.reconcile().catch((err: any) => {
      log.error(`Device reconcile crashed: ${err.message}`);
    });
  }, intervalMs);
  return cronTimerReconcileDevices;
}

/**
 * Periodically sweep sessions whose heartbeat has gone stale, marking them as
 * failed and releasing their devices.
 */
export function setupCronSweepOrphanSessions(heartbeatIntervalMs: number) {
  // Use dynamic require to avoid circular-import issues at module load time
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { OrphanSweeper } = require('./services/OrphanSweeper') as { OrphanSweeper: new () => import('./services/OrphanSweeper').OrphanSweeper };
  const sweeper = Container.get(OrphanSweeper);
  const intervalMs = heartbeatIntervalMs; // sweep as often as sessions heartbeat
  log.info(`Orphan session sweep scheduled every ${intervalMs}ms`);
  if (cronTimerSweepOrphanSessions) {
    clearInterval(cronTimerSweepOrphanSessions);
  }
  cronTimerSweepOrphanSessions = setInterval(() => {
    sweeper.sweep({ heartbeatIntervalMs }).catch((err: any) => {
      log.error(`Orphan sweep crashed: ${err.message}`);
    });
  }, intervalMs);
  return cronTimerSweepOrphanSessions;
}

/**
 * Walks every Pending SelectorState row and (if 3+ distinct clean CI builds
 * have run since fixed_at) promotes it to Resolved. Mirrors the OrphanSweeper
 * cron-driven shape — single module-level handle that `stopAllTimers` cancels.
 *
 * Default cron is every 15 minutes (`*​/15 * * * *`); short enough that the
 * dashboard's "1/3, 2/3" progress moves at a believable cadence, long enough
 * that the per-row $queryRaw doesn't dominate the DB.
 */
export async function setupCronSelectorVerification(cronExpression = '*/15 * * * *') {
  const { SelectorVerificationJob } = await import('./services/SelectorVerificationJob');
  const schedule = await import('node-schedule');
  const job = Container.get(SelectorVerificationJob);

  if (cronTimerSelectorVerification) {
    cronTimerSelectorVerification.cancel();
  }

  log.info(`Selector verification scheduled with expression: ${cronExpression}`);
  cronTimerSelectorVerification = schedule.scheduleJob(cronExpression, () => {
    job.run().catch((err: any) => {
      log.error(`Selector verification crashed: ${err.message}`);
    });
  });
  return cronTimerSelectorVerification;
}

/**
 * Principal Shutdown: Clears all background intervals and scheduled jobs
 * to prevent process hangs and handle leaks.
 */
export function stopAllTimers() {
  if (timer) clearInterval(timer);
  if (cronTimerToReleaseBlockedDevices) clearInterval(cronTimerToReleaseBlockedDevices);
  if (cronTimerToUpdateDevices) clearInterval(cronTimerToUpdateDevices);
  if (cronTimerToCleanPendingSessions) clearInterval(cronTimerToCleanPendingSessions);
  if (cronTimerToCleanExpiredReservations) clearInterval(cronTimerToCleanExpiredReservations);
  if (cronTimerToCleanupBuilds) cronTimerToCleanupBuilds.cancel();
  if (cronTimerSweepOrphanSessions) clearInterval(cronTimerSweepOrphanSessions);
  if (cronTimerReconcileDevices) clearInterval(cronTimerReconcileDevices);
  if (cronTimerSelectorVerification) cronTimerSelectorVerification.cancel();
}
