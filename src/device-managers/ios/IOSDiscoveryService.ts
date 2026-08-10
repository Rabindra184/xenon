import Simctl from 'node-simctl';
import { flatten } from 'lodash';
import { utilities as IOSUtils } from 'appium-ios-device';
import { IDevice } from '../../interfaces/IDevice';
import { cachePath } from '../../helpers';
import log from '../../logger';
import path from 'path';
import fs from 'fs-extra';
import { getUtilizationTime } from '../../device-utils';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { DeviceTypeToInclude, SimulatorConfig } from '../../interfaces/IPluginArgs';
import { PluginContext } from '../../PluginContext';
import { Service, Container } from 'typedi';
import { PortAllocator } from '../../services/PortAllocator';
import Devices from '../cloud/Devices';
import NodeDevices from '../NodeDevices';
import { config as xenonConfig } from '../../config';
import { addNewDevice, removeDevice } from '../../data-service/device-service';
import { IosTracker } from '../iOSTracker';
import { resolveAdvertisedBindHost, sanitizeDeviceNetworkIp } from '../../helpers/networkAddresses';

/**
 * Should this simulator be given wda/mjpeg ports the moment we notice it?
 *
 * Every simulator installed on the machine is discovered, booted or not, and a
 * Mac carries far more of them than the port ranges hold — 158 against 100
 * where this surfaced. A shut-down simulator is not running WebDriverAgent and
 * will not until someone boots it, so it gets nothing here; `iOSCapabilities`
 * acquires a port at session time for whichever device is actually chosen.
 *
 * Draining the range did not merely waste ports. Discovery threw once it ran
 * dry, so IOSDeviceManager returned no devices at all, and the physically
 * attached iPhone on the same Mac was reaped as stale for not being in its own
 * device list.
 */
export function simulatorNeedsPortNow(state: string | undefined): boolean {
  return state === 'Booted';
}

@Service()
export class IOSDiscoveryService {
  private log = log.scope('IOSDiscovery');
  private trackingInitialized = false;

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

  async getDevices(
    deviceTypes: { iosDeviceType: DeviceTypeToInclude },
    existingDeviceDetails: Array<IDevice>,
  ): Promise<IDevice[]> {
    if (deviceTypes.iosDeviceType === 'real') {
      return flatten(await Promise.all([this.getRealDevices(existingDeviceDetails)]));
    } else if (deviceTypes.iosDeviceType === 'simulated') {
      return await this.getSimulators();
    } else {
      return flatten(
        await Promise.all([this.getRealDevices(existingDeviceDetails), this.getSimulators()]),
      );
    }
  }

  async getConnectedDevices(): Promise<Array<string>> {
    try {
      return await IOSUtils.getConnectedDevices();
    } catch (error) {
      this.log.error(error);
      return [];
    }
  }

  async getRealDevices(existingDeviceDetails: Array<IDevice>): Promise<Array<IDevice>> {
    let deviceState: Array<IDevice> = [];
    if (this.pluginArgs.cloud?.cloudName) {
      const cloud = new Devices(this.pluginArgs.cloud, deviceState, 'ios');
      return await cloud.getDevices();
    } else {
      deviceState = await this.fetchLocalIOSDevices(existingDeviceDetails);
    }
    return deviceState.filter((device) => device.realDevice === true);
  }

  async fetchLocalIOSDevices(existingDeviceDetails: IDevice[]): Promise<IDevice[]> {
    if (process.env.NODE_ENV === 'test') {
      console.log('[POISON PILL] REAL fetchLocalIOSDevices CALLED IN TEST MODE!');
    }
    const devices = await this.getConnectedDevices();
    const deviceProcessingPromises = devices.map(async (udid: string) => {
      try {
        const existingDevice = existingDeviceDetails.find((device) => device.udid === udid);
        if (existingDevice) {
          const networkIp = await this.fetchRealDeviceNetworkIp(udid);
          return {
            ...existingDevice,
            ip: networkIp || sanitizeDeviceNetworkIp(existingDevice.ip) || '',
          };
        }
        return await this.getDeviceInfo(udid);
      } catch (e: any) {
        this.log.error(`Failed to initialize iOS device ${udid}: ${e.message}`);
        return null;
      }
    });

    const deviceState = (await Promise.all(deviceProcessingPromises)).filter(
      (d): d is IDevice => d !== null,
    );
    if (!this.trackingInitialized && process.env.NODE_ENV !== 'test') {
      this.trackIOSDevices();
    }
    return deviceState;
  }

