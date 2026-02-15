import Simctl from 'node-simctl';
import { flatten } from 'lodash';
import { IDevice } from '../interfaces/IDevice';
import { IDeviceManager } from '../interfaces/IDeviceManager';
import log from '../logger';
import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Container, Service } from 'typedi';
import { DeviceStoreFactory } from '../data-service/device-store';
import { DeviceTypeToInclude, IDerivedDataPath } from '../interfaces/IPluginArgs';
import { PluginContext } from '../PluginContext';
import IOSStreamService from './ios/IOSStreamService';
import { IOSDiscoveryService } from './ios/IOSDiscoveryService';
import { WDAClient } from './ios/WDAClient';

const execPromise = promisify(exec);

@Service()
export default class IOSDeviceManager implements IDeviceManager {
  private log = log.scope('IOSManager');
  private wdaSoftFailures: Map<string, number> = new Map();
  private readonly WDA_SOFT_FAIL_MAX = 3;

  constructor(private context: PluginContext) {}

  private get pluginArgs() {
    return this.context.pluginArgs;
  }

  async getDevices(
    deviceTypes: { iosDeviceType: DeviceTypeToInclude },
    existingDeviceDetails: Array<IDevice>,
  ): Promise<IDevice[]> {
    return Container.get(IOSDiscoveryService).getDevices(deviceTypes, existingDeviceDetails);
  }

  async getConnectedDevices(): Promise<Array<string>> {
    return Container.get(IOSDiscoveryService).getConnectedDevices();
  }

  async getOSVersion(udid: string): Promise<string> {
    const device = await Container.get(IOSDiscoveryService).getDeviceInfo(udid);
    return device.sdk;
  }

  async getDeviceName(udid: string): Promise<string> {
    const device = await Container.get(IOSDiscoveryService).getDeviceInfo(udid);
    return device.name || 'iPhone';
  }

  async getAdditionalDeviceInfo(device: IDevice): Promise<Partial<IDevice>> {
    this.log.info(`Fetching additional iOS device info for ${device.udid}`);
    const result: Partial<IDevice> = {
      derivedDataPath: this.prepareDerivedDataPath(
        this.pluginArgs.derivedDataPath,
        device.udid,
        device.realDevice,
      ),
    };

    const streamStatus = Container.get(IOSStreamService).getStreamStatus(device.udid);
    if (streamStatus?.screenWidth && streamStatus?.screenHeight) {
      result.screenWidth = String(streamStatus.screenWidth);
      result.screenHeight = String(streamStatus.screenHeight);
    } else {
      const storeDevice = await DeviceStoreFactory.getStore().findDevice({ udid: device.udid });
      if (storeDevice?.screenWidth) {
        result.screenWidth = storeDevice.screenWidth;
        result.screenHeight = storeDevice.screenHeight;
      }
    }
    return result;
  }

  private prepareDerivedDataPath(
    derivedDataPath: IDerivedDataPath | undefined,
    udid: string,
    realDevice: boolean,
  ): string {
    const tmpPath = path.join(
      os.homedir(),
      `Library/Developer/Xcode/DerivedData/WebDriverAgent-${udid}`,
    );
    if (derivedDataPath) {
      const source = realDevice ? derivedDataPath.device : derivedDataPath.simulator;
      if (source) fs.copySync(source, tmpPath);
      else if (!fs.existsSync(tmpPath)) fs.mkdirSync(tmpPath, { recursive: true });
      return tmpPath;
    }
    return tmpPath;
  }

  // WDA Interactions - Delegated to WDAClient
  async tap(udid: string, x: number, y: number): Promise<void> {
    return Container.get(WDAClient).tap(udid, x, y);
  }

  async swipe(
    udid: string,
    x: number,
    y: number,
    endX: number,
    endY: number,
    duration: number,
  ): Promise<void> {
    return Container.get(WDAClient).swipe(udid, x, y, endX, endY, duration);
  }

  async typeText(udid: string, text: string): Promise<void> {
    return Container.get(WDAClient).typeText(udid, text);
  }

  async pressKey(udid: string, keyCode: string | number): Promise<void> {
    return Container.get(WDAClient).pressKey(udid, keyCode);
  }

  async getScreenshot(udid: string): Promise<string> {
    return Container.get(WDAClient).getScreenshot(udid);
  }

