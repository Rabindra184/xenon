import { IDeviceManager } from '../interfaces/IDeviceManager';
import { asyncForEach } from '../helpers';
import { spawn } from 'child_process';
import { ADB, getSdkRootFromEnv } from 'appium-adb';
import log from '../logger';
import _ from 'lodash';
import { fs } from '@appium/support';
import ChromeDriverManager from './ChromeDriverManager';
import { Container } from 'typedi';
import { PortAllocator } from '../services/PortAllocator';
import { getUtilizationTime } from '../device-utils';
import Adb, { Client, DeviceWithPath } from '@devicefarmer/adbkit';
import { AbortController } from 'node-abort-controller';
import asyncWait from 'async-wait-until';
import NodeDevices from './NodeDevices';
import { config as xenonConfig } from '../config';
import { addNewDevice, removeDevice } from '../data-service/device-service';
import { DeviceStoreFactory } from '../data-service/device-store';

import Devices from './cloud/Devices';
import { DeviceTypeToInclude, IPluginArgs } from '../interfaces/IPluginArgs';
import { IDevice } from '../interfaces/IDevice';
import { DeviceUpdate } from '../types/DeviceUpdate';
import Tracker from '@devicefarmer/adbkit/dist/src/adb/tracker';
import { deviceLock } from './android/DeviceLockManager';
import AndroidStreamService from './android/AndroidStreamService';
interface ExtendedADB extends ADB {
  adbHost?: string;
  adbPort?: number;
  adbRemoteHost?: string | null;
  executable: { path: string; defaultArgs: string[];[key: string]: any };
}

import { PluginContext } from '../PluginContext';
import { Service } from 'typedi';

@Service()
export default class AndroidDeviceManager implements IDeviceManager {
  private log = log.scope('AndroidManager');
  private adb: ExtendedADB | undefined;
  private adbAvailable = true;
  private abortControl: Map<string, AbortController> = new Map();
  private tracker?: Tracker = undefined;
  private remoteTrackers: { id: string; tracker: Tracker }[] = [];

  constructor(private context: PluginContext) { }

  private get pluginArgs() {
    return this.context.pluginArgs;
  }
  private get hostPort() {
    return this.context.port;
  }
  private get nodeId() {
    return this.context.nodeId;
  }

  private initiateAbortControl(deviceUdid: string) {
    const control = new AbortController();
    this.abortControl.set(deviceUdid, control);
    return control;
  }

  private abort(deviceUdid: string) {
    this.abortControl.get(deviceUdid)?.abort();
  }

  private cancelAbort(deviceUdid: string) {
    if (this.abortControl.has(deviceUdid)) {
      this.abortControl.delete(deviceUdid);
    }
  }

  async getDevices(
    deviceTypes: { androidDeviceType: DeviceTypeToInclude },
    existingDeviceDetails: Array<IDevice>,
  ): Promise<IDevice[]> {
    if (!this.adbAvailable) {
      log.info('adb is not available. So, returning empty list');
      return [];
    }
    let devices: IDevice[] = [];
    try {
      if (this.pluginArgs.cloud?.cloudName) {
        const cloud = new Devices(this.pluginArgs.cloud, devices, 'android');
        return await cloud.getDevices();
      } else {
        devices = await this.fetchAndroidDevices(existingDeviceDetails, this.pluginArgs);
        log.info(`Found ${devices.length} android devices`);
      }

      if (deviceTypes.androidDeviceType === 'real') {
        return devices.filter((device) => {
          console.log(`Filtering device ${device.udid}, type: ${device.deviceType}, expected real`);
          return device.deviceType === 'real';
        });
      } else if (deviceTypes.androidDeviceType === 'simulated') {
        const simulated = devices.filter((device) => {
          return device.deviceType === 'emulator';
        });
        if (this.pluginArgs.bootedEmulators) {
          return simulated.filter((device) => device.state === 'device');
        }
        return simulated;
        // return both real and simulated (emulated) devices
      } else {
        if (this.pluginArgs.bootedEmulators) {
          return devices.filter((device) => {
            if (device.deviceType === 'emulator') {
              return device.state === 'device';
            }
            return true;
          });
        }
        return devices;
      }
    } catch (e: unknown) {
      log.error(
        `Error while getting android devices. Error: ${e instanceof Error ? e.message : e}`,
      );
    }
    return [];
  }

  private async fetchAndroidDevices(existingDeviceDetails: IDevice[], pluginArgs: IPluginArgs) {
    await this.requireSdkRoot();
    const connectedDevices = await this.getConnectedDevices(pluginArgs);

    const deviceProcessingPromises: Promise<IDevice | undefined>[] = [];

    for (const [adbInstance, devices] of connectedDevices) {
      log.debug(
        `fetchAndroidDevices from host: ${adbInstance.adbRemoteHost || 'Local'}. Found ${(devices as any[]).length
        } android devices`,
      );
      const devicesArray = devices as any[];
      for (const device of devicesArray) {
        deviceProcessingPromises.push(
          (async () => {
            device.adbRemoteHost =
              adbInstance.adbRemoteHost === null
                ? this.pluginArgs.bindHostOrIp
                : adbInstance.adbRemoteHost;

            const existingDevice = existingDeviceDetails.find(
              (dev) => dev.udid === device.udid && dev.host.includes(this.pluginArgs.bindHostOrIp),
            );

            if (existingDevice) {
              if (device.state === 'device') {
                log.debug(`Android Device details for ${device.udid} already available and online`);
                return {
                  ...existingDevice,
                  state: 'device',
                  busy: existingDevice.busy || false,
                };
              } else {
                log.info(`Device ${device.udid} was cached but is now in "${device.state}" state. Ignoring.`);
                return undefined;
              }
            } else {
              if (device.state === 'device') {
                log.info(`New Android Device ${device.udid} discovered in "device" state. Querying details...`);
                try {
                  return await this.deviceInfo(device, adbInstance, this.pluginArgs, this.hostPort);
                } catch (e) {
                  log.error(`Error while getting device info for ${device.udid}. Error: ${e}`);
                  return undefined;
                }
              } else {
                log.info(`Device ${device.udid} is in "${device.state}" state. Ignoring.`);
                return undefined;
              }
            }
          })(),
        );
      }
    }

    const processedDevices = await Promise.all(deviceProcessingPromises);

    const availableDevices: IDevice[] = [];
    const seenUdids = new Set();

    for (const dev of processedDevices) {
      if (dev && !seenUdids.has(`${dev.udid}-${dev.adbRemoteHost}`)) {
        availableDevices.push(dev);
        seenUdids.add(`${dev.udid}-${dev.adbRemoteHost}`);
      }
    }

    return availableDevices;
  }

