import { IDevice } from '../interfaces/IDevice';
import { IDeviceFilterOptions } from '../interfaces/IDeviceFilterOptions';
import { IDeviceStore, IPendingSessionStore, ICLIArgsStore } from './device-store.interface';

import log from '../logger';
import semver from 'semver';
import { XenonDatabase } from './db';
import { PrismaDeviceStore, PrismaPendingSessionStore, PrismaCLIArgsStore } from './prisma-store';
import { config } from '../config';

/**
 * LokiJS Implementation of Device Store (Legacy/Internal)
 */
class LokiDeviceStore implements IDeviceStore {
  // ... (rest of LokiDeviceStore implementation stays same)
  private log = log.scope('LokiStore');

  async getAllDevices(): Promise<IDevice[]> {
    return (await XenonDatabase.DeviceModel).chain().find().data();
  }

  async getDevices(filterOptions: IDeviceFilterOptions): Promise<IDevice[]> {
    const basicFilter = { host: { $ne: undefined }, userBlocked: { $ne: undefined } };
    const deviceModel = await XenonDatabase.DeviceModel;
    let results = deviceModel.chain().find(basicFilter);
    const filter = {} as any;

    type FilterOptionsKey = keyof IDeviceFilterOptions;
    const filterOptionKeys = Object.keys(filterOptions) as FilterOptionsKey[];

    filterOptionKeys
      .filter((key) => filterOptions[key] !== undefined)
      .forEach((key: FilterOptionsKey) => {
        switch (key) {
          case 'platform':
            filter.platform = filterOptions.platform;
            break;
          case 'platformVersion':
            const coercedPlatformVersion = semver.coerce(filterOptions.platformVersion);
            results = results.where((obj: IDevice) => {
              const coercedSDK = semver.coerce(obj.sdk);
              return !!(
                coercedSDK &&
                coercedPlatformVersion &&
                semver.eq(coercedSDK, coercedPlatformVersion)
              );
            });
            break;
          case 'name':
            if (filterOptions.name?.trim()) filter.name = { $contains: filterOptions.name.trim() };
            else filter.name = { $ne: undefined };
            break;
          case 'busy':
            filter.busy = filterOptions.busy;
            break;
          case 'offline':
            filter.offline = filterOptions.offline;
            break;
          case 'userBlocked':
            filter.userBlocked = filterOptions.userBlocked;
            break;
          case 'udid':
            if (filterOptions.udid.length > 0) filter.udid = { $in: filterOptions.udid };
            break;
          case 'deviceType':
            filter.deviceType = filterOptions.deviceType;
            break;
          case 'session_id':
            filter.session_id = filterOptions.session_id;
            break;
          case 'filterByHost':
            filter.host = { $contains: filterOptions.filterByHost };
            break;
          case 'minSDK':
            const coercedMinSDK = semver.coerce(filterOptions.minSDK);
            if (coercedMinSDK) {
              results = results.where((obj: IDevice) => {
                const coercedSDK = semver.coerce(obj.sdk);
                return !!(coercedSDK && semver.gte(coercedSDK, coercedMinSDK));
              });
            }
            break;
          case 'maxSDK':
            const coercedMaxSDK = semver.coerce(filterOptions.maxSDK);
            if (coercedMaxSDK) {
              results = results.where((obj: IDevice) => {
                const coercedSDK = semver.coerce(obj.sdk);
                return !!(coercedSDK && semver.lte(coercedSDK, coercedMaxSDK));
              });
            }
            break;
        }
      });

    return results.find(filter).data();
  }

  async updateDevice(udid: string, host: string, updateData: Partial<IDevice>): Promise<void> {
    (await XenonDatabase.DeviceModel)
      .chain()
      .find({ udid, host: { $contains: host } })
      .update((device: IDevice) => {
        Object.assign(device, updateData);
      });
  }

  async updateDevices(
    filter: Partial<IDevice>,
    updateFn: (device: IDevice) => void,
  ): Promise<void> {
    (await XenonDatabase.DeviceModel).chain().find(filter).update(updateFn);
  }

