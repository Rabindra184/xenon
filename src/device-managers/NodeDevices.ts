import log from '../logger';
import { DeviceWithPath } from '@devicefarmer/adbkit';
import { DeviceUpdate } from '../types/DeviceUpdate';
import { IDeviceFilterOptions } from '../interfaces/IDeviceFilterOptions';
import { InternalHttpClient } from '../InternalHttpClient';

interface NodeDevicesOptions {
  tlsRejectUnauthorized?: boolean;
  nodeSecret?: string; // legacy; phased out via XENON_ACCEPT_LEGACY_NODE_SECRET
  hubAccessKey?: string; // pair-auth (preferred)
  hubToken?: string;
}

export default class NodeDevices {
  private host: string;
  private tlsRejectUnauthorized?: boolean;
  private nodeSecret?: string;
  private hubAccessKey?: string;
  private hubToken?: string;

  constructor(host: string, options: NodeDevicesOptions = {}) {
    this.host = host;
    this.tlsRejectUnauthorized = options.tlsRejectUnauthorized;
    this.nodeSecret = options.nodeSecret;
    this.hubAccessKey = options.hubAccessKey;
    this.hubToken = options.hubToken;
  }

  // Phase 4B: pair auth wins when both shapes are configured. A node mid-
  // migration may have BOTH XENON_HUB_ACCESS_KEY/TOKEN AND XENON_NODE_SECRET
  // set; we always prefer the pair, leaving the legacy env var harmless.
  private nodeHeaders(): Record<string, string> {
    if (this.hubAccessKey && this.hubToken) {
      return {
        'x-xenon-access-key': this.hubAccessKey,
        'x-xenon-token': this.hubToken,
      };
    }
    if (this.nodeSecret) {
      return { 'x-xenon-node-secret': this.nodeSecret };
    }
    return {};
  }

  async postDevicesToHub(devices: DeviceWithPath[] | DeviceUpdate[], arg: string) {
    log.info(`Updating remote android devices ${this.host}/xenon/api/register`);
    try {
      const client = InternalHttpClient.getClient(this.tlsRejectUnauthorized);
      await client.post(`${this.host}/xenon/api/register`, devices, {
        params: { type: arg },
        headers: this.nodeHeaders(),
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
      const client = InternalHttpClient.getClient(this.tlsRejectUnauthorized);
      await client.post(`${this.host}/xenon/api/unblock`, filter, {
        params: { type: 'unblock' },
        headers: this.nodeHeaders(),
      });
      log.info(`Unblocked device with filter: ${JSON.stringify(filter)}`);
    } catch (error) {
      log.error(`Unable to unblock device. Reason: ${error}`);
    }
  }

  async unRegisterNode(host: string) {
    log.info(`Unregistering node ${this.host}/xenon/api/register`);
    try {
      const client = InternalHttpClient.getClient(this.tlsRejectUnauthorized);
      await client.post(`${this.host}/xenon/api/register`, [], {
        params: { type: 'unregister', host },
        headers: this.nodeHeaders(),
      });
      log.info(`Unregistered node ${host} from hub`);
    } catch (error) {
      log.error(`Unable to unregister node from hub. Reason: ${error}`);
    }
  }
}
