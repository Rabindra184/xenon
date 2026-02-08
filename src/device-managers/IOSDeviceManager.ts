import Simctl from 'node-simctl';
import { flatten, isEmpty } from 'lodash';
import { utilities as IOSUtils } from 'appium-ios-device';
import { IDevice } from '../interfaces/IDevice';
import { IDeviceManager } from '../interfaces/IDeviceManager';
import { getFreePort } from '../helpers';
import { asyncForEach } from '../helpers';
import log from '../logger';
import os from 'os';
import path from 'path';
import { getUtilizationTime } from '../device-utils';
import fs from 'fs-extra';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import http from 'http';
import https from 'https';
import IOSStreamService from './ios/IOSStreamService';

const execPromise = promisify(exec);
import Devices from './cloud/Devices';
import NodeDevices from './NodeDevices';
import { IosTracker } from './iOSTracker';
import { Container } from 'typedi';
import { DeviceStoreFactory } from '../data-service/device-store';

import { addNewDevice, removeDevice } from '../data-service/device-service';
import { DeviceTypeToInclude, IDerivedDataPath, IPluginArgs } from '../interfaces/IPluginArgs';

import { PluginContext } from '../PluginContext';
import { Service } from 'typedi';

@Service()
export default class IOSDeviceManager implements IDeviceManager {
  private log = log.scope('IOSManager');
  // Soft failure tracking: Allow transient 'ready: false' states before declaring unhealthy
  private wdaSoftFailures: Map<string, number> = new Map();
  private readonly WDA_SOFT_FAIL_MAX = 3; // Allow 3 consecutive 'ready: false' before triggering recovery

  constructor(private context: PluginContext) { }

  private get pluginArgs() { return this.context.pluginArgs; }
  private get hostPort() { return this.context.port; }
  private get nodeId() { return this.context.nodeId; }
  /**
   * Method to get all ios devices and simulators
   *
   * @returns {Promise<Array<IDevice>>}
   */
  async getDevices(
    deviceTypes: { iosDeviceType: DeviceTypeToInclude },
    existingDeviceDetails: Array<IDevice>,
  ): Promise<IDevice[]> {
    if (deviceTypes.iosDeviceType === 'real') {
      return flatten(
        await Promise.all([
          this.getRealDevices(existingDeviceDetails, this.pluginArgs, this.hostPort),
        ]),
      );
    } else if (deviceTypes.iosDeviceType === 'simulated') {
      const simulators = flatten(await Promise.all([this.getSimulators()]));
      log.debug(`Simulators: ${JSON.stringify(simulators)}`);
      return simulators;
    } else {
      // return both real and simulated devices
      return flatten(
        await Promise.all([
          this.getRealDevices(existingDeviceDetails, this.pluginArgs, this.hostPort),
          this.getSimulators(),
        ]),
      );
    }
  }

  async getConnectedDevices(): Promise<Array<string>> {
    try {
      const devices: string[] = await IOSUtils.getConnectedDevices();
      return devices;
    } catch (error) {
      this.log.error(error);
      return [];
    }
  }

  async getOSVersion(udid: string): Promise<string> {
    try {
      return await IOSUtils.getOSVersion(udid);
    } catch (error: any) {
      log.warn(`Failed to get OS version for device ${udid}: ${error.message}`);
      return 'Unknown';
    }
  }

  async getDeviceName(udid: string): Promise<string> {
    try {
      return await IOSUtils.getDeviceName(udid);
    } catch (error: any) {
      log.warn(`Failed to get device name for device ${udid}: ${error.message}`);
      return 'iPhone';
    }
  }

  private getDevicePlatformName(name: string) {
    return name.toLowerCase().includes('tv') ? 'tvos' : 'ios';
  }

  /**
   * Method to get all ios real devices
   *
   * @returns {Promise<Array<IDevice>>}
   */
  private async getRealDevices(
    existingDeviceDetails: Array<IDevice>,
    pluginArgs: IPluginArgs,
    hostPort: number,
  ): Promise<Array<IDevice>> {
    let deviceState: Array<IDevice> = [];
    if (this.pluginArgs.cloud !== undefined) {
      const cloud = new Devices(this.pluginArgs.cloud, deviceState, 'ios');
      return await cloud.getDevices();
    } else {
      deviceState = await this.fetchLocalIOSDevices(existingDeviceDetails, pluginArgs, hostPort);
    }
    const returnDevices = deviceState.filter((device) => device.realDevice === true);
    return returnDevices;
  }

  private prepareDerivedDataPath(
    derivedDataPath: IDerivedDataPath | undefined,
    udid: string,
    realDevice: boolean,
  ): string {
    function derivedPathExtracted(tmpPath: string, theDerivedDataPath?: string) {
      if (theDerivedDataPath !== undefined) {
        fs.copySync(theDerivedDataPath, tmpPath);
      } else {
        if (!fs.existsSync(tmpPath)) {
          log.info(`DerivedDataPath for UDID ${udid} not set, so falling back to ${tmpPath}`);
          log.info(
            `WDA will be build once and will use WDA Runner from path ${tmpPath}, second test run will skip the build process`,
          );
          fs.mkdirSync(tmpPath, { recursive: true });
        }
      }
    }

    if (derivedDataPath) {
      if (typeof derivedDataPath !== 'object')
        throw new Error('DerivedData Path should be able Object');
      const tmpPath = path.join(
        os.homedir(),
        `Library/Developer/Xcode/DerivedData/WebDriverAgent-${udid}`,
      );
      if (realDevice) {
        derivedPathExtracted(tmpPath, derivedDataPath.device);
      } else {
        derivedPathExtracted(tmpPath, derivedDataPath.simulator);
      }
      return tmpPath;
    } else {
      return path.join(os.homedir(), `Library/Developer/Xcode/DerivedData/WebDriverAgent-${udid}`);
    }
  }

  private async fetchLocalIOSDevices(
    existingDeviceDetails: IDevice[],
    pluginArgs: IPluginArgs,
    hostPort: number,
  ): Promise<IDevice[]> {
    const devices = await this.getConnectedDevices();
    const deviceProcessingPromises = devices.map(async (udid: string) => {
      try {
        const existingDevice = existingDeviceDetails.find((device) => device.udid === udid);
        if (existingDevice) {
          log.info(`IOS Device details for ${udid} already available`);
          return {
            ...existingDevice,
            busy: false,
            userBlocked: false,
          };
        } else {
          return await this.getDeviceInfo(udid, pluginArgs, hostPort);
        }
      } catch (e: any) {
        log.error(`Failed to initialize iOS device ${udid}: ${e.message}`);
        return null; // Resolve with null to filter out failed devices
      }
    });

    const deviceState = (await Promise.all(deviceProcessingPromises)).filter(
      (d): d is IDevice => d !== null,
    );
    // might as well track devices
    this.trackIOSDevices(pluginArgs);

    return deviceState;
  }

  async trackIOSDevices(pluginArgs: IPluginArgs) {
    const iosTracker = Container.get(IosTracker).getListener();
    iosTracker.on('attached', async (udid: string) => {
      try {
        const deviceAttached = await this.getDeviceInfo(udid, pluginArgs, this.hostPort);
        const deviceTracked: IDevice = {
          ...deviceAttached,
          nodeId: this.nodeId,
        };
        if (pluginArgs.hub !== undefined) {
          log.info(`Updating Hub with iOS device ${udid}`);
          const nodeDevices = new NodeDevices(pluginArgs.hub);
          await nodeDevices.postDevicesToHub([deviceTracked], 'add');
        }
        // add device to local list
        log.info(`iOS device with udid ${udid} plugged! updating device list...`);
        await addNewDevice([deviceTracked], pluginArgs.bindHostOrIp);
      } catch (e: any) {
        log.error(`Failed to handle iOS device attach for ${udid}: ${e.message}`);
      }
    });
    iosTracker.on('detached', async (udid: string) => {
      const deviceRemoved: any = [{ udid, host: pluginArgs.bindHostOrIp }];
      if (pluginArgs.hub !== undefined) {
        log.info(`iOS device with udid ${udid} unplugged! updating hub device list...`);
        const nodeDevices = new NodeDevices(pluginArgs.hub);
        await nodeDevices.postDevicesToHub(deviceRemoved, 'remove');
      }

      // remove device from local list
      log.info(`iOS device with udid ${udid} unplugged! updating device list...`);
      await removeDevice(deviceRemoved);
    });
  }