  async getDeviceInfo(udid: string): Promise<IDevice> {
    const store = DeviceStoreFactory.getStore();
    const storeDevice = await store.findDevice({ udid });

    const host = this.pluginArgs.remoteMachineProxyIP
      ? String(this.pluginArgs.remoteMachineProxyIP)
      : `http://${this.pluginArgs.bindHostOrIp}:${this.hostPort}`;

    // A real device is going to want these, so ask now — but not at the cost
    // of the whole discovery pass. See tryAcquire: an exhausted range used to
    // throw out of here and take the device list with it.
    const wdaLocalPort =
      storeDevice?.wdaLocalPort || (await Container.get(PortAllocator).tryAcquire('wda', udid));
    const mjpegServerPort =
      storeDevice?.mjpegServerPort || (await Container.get(PortAllocator).tryAcquire('mjpeg', udid));
    const totalUtilizationTimeMilliSec = await getUtilizationTime(udid);

    let sdk = 'Unknown';
    let name = 'iPhone';
    const ipAddress = await this.fetchRealDeviceNetworkIp(udid);

    try {
      [sdk, name] = await Promise.all([IOSUtils.getOSVersion(udid), IOSUtils.getDeviceName(udid)]);
    } catch (e: any) {
      this.log.error(`Metadata discovery failed for ${udid}: ${e.message}`);
    }

    return {
      wdaLocalPort,
      mjpegServerPort,
      udid,
      sdk,
      name,
      ip: ipAddress,
      busy: false,
      realDevice: true,
      deviceType: 'real',
      cpuArchitecture: 'arm64',
      platform: (name.toLowerCase().includes('tv') ? 'tvos' : 'ios') as 'ios' | 'android' | 'tvos',
      host: host as string,
      totalUtilizationTimeMilliSec,
      sessionStartTime: 0,
      state: storeDevice?.state || 'Unknown',
      userBlocked: storeDevice?.userBlocked || false,
      ...(storeDevice || {}),
    } as IDevice;
  }

  async getSimulators(): Promise<Array<IDevice>> {
    const simulators = await this.fetchLocalSimulators();
    simulators.sort((a, b) => (a.state > b.state ? 1 : -1));

    if (this.pluginArgs.hub !== undefined) {
      const nodeDevices = new NodeDevices(this.pluginArgs.hub, {
        tlsRejectUnauthorized: this.pluginArgs.tlsRejectUnauthorized,
        hubAccessKey: xenonConfig.hubAccessKey,
        hubToken: xenonConfig.hubToken,
      });
      await nodeDevices.postDevicesToHub(simulators, 'add');
    }
    return simulators;
  }

