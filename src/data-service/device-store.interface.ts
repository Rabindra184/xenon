import { IDevice } from '../interfaces/IDevice';
import { IDeviceFilterOptions } from '../interfaces/IDeviceFilterOptions';

/**
 * How addDevices treats a phone the store already has. By default it writes
 * only the discovery columns (DISCOVERY_FIELDS in deviceFieldOwners.ts), so a
 * sync can't undo a session's lock, a preview's hold or a team change.
 * `mirror` is the hub storing a node's own report of its phones: the node is
 * the source of truth for them, so every column is written.
 */
export interface AddDevicesOptions {
  mirror?: boolean;
}

/**
 * Enterprise Storage Interface for Device Management.
 * Allows switching between Local (LokiJS) and Distributed (Redis) stores.
 */
export interface IDeviceStore {
  getAllDevices(): Promise<IDevice[]>;
  getDevices(filterOptions: IDeviceFilterOptions): Promise<IDevice[]>;
  updateDevice(udid: string, host: string, updateData: Partial<IDevice>): Promise<void>;
  updateDevices(filter: Partial<IDevice>, updateFn: (device: IDevice) => void): Promise<void>;
  /** Adds the phones the store doesn't have and returns only those. */
  addDevices(devices: IDevice[], options?: AddDevicesOptions): Promise<IDevice[]>;
  removeDevices(filter: Partial<IDevice>): Promise<void>;
  clearStorage(): Promise<void>;
  findDevice(filter: Partial<IDevice>): Promise<IDevice | null>;
  findDevices(filter: Partial<IDevice>): Promise<IDevice[]>;
  findAndLockDevice(filterOptions: IDeviceFilterOptions): Promise<IDevice | null>;
  resetMetrics(): Promise<void>;
}

export interface IPendingSessionStore {
  addPendingSession(capability: any): Promise<void>;
  removePendingSession(sessionCapabilityId: string): Promise<void>;
  getAllPendingSessions(): Promise<any[]>;
  remove(session: any): Promise<void>;
}

export interface ICLIArgsStore {
  addCLIArgs(args: any): Promise<void>;
  getCLIArgs(): Promise<any[]>;
}

export interface IHealEtalonStore {
  saveSignature(etalon: any): Promise<void>;
  getSignature(selector: string): Promise<any | null>;
}