  async addDevices(devices: IDevice[]): Promise<IDevice[]> {
    const deviceModel = await XenonDatabase.DeviceModel;
    const added: IDevice[] = [];

    for (const device of devices) {
      const existing = deviceModel.findOne({ udid: device.udid, host: device.host });
      if (!existing) {
        const cleanDevice = { ...device };
        // @ts-expect-error - LokiJS adds $loki metadata that we need to strip before insert
        delete cleanDevice['$loki'];
        // @ts-expect-error - LokiJS adds meta metadata that we need to strip before insert
        delete cleanDevice['meta'];
        deviceModel.insert(cleanDevice);
        added.push(cleanDevice);
      }
    }
    return added;
  }

  async removeDevices(filter: Partial<IDevice>): Promise<void> {
    (await XenonDatabase.DeviceModel).chain().find(filter).remove();
  }

  async clearStorage(): Promise<void> {
    (await XenonDatabase.DeviceModel).removeDataOnly();
  }

  async findDevice(filter: Partial<IDevice>): Promise<IDevice | null> {
    return (await XenonDatabase.DeviceModel).findOne(filter);
  }

  async findDevices(filter: Partial<IDevice>): Promise<IDevice[]> {
    return (await XenonDatabase.DeviceModel).find(filter);
  }

  async resetMetrics(): Promise<void> {
    (await XenonDatabase.DeviceModel)
      .chain()
      .find()
      .update((device: IDevice) => {
        device.totalHealedCount = 0;
      });
  }
}

class LokiPendingSessionStore implements IPendingSessionStore {
  async addPendingSession(capability: any): Promise<void> {
    (await XenonDatabase.PendingSessionsModel).insert(capability);
  }

  async removePendingSession(sessionCapabilityId: string): Promise<void> {
    (await XenonDatabase.PendingSessionsModel)
      .chain()
      .find({ capability_id: sessionCapabilityId })
      .remove();
  }

  async getAllPendingSessions(): Promise<any[]> {
    return (await XenonDatabase.PendingSessionsModel).chain().find().data();
  }

  async remove(session: any): Promise<void> {
    (await XenonDatabase.PendingSessionsModel).remove(session);
  }
}

class LokiCLIArgsStore implements ICLIArgsStore {
  async addCLIArgs(args: any): Promise<void> {
    (await XenonDatabase.CLIArgs).insert(args);
  }

  async getCLIArgs(): Promise<any[]> {
    return (await XenonDatabase.CLIArgs).chain().find().data();
  }
}

/**
 * Factory for Device Store.
 * Determines storage type based on config.
 */
export class DeviceStoreFactory {
  private static _deviceStore: IDeviceStore;
  private static _pendingSessionStore: IPendingSessionStore;
  private static _cliArgsStore: ICLIArgsStore;

  private static getStorageType(): 'loki' | 'prisma' {
    const type = process.env.XENON_STORAGE_TYPE || config.databaseProvider;
    if (type === 'sqlite' || type === 'postgresql' || type === 'prisma') return 'prisma';
    return 'loki';
  }

  static getStore(): IDeviceStore {
    if (!this._deviceStore) {
      if (this.getStorageType() === 'prisma') {
        this._deviceStore = new PrismaDeviceStore();
      } else {
        this._deviceStore = new LokiDeviceStore();
      }
    }
    return this._deviceStore;
  }

  static getPendingSessionStore(): IPendingSessionStore {
    if (!this._pendingSessionStore) {
      if (this.getStorageType() === 'prisma') {
        this._pendingSessionStore = new PrismaPendingSessionStore();
      } else {
        this._pendingSessionStore = new LokiPendingSessionStore();
      }
    }
    return this._pendingSessionStore;
  }

  static getCLIArgsStore(): ICLIArgsStore {
    if (!this._cliArgsStore) {
      if (this.getStorageType() === 'prisma') {
        this._cliArgsStore = new PrismaCLIArgsStore();
      } else {
        this._cliArgsStore = new LokiCLIArgsStore();
      }
    }
    return this._cliArgsStore;
  }
}