  private async deviceInfo(
    device: { udid: string; state: string },
    adbInstance: ExtendedADB,
    pluginArgs: IPluginArgs,
    hostPort: number,
  ): Promise<IDevice | undefined> {
    const systemPort = await Container.get(PortAllocator).acquire('system', device.udid);
    const totalUtilizationTimeMilliSec = await getUtilizationTime(device.udid);
    let deviceInfo;

    try {
      deviceInfo = await Promise.all([
        this.getDeviceVersion(adbInstance, device.udid),
        this.isRealDevice(adbInstance, device.udid),
        this.getDeviceName(adbInstance, device.udid),
      ]);
    } catch (error) {
      log.info(`Error while getting base device info for ${device.udid}. Error: ${error}`);
      return undefined;
    }

    const [sdk, realDevice, name] = deviceInfo;

    // Base info is mandatory
    if (_.isNil(sdk) || _.isNil(realDevice) || _.isNil(name)) {
      log.info(`Cannot get base device info for ${device.udid}. Skipping`);
      return undefined;
    }

    let host;
    if (adbInstance.adbHost != null) {
      host = `http://${adbInstance.adbHost}:${adbInstance.adbPort}`;
    } else if (pluginArgs.remoteMachineProxyIP !== undefined) {
      host = `http://${pluginArgs.remoteMachineProxyIP}:${hostPort}`;
    } else {
      host = `http://${pluginArgs.bindHostOrIp}:${hostPort}`;
    }
    return {
      adbRemoteHost: adbInstance.adbRemoteHost ?? undefined,
      adbPort: adbInstance.adbPort,
      systemPort,
      sdk: sdk ?? 'unknown',
      realDevice,
      name: name ?? 'unknown',
      busy: false,
      state: device.state,
      udid: device.udid,
      platform: 'android',
      deviceType: realDevice ? 'real' : 'emulator',
      host,
      totalUtilizationTimeMilliSec: totalUtilizationTimeMilliSec,
      sessionStartTime: 0,
      userBlocked: false,
      ip: await this.getDeviceIp(adbInstance, device.udid),
      cpuArchitecture: await this.getCpuArchitecture(adbInstance, device.udid),
    };
  }

  private async getDeviceIp(adbInstance: ExtendedADB, udid: string): Promise<string> {
    try {
      // Primary: Check wlan0
      const stdout = await deviceLock.acquire(udid, async () => {
        return await adbInstance.adbExec(['-s', udid, 'shell', 'ip', 'addr', 'show', 'wlan0'], {
          timeout: 5000,
        });
      });
      const match = /inet\s+(\d+\.\d+\.\d+\.\d+)/.exec(stdout);
      if (match) return match[1];

      // Secondary: Check ip route for default gateway source
      const stdoutRoute = await deviceLock.acquire(udid, async () => {
        return await adbInstance.adbExec(['-s', udid, 'shell', 'ip', 'route'], { timeout: 5000 });
      });
      const routeMatch = /src\s+(\d+\.\d+\.\d+\.\d+)/.exec(stdoutRoute);
      if (routeMatch) return routeMatch[1];

      return '';
    } catch (e) {
      log.debug(`Failed to fetch IP for android device ${udid}: ${e}`);
      return '';
    }
  }

  private async getCpuArchitecture(adbInstance: ExtendedADB, udid: string): Promise<string> {
    try {
      const abi = await deviceLock.acquire(udid, async () => {
        return await adbInstance.adbExec(['-s', udid, 'shell', 'getprop', 'ro.product.cpu.abi'], {
          timeout: 3000,
        });
      });
      return abi.trim();
    } catch (e) {
      log.debug(`Failed to fetch CPU architecture for ${udid}: ${e}`);
      return '';
    }
  }

  async getAdditionalDeviceInfo(device: IDevice): Promise<Partial<IDevice>> {
    log.info(`Fetching additional device info for ${device.udid} (Lazy Loading)`);
    const { adbInstance } = await this.getAdb();
    if (!adbInstance) return {};
    const adb = device.adbRemoteHost
      ? (adbInstance.clone({
        remoteAdbHost: device.adbRemoteHost,
        adbPort: device.adbPort,
      }) as ExtendedADB)
      : adbInstance;

    try {
      const [chromeDriverPath, screenSize, cpuArchitecture] = await Promise.all([
        this.getChromeVersion(adb, device.udid, this.pluginArgs),
        this.getScreenSize(adb, device.udid),
        this.getCpuArchitecture(adb, device.udid),
      ]);

      return {
        chromeDriverPath,
        screenWidth: screenSize?.width,
        screenHeight: screenSize?.height,
        ip: await this.getDeviceIp(adb, device.udid),
        cpuArchitecture,
      };
    } catch (err) {
      log.warn(`Failed to fetch additional info for ${device.udid}: ${err}`);
      return {};
    }
  }

