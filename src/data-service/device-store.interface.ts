import { IDevice } from '../interfaces/IDevice';
import { IDeviceFilterOptions } from '../interfaces/IDeviceFilterOptions';
import { ClaimRef } from './deviceClaims';

/**
 * How addDevices treats a phone the store already has. By default it writes
 * only the discovery columns (DISCOVERY_FIELDS in deviceFieldOwners.ts), so a
 * sync can't undo a session's lock, a preview's hold or a team change.
 *
 * `nodeReport` is a hub storing a node's report of its phones: it writes the
 * columns the node observes (NODE_REPORT_FIELDS) and sets `nodeBusy` from the
 * report's `busy`, never `busy` itself. The phone is then busy if the node
 * says so, and freed only where the hub holds no claim (deviceClaims.ts). The
 * settings the hub owns (team, tags, reservation, block) are never written.
 */
export interface AddDevicesOptions {
  nodeReport?: boolean;
}

/** How findAndLockDevice locks a phone. */
export interface LockOptions {
  /** Also take a claim for a session being created (deviceClaims.ts). */
  claim?: boolean;
}

/**
 * Enterprise Storage Interface for Device Management.
 * Allows switching between Local (LokiJS) and Distributed (Redis) stores.
 */
export interface IDeviceStore {
  getAllDevices(): Promise<IDevice[]>;
  getDevices(filterOptions: IDeviceFilterOptions): Promise<IDevice[]>;
  updateDevice(udid: string, host: string, updateData: Partial<IDevice>): Promise<void>;
  /** Adds the phones the store doesn't have and returns only those. */
  addDevices(devices: IDevice[], options?: AddDevicesOptions): Promise<IDevice[]>;
  /**
   * Delete the phones matching `filter`. The Prisma store matches a host that
   * isn't a URL as a substring, unless `exactHost` is set.
   */
  removeDevices(filter: Partial<IDevice>, options?: { exactHost?: boolean }): Promise<void>;
  /** Delete every phone, or only those filed under these hosts. */
  clearStorage(onlyHosts?: readonly string[]): Promise<void>;
  findDevice(filter: Partial<IDevice>): Promise<IDevice | null>;
  findDevices(filter: Partial<IDevice>): Promise<IDevice[]>;
  findAndLockDevice(
    filterOptions: IDeviceFilterOptions,
    options?: LockOptions,
  ): Promise<IDevice | null>;
  /**
   * Put a created session on the claim its phone was allocated with
   * (`claimedAt`), in one conditional update with `update`. False when the
   * claim is gone to another session meanwhile; nothing is written then.
   */
  claimForSession(
    udid: string,
    host: string,
    claimedAt: number | null | undefined,
    sessionId: string,
    update: Partial<IDevice>,
  ): Promise<boolean>;
  /**
   * End the claim `ref` names, writing `update` with it, then clear `busy`
   * where nothing else holds the phone. Each step one conditional update.
   * False when the phone no longer holds that claim; nothing is written then.
   */
  releaseClaim(
    udid: string,
    host: string,
    ref: ClaimRef,
    update: Partial<IDevice>,
  ): Promise<boolean>;
  /** Mark the phones of a session as just used, without reading them first. */
  touchSession(sessionId: string, at: number): Promise<void>;
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