  async fetchLocalSimulators(): Promise<IDevice[]> {
    if (process.env.NODE_ENV === 'test') {
      console.log('[POISON PILL] REAL fetchLocalSimulators CALLED IN TEST MODE!');
    }
    const simctl = new Simctl();
    let simulators: IDevice[] = [];
    try {
      const list = await simctl.list();

      // Log unavailable runtimes
      if (list && list.runtimes) {
        list.runtimes
          .filter((r: any) => !r.isAvailable)
          .forEach((r: any) => this.log.error(`Runtime not available: ${r.name}`));
      }

      const iosSims = flatten(Object.values((await simctl.getDevicesByParsing('iOS')) as any));
      const tvosSims = flatten(Object.values((await simctl.getDevicesByParsing('tvOS')) as any));
      simulators = [...(iosSims as IDevice[]), ...(tvosSims as IDevice[])];
    } catch (e: any) {
      this.log.error(`Failed to fetch local simulators: ${e.message || e}`);
    }
    if (this.pluginArgs.bootedSimulators) {
      simulators = simulators.filter((d) => d.state === 'Booted');
    }

    const localPluginArgs = this.pluginArgs;
    if (localPluginArgs.simulators && localPluginArgs.simulators.length > 0) {
      const allowedSimulators = localPluginArgs.simulators;
      simulators = simulators.filter((d) =>
        allowedSimulators.some((s) => d.name === s.name && d.sdk === s.sdk),
      );
    }

    const store = DeviceStoreFactory.getStore();
    const nodeLanIp = this.resolveNodeLanIp();
    return await Promise.all(
      simulators.map(async (d) => {
        const storeDevice = await store.findDevice({ udid: d.udid });
        const willRunWda = simulatorNeedsPortNow(d.state);
        return {
          ...d,
          wdaLocalPort:
            storeDevice?.wdaLocalPort ||
            (willRunWda
              ? await Container.get(PortAllocator).tryAcquire('wda', d.udid)
              : undefined),
          mjpegServerPort:
            storeDevice?.mjpegServerPort ||
            (willRunWda
              ? await Container.get(PortAllocator).tryAcquire('mjpeg', d.udid)
              : undefined),
          busy: false,
          realDevice: false,
          platform: (d.name?.toLowerCase().includes('tv') ? 'tvos' : 'ios') as
            | 'ios'
            | 'android'
            | 'tvos',
          deviceType: 'simulator',
          host: `http://${this.pluginArgs.bindHostOrIp}:${this.hostPort}`,
          ip: nodeLanIp,
          totalUtilizationTimeMilliSec: await getUtilizationTime(d.udid),
          sessionStartTime: 0,
        } as IDevice;
      }),
    );
  }

  private resolveNodeLanIp(): string {
    return resolveAdvertisedBindHost(this.pluginArgs.bindHostOrIp);
  }

  private async fetchRealDeviceNetworkIp(udid: string): Promise<string> {
    return sanitizeDeviceNetworkIp(await this.fetchIpViaGoIos(udid));
  }

  private async fetchIpViaGoIos(udid: string): Promise<string> {
    const goIOSDir = cachePath('goIOS');
    const goIOSPath = path.join(goIOSDir, 'ios');
    if (!fs.existsSync(goIOSPath)) return '';

    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execPromise = promisify(exec);
    try {
      const { stdout } = await execPromise(`"${goIOSPath}" info --udid ${udid}`, {
        env: { ...process.env, ENABLE_GO_IOS_AGENT: 'yes' },
      });
      const info = JSON.parse(stdout);
      return info.IPAddress || '';
    } catch (e) {
      log.debug(`Failed to fetch IP via go-ios for ${udid}: ${e}`);
      return '';
    }
  }

  trackIOSDevices() {
    if (this.trackingInitialized) return;
    this.trackingInitialized = true;
    const tracker = Container.get(IosTracker).getListener();
    tracker.on('attached', async (udid: string) => {
      try {
        const device = { ...(await this.getDeviceInfo(udid)), nodeId: this.nodeId };
        if (this.pluginArgs.hub) {
          await new NodeDevices(this.pluginArgs.hub, {
            tlsRejectUnauthorized: this.pluginArgs.tlsRejectUnauthorized,
            hubAccessKey: xenonConfig.hubAccessKey,
            hubToken: xenonConfig.hubToken,
          }).postDevicesToHub([device], 'add');
        }
        await addNewDevice([device], this.pluginArgs.bindHostOrIp);
      } catch (e: any) {
        this.log.error(`Attach failed for ${udid}: ${e.message}`);
      }
    });

    tracker.on('detached', async (udid: string) => {
      const deviceRemoved = [{ udid, host: this.pluginArgs.bindHostOrIp as string }];
      if (this.pluginArgs.hub) {
        await new NodeDevices(this.pluginArgs.hub, {
          tlsRejectUnauthorized: this.pluginArgs.tlsRejectUnauthorized,
          hubAccessKey: xenonConfig.hubAccessKey,
          hubToken: xenonConfig.hubToken,
        }).postDevicesToHub(deviceRemoved as any, 'remove');
      }
      await removeDevice(deviceRemoved);
    });
  }
}