  private async getScreenSize(
    adbInstance: ExtendedADB,
    udid: string,
  ): Promise<{ width: string; height: string } | undefined> {
    try {
      const adb = await adbInstance;
      let stdout = await deviceLock.acquire(udid, async () => {
        return await adb.adbExec(['-s', udid, 'shell', 'wm', 'size'], { timeout: 10000 });
      });

      const physicalMatch = /Physical size: (\d+)x(\d+)/.exec(stdout);
      const overrideMatch = /Override size: (\d+)x(\d+)/.exec(stdout);

      if (overrideMatch) {
        log.info(`Detected Override size for ${udid}: ${overrideMatch[1]}x${overrideMatch[2]}`);
        return { width: overrideMatch[1], height: overrideMatch[2] };
      }

      if (physicalMatch) {
        log.info(`Detected Physical size for ${udid}: ${physicalMatch[1]}x${physicalMatch[2]}`);
        return { width: physicalMatch[1], height: physicalMatch[2] };
      }

      // Fallback: dumpsys display
      log.debug(`wm size failed for ${udid}, trying dumpsys display`);
      stdout = await adb.adbExec([
        '-s',
        udid,
        'shell',
        'dumpsys',
        'display',
        '|',
        'grep',
        'mBaseDisplayInfo',
      ]);
      const sizeMatch = /width=(\d+), height=(\d+)/.exec(stdout);
      if (sizeMatch) {
        return { width: sizeMatch[1], height: sizeMatch[2] };
      }
    } catch (error) {
      log.error(`Error while getting screen size for ${udid}. Error: ${error}`);
    }
    return undefined;
  }

  private async getAdb(): Promise<{
    adbInstance: ExtendedADB | undefined;
    adbTracker: Tracker | undefined;
  }> {
    try {
      if (!this.adb) {
        try {
          this.adb = await ADB.createADB({});
        } catch (e) {
          this.adbAvailable = false;
          this.log.error('Could not find ADB');
        }
        if (process.env.NODE_ENV !== 'test') {
          const client = Adb.createClient();
          this.tracker = await client.trackDevices();
          if (this.tracker && this.adb) {
            const originalADBTracking = this.createLocalAdbTracker(this.tracker, this.adb);
            await originalADBTracking();
          }
        }
      }
    } catch (e) {
      log.error(`Failed to initialize ADB: ${e}`);
      this.adbAvailable = false;
    }
    return { adbInstance: this.adb as ExtendedADB, adbTracker: this.tracker };
  }

  public async getAdbForDevice(udid: string): Promise<ExtendedADB> {
    const { adbInstance } = await this.getAdb();
    if (!adbInstance) throw new Error('ADB is not available');
    const device = await DeviceStoreFactory.getStore().findDevice({ udid });
    if (device && device.adbRemoteHost) {
      log.debug(
        `Using remote ADB instance for ${udid} at ${device.adbRemoteHost}:${device.adbPort}`,
      );
      return adbInstance.clone({
        remoteAdbHost: device.adbRemoteHost,
        adbPort: device.adbPort,
      }) as ExtendedADB;
    }
    return adbInstance;
  }

  async waitBootComplete(originalADB: ExtendedADB, udid: string): Promise<boolean | undefined> {
    return await asyncWait(
      async () => {
        try {
          const bootStatus = (await this.getDeviceProperty(
            originalADB,
            udid,
            'init.svc.bootanim',
          )) as any;
          if (!_.isNil(bootStatus) && !_.isEmpty(bootStatus) && bootStatus == 'stopped') {
            this.log.info('Boot Completed!', udid);
            return true;
          }
        } catch (err) {
          return false;
        }
      },
      {
        intervalBetweenAttempts: 2000,
        timeout: 60 * 1000,
      },
    );
  }

  public async getConnectedDevices(pluginArgs: IPluginArgs) {
    const deviceList = new Map();
    const { adbInstance: originalADB } = await this.getAdb();
    if (!originalADB) return deviceList;
    deviceList.set(originalADB, await originalADB.getConnectedDevices());
    const adbRemote = pluginArgs.adbRemote;
    if (adbRemote !== undefined && adbRemote.length > 0) {
      const promises = adbRemote.map(async (value: string) => {
        const adbRemoteValue = value.split(':');
        const adbHost = adbRemoteValue[0];
        const adbPort = parseInt(adbRemoteValue[1]) || 5037;
        const cloneAdb = originalADB.clone({
          remoteAdbHost: adbHost,
          adbPort,
        }) as ExtendedADB;
        const devices = await cloneAdb.getConnectedDevices();
        deviceList.set(cloneAdb, devices);
        const remoteAdb = Adb.createClient({
          host: adbHost,
          port: adbPort,
        });
        const remoteAdbTracking = await this.createRemoteAdbTracker(remoteAdb, originalADB, value);
        await remoteAdbTracking();
      });
      await Promise.all(promises);
    }
    return deviceList;
  }

