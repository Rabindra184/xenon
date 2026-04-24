import { IDevice } from '../interfaces/IDevice';
import { IDeviceFilterOptions } from '../interfaces/IDeviceFilterOptions';
import {
  IDeviceStore,
  IPendingSessionStore,
  ICLIArgsStore,
  IHealEtalonStore,
} from './device-store.interface';

import log from '../logger';
import semver from 'semver';
import { XenonDatabase } from './db';
import { PrismaDeviceStore, PrismaPendingSessionStore, PrismaCLIArgsStore } from './prisma-store';
import { config } from '../config';

/**
 * LokiJS Implementation of Device Store (Legacy/Internal)
 */
class LokiDeviceStore implements IDeviceStore {
  private log = log.scope('LokiStore');

  async getAllDevices(): Promise<IDevice[]> {
    return (await XenonDatabase.DeviceModel).chain().find().data();
  }

  async getDevices(filterOptions: IDeviceFilterOptions): Promise<IDevice[]> {
    const basicFilter =
      process.env.NODE_ENV === 'test'
        ? {}
        : { host: { $ne: undefined }, userBlocked: { $ne: undefined } };

    const allInColl = (await XenonDatabase.DeviceModel).find(basicFilter);

    const filtered = allInColl.filter((device: IDevice) => {
      // Platform Filter
      if (filterOptions.platform) {
        const match =
          (device.platform || '').toLowerCase() === filterOptions.platform.toLowerCase();
        // if (!match) console.error(`[LokiStore] Platform Mismatch: ${device.udid} (${device.platform} vs ${filterOptions.platform})`);
        if (!match) return false;
      }

      // Platform Version Filter
      if (filterOptions.platformVersion) {
        const coercedFilterVersion = semver.coerce(filterOptions.platformVersion);
        const coercedDeviceVersion = semver.coerce(device.sdk || '');
        if (
          !coercedFilterVersion ||
          !coercedDeviceVersion ||
          !semver.eq(coercedDeviceVersion, coercedFilterVersion)
        )
          return false;
      }

      // Name Filter
      if (filterOptions.name?.trim()) {
        const nameRegex = new RegExp(filterOptions.name.trim(), 'i');
        if (!nameRegex.test(device.name || '')) return false;
      }

      // UDID Filter
      if (filterOptions.udid) {
        if (Array.isArray(filterOptions.udid)) {
          if (filterOptions.udid.length > 0 && !filterOptions.udid.includes(device.udid))
            return false;
        } else if (device.udid !== filterOptions.udid) {
          return false;
        }
      }

      // Device Type Filter
      if (filterOptions.deviceType) {
        if (device.deviceType !== filterOptions.deviceType) return false;
      }

      // Host Filter
      if (filterOptions.filterByHost) {
        const hostFilter = filterOptions.filterByHost.toLowerCase();
        if (!(device.host || '').toLowerCase().includes(hostFilter)) return false;
      }

      // Team scoping (see prisma-store.ts for the DB equivalent).
      if (Object.prototype.hasOwnProperty.call(filterOptions, 'callerTeamId')) {
        const caller = filterOptions.callerTeamId;
        if (caller) {
          if (device.teamId && device.teamId !== caller) return false;
        } else {
          if (device.teamId) return false;
        }
      }

      // Session ID Filter
      if (filterOptions.session_id) {
        if (device.session_id !== filterOptions.session_id) return false;
      }

      // Busy / Offline / UserBlocked Filters
      if (filterOptions.busy !== undefined && device.busy !== filterOptions.busy) return false;
      if (filterOptions.offline !== undefined && device.offline !== filterOptions.offline)
        return false;
      if (
        filterOptions.userBlocked !== undefined &&
        device.userBlocked !== filterOptions.userBlocked
      )
        return false;

      // minSDK Filter
      if (filterOptions.minSDK) {
        const coercedMinSDK = semver.coerce(filterOptions.minSDK);
        const coercedSDK = semver.coerce(device.sdk || '');
        if (!coercedMinSDK || !coercedSDK || !semver.gte(coercedSDK, coercedMinSDK)) return false;
      }

      // maxSDK Filter
      if (filterOptions.maxSDK) {
        const coercedMaxSDK = semver.coerce(filterOptions.maxSDK);
        const coercedSDK = semver.coerce(device.sdk || '');
        if (!coercedMaxSDK || !coercedSDK || !semver.lte(coercedSDK, coercedMaxSDK)) return false;
      }

      return true;
    });

    return filtered.sort((a, b) => {
      try {
        const vA = semver.coerce(a.sdk || '0.0.0');
        const vB = semver.coerce(b.sdk || '0.0.0');
        if (vA && vB) {
          if (semver.gt(vA, vB)) return -1;
          if (semver.lt(vA, vB)) return 1;
        }
      } catch (e) {
        // Ignore sort errors
      }
      return 0;
    });
  }

  async updateDevice(udid: string, host: string, updateData: Partial<IDevice>): Promise<void> {
    (await XenonDatabase.DeviceModel)
      .chain()
      .find({ udid, host })
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
        if (cleanDevice.host === undefined) cleanDevice.host = 'Local';
        if (cleanDevice.userBlocked === undefined) cleanDevice.userBlocked = false;
        if (cleanDevice.busy === undefined) cleanDevice.busy = false;
        if (cleanDevice.offline === undefined) cleanDevice.offline = false;

        // @ts-ignore - LokiJS adds $loki metadata that we need to strip before insert
        delete cleanDevice['$loki'];
        // @ts-ignore
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

  async findAndLockDevice(filterOptions: IDeviceFilterOptions): Promise<IDevice | null> {
    const devices = await this.getDevices(filterOptions);
    const available = devices.find((d) => !d.busy && !d.userBlocked);
    if (available) {
      await this.updateDevice(available.udid, available.host, { busy: true });
      return available;
    }
    return null;
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

class LokiHealEtalonStore implements IHealEtalonStore {
  private collectionName = 'locator-etalons';

  private async getCollection() {
    const db = await XenonDatabase.db;
    let coll = db.getCollection(this.collectionName);
    if (!coll) {
      coll = db.addCollection(this.collectionName, { unique: ['selector'] });
    }
    return coll;
  }

  async saveSignature(etalon: any): Promise<void> {
    const coll = await this.getCollection();
    const existing = coll.findOne({ selector: etalon.selector });
    if (existing) {
      Object.assign(existing, etalon);
      coll.update(existing);
    } else {
      coll.insert(etalon);
    }
  }

  async getSignature(selector: string): Promise<any | null> {
    const coll = await this.getCollection();
    return coll.findOne({ selector });
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
    if (process.env.NODE_ENV === 'test') return 'loki';
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

  private static _healEtalonStore: IHealEtalonStore;
  static getHealEtalonStore(): IHealEtalonStore {
    if (!this._healEtalonStore) {
      if (this.getStorageType() === 'prisma') {
        const { PrismaHealEtalonStore } = require('./prisma-store');
        this._healEtalonStore = new PrismaHealEtalonStore();
      } else {
        this._healEtalonStore = new LokiHealEtalonStore();
      }
    }
    return this._healEtalonStore;
  }
}