  private async getDeviceInfo(
    udid: string,
    pluginArgs: IPluginArgs,
    hostPort: number,
  ): Promise<IDevice> {
    const store = DeviceStoreFactory.getStore();
    const storeDevice = await store.findDevice({ udid });

    let host: string;
    if (pluginArgs.remoteMachineProxyIP) {
      host = String(pluginArgs.remoteMachineProxyIP);
    } else {
      host = `http://${pluginArgs.bindHostOrIp}:${hostPort}`;
    }
    let wdaLocalPort = storeDevice?.wdaLocalPort;
    let mjpegServerPort = storeDevice?.mjpegServerPort;

    // Principal Port Health Check: If ports are stored but occupied, verify they are responsive
    const { isPortBusy } = await import('../helpers');
    const { default: IOSStreamService } = await import('./ios/IOSStreamService');
    const streamService = Container.get(IOSStreamService);
    const streamStatus = streamService.getStreamStatus(udid);

    // If port is busy but stream service isn't actively managing it, it's a "Zombie" or Collision
    if (wdaLocalPort && (await isPortBusy(wdaLocalPort)) && streamStatus?.status !== 'running') {
      log.warn(
        `[${udid}] WDA Port ${wdaLocalPort} is occupied but stream is inactive. Reclaiming...`,
      );
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execPromise = promisify(exec);
        await execPromise(`lsof -ti :${wdaLocalPort} | xargs kill -9`).catch(() => { });
        // Wait for OS to release
        await new Promise((r) => setTimeout(r, 500));
      } catch (e) {
        log.error(`Failed to reclaim port ${wdaLocalPort}, will select a new one.`);
        wdaLocalPort = undefined;
      }
    }

    if (!wdaLocalPort) wdaLocalPort = await getFreePort();
    if (!mjpegServerPort || (await isPortBusy(mjpegServerPort)))
      mjpegServerPort = await getFreePort();
    const totalUtilizationTimeMilliSec = await getUtilizationTime(udid);

    let sdk = 'Unknown';
    let name = 'iPhone';

    try {
      [sdk, name] = await Promise.all([this.getOSVersion(udid), this.getDeviceName(udid)]);
    } catch (e: any) {
      log.error(`Critical error during metadata discovery for ${udid}: ${e.message}`);
    }