  public async onDeviceAdded(originalADB: ExtendedADB, device: DeviceWithPath) {
    if (!device || !device.id) return;
    const newDevice = { udid: device.id, state: device.type };
    log.info(`Device ${newDevice.udid} was plugged. Detail: ${JSON.stringify(newDevice)}`);
    if (newDevice.state != 'offline') {
      log.info(`Device ${newDevice.udid} was plugged`);
      this.initiateAbortControl(newDevice.udid);
      let bootCompleted = false;
      try {
        await this.waitBootComplete(originalADB, newDevice.udid);
        bootCompleted = true;
      } catch (error) {
        log.info(`Device ${newDevice.udid} boot did not complete. Error: ${error}`);
      }

      if (!bootCompleted) {
        log.info(`Device ${newDevice.udid} boot did not complete in time. Ignoring`);
        return;
      }

      this.cancelAbort(newDevice.udid);
      const trackedDevice = await this.deviceInfo(
        newDevice,
        originalADB,
        this.pluginArgs,
        this.hostPort,
      );

      if (!trackedDevice) {
        log.info(`Cannot get device info for ${newDevice.udid}. Skipping`);
        return;
      }

      log.info(`Adding device ${newDevice.udid} to list!`);
      const deviceTracked = {
        ...trackedDevice,
        nodeId: this.nodeId,
      };
      if (this.pluginArgs.hub != undefined) {
        log.info(`Updating Hub with device ${newDevice.udid}`);
        const nodeDevices = new NodeDevices(this.pluginArgs.hub, {
          tlsRejectUnauthorized: this.pluginArgs.tlsRejectUnauthorized,
          hubAccessKey: xenonConfig.hubAccessKey,
          hubToken: xenonConfig.hubToken,
        });
        await nodeDevices.postDevicesToHub([deviceTracked], 'add');
      }

      // node also need a copy of devices, otherwise it cannot serve requests
      await addNewDevice([deviceTracked], this.pluginArgs.bindHostOrIp);
    }
  }

  public createLocalAdbTracker(tracker: Tracker, originalADB: ExtendedADB) {
    const pluginArgs = this.pluginArgs;
    const adbTracker = async () => {
      try {
        tracker.on('add', async (device: DeviceWithPath) => {
          if (!device || !device.id) return;
          await this.onDeviceAdded(originalADB, device);
        });
        tracker.on('remove', async (device: DeviceWithPath) => {
          if (!device || !device.id) return;
          await this.onDeviceRemoved(device, pluginArgs);
        });
        tracker.on('change', async (device: DeviceWithPath) => {
          if (!device || !device.id) return;
          if (device.type === 'offline' || device.type === 'unauthorized') {
            await this.onDeviceRemoved(device, pluginArgs);
          } else {
            await this.onDeviceAdded(originalADB, device);
          }
        });
        tracker.on('end', () => {
          log.info('Tracking stopped');
        });
      } catch (err: unknown) {
        log.error('Something went wrong:', err instanceof Error ? err.stack : err);
      }
    };

    return adbTracker;
  }

  private async onDeviceRemoved(device: DeviceWithPath, pluginArgs: IPluginArgs) {
    const clonedDevice: DeviceUpdate = {
      udid: device['id'],
      host: pluginArgs.bindHostOrIp,
      state: device.type,
    };
    if (pluginArgs.hub != undefined) {
      const nodeDevices = new NodeDevices(pluginArgs.hub, {
        tlsRejectUnauthorized: pluginArgs.tlsRejectUnauthorized,
        hubAccessKey: xenonConfig.hubAccessKey,
        hubToken: xenonConfig.hubToken,
      });
      await nodeDevices.postDevicesToHub([clonedDevice], 'remove');
    }

    // node also need a copy of devices, otherwise it cannot serve requests
    await removeDevice([clonedDevice]);
    this.abort(clonedDevice.udid);
  }

  /**
   * Return and cache a tracker for remote adb. If tracker already exists for the given id, return the existing one.
   * @param adbClient
   * @param originalADB
   * @param id
   * @returns
   */
  private async createRemoteAdbTracker(adbClient: Client, originalADB: ExtendedADB, id: string) {
    let remoteTracker: Tracker;
    // get tracker from remoteTracker list if already exists
    const existingTracker = this.remoteTrackers.find((tracker) => tracker.id === id);
    if (!existingTracker) {
      const newTracker = await adbClient.trackDevices();
      this.remoteTrackers.push({ id, tracker: newTracker });
      remoteTracker = newTracker;
    } else {
      remoteTracker = existingTracker.tracker;
    }
    const pluginArgs = this.pluginArgs;
    const adbTracking = async () => {
      try {
        remoteTracker.on('add', async (device: DeviceWithPath) => {
          await this.onDeviceAdded(originalADB, device);
        });
        remoteTracker.on('remove', async (device: DeviceWithPath) => {
          await this.onDeviceRemoved(device, pluginArgs);
        });
        remoteTracker.on('change', async (device: DeviceWithPath) => {
          if (device.type === 'offline' || device.type === 'unauthorized') {
            log.info(`Device ${device.id} is ${device.type}. Removing from list`);
            await this.onDeviceRemoved(device, pluginArgs);
          } else {
            await this.onDeviceAdded(originalADB, device);
          }
        });
        remoteTracker.on('end', () => this.log.info('Tracking stopped'));
      } catch (err: unknown) {
        this.log.error('Something went wrong:', err instanceof Error ? err.stack : err);
      }
    };

    return adbTracking;
  }