  async getClipboard(udid: string): Promise<string> {
    return Container.get(WDAClient).getClipboard(udid);
  }

  async setClipboard(udid: string, content: string): Promise<void> {
    return Container.get(WDAClient).setClipboard(udid, content);
  }

  async lock(udid: string): Promise<void> {
    return Container.get(WDAClient).lock(udid);
  }

  async unlock(udid: string): Promise<void> {
    return Container.get(WDAClient).unlock(udid);
  }

  async installApp(udid: string, appPath: string): Promise<void> {
    return Container.get(WDAClient).installApp(udid, appPath);
  }

  async uninstallApp(udid: string, bundleId: string): Promise<void> {
    return Container.get(WDAClient).uninstallApp(udid, bundleId);
  }

  async listApps(udid: string): Promise<string[]> {
    return Container.get(WDAClient).listApps(udid);
  }

  async getLogs(udid: string): Promise<string> {
    return Container.get(WDAClient).getLogs(udid);
  }

  async getPageSource(udid: string): Promise<string> {
    this.log.info(`iOS getPageSource on ${udid}`);
    try {
      const res = await Container.get(WDAClient).sendWDACommand(udid, 'get', '/source');
      return res?.data?.value || '';
    } catch (e: any) {
      this.log.error(`Failed to get iOS page source for ${udid}: ${e.message}`);
      return '';
    }
  }

  async checkHealth(device: IDevice): Promise<Partial<IDevice>> {
    if (device.cloud) return { healthStatus: 'Healthy' };
    try {
      if (device.realDevice) {
        // Collect hardware stats via WDAClient (which uses go-ios if available)
        // For simplicity, we'll keep some health check logic here but use the client for WDA status
        const isReady = await Container.get(WDAClient).verifyWDAStatus(device.udid);
        if (isReady) return { healthStatus: 'Healthy' };
        return { healthStatus: 'Unhealthy', healthCheckError: 'WDA not responding' };
      } else {
        const simctl = new Simctl();
        const list = await simctl.list();
        const sim: any = flatten(Object.values(list.devices)).find(
          (s: any) => s.udid === device.udid,
        );
        return sim && ['Booted', 'Shutdown'].includes(sim.state)
          ? { healthStatus: 'Healthy' }
          : { healthStatus: 'Unhealthy', healthCheckError: `Simulator state: ${sim?.state}` };
      }
    } catch (err: any) {
      return { healthStatus: 'Unhealthy', healthCheckError: err.message };
    }
  }

  async readyForSession(device: IDevice): Promise<boolean> {
    if (device.cloud) return true;
    this.log.info(`🚀 [SessionStart] Verifying readiness for ${device.udid}...`);

    const streamService = Container.get(IOSStreamService);
    const streamStatus = streamService.getStreamStatus(device.udid);
    if (streamStatus?.status === 'starting') {
      const start = Date.now();
      while (Date.now() - start < 30000) {
        if (streamService.getStreamStatus(device.udid)?.status === 'running') return true;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    let healthy = await Container.get(WDAClient).verifyWDAStatus(device.udid);
    if (!healthy) {
      this.log.warn(`⚠️ [SessionStart] ${device.udid} is UNHEALTHY. Recovering...`);
      if (await this.recoverHealth(device)) {
        const start = Date.now();
        while (Date.now() - start < 15000) {
          healthy = await Container.get(WDAClient).verifyWDAStatus(device.udid);
          if (healthy) break;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
    return healthy;
  }

  async recoverHealth(device: IDevice): Promise<boolean> {
    if (device.cloud) return true;
    try {
      if (device.realDevice) {
        if (device.busy && device.session_id) return false;
        this.log.info(`🛡️ Auto-recovery for iOS device ${device.udid}...`);
        await Container.get(IOSStreamService).startStream(device.udid);
        return true;
      } else {
        const simctl = new Simctl();
        simctl.udid = device.udid;
        try {
          await simctl.shutdownDevice();
          await new Promise((r) => setTimeout(r, 2000));
        } catch (e) {}
        await simctl.bootDevice();
        return true;
      }
    } catch (err: any) {
      this.log.error(`Auto-recovery failed for ${device.udid}: ${err.message}`);
      return false;
    }
  }

  async executeShell(udid: string, command: string): Promise<string> {
    return Container.get(WDAClient).executeShell(udid, command);
  }
}
