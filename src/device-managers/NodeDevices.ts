import log from '../logger';
import { DeviceWithPath } from '@devicefarmer/adbkit';
import { DeviceUpdate } from '../types/DeviceUpdate';
import { IDeviceFilterOptions } from '../interfaces/IDeviceFilterOptions';
import { InternalHttpClient } from '../InternalHttpClient';

export default class NodeDevices {
  private host: string;

  constructor(host: string) {
    this.host = host;
  }

  async postDevicesToHub(devices: DeviceWithPath[] | DeviceUpdate[], arg: string) {
    // DeviceWithPath -> new device
    // DeviceUpdate -> removed device
    log.info(`Updating remote android devices ${this.host}/xenon/api/register`);
    try {
      await InternalHttpClient.post(`${this.host}/xenon/api/register`, devices, {
        params: {
          type: arg,
        },
      });
      if (arg === 'add') {
        log.info(`Pushed devices to hub ${JSON.stringify(devices)}`);
      } else {
        log.info(`Removed device and pushed information to hub ${JSON.stringify(devices)}`);
      }
    } catch (error) {
      log.error(`Unable to push devices update to hub. Reason: ${error}`);
    }
  }

  async unblockDevice(filter: IDeviceFilterOptions) {
    log.info(`Unblocking device ${this.host}/xenon/api/unblock`);
    try {
      await InternalHttpClient.post(`${this.host}/xenon/api/unblock`, filter, {
        params: {
          type: 'unblock',
        },
      });
      log.info(`Unblocked device with filter: ${JSON.stringify(filter)}`);
    } catch (error) {
      log.error(`Unable to unblock device. Reason: ${error}`);
    }
  }

  async unRegisterNode(host: string) {
    log.info(`Unregistering node ${this.host}/xenon/api/register`);
    try {
      await InternalHttpClient.post(`${this.host}/xenon/api/register`, [], {
        params: {
          type: 'unregister',
          host,
        },
      });
      log.info(`Unregistered node ${host} from hub`);
    } catch (error) {
      log.error(`Unable to unregister node from hub. Reason: ${error}`);
    }
  }
}