  public async getChromeVersion(adbInstance: ExtendedADB, udid: string, pluginArgs: IPluginArgs) {
    if (pluginArgs.skipChromeDownload) {
      log.warn('skipChromeDownload server arg is set; skipping Chromedriver installation.');
      log.warn('Android web/hybrid testing will not be possible without Chromedriver.');
      return;
    }
    log.debug('Getting package info for chrome');
    const chromeDriverManager = Container.get(ChromeDriverManager);
    let versionName = '';
    try {
      const stdout = await (
        await adbInstance
      ).adbExec(['-s', udid, 'shell', 'dumpsys', 'package', 'com.android.chrome']);
      const versionNameMatch = new RegExp(/versionName=([\d+.]+)/).exec(stdout);
      if (versionNameMatch) {
        versionName = versionNameMatch[1];
        versionName = versionName.split('.')[0];
        return await chromeDriverManager.downloadChromeDriver(versionName);
      }
    } catch (err: unknown) {
      log.warn(`Error '${err instanceof Error ? err.message : err}' while dumping package info`);
    }
  }

  public async downloadChromeDriver(version: string) {
    const instance = Container.get(ChromeDriverManager);
    return await instance.downloadChromeDriver(version);
  }

  private async getDeviceVersion(adbInstance: any, udid: string): Promise<string | undefined> {
    return await this.getDeviceProperty(adbInstance, udid, 'ro.build.version.release');
  }

  private async getDeviceProperty(
    adbInstance: ExtendedADB,
    udid: string,
    prop: string,
  ): Promise<string | undefined> {
    try {
      return await (await adbInstance).adbExec(['-s', udid, 'shell', 'getprop', prop]);
    } catch (error) {
      log.error(`Error while getting device property "${prop}" for ${udid}. Error: ${error}`);
    }
  }

  private async isRealDevice(adbInstance: ExtendedADB, udid: string): Promise<boolean> {
    const character = await this.getDeviceProperty(adbInstance, udid, 'ro.build.characteristics');
    return character !== 'emulator';
  }

  private async requireSdkRoot() {
    const sdkRoot = getSdkRootFromEnv();
    const docMsg =
      'Read https://developer.android.com/studio/command-line/variables for more details';

    if (_.isEmpty(sdkRoot)) {
      throw new Error(
        `Neither ANDROID_HOME nor ANDROID_SDK_ROOT environment variable was exported. ${docMsg}`,
      );
    }

    if (sdkRoot === undefined || !(await fs.exists(sdkRoot))) {
      throw new Error(
        `The Android SDK root folder '${sdkRoot}' does not exist on the local file system. ${docMsg}`,
      );
    }
    const stats = await fs.stat(sdkRoot);
    if (!stats.isDirectory()) {
      throw new Error(`The Android SDK root '${sdkRoot}' must be a folder. ${docMsg}`);
    }
    return sdkRoot;
  }

  private getDeviceName = async (
    adbInstance: ExtendedADB,
    udid: string,
  ): Promise<string | undefined> => {
    let deviceName = await this.getDeviceProperty(await adbInstance, udid, 'ro.product.name');

    if (!deviceName || (deviceName && deviceName.trim() === '')) {
      // If the device name is null or empty, try to get it from the Bluetooth manager.
      deviceName = await (
        await adbInstance
      ).adbExec([
        '-s',
        udid,
        'shell',
        'dumpsys',
        'bluetooth_manager',
        '|',
        'grep',
        'name:',
        '|',
        'cut',
        '-c9-',
      ]);
    }
    return deviceName;
  };

  async tap(udid: string, x: number, y: number): Promise<void> {
    log.info(`Android Tap on ${udid} at ${x},${y}`);
    const adb = await this.getAdbForDevice(udid);
    await deviceLock.acquire(udid, async () => {
      await adb.adbExec(
        ['-s', udid, 'shell', 'input', 'tap', Math.round(x).toString(), Math.round(y).toString()],
        { timeout: 10000 },
      );
    });
  }

  async swipe(
    udid: string,
    x: number,
    y: number,
    endX: number,
    endY: number,
    duration: number,
  ): Promise<void> {
    log.info(`Android Swipe on ${udid}: (${x},${y}) -> (${endX},${endY}) duration: ${duration}`);
    const adb = await this.getAdbForDevice(udid);
    await deviceLock.acquire(udid, async () => {
      await adb.adbExec(
        [
          '-s',
          udid,
          'shell',
          'input',
          'swipe',
          Math.round(x).toString(),
          Math.round(y).toString(),
          Math.round(endX).toString(),
          Math.round(endY).toString(),
          duration.toString(),
        ],
        { timeout: 15000 },
      );
    });
  }

  async typeText(udid: string, text: string): Promise<void> {
    log.info(`Android TypeText on ${udid}: ${text}`);
    const adb = await this.getAdbForDevice(udid);
    // Escape whitespace for shell input
    const escapedText = text.replace(/ /g, '%s');
    await deviceLock.acquire(udid, async () => {
      await adb.adbExec(['-s', udid, 'shell', 'input', 'text', escapedText], { timeout: 10000 });
    });
  }

  async pressKey(udid: string, keyCode: string | number): Promise<void> {
    log.info(`Android PressKey on ${udid}: ${keyCode}`);
    const adb = await this.getAdbForDevice(udid);
    await deviceLock.acquire(udid, async () => {
      await adb.adbExec(['-s', udid, 'shell', 'input', 'keyevent', keyCode.toString()], {
        timeout: 10000,
      });
    });
  }

