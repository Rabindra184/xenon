import { IDevice } from '../interfaces/IDevice';
import { IDeviceFilterOptions } from '../interfaces/IDeviceFilterOptions';

/**
 * Enterprise Storage Interface for Device Management.
 * Allows switching between Local (LokiJS) and Distributed (Redis) stores.
 */
export interface IDeviceStore {
  getAllDevices(): Promise<IDevice[]>;
  getDevices(filterOptions: IDeviceFilterOptions): Promise<IDevice[]>;
  updateDevice(udid: string, host: string, updateData: Partial<IDevice>): Promise<void>;
  updateDevices(filter: Partial<IDevice>, updateFn: (device: IDevice) => void): Promise<void>;
  addDevices(devices: IDevice[]): Promise<IDevice[]>;
  removeDevices(filter: Partial<IDevice>): Promise<void>;
  clearStorage(): Promise<void>;
  findDevice(filter: Partial<IDevice>): Promise<IDevice | null>;
  findDevices(filter: Partial<IDevice>): Promise<IDevice[]>;
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