    return Object.assign(
      {
        wdaLocalPort,
        mjpegServerPort,
        udid,
        sdk,
        name,
        busy: false,
        realDevice: true,
        deviceType: 'real',
        platform: this.getDevicePlatformName(name) as any,
        host,
        totalUtilizationTimeMilliSec: totalUtilizationTimeMilliSec,
        sessionStartTime: 0,
        screenWidth: storeDevice?.screenWidth,
        screenHeight: storeDevice?.screenHeight,
        state: storeDevice?.state || 'Unknown',
        userBlocked: storeDevice?.userBlocked || false,
      },
      storeDevice || {},
    );
  }

  async getAdditionalDeviceInfo(device: IDevice): Promise<Partial<IDevice>> {
    log.info(`Fetching additional iOS device info for ${device.udid} (Lazy Loading)`);
    const result: Partial<IDevice> = {
      derivedDataPath: this.prepareDerivedDataPath(
        this.pluginArgs.derivedDataPath,
        device.udid,
        device.realDevice,
      ),
    };

    // Try to get screen dimensions from cache/store
    const streamStatus = Container.get(IOSStreamService).getStreamStatus(device.udid);
    if (streamStatus?.screenWidth && streamStatus?.screenHeight) {
      result.screenWidth = String(streamStatus.screenWidth);
      result.screenHeight = String(streamStatus.screenHeight);
    } else {
      // Fallback: Query store directly for persisted dimensions
      const store = DeviceStoreFactory.getStore();
      const storeDevice = await store.findDevice({ udid: device.udid });
      if (storeDevice?.screenWidth) {
        result.screenWidth = storeDevice.screenWidth;
        result.screenHeight = storeDevice.screenHeight;
      }
    }
    return result;
  }

  /**
   * Method to get all ios simulators
   *
   * @returns {Promise<Array<IDevice>>}
   */
  public async getSimulators(): Promise<Array<IDevice>> {
    const simulators = await this.fetchLocalSimulators();
    simulators.sort((a, b) => (a.state > b.state ? 1 : -1));

    // should not be here, but we need to update the hub with simulators
    if (this.pluginArgs.hub !== undefined) {
      log.info('Updating Hub with Simulators');
      const nodeDevices = new NodeDevices(this.pluginArgs.hub);
      await nodeDevices.postDevicesToHub(simulators, 'add');
    }

    return simulators;
  }

  public async fetchLocalSimulators() {
    log.debug('Fetching local simulators');
    const flattenValued = await this.getLocalSims();
    let filteredSimulators: Array<IDevice> = [];
    const localPluginArgs = this.pluginArgs;
    if (this.pluginArgs.simulators !== undefined) {
      filteredSimulators = flattenValued.filter((device: IDevice) =>
        localPluginArgs.simulators.some(
          (simulator: IDevice) => device.name === simulator.name && device.sdk === simulator.sdk,
        ),
      );
    }

    const buildSimulators = !isEmpty(filteredSimulators) ? filteredSimulators : flattenValued;

    const simulatorProcessingPromises = buildSimulators.map(async (device) => {
      const wdaLocalPort = await getFreePort();
      const mjpegServerPort = await getFreePort();
      const totalUtilizationTimeMilliSec = await getUtilizationTime(device.udid);
      return Object.assign({
        ...device,
        wdaLocalPort,
        mjpegServerPort,
        busy: false,
        realDevice: false,
        platform: this.getDevicePlatformName(device.name),
        deviceType: 'simulator',
        host: `http://${this.pluginArgs.bindHostOrIp}:${this.hostPort}`,
        totalUtilizationTimeMilliSec: totalUtilizationTimeMilliSec,
        sessionStartTime: 0,
      });
    });

    return await Promise.all(simulatorProcessingPromises);
  }

  private async getLocalSims(): Promise<Array<IDevice>> {
    try {
      const simctl = new Simctl();
      // list runtimes and log availability errors
      const list = await simctl.list();
      const runtimes = list.runtimes;
      const unAavailableRuntimes = runtimes
        .filter((runtime: any) => !runtime.isAvailable)
        .map((runtime: any) => runtime.name);
      if (unAavailableRuntimes.length > 0) {
        log.error(`The following runtimes are not available: ${unAavailableRuntimes.join(', ')}`);
      }

      const iOSSimulators = flatten(Object.values(await simctl.getDevices(null, 'iOS'))).length > 1;
      const tvSimulators = flatten(Object.values(await simctl.getDevices(null, 'tvOS'))).length > 1;

      log.debug(`iOS Simulators: ${iOSSimulators}`);
      log.debug(`tvOS Simulators: ${tvSimulators}`);

      let iosSimulators: any = [];
      let tvosSimulators: any = [];
      if (iOSSimulators) {
        iosSimulators = flatten(
          Object.values((await simctl.getDevicesByParsing('iOS')) as Array<IDevice>),
        );
      } else {
        log.info('No iOS simulators found!');
      }

      if (tvSimulators) {
        tvosSimulators = flatten(
          Object.values((await simctl.getDevicesByParsing('tvOS')) as Array<IDevice>),
        );
      } else {
        log.info('No tvOS simulators found!');
      }
      let simulators = [...iosSimulators, ...tvosSimulators];
      if (this.pluginArgs.bootedSimulators) {
        simulators = simulators.filter((device: IDevice) => device.state === 'Booted');
      }
      return simulators;
    } catch (error) {
      log.error(error);
      return [];
    }
  }

  private wdaConnectionCache: Map<
    string,
    { host: string; pathPrefix: string; sessionId?: string }
  > = new Map();

  // Sequential command queues per device (UDID) to avoid WDA congestion
  private commandQueues: Map<string, Promise<any>> = new Map();

  /**
   * Serializes WDA commands for a specific device.
   * Ensures only one WDA request is active at a time to prevent congestion.
   */
  private async executeSerializedCommand<T>(udid: string, action: () => Promise<T>): Promise<T> {
    const currentQueue = this.commandQueues.get(udid) || Promise.resolve();

    const nextInQueue = currentQueue
      .catch(() => { }) // Ensure we always continue even if previous command failed
      .then(async () => {
        try {
          return await action();
        } catch (err: any) {
          throw err;
        }
      })
      .finally(() => {
        // Clean up queue if it's the last one
        if (this.commandQueues.get(udid) === nextInQueue) {
          this.commandQueues.delete(udid);
        }
      });

    this.commandQueues.set(udid, nextInQueue);
    return nextInQueue;
  }

  private async sendWDACommand(
    udid: string,
    method: 'get' | 'post',
    endpoint: string,
    data?: any,
  ): Promise<any> {
    // Read-only status/health checks skip serialization to avoid blocking health monitor
    // and to prevent infinite loops during sensitive discovery phases.
    if (
      endpoint === '/status' ||
      endpoint === '/health' ||
      (method === 'get' && endpoint === '/sessions')
    ) {
      return this.performWDACommand(udid, method, endpoint, data);
    }
    // Internally serialize all state-changing WDA commands
    return this.executeSerializedCommand(udid, () =>
      this.performWDACommand(udid, method, endpoint, data),
    );
  }

  private async performWDACommand(
    udid: string,
    method: 'get' | 'post',
    endpoint: string,
    data?: any,
  ): Promise<any> {
    const device = await this.getDeviceOrSimulator(udid);
    if (!device) return null;

    const streamStatus = Container.get(IOSStreamService).getStreamStatus(udid);
    const port =
      streamStatus?.status === 'running' || streamStatus?.status === 'starting'
        ? streamStatus.wdaPort
        : device.wdaLocalPort;

    if (!port) return null;

    const cacheKey = `${udid}:${port}`;
    let cached = this.wdaConnectionCache.get(cacheKey);

    // If no cached session, try to get session from the stream service
    if (!cached?.sessionId) {
      const streamSessionId = Container.get(IOSStreamService).getWDASessionId(udid);
      if (streamSessionId) {
        log.debug(`Using shared WDA session ${streamSessionId} from stream service for ${udid}`);
        cached = {
          host: '127.0.0.1',
          pathPrefix: `/session/${streamSessionId}`,
          sessionId: streamSessionId,
        };
        this.wdaConnectionCache.set(cacheKey, cached);
      }
    }

    // Tiered Session Discovery: Avoid discovery overhead for every request
    const pathPrefixes = cached?.sessionId
      ? [`/session/${cached.sessionId}`] // Fast path: Use known active session
      : ['/session/None', '', '/session/any']; // Discovery path

    const hosts = cached
      ? [cached.host] // Fast path: Use known host
      : ['127.0.0.1']; // Force IPv4 for reliable tunnel access, avoid ::1 fallback

    let lastError: any = new Error('No connection attempts were successful');

    // Higher-level retry loop for network-level failures (ECONNRESET, etc)
    const MAX_NETWORK_RETRIES = 3;
    let networkRetryCount = 0;

    while (networkRetryCount < MAX_NETWORK_RETRIES) {
      networkRetryCount++;
      for (const host of hosts) {
        for (const prefix of pathPrefixes) {
          try {
            // SCENE: Don't use session prefix for status/health checks as they are usually root-level
            const effectivePrefix = endpoint === '/status' || endpoint === '/health' ? '' : prefix;
            const url = `http://${host}:${port}${effectivePrefix}${endpoint}`;

            // Senior Resilience: Disable keepAlive for tunnel-based WDA to avoid socket reset issues
            const config = {
              timeout: 10000,
              httpAgent: new http.Agent({ keepAlive: false }),
            };

            let response;
            if (method === 'post') {
              response = await axios.post(url, data || {}, config);
            } else {
              response = await axios.get(url, config);
            }

            // Principal Optimization: Cache the session ID aggressively
            if (!cached?.sessionId || response.data?.sessionId) {
              const sid = response.data?.sessionId || response.data?.value?.sessionId;
              if (sid && sid !== cached?.sessionId) {
                log.info(`Locked WDA SessionID for ${udid}: ${sid}`);
                this.wdaConnectionCache.set(cacheKey, {
                  host,
                  pathPrefix: `/session/${sid}`,
                  sessionId: sid,
                });
                // Share with stream service
                Container.get(IOSStreamService).setWDASessionId(udid, sid);
              }
            }
            log.debug(`[WDA] ${method.toUpperCase()} ${endpoint} -> ${response.status}`);
            return response;
          } catch (err: any) {
            lastError = err;

            // If a known session fails with 404, it's likely expired or invalid.
            if (cached?.sessionId && err.response?.status === 404) {
              log.warn(`WDA Session ${cached.sessionId} invalid for ${udid}, clearing all caches.`);
              this.wdaConnectionCache.delete(cacheKey);
              // ALSO clear from stream service to avoid getting the same ID on retry
              Container.get(IOSStreamService).setWDASessionId(udid, undefined);

              cached = undefined;
              // Immediate retry with discovery path - only once per logical command
              if (!data?.__isRetry) {
                return this.performWDACommand(udid, method, endpoint, {
                  ...(data || {}),
                  __isRetry: true,
                });
              }
            }

            if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
              lastError = err;
              // Aggressive Cache Purge: Force rediscovery on next retry
              this.wdaConnectionCache.delete(cacheKey);
              Container.get(IOSStreamService).setWDASessionId(udid, undefined);
              cached = undefined;
              continue; // Try next host/prefix in this attempt
            }
            if (err.response?.status === 404) continue;
            break;
          }
        }
      }

      if (lastError.code === 'ECONNREFUSED' || lastError.code === 'ECONNRESET') {
        log.warn(
          `[WDA] ${lastError.code} for ${udid} (Attempt ${networkRetryCount}/${MAX_NETWORK_RETRIES}). Purging cache and backoff...`,
        );

        // Senior Resilience: Trigger proactive stream restart if it's a real device.
        // This bridges the gap between managed proxies (iproxy) and WDA.
        if (device.realDevice && !device.cloud) {
          log.info(`[WDA] Detected tunnel/WDA crash for ${udid}. Triggering immediate stream-aware recovery...`);
          try {
            const streamService = Container.get(IOSStreamService);
            // Don't await here to avoid blocking the retry loop, BUT the next retry 
            // will benefit from the started startup promise in IOSStreamService.
            // If it's already starting, startStream returns the same promise.
            streamService.startStream(udid).catch((e) => log.error(`Stream-aware recovery failed: ${e}`));
          } catch (e) {
            log.warn(`Failed to access stream service for recovery: ${e}`);
          }
        }

        // Backoff delay to let the instrumentation stack recover
        await new Promise((r) => setTimeout(r, 1200));
      } else {
        break;
      }
    }

    // Principal Recovery: If all paths failed with 404 or we have no session, attempt recovery.
    // IMPORTANT: Do NOT create new sessions for keyboard/action endpoints - it disrupts the app and can lock the phone.
    // Only recover existing sessions or skip if none available.
    const keyboardEndpoints = ['/actions', '/wda/keys', '/keys', '/wda/type'];
    const isKeyboardAction = keyboardEndpoints.some((ep) => endpoint.includes(ep));

    if (
      (lastError.response?.status === 404 || !cached?.sessionId) &&
      endpoint !== '/status' &&
      !endpoint.includes('/session')
    ) {
      log.info(`WDA for ${udid} seems session-less or lost. Attempting recovery...`);

      // Tier 1: Try to recover an existing session first (GET /sessions)
      const recoveredSid = await this.recoverWDASession(udid, port);
      if (recoveredSid && !data?.__isRetry) {
        log.info(`Recovered orphaned WDA session ${recoveredSid} for ${udid}. Retrying command...`);
        return this.performWDACommand(udid, method, endpoint, { ...(data || {}), __isRetry: true });
      }

      // Tier 2: Only create new session for non-keyboard operations
      // Keyboard operations work session-less or need user's active context
      if (!isKeyboardAction) {
        const newSid = await this.ensureWDASession(udid, port);
        if (newSid && !data?.__isRetry) {
          log.info(
            `Successfully created new WDA session ${newSid} for ${udid}. Retrying command...`,
          );
          return this.performWDACommand(udid, method, endpoint, {
            ...(data || {}),
            __isRetry: true,
          });
        }
      } else {
        log.warn(
          `Skipping session creation for keyboard action ${endpoint} - would disrupt app state.`,
        );
      }
    }

    log.error(`WDA command failed for ${udid} (${endpoint}): ${lastError?.message || lastError}`);
    throw lastError;
  }

  /**
   * Ensure a valid WDA session exists. If not, create one.
   */
  private async ensureWDASession(udid: string, port: number): Promise<string | null> {
    const createSession = async (caps: any) => {
      return await axios.post(`http://127.0.0.1:${port}/session`, caps, {
        timeout: 20000,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const sessionConfigs = [
      // Standard WDA Session Creation
      {
        capabilities: {
          alwaysMatch: {
            bundleId: 'com.apple.springboard',
            shouldWaitForQuiescence: false,
            shouldUseTestManagerForVisibilityDetection: false,
            maxTypingFrequency: 60,
            shouldUseSingletonTestManager: false,
          },
        },
      },
      // Minimal recovery config (empty capabilities)
      { capabilities: { alwaysMatch: {} } },
      // Legacy JWP format fallback
      { desiredCapabilities: { bundleId: 'com.apple.springboard' } },
    ];

    for (const config of sessionConfigs) {
      try {
        log.info(
          `Attempting WDA session creation for ${udid} with config: ${JSON.stringify(config)}`,
        );
        const response = await createSession(config);
        const sid = response.data?.sessionId || response.data?.value?.sessionId;
        if (sid) {
          const cacheKey = `${udid}:${port}`;
          this.wdaConnectionCache.set(cacheKey, {
            host: '127.0.0.1',
            pathPrefix: `/session/${sid}`,
            sessionId: sid,
          });
          // Share session with stream service
          Container.get(IOSStreamService).setWDASessionId(udid, sid);
          return sid;
        }
      } catch (err: any) {
        log.warn(
          `WDA session creation failed for ${udid} (config skipped): ${err.response?.status} ${err.message}`,
        );
      }
    }

    log.error(`All WDA session creation attempts failed for ${udid}`);
    return null;
  }

  /**
   * Attempt to recover an existing session by querying WDA's /sessions endpoint
   */
  private async recoverWDASession(udid: string, port: number): Promise<string | null> {
    try {
      log.info(`Attempting to recover existing WDA sessions for ${udid} on port ${port}...`);
      const response = await axios.get(`http://127.0.0.1:${port}/sessions`, { timeout: 5000 });
      const sessions = response.data?.value || [];
      if (sessions.length > 0) {
        const sid = sessions[0].id || sessions[0].sessionId;
        if (sid) {
          log.info(`Found orphaned WDA session ${sid} for ${udid}, re-caching...`);
          const cacheKey = `${udid}:${port}`;
          this.wdaConnectionCache.set(cacheKey, {
            host: '127.0.0.1',
            pathPrefix: `/session/${sid}`,
            sessionId: sid,
          });
          // Share session with stream service
          Container.get(IOSStreamService).setWDASessionId(udid, sid);
          return sid;
        }
      }
    } catch (err: any) {
      log.debug(`Failed to recover WDA sessions for ${udid}: ${err.message}`);
    }
    return null;
  }

  // Interaction methods
  // For iOS, these now use WDA directly with performance optimizations

  async tap(udid: string, x: number, y: number): Promise<void> {
    log.info(`iOS Tap on ${udid} at ${x},${y}`);
    const roundedX = Math.round(x);
    const roundedY = Math.round(y);

    // Principal Fix: Use W3C Actions API for maximum compatibility.
    // The /wda/tap endpoint is not universally supported by all WDA versions.
    try {
      await this.sendWDACommand(udid, 'post', '/actions', {
        actions: [
          {
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: roundedX, y: roundedY },
              { type: 'pointerDown', button: 0 },
              { type: 'pause', duration: 50 },
              { type: 'pointerUp', button: 0 },
            ],
          },
        ],
      });
    } catch (actionsError: any) {
      // Fallback: Try legacy /wda/tap endpoint for older WDA builds
      log.warn(
        `W3C Actions API tap failed for ${udid}, trying /wda/tap fallback: ${actionsError.message}`,
      );
      await this.sendWDACommand(udid, 'post', '/wda/tap', { x: roundedX, y: roundedY });
    }
  }

  async swipe(
    udid: string,
    x: number,
    y: number,
    endX: number,
    endY: number,
    duration: number,
  ): Promise<void> {
    log.info(`iOS Swipe on ${udid}: (${x},${y}) -> (${endX},${endY})`);

    const performSwipe = async () => {
      try {
        // High-speed direct WDA swipe
        await this.sendWDACommand(udid, 'post', '/wda/swipe', {
          startX: Math.round(x),
          startY: Math.round(y),
          endX: Math.round(endX),
          endY: Math.round(endY),
          delay: Math.max(0.1, duration / 1000),
        });
      } catch (err: any) {
        log.warn(`WDA /wda/swipe failed for ${udid}, using performActions fallback...`);
        try {
          // XCUITest Action Chain (slow but 100% reliable regardless of viewport/scaling)
          await this.sendWDACommand(udid, 'post', '/actions', {
            actions: [
              {
                type: 'pointer',
                id: 'finger1',
                parameters: { pointerType: 'touch' },
                actions: [
                  { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y) },
                  { type: 'pointerDown', button: 0 },
                  { type: 'pause', duration: 100 },
                  {
                    type: 'pointerMove',
                    duration: 500,
                    origin: 'viewport',
                    x: Math.round(endX),
                    y: Math.round(endY),
                  },
                  { type: 'pointerUp', button: 0 },
                ],
              },
            ],
          });
        } catch (e: any) {
          log.error(`All swipe methods failed for ${udid}: ${e.message}`);
        }
      }
    };

    // Priority Fix: Must await for UI sync and queue order
    await performSwipe();
  }

  // Debouncing state for iOS typing - batches rapid keystrokes
  private typeBuffers: Map<
    string,
    { text: string; timer: NodeJS.Timeout | null; pending: boolean }
  > = new Map();

  async typeText(udid: string, text: string): Promise<void> {
    log.info(`iOS typing for ${udid}: "${text}"`);

    // Get or create buffer for this device
    let buffer = this.typeBuffers.get(udid);
    if (!buffer) {
      buffer = { text: '', timer: null, pending: false };
      this.typeBuffers.set(udid, buffer);
    }

    // Append new text to buffer
    buffer.text += text;

    // Clear existing timer
    if (buffer.timer) {
      clearTimeout(buffer.timer);
    }

    // If a request is already pending, just buffer the text
    if (buffer.pending) {
      log.debug(`iOS typing: Request pending for ${udid}, buffering "${text}"`);
      return;
    }

    // Set debounce timer - wait 150ms for more keystrokes before sending
    buffer.timer = setTimeout(() => {
      this.flushTypeBuffer(udid);
    }, 150);
  }

  private async flushTypeBuffer(udid: string): Promise<void> {
    const buffer = this.typeBuffers.get(udid);
    if (!buffer || buffer.text.length === 0) return;

    // Grab the current text and clear buffer
    const textToSend = buffer.text;
    buffer.text = '';
    buffer.timer = null;
    buffer.pending = true;

    log.info(`iOS typing: Sending batched text "${textToSend}" for ${udid}`);

    try {
      // Use only /wda/type - the fastest endpoint that handles full strings
      // Don't cascade through fallbacks - that creates request pileup
      await this.sendWDACommand(udid, 'post', '/wda/type', { text: textToSend });
      log.debug(`iOS typing: Successfully sent "${textToSend}" for ${udid}`);
    } catch (err: any) {
      log.warn(
        `iOS typing failed for ${udid}: ${err.message}. Text "${textToSend}" may not have been typed.`,
      );
    } finally {
      buffer.pending = false;

      // If more text accumulated while we were sending, flush again
      if (buffer.text.length > 0) {
        log.debug(`iOS typing: More text buffered during send, flushing again for ${udid}`);
        setTimeout(() => this.flushTypeBuffer(udid), 50);
      }
    }
  }

  private async sendWDACommandWithTimeout(
    udid: string,
    method: 'get' | 'post',
    endpoint: string,
    data: any,
    timeoutMs: number,
  ): Promise<any> {
    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    // Race between the actual command and timeout
    return Promise.race([this.sendWDACommand(udid, method, endpoint, data), timeoutPromise]);
  }

  async pressKey(udid: string, keyCode: string | number): Promise<void> {
    log.info(`iOS Press Key on ${udid}: ${keyCode}`);
    const name = keyCode.toString().toLowerCase();

    // Mapping for Home button - This always works
    if (name === 'home' || keyCode === 3) {
      try {
        await this.sendWDACommand(udid, 'post', '/wda/homescreen', {});
        return;
      } catch (e) {
        try {
          await this.sendWDACommand(udid, 'post', '/wda/pressButton', { name: 'home' });
          return;
        } catch (e2: any) {
          log.error(`iOS Home button failed for ${udid}: ${e2.message}`);
          throw e2;
        }
      }
    }

    // For keyboard keys - requires active keyboard/text field on iOS
    // W3C WebDriver key values: https://www.w3.org/TR/webdriver/#keyboard-actions
    let w3cValue = '';
    let legacyValue = '';

    if (name === 'enter' || name === 'return' || keyCode === 13) {
      w3cValue = '\uE007'; // W3C Enter
      legacyValue = '\n';
    } else if (name === 'backspace' || keyCode === 8 || name === 'back' || keyCode === 67) {
      w3cValue = '\uE003'; // W3C Backspace
      legacyValue = '\u0008';
    } else if (name === 'tab' || keyCode === 9) {
      w3cValue = '\uE004';
      legacyValue = '\t';
    } else if (name === 'escape' || keyCode === 27) {
      w3cValue = '\uE00C';
      legacyValue = '\u001b';
    }

    if (w3cValue) {
      const errors: string[] = [];

      // Tier 1: W3C Actions API with proper key codes (most reliable for special keys)
      try {
        log.debug(`iOS PressKey: Trying W3C Actions API for ${name}`);
        await this.sendWDACommand(udid, 'post', '/actions', {
          actions: [
            {
              type: 'key',
              id: 'keyboard',
              actions: [
                { type: 'keyDown', value: w3cValue },
                { type: 'keyUp', value: w3cValue },
              ],
            },
          ],
        });
        log.info(`iOS PressKey: W3C Actions succeeded for ${name}`);
        return;
      } catch (err: any) {
        errors.push(`W3C Actions: ${err.message}`);
        log.debug(`iOS PressKey W3C Actions failed: ${err.message}`);
      }

      // Tier 2: WDA Keys with legacy value
      try {
        log.debug(`iOS PressKey: Trying /wda/keys for ${name}`);
        await this.sendWDACommand(udid, 'post', '/wda/keys', { value: [legacyValue] });
        log.info(`iOS PressKey: /wda/keys succeeded for ${name}`);
        return;
      } catch (err: any) {
        errors.push(`/wda/keys: ${err.message}`);
        log.debug(`iOS PressKey /wda/keys failed: ${err.message}`);
      }

      // Tier 3: Standard WebDriver /keys
      try {
        log.debug(`iOS PressKey: Trying /keys for ${name}`);
        await this.sendWDACommand(udid, 'post', '/keys', { value: [legacyValue] });
        log.info(`iOS PressKey: /keys succeeded for ${name}`);
        return;
      } catch (err: any) {
        errors.push(`/keys: ${err.message}`);
        log.debug(`iOS PressKey /keys failed: ${err.message}`);
      }

      // All tiers failed
      const errorMsg = `iOS keyboard key '${name}' failed. Ensure a text field is focused. Errors: ${errors.join(
        '; ',
      )}`;
      log.error(errorMsg);
      throw new Error(errorMsg);
    }

    // For volume/other hardware buttons
    try {
      const buttonName = name === 'backspace' ? 'delete' : name;
      await this.sendWDACommand(udid, 'post', '/wda/pressButton', { name: buttonName });
    } catch (err: any) {
      log.error(`WDA pressButton failed for ${udid} (${name}): ${err.message}`);
      throw err;
    }
  }

  async installApp(udid: string, appPath: string): Promise<void> {
    // Use go-ios for installation if available
    const goIOS = Container.get(IOSStreamService);
    if (await goIOS.isGoIOSAvailable()) {
      try {
        // iOS 17+ requires a tunnel for go-ios apps command
        await goIOS.ensureTunnel(udid);

        // Use the public goIOSPath
        await execPromise(`"${goIOS.goIOSPath}" install --path="${appPath}" --udid ${udid}`, {
          env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
        });
      } catch (err: any) {
        log.error(`Installation via go-ios failed: ${err.message}`);
        throw err;
      }
    } else {
      // Fallback to ideviceinstaller
      try {
        await execPromise(`ideviceinstaller -u ${udid} -i "${appPath}"`);
      } catch (err: any) {
        log.error(`Installation via ideviceinstaller failed: ${err.message}`);
        throw err;
      }
    }
  }

  async uninstallApp(udid: string, bundleId: string): Promise<void> {
    const goIOS = Container.get(IOSStreamService);
    if (await goIOS.isGoIOSAvailable()) {
      try {
        await execPromise(`"${goIOS.goIOSPath}" uninstall "${bundleId}" --udid ${udid}`, {
          env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
        });
      } catch (err: any) {
        log.warn(`go-ios uninstall failed, trying ideviceinstaller: ${err.message}`);
        try {
          await execPromise(`ideviceinstaller -u ${udid} -U ${bundleId}`);
        } catch (e: any) {
          log.error(`ideviceinstaller uninstall failed: ${e.message}`);
        }
      }
    } else {
      try {
        await execPromise(`ideviceinstaller -u ${udid} -U ${bundleId}`);
      } catch (err: any) {
        log.error(`Uninstall might have failed: ${err.message}`);
      }
    }
  }

  async getScreenshot(udid: string): Promise<string> {
    log.info(`iOS Get Screenshot on ${udid}`);

    // Try go-ios first as it's faster and works even if WDA is unresponsive
    const goIOS = Container.get(IOSStreamService);
    if (await goIOS.isGoIOSAvailable()) {
      try {
        const localPath = path.join(os.tmpdir(), `screenshot-${udid}.png`);
        await execPromise(`"${goIOS.goIOSPath}" screenshot --udid ${udid} --output "${localPath}"`, {
          env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
        });

        // Validation Layer: Ensure file exists and is not empty
        const stats = await fs.stat(localPath);
        if (stats.size === 0) {
          throw new Error('go-ios captured an empty 0-byte file.');
        }

        const buffer = await fs.readFile(localPath);
        // Clean up
        await fs.remove(localPath);
        this.log.info(`[iOS] Captured ${stats.size} bytes via go-ios for ${udid}`);
        return buffer.toString('base64');
      } catch (err: any) {
        log.warn(`go-ios screenshot failed for ${udid}: ${err.message}. Buffering 1s before WDA fallback...`);
        // Instrumentation breathing room
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    try {
      const response = await this.sendWDACommand(udid, 'get', '/screenshot');
      if (response.data && response.data.value) {
        const val = response.data.value;
        return typeof val === 'string' ? val : val.screenshot || '';
      }
    } catch (err: any) {
      log.warn(`WDA Screenshot failed for ${udid}: ${err?.message || err}`);
    }

    const device = await this.getDeviceOrSimulator(udid);
    if (device && !device.realDevice) {
      const localPath = path.join(os.tmpdir(), `screenshot-${udid}.png`);
      try {
        await execPromise(`xcrun simctl io ${udid} screenshot ${localPath}`);
        const stats = await fs.stat(localPath);
        if (stats.size === 0) {
          throw new Error('simctl captured an empty 0-byte file.');
        }
        const buffer = await fs.readFile(localPath);
        await fs.remove(localPath);
        this.log.info(`[iOS] Captured ${stats.size} bytes via simctl for ${udid}`);
        return buffer.toString('base64');
      } catch (err: any) {
        log.error(`Screenshot failed for simulator ${udid}: ${err.message}`);
        return '';
      }
    }
    return '';
  }

  private async getWDABundleId(udid: string): Promise<string> {
    const goIOS = Container.get(IOSStreamService);
    if (await goIOS.isGoIOSAvailable()) {
      try {
        const { stdout } = await execPromise(`"${goIOS.goIOSPath}" apps --udid ${udid}`, {
          env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
        });
        // Response can be JSON or text based on version
        try {
          const apps = JSON.parse(stdout);
          const wda = apps.find(
            (a: any) =>
              (a.CFBundleIdentifier && a.CFBundleIdentifier.includes('WebDriverAgentRunner')) ||
              (a.CFBundleName && a.CFBundleName.includes('WebDriverAgentRunner')),
          );
          if (wda) return wda.CFBundleIdentifier;
        } catch (e) {
          const match = stdout.match(/(com\..*WebDriverAgentRunner\.xctrunner)/);
          if (match) return match[1];
        }
      } catch (e) {
        // ignore
      }
    }
    return 'com.facebook.WebDriverAgentRunner.xctrunner';
  }

  async getClipboard(udid: string): Promise<string> {
    log.info(`iOS Get Clipboard on ${udid}`);
    const wdaBundleId = await this.getWDABundleId(udid);

    try {
      // 1. Try to foreground WDA using WDA API first
      try {
        await this.sendWDACommand(udid, 'post', '/wda/apps/activate', { bundleId: wdaBundleId });
      } catch (e) {
        // Fallback: Use go-ios to force launch if WDA API is restricted (400/403)
        const goIOS = Container.get(IOSStreamService);
        if (await goIOS.isGoIOSAvailable()) {
          log.info(`WDA activate failed, trying go-ios launch for ${udid}`);
          await execPromise(`"${goIOS.goIOSPath}" launch ${wdaBundleId} --udid ${udid}`, {
            env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
          });
        }
      }

      // Sync wait for iOS pasteboard hardware buffer to flush to foreground app
      await new Promise((r) => setTimeout(r, 1200));

      // 2. Fetch the pasteboard content (Try multiple standard WDA endpoints)
      let response;
      const endpoints = ['/wda/getPasteboard', '/pasteboard'];
      for (const ep of endpoints) {
        try {
          response = await this.sendWDACommand(udid, 'post', ep, { contentType: 'plaintext' });

          // Check if an alert is blocking us (iOS 16+ "Allow Paste" privacy dialog)
          const alertTextRes = await this.sendWDACommand(udid, 'get', '/alert/text').catch(
            () => null,
          );
          const alertText = alertTextRes?.data?.value || '';
          if (alertText.toLowerCase().includes('paste')) {
            log.info(`Detected Paste Permission alert on ${udid}. Accepting...`);
            await this.sendWDACommand(udid, 'post', '/alert/accept', {}).catch(() => { });
            await new Promise((r) => setTimeout(r, 1000));
            // Retry fetch after accepting
            response = await this.sendWDACommand(udid, 'post', ep, { contentType: 'plaintext' });
          }

          if (response?.data?.value) break;
        } catch (e) {
          // ignore error and try next endpoint
        }
      }

      log.info(`WDA raw clipboard response for ${udid}: ${JSON.stringify(response?.data)}`);

      const base64Content = response?.data?.value;
      if (base64Content) {
        if (typeof base64Content === 'object') return JSON.stringify(base64Content);
        try {
          const decoded = Buffer.from(base64Content, 'base64').toString('utf8');
          // Basic printable check
          if (/^[\x20-\x7E\s]*$/.test(decoded) || decoded.length === 0) return decoded;
          return decoded;
        } catch (e) {
          return String(base64Content);
        }
      }
    } catch (err: any) {
      log.warn(`Comprehensive clipboard fetch failed for ${udid}: ${err.message}`);
    }
    return '';
  }

  async setClipboard(udid: string, content: string): Promise<void> {
    log.info(`iOS Set Clipboard on ${udid}`);
    try {
      // WDA expects base64 encoded content for setPasteboard
      const base64Content = Buffer.from(content).toString('base64');
      await this.sendWDACommand(udid, 'post', '/wda/setPasteboard', {
        content: base64Content,
        contentType: 'plaintext',
      });
    } catch (err: any) {
      log.warn(`WDA SetPasteboard failed for ${udid}: ${err.message}`);
    }
  }

  async lock(udid: string): Promise<void> {
    log.info(`iOS Lock on ${udid}`);
    try {
      await this.sendWDACommand(udid, 'post', '/wda/lock', {});
    } catch (err) {
      // ignore
    }
  }

  async unlock(udid: string): Promise<void> {
    log.info(`iOS Unlock on ${udid}`);
    try {
      await this.sendWDACommand(udid, 'post', '/wda/unlock', {});
    } catch (err) {
      // ignore
    }
  }

  private async getDeviceOrSimulator(udid: string): Promise<IDevice | null> {
    return await DeviceStoreFactory.getStore().findDevice({ udid });
  }

  async listApps(udid: string): Promise<string[]> {
    const device = await this.getDeviceOrSimulator(udid);
    if (!device) return [];

    if (device.realDevice) {
      const goIOS = Container.get(IOSStreamService);
      if (await goIOS.isGoIOSAvailable()) {
        try {
          const { stdout } = await execPromise(`"${goIOS.goIOSPath}" apps --udid ${udid}`, {
            env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
          });
          // go-ios 1.0.134+ outputs JSON by default
          try {
            const appsJson = JSON.parse(stdout);
            if (Array.isArray(appsJson)) {
              return appsJson
                .map((app: any) => app.CFBundleIdentifier || app.bundleId)
                .filter(Boolean)
                .sort();
            }
          } catch (e) {
            // Fallback for older versions or non-json output
            return (
              stdout
                .split('\n')
                .map((l) => l.trim())
                // Robust regex to find bundle IDs in text: com.example.app
                .filter((l) => /^[a-zA-Z0-9.-]+$/.test(l))
                .sort()
            );
          }
        } catch (err) {
          log.error(`Failed to list apps via go-ios: ${err}`);
        }
      }
    } else {
      // Simulator
      try {
        const { stdout } = await execPromise(`xcrun simctl listapps ${udid}`);
        // Parse simctl listapps output
        const apps: string[] = [];
        const lines = stdout.split('\n');
        for (const line of lines) {
          // Robust regex for simctl listapps output like: "com.apple.Maps" = { ... }
          const match = line.match(/^\s*"?([a-z0-9.-]+)"?\s*=/i);
          if (match) apps.push(match[1]);
        }
        return apps.sort();
      } catch (err) {
        log.error(`Failed to list apps for simulator: ${err}`);
      }
    }
    return [];
  }

  async getLogs(udid: string): Promise<string> {
    const device = await this.getDeviceOrSimulator(udid);
    if (!device) return 'Device not found';

    if (!device.realDevice) {
      // Simulator logs - Get last 1m of logs
      try {
        const { stdout } = await execPromise(
          `xcrun simctl spawn ${udid} log show --last 1m --style syslog`,
        );
        return stdout || 'No recent logs found';
      } catch (err: any) {
        return `Failed to fetch simulator logs: ${err.message}`;
      }
    } else {
      // Real device logs via go-ios
      const goIOS = Container.get(IOSStreamService);
      if (await goIOS.isGoIOSAvailable()) {
        try {
          // Capture syslog for 2 seconds
          const cmd = `timeout 2 "${goIOS.goIOSPath}" syslog --udid ${udid}`;
          const { stdout } = await execPromise(cmd, {
            env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
          }).catch((e) => e); // timeout will cause non-zero exit
          return stdout || 'Waiting for log stream...';
        } catch (err: any) {
          return `Failed to fetch device logs: ${err.message}`;
        }
      }
      return 'Log streaming requires go-ios to be installed';
    }
  }

  async checkHealth(device: IDevice): Promise<Partial<IDevice>> {
    if (device.cloud) return { healthStatus: 'Healthy' };

    try {
      if (device.realDevice) {
        let batteryLevel: number | undefined;
        let storageFree: string | undefined;
        let thermalStatus: string | undefined = 'Normal';

        // 1. Try to get hardware info via go-ios (Lockdown Baseline)
        const streamService = Container.get(IOSStreamService);
        if (await streamService.isGoIOSAvailable()) {
          const runCmd = async (subCmd: string) => {
            try {
              const { stdout } = await execPromise(
                `"${streamService.goIOSPath}" ${subCmd} --udid ${device.udid}`,
                { env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' } },
              );
              const jsonStartIndex = stdout.indexOf('{');
              const jsonEndIndex = stdout.lastIndexOf('}');
              if (jsonStartIndex !== -1) {
                return JSON.parse(stdout.slice(jsonStartIndex, jsonEndIndex + 1));
              }
              // Return raw if it's not JSON (as we saw with diskspace)
              return { raw: stdout };
            } catch (e) {
              return null;
            }
          };

          const findDeepKey = (obj: any, target: string): any => {
            if (!obj || typeof obj !== 'object') return undefined;
            const foundKey = Object.keys(obj).find((k) => k.toLowerCase() === target.toLowerCase());
            if (foundKey !== undefined && obj[foundKey] !== null) return obj[foundKey];
            for (const k of Object.keys(obj)) {
              const res = findDeepKey(obj[k], target);
              if (res !== undefined) return res;
            }
            return undefined;
          };

          // Step 1: Lockdown Info (Baseline)
          const info = await runCmd('info');
          if (info) {
            batteryLevel =
              findDeepKey(info, 'BatteryCurrentCapacity') ?? findDeepKey(info, 'BatteryLevel');
            const tState = findDeepKey(info, 'ThermalState') ?? findDeepKey(info, 'thermal_status');
            if (tState && tState !== 'Nominal' && tState !== 'Normal')
              thermalStatus = String(tState);
            const disk =
              findDeepKey(info, 'TotalDataAvailable') ??
              findDeepKey(info, 'DataAvailable') ??
              findDeepKey(info, 'AvailableCapacity');
            if (disk) storageFree = `${(Number(disk) / 1024 / 1024 / 1024).toFixed(1)}GB`;
          }

          // Step 2: Dedicated Battery Check (Highly Reliable)
          if (batteryLevel === undefined) {
            const bInfo = await runCmd('batterycheck');
            batteryLevel =
              findDeepKey(bInfo, 'BatteryCurrentCapacity') ?? findDeepKey(bInfo, 'BatteryLevel');
            if (batteryLevel === undefined && bInfo?.raw) {
              const match =
                bInfo.raw.match(/BatteryCurrentCapacity[:\s]*(\d+)/i) ??
                bInfo.raw.match(/Level[:\s]*(\d+)/i);
              if (match) batteryLevel = parseInt(match[1]);
            }
          }

          // Step 3: Dedicated Disk Space (AFC Service)
          if (storageFree === undefined) {
            const dInfo = await runCmd('diskspace');
            const freeBytes =
              findDeepKey(dInfo, 'FreeBytes') ??
              findDeepKey(dInfo, 'FSFreeBytes') ??
              findDeepKey(dInfo, 'FreeSpace');
            if (freeBytes) {
              storageFree = `${(Number(freeBytes) / 1024 / 1024 / 1024).toFixed(1)}GB`;
            } else if (dInfo?.raw) {
              // Handle text output: "FreeSpace: 93.6GB"
              const match = dInfo.raw.match(/FreeSpace[:\s]*([\d.]+G?B?)/i);
              if (match) storageFree = match[1].includes('B') ? match[1] : `${match[1]}GB`;
            }
          }

          log.info(
            `[HealthCheck] [${device.udid}] Stats Collected -> Battery: ${batteryLevel}%, Storage: ${storageFree}`,
          );
        }

        const healthData: Partial<IDevice> = {
          batteryLevel:
            typeof batteryLevel === 'number'
              ? batteryLevel
              : batteryLevel
                ? parseInt(String(batteryLevel))
                : undefined,
          storageFree,
          thermalStatus,
        };

        // 2. Check WDA responsiveness (via strict status check)
        try {
          const streamStatus = streamService.getStreamStatus(device.udid);
          if (!streamStatus) {
            log.debug(`[HealthCheck] [${device.udid}] No active stream. Skipping WDA check.`);
            return { ...healthData, healthStatus: 'Healthy' };
          }

          const isStarting = streamStatus.status === 'starting';
          const elapsedMs = streamStatus.startedAt
            ? Date.now() - new Date(streamStatus.startedAt).getTime()
            : -1;
          const isSettling = streamStatus.status === 'running' && elapsedMs >= 0 && elapsedMs < 60000;

          log.debug(
            `[HealthCheck] [${device.udid}] Guard Check - Status: ${streamStatus.status}, Elapsed: ${elapsedMs}ms, isStarting: ${isStarting}, isSettling: ${isSettling}`,
          );

          if (isStarting || isSettling) {
            log.info(
              `[HealthCheck] [${device.udid}] Stream is ${isStarting ? 'STARTING' : 'SETTLING'}. Skipping WDA check (Settlement progress: ${Math.round(elapsedMs / 1000)}s/60s).`,
            );
            return { ...healthData, healthStatus: 'Healthy' };
          }

          const isReady = await this.verifyWDAStatus(device.udid);
          if (isReady) {
            if (
              healthData.batteryLevel !== undefined &&
              healthData.batteryLevel > 0 &&
              healthData.batteryLevel < 15
            ) {
              return {
                ...healthData,
                healthStatus: 'Unhealthy',
                healthCheckError: `Low battery warning: ${healthData.batteryLevel}%`,
              };
            }
            return { ...healthData, healthStatus: 'Healthy' };
          }
          throw new Error('WebDriverAgent status check failed (unready or slow)');
        } catch (err: any) {
          log.warn(`[HealthCheck] WDA Status fail for ${device.udid}: ${err.message}`);
          return {
            ...healthData,
            healthStatus: 'Unhealthy',
            healthCheckError: `WebDriverAgent not responding: ${err.message}`,
          };
        }
      } else {
        // Simulator health check
        const simctl = new Simctl();
        const list = await simctl.list();
        const devices: any[] = flatten(Object.values(list.devices));
        const sim = devices.find((s: any) => s.udid === device.udid);

        if (sim && (sim.state === 'Booted' || sim.state === 'Shutdown')) {
          return { healthStatus: 'Healthy' };
        }
        return {
          healthStatus: 'Unhealthy',
          healthCheckError: `Simulator in unexpected state: ${sim?.state || 'Not found'}`,
        };
      }
    } catch (err: any) {
      return { healthStatus: 'Unhealthy', healthCheckError: err.message };
    }
  }

  /**
   * Status check helper for internal use.
   */
  private async verifyWDAStatus(udid: string): Promise<boolean> {
    const startTime = Date.now();
    try {
      const status: any = await this.sendWDACommand(udid, 'get', '/status');
      const latency = Date.now() - startTime;

      if (!status || (status.status !== 200 && !status.value)) {
        log.warn(
          `[HealthCheck] [${udid}] WDA unreachable or invalid status: ${status?.status || 'Unknown'}`,
        );
        return false;
      }

      const isReady = status.value?.ready === true;
      if (!isReady) {
        // Soft failure: WDA is reachable but not ready, increment counter
        const softFails = (this.wdaSoftFailures.get(udid) || 0) + 1;
        this.wdaSoftFailures.set(udid, softFails);

        if (softFails <= this.WDA_SOFT_FAIL_MAX) {
          log.debug(`[HealthCheck] [${udid}] WDA reported NOT READY (Soft Fail ${softFails}/${this.WDA_SOFT_FAIL_MAX}). Tolerating...`);
          return true; // Tolerate transient unreadiness
        }

        log.warn(`[HealthCheck] [${udid}] WDA reported NOT READY (Exceeded soft fail threshold: ${softFails}/${this.WDA_SOFT_FAIL_MAX})`);
        return false;
      }

      // Reset soft fail counter on success
      this.wdaSoftFailures.delete(udid);

      if (latency > 1000) {
        log.warn(`[HealthCheck] [${udid}] WDA response SLOW: ${latency}ms (Threshold: 1s)`);
        return false;
      }

      log.debug(`[HealthCheck] [${udid}] WDA is HEALTHY (Latency: ${latency}ms)`);
      return true;
    } catch (err: any) {
      log.warn(`[HealthCheck] [${udid}] WDA connectivity failure: ${err.message}`);
      return false;
    }
  }

  /**
   * Pre-Session Readiness:
   * Mandatory check before every test run.
   */
  async readyForSession(device: IDevice): Promise<boolean> {
    if (device.cloud) return true;

    log.info(`🚀 [SessionStart] Verifying readiness for ${device.udid}...`);

    // Guard: If stream is currently starting, don't trigger another recovery
    const streamService = Container.get(IOSStreamService);
    const streamStatus = streamService.getStreamStatus(device.udid);
    if (streamStatus && streamStatus.status === 'starting') {
      log.info(`🚀 [SessionStart] ${device.udid} stream is already STARTING. Waiting for completion...`);
      // Wait up to 30s for the existing startup to finish
      const startTime = Date.now();
      while (Date.now() - startTime < 30000) {
        const current = streamService.getStreamStatus(device.udid);
        if (current?.status === 'running') return true;
        if (current?.status === 'error') break;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // 1. Initial Check
    let healthy = await this.verifyWDAStatus(device.udid);

    // 2. Automated Recovery (Retry once)
    if (!healthy) {
      log.warn(`⚠️ [SessionStart] ${device.udid} is UNHEALTHY. Triggering emergency recovery...`);
      const recovered = await this.recoverHealth(device);
      if (recovered) {
        log.info(`🔄 [SessionStart] Recovery triggered. Waiting for WDA to settle...`);
        // Wait up to 15s for WDA to settle after recovery
        const startTime = Date.now();
        while (Date.now() - startTime < 15000) {
          healthy = await this.verifyWDAStatus(device.udid);
          if (healthy) break;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }

    if (healthy) {
      log.info(`✅ [SessionStart] ${device.udid} is READY for test run.`);
      return true;
    } else {
      log.error(`❌ [SessionStart] ${device.udid} FAILED readiness check. Aborting session.`);
      return false;
    }
  }

  async recoverHealth(device: IDevice): Promise<boolean> {
    if (device.cloud) return true;

    try {
      if (device.realDevice) {
        // If device is busy with a session, don't interrupt it for recovery
        if (device.busy && device.session_id) {
          log.info(`Skipping auto-recovery for ${device.udid} as it has an active session`);
          return false;
        }

        log.info(
          `🛡️ [Autonomous Watchdog] Attempting auto-recovery for iOS device ${device.udid}...`,
        );
        const streamService = Container.get(IOSStreamService);

        // Final Session Shield check immediately before recovery
        const store = DeviceStoreFactory.getStore();
        const latestDevice = await store.findDevice({ udid: device.udid });
        if (latestDevice && latestDevice.busy) {
          log.info(
            `🛡️ [Autonomous Watchdog] Recovery aborted for ${device.udid}: Device is now BUSY.`,
          );
          return false;
        }

        // Restarting the stream will effectively restart WDA and proxying
        await streamService.startStream(device.udid);

        // Record the healing event
        if (latestDevice) {
          await store.updateDevice(device.udid, device.host, {
            totalHealedCount: (latestDevice.totalHealedCount || 0) + 1,
          });
        }
        return true;
      } else {
        // Simulator recovery
        log.info(`🛡️ Attempting auto-recovery for Simulator ${device.udid}...`);
        const simctl = new Simctl();
        simctl.udid = device.udid;
        try {
          await simctl.shutdownDevice();
          // Small delay for clean shutdown
          await new Promise((r) => setTimeout(r, 2000));
        } catch (e) {
          /* ignore if already shutdown */
        }
        await simctl.bootDevice();
        return true;
      }
    } catch (err: any) {
      log.error(`Auto-recovery failed for ${device.udid}: ${err.message}`);
      return false;
    }
  }

  async executeShell(udid: string, command: string): Promise<string> {
    const ALLOWED_SIMULATOR_COMMANDS = ['listapps', 'get_app_container', 'list', 'getenv'];

    // Commands for real devices via go-ios
    const ALLOWED_REAL_COMMANDS = ['apps', 'info', 'syslog', 'list'];

    const device = await this.getDeviceOrSimulator(udid);
    if (!device) throw new Error(`Device ${udid} not found`);

    const safeCommand = command.trim();
    log.info(`Executing iOS shell command on ${udid}: ${safeCommand}`);

    if (device.realDevice) {
      // Real Device - Use go-ios
      const cmdParts = safeCommand.split(/\s+/);
      const mainCmd = cmdParts[0];

      if (!ALLOWED_REAL_COMMANDS.includes(mainCmd)) {
        throw new Error(`Command '${mainCmd}' is not allowed for real iOS devices.`);
      }

      const streamService = Container.get(IOSStreamService);
      if (!(await streamService.isGoIOSAvailable())) {
        throw new Error('go-ios is not available');
      }

      const goIOSPath = streamService.goIOSPath;
      // Example: go-ios apps --udid <udid>
      try {
        const { stdout } = await execPromise(`"${goIOSPath}" ${safeCommand} --udid ${udid}`, {
          env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
        });
        return stdout;
      } catch (err: any) {
        throw new Error(`Execution failed: ${err.message}`);
      }
    } else {
      // Simulator - Use xcrun simctl
      const cmdParts = safeCommand.split(/\s+/);
      const subCommand = cmdParts[0];

      if (!ALLOWED_SIMULATOR_COMMANDS.includes(subCommand)) {
        throw new Error(`Command '${subCommand}' is not allowed for Simulators.`);
      }

      try {
        let fullCmd = `xcrun simctl ${safeCommand}`;
        // listapps <udid>
        if (
          subCommand === 'listapps' ||
          subCommand === 'get_app_container' ||
          subCommand === 'getenv'
        ) {
          fullCmd = `xcrun simctl ${subCommand} ${udid} ${cmdParts.slice(1).join(' ')}`;
        }

        const { stdout } = await execPromise(fullCmd);
        return stdout;
      } catch (err: any) {
        throw new Error(`Simulator execution failed: ${err.message}`);
      }
    }
  }

  async getPageSource(udid: string): Promise<string> {
    log.info(`iOS getPageSource on ${udid}`);
    try {
      const response = await this.sendWDACommand(udid, 'get', '/source');
      return response?.data?.value || '';
    } catch (err: any) {
      log.error(`Failed to get iOS page source for ${udid}: ${err.message}`);
      return '';
    }
  }
}