  async getPageSource(udid: string): Promise<string> {
    log.info(`Android getPageSource on ${udid}`);
    const adb = await this.getAdbForDevice(udid);
    return await deviceLock.acquire(udid, async () => {
      try {
        const dumpPath = '/data/local/tmp/dump.xml';
        await adb.adbExec(['-s', udid, 'shell', 'uiautomator', 'dump', dumpPath], {
          timeout: 15000,
        });
        const xml = await adb.adbExec(['-s', udid, 'shell', 'cat', dumpPath], { timeout: 10000 });
        return xml || '';
      } catch (err: any) {
        log.error(`Failed to get Android page source for ${udid}: ${err.message}`);
        return '';
      }
    });
  }

  async installApp(udid: string, appPath: string): Promise<void> {
    const { adbInstance } = await this.getAdb();
    if (!adbInstance) throw new Error('ADB is not available');
    await adbInstance.adbExec(['-s', udid, 'install', '-r', appPath]);
  }

  async uninstallApp(udid: string, bundleId: string): Promise<void> {
    const { adbInstance } = await this.getAdb();
    if (!adbInstance) throw new Error('ADB is not available');
    await adbInstance.adbExec(['-s', udid, 'uninstall', bundleId]);
  }

  /**
   * Helper function to temporarily set the Android device's IME to Appium Settings.
   * This is required on Android 10+ to bypass OS background clipboard restrictions.
   */
  private async withAppiumIME<T>(
    adbInstance: ExtendedADB,
    udid: string,
    action: () => Promise<T>,
  ): Promise<T> {
    let originalIME = '';
    const appiumIME = 'io.appium.settings/.AppiumIME';

    try {
      // 1. Get current IME
      originalIME = (
        await adbInstance.adbExec([
          '-s',
          udid,
          'shell',
          'settings',
          'get',
          'secure',
          'default_input_method',
        ])
      ).trim();

      // 2. Enable and Set Appium IME
      if (originalIME !== appiumIME) {
        await adbInstance.adbExec(['-s', udid, 'shell', 'ime', 'enable', appiumIME]);
        await adbInstance.adbExec(['-s', udid, 'shell', 'ime', 'set', appiumIME]);
        // Give the OS a tiny moment to process the IME swap
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // 3. Execute the clipboard action with the Appium IME active
      return await action();
    } finally {
      // 4. Always restore the original IME if we swapped it
      if (originalIME && originalIME !== appiumIME) {
        try {
          await adbInstance.adbExec(['-s', udid, 'shell', 'ime', 'set', originalIME]);
        } catch (e) {
          log.warn(`[${udid}] Failed to restore original IME (${originalIME}): ${e}`);
        }
      }
    }
  }

  async getClipboard(udid: string): Promise<string> {
    const { adbInstance } = await this.getAdb();
    if (!adbInstance) return '';
    try {
      // Wrap the targeted broadcast in the Appium IME context
      return await this.withAppiumIME(adbInstance, udid, async () => {
        // 1. Try Targeted Broadcast method (Reliable for modern Android)
        const result = await adbInstance.adbExec([
          '-s',
          udid,
          'shell',
          'am',
          'broadcast',
          '-a',
          'com.appium.settings.clipboard.get',
          '-n',
          'io.appium.settings/.receivers.ClipboardReceiver',
        ]);

        // Parse result like: Broadcast completed: result=-1, data="BASE64_DATA"
        const dataMatch = /data="([^"]*)"/.exec(result);
        if (dataMatch) {
          const rawData = dataMatch[1];
          if (!rawData) return '';

          // Appium Settings returns Base64 for robustness
          try {
            const decoded = Buffer.from(rawData, 'base64').toString('utf8');
            // If it looks like printable text after decoding, use it
            if (/^[\x20-\x7E\s\u00A0-\uFFFF]*$/.test(decoded)) return decoded;
            return rawData;
          } catch (e) {
            return rawData;
          }
        }

        // 2. Fallback: Query the content provider (Legacy/Alternative)
        const queryResult = await adbInstance.adbExec([
          '-s',
          udid,
          'shell',
          'content',
          'query',
          '--uri',
          'content://io.appium.settings.clipboard/clipboard',
        ]);

        // Extract value using a more flexible regex that handles different formats
        const valMatch = /value=([^\s,]*)/i.exec(queryResult);
        if (valMatch) {
          const val = valMatch[1];
          // Most content providers return base64 for safety
          try {
            const decoded = Buffer.from(val, 'base64').toString('utf8');
            // Basic sanity check: if it contains non-printable characters, it might not have been base64
            if (/^[\x20-\x7E\s]*$/.test(decoded)) return decoded;
            return val;
          } catch (e) {
            return val;
          }
        }
        return '';
      });
    } catch (err: unknown) {
      log.warn(
        `Failed to fetch Android clipboard for ${udid}: ${err instanceof Error ? err.message : err
        }`,
      );
    }

