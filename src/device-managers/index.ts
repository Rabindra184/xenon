import { IDevice } from '../interfaces/IDevice';
import { IDeviceManager } from '../interfaces/IDeviceManager';
import AndroidDeviceManager from './AndroidDeviceManager';
import IOSDeviceManager from './IOSDeviceManager';
import log from '../logger';
import { Container, Service } from 'typedi';
import { PluginContext } from '../PluginContext';

@Service()
export class XenonManager {
  private log = log.scope('XenonManager');
  private deviceManagers: IDeviceManager[] = [];

  constructor(private context: PluginContext) {}

  /**
   * Initializes the managers based on the platform requested.
   * This allows for lazy initialization after the PluginContext is ready.
   */
  public init() {
    this.deviceManagers = [];
    const platform = this.context.pluginArgs.platform.toLowerCase();

    if (platform === 'both') {
      this.deviceManagers.push(Container.get(AndroidDeviceManager));
      this.deviceManagers.push(Container.get(IOSDeviceManager));
    } else if (platform === 'android') {
      this.deviceManagers.push(Container.get(AndroidDeviceManager));
    } else if (platform === 'ios') {
      this.deviceManagers.push(Container.get(IOSDeviceManager));
    }
    this.log.info(`Initialized with ${this.deviceManagers.length} device managers`);
  }

  public async getDevices(existingDeviceDetails?: Array<IDevice>): Promise<IDevice[]> {
    const devices: IDevice[] = [];

    // Auto-init if not already done
    if (this.deviceManagers.length === 0) {
      this.init();
    }

    for (const deviceManager of this.deviceManagers) {
      devices.push(
        ...(
          await deviceManager.getDevices(
            {
              androidDeviceType: this.context.pluginArgs.androidDeviceType,
              iosDeviceType: this.context.pluginArgs.iosDeviceType,
            },
            existingDeviceDetails || [],
          )
        ).map((device) => {
          return {
            ...device,
            nodeId: !device.cloud ? this.context.nodeId : undefined,
          };
        }),
      );
    }
    return devices;
  }

  public getMaxSessionCount(): number {
    return this.context.pluginArgs.maxSessions;
  }

  public async deviceInstances() {
    if (this.deviceManagers.length === 0) {
      this.init();
    }
    return this.deviceManagers;
  }
}