    return '';
  }

  async setClipboard(udid: string, content: string): Promise<void> {
    const { adbInstance } = await this.getAdb();
    if (!adbInstance) return;
    try {
      await this.withAppiumIME(adbInstance, udid, async () => {
        await adbInstance.adbExec([
          '-s',
          udid,
          'shell',
          'am',
          'broadcast',
          '-a',
          'com.appium.settings.clipboard.set',
          '-n',
          'io.appium.settings/.receivers.ClipboardReceiver',
          '--es',
          'label',
          'clipboard',
          '--es',
          'content',
          Buffer.from(content).toString('base64'), // Send as Base64 for safety
        ]);
      });
    } catch (err: unknown) {
      log.warn(
        `Failed to set Android clipboard for ${udid}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async touchAndHold(udid: string, x: number, y: number, duration: number): Promise<void> {
    const { adbInstance } = await this.getAdb();
    if (!adbInstance) return;
    await deviceLock.acquire(udid, async () => {
      await adbInstance.adbExec(
        [
          '-s',
          udid,
          'shell',
          'input',
          'swipe',
          x.toString(),
          y.toString(),
          x.toString(),
          y.toString(),
          duration.toString(),
        ],
        { timeout: 15000 },
      );
    });
  }

  async lock(udid: string): Promise<void> {
    const { adbInstance } = await this.getAdb();
    if (!adbInstance) return;
    // 26 is POWER button, usually locks if screen is on
    await adbInstance.adbExec(['-s', udid, 'shell', 'input', 'keyevent', '26']);
  }

  async unlock(udid: string): Promise<void> {
    const { adbInstance } = await this.getAdb();
    if (!adbInstance) return;
    // Wake up the device and potentially unlock
    await adbInstance.adbExec(['-s', udid, 'shell', 'input', 'keyevent', '224']); // WAKEUP
    await adbInstance.adbExec(['-s', udid, 'shell', 'input', 'keyevent', '82']); // MENU (locks/unlocks some devices)
  }

  async listApps(udid: string): Promise<string[]> {
    const { adbInstance } = await this.getAdb();
    if (!adbInstance) return [];
    // List all third-party apps
    const stdout = await adbInstance.adbExec(['-s', udid, 'shell', 'pm', 'list', 'packages', '-3']);
    return stdout
      .split(/\r?\n/)
      .map((line: string) => line.replace(/^package:/i, '').trim())
      .filter((line: string) => line.length > 0)
      .sort();
  }

  async getScreenshot(udid: string): Promise<string> {
    log.info(`Android Get Screenshot on ${udid}`);

    // Principal Optimization: Try to use the latest frame from the active stream if available
    try {
      const { default: AndroidStreamService } = await import('./android/AndroidStreamService');
      const streamSession = Container.get(AndroidStreamService).getStreamStatus(udid);
      if (streamSession?.status === 'running' && streamSession.latestFrame) {
        // Sanity Check: A full screenshot should be at least ~10KB as JPEG.
        // Staleness Check: If the frame is older than 5 seconds, it's considered poor quality for interactive use.
        const isFresh =
          streamSession.latestFrameTimestamp &&
          Date.now() - streamSession.latestFrameTimestamp < 5000;

        if (streamSession.latestFrame.length > 10000 && isFresh) {
          log.info(
            `[AndroidDeviceManager] Using fresh cached stream frame for ${udid} screenshot.`,
          );
          return streamSession.latestFrame.toString('base64');
        } else if (!isFresh) {
          log.warn(
            `[AndroidDeviceManager] Cached frame for ${udid} is STALE (${Math.round((Date.now() - (streamSession.latestFrameTimestamp || 0)) / 1000)}s old). Falling back to direct screencap.`,
          );
        } else {
          log.warn(
            `[AndroidDeviceManager] Cached frame for ${udid} is too small (${streamSession.latestFrame.length}b). Falling back to direct screencap.`,
          );
        }
      }
    } catch (e) {
      log.debug(`Failed to check stream status for ${udid}: ${e}`);
    }

    const { spawn } = await import('child_process');
    const adb = await this.getAdbForDevice(udid);
    try {
      // 1. Try targeted exec-out screencap -p for maximum speed/reliability
      // This is binary-safe and avoids saving to device disk
      const screenshot = await deviceLock.acquire(udid, async () => {
        return await new Promise<string>((resolve, reject) => {
          const adbArgs = ['-s', udid];
          // remote ADB support
          if (adb.adbHost && adb.adbPort) {
            adbArgs.unshift('-H', adb.adbHost, '-P', adb.adbPort.toString());
          }
          const adbPath = adb.executable.path || 'adb';
          const proc = spawn(adbPath, [...adbArgs, 'exec-out', 'screencap', '-p']);
          const chunks: Uint8Array[] = [];
          proc.stdout.on('data', (c) => chunks.push(c));
          proc.on('close', (code) => {
            if (code === 0) {
              const base64 = Buffer.concat(chunks).toString('base64');
              log.info(`ADB screencap successful for ${udid} (${base64.length} chars)`);
              resolve(base64);
            } else {
              reject(new Error(`ADB screencap failed with code ${code}`));
            }
          });
          proc.on('error', (err) => {
            log.error(`ADB spawn error: ${err.message}`);
            reject(err);
          });
          // Safety timeout
          setTimeout(() => {
            proc.kill();
            reject(new Error('ADB Screenshot timeout after 15s'));
          }, 15000);
        });
      });
      return screenshot;
    } catch (err: unknown) {
      log.error(
        `Failed to take screenshot for ${udid}: ${err instanceof Error ? err.message : err}`,
      );
      // Fallback: Try shell method with base64 conversion on device
      try {
        log.info(`Attempting fallback screenshot for ${udid}...`);
        const base64 = await adb.adbExec(['-s', udid, 'shell', 'screencap', '-p', '|', 'base64']);
        return base64.replace(/\r?\n/g, '');
      } catch (fallbackErr: unknown) {
        log.error(
          `Fallback screenshot also failed for ${udid}: ${fallbackErr instanceof Error ? fallbackErr.message : fallbackErr
          }`,
        );
      }
      return '';
    }
  }

  async getLogs(udid: string): Promise<string> {
    const { adbInstance } = await this.getAdb();
    if (!adbInstance) return 'ADB is not available';
    try {
      // Get last 500 lines of logcat
      return await adbInstance.adbExec([
        '-s',
        udid,
        'shell',
        'logcat',
        '-d',
        '-t',
        '500',
        '-v',
        'threadtime',
      ]);
    } catch (err: unknown) {
      log.warn(
        `Failed to fetch Android logs for ${udid}: ${err instanceof Error ? err.message : err}`,
      );
      return `Failed to fetch logs: ${err instanceof Error ? err.message : err}`;
    }
  }

  async checkHealth(device: IDevice): Promise<Partial<IDevice>> {
    if (device.cloud) return { healthStatus: 'Healthy' };

    try {
      const adb = await this.getAdbForDevice(device.udid);
      const [bootCompleted, batteryInfo, storageInfo] = await Promise.all([
        adb.adbExec(['-s', device.udid, 'shell', 'getprop', 'sys.boot_completed']),
        adb.adbExec(['-s', device.udid, 'shell', 'dumpsys', 'battery']),
        adb.adbExec(['-s', device.udid, 'shell', 'df', '-h', '/data']),
      ]);

      const isBooted = bootCompleted && bootCompleted.trim() === '1';

      // Parse battery
      const batteryLevelMatch = /level: (\d+)/.exec(batteryInfo);
      const batteryLevel = batteryLevelMatch ? parseInt(batteryLevelMatch[1]) : undefined;
      const batteryTempMatch = /temperature: (\d+)/.exec(batteryInfo);
      const batteryTemp = batteryTempMatch ? parseInt(batteryTempMatch[1]) / 10 : undefined;

      let thermalStatus = 'Normal';
      if (batteryTemp && batteryTemp > 45) thermalStatus = 'Hot';
      if (batteryTemp && batteryTemp > 55) thermalStatus = 'Critical';

      // Parse storage
      const storageLines = storageInfo.split(/\r?\n/);
      let storageFree = 'Unknown';
      if (storageLines.length > 1) {
        const fields = storageLines[1].trim().split(/\s+/);
        if (fields.length >= 4) storageFree = fields[3];
      }

      const healthData: Partial<IDevice> = {
        batteryLevel,
        thermalStatus,
        storageFree,
      };

      if (!isBooted) {
        return {
          ...healthData,
          healthStatus: 'Unhealthy',
          healthCheckError: `Device boot not completed. sys.boot_completed: ${bootCompleted}`,
        };
      }

      if (batteryLevel !== undefined && batteryLevel < 10) {
        return {
          ...healthData,
          healthStatus: 'Unhealthy',
          healthCheckError: `Low battery: ${batteryLevel}%`,
        };
      }

      if (thermalStatus === 'Critical') {
        return {
          ...healthData,
          healthStatus: 'Unhealthy',
          healthCheckError: `Critical thermal state: ${batteryTemp}°C`,
        };
      }

      return {
        ...healthData,
        healthStatus: 'Healthy',
      };
    } catch (err: unknown) {
      return {
        healthStatus: 'Unhealthy',
        healthCheckError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async recoverHealth(device: IDevice): Promise<boolean> {
    if (device.cloud) return true;

    try {
      log.info(`🛡️ Attempting auto-recovery for Android device ${device.udid}...`);
      const adb = await this.getAdbForDevice(device.udid);

      // Tier 1: Just log and hope it clears (for now)
      // Tier 2: If low battery and not charging, or critical thermal, we can't do much but alert.
      // Tier 3: If stuck booting or unresponsive, reboot.
      if (device.healthStatus === 'Unhealthy') {
        if (device.healthCheckError?.includes('boot not completed')) {
          log.info(`Device ${device.udid} is stuck booting. Attempting hard reboot...`);
          await adb.adbExec(['-s', device.udid, 'reboot']);
          return true;
        }
      }

      return true;
    } catch (err: unknown) {
      log.error(
        `Auto-recovery failed for ${device.udid}: ${err instanceof Error ? err.message : err}`,
      );
      return false;
    }
  }

  async executeShell(udid: string, command: string): Promise<string> {
    const ALLOWED_COMMANDS = [
      'ls',
      'ps',
      'top',
      'dumpsys battery',
      'dumpsys wifi',
      'dumpsys power',
      'whoami',
      'getprop',
      'pm list packages',
      'ip addr',
      'cat /proc/meminfo',
      'cat /proc/cpuinfo',
      'date',
      'uptime',
      'netstat',
    ];

    // Basic sanitation
    const safeCommand = command.trim();

    // Check if the command starts with any allowed prefix
    const isAllowed = ALLOWED_COMMANDS.some((prefix) => safeCommand.startsWith(prefix));

    if (!isAllowed) {
      log.warn(`Blocked potentially unsafe shell command on ${udid}: ${safeCommand}`);
      throw new Error(`Command '${safeCommand}' is not allowed for security reasons.`);
    }

    // Split command into args for adbExec
    // This is a naive split, but safe enough for the allowed commands which don't use complex quoting
    const args = safeCommand.split(/\s+/);

    log.info(`Executing shell command on ${udid}: ${safeCommand}`);
    const { adbInstance } = await this.getAdb();
    if (!adbInstance) throw new Error('ADB is not available');

    // Use device lock to ensure thread safety
    return await deviceLock.acquire(udid, async () => {
      // Direct raw shell execution might be better for piping, but adbExec is safer as it escapes args
      // except we passed them as array, so standard child_process rules apply.
      return await adbInstance.adbExec(['-s', udid, 'shell', ...args], { timeout: 10000 });
    });
  }
}
