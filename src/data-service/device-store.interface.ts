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
 * settings the hub owns (team, tags, reservation, block) are never written: a
 * new row starts from those the hub saved for the phone (deviceSettings.ts).
 */
export interface AddDevicesOptions {
  nodeReport?: boolean;
}

/** How findAndLockDevice locks a phone. */
export interface LockOptions {
  /** Also take a claim for a session being created (deviceClaims.ts). */
  claim?: boolean;
  /**
   * Lock only one of these phones, by `udid@host`. The filter's udid list
   * matches a udid on every host; this keeps the lock to the rows the caller
   * vetted (not reserved, say), not a twin of one on another host.
   */
  only?: ReadonlySet<string>;
}

/**
 * Enterprise Storage Interface for Device Management.
 * Allows switching between Local (LokiJS) and Distributed (Redis) stores.
 */
export interface IDeviceStore {
  getAllDevices(): Promise<IDevice[]>;
  getDevices(filterOptions: IDeviceFilterOptions): Promise<IDevice[]>;
  /**
   * Write `updateData` to the phone's row. Its setting columns (team, tags,
   * maintenance, reservation: SETTING_FIELDS) are saved for the phone first,
   * apart from the row, so a new row for it starts from them
   * (deviceSettings.ts). They are saved whether or not the row exists now:
   * the caller names a phone it knows.
   */
  updateDevice(udid: string, host: string, updateData: Partial<IDevice>): Promise<void>;
  /**
   * Adds the phones the store doesn't have and returns only those. Each starts
   * from the settings saved for it, in the write that creates it.
   */
  addDevices(devices: IDevice[], options?: AddDevicesOptions): Promise<IDevice[]>;
  /**
   * Delete the phones matching `filter`. The Prisma store matches a host that
   * isn't a URL as a substring, unless `exactHost` is set.
   */
  removeDevices(filter: Partial<IDevice>, options?: { exactHost?: boolean }): Promise<void>;
  /**
   * Delete every phone, or only those filed under these hosts. Their saved
   * settings stay (forgetSettings).
   */
  clearStorage(onlyHosts?: readonly string[]): Promise<void>;
  /**
   * Save the settings of every row that has some and none saved yet: rows
   * written before settings were saved apart. Returns how many were saved.
   */
  adoptSettings(): Promise<number>;
  /** Forget the saved settings of every phone, or only of those filed under these hosts. */
  forgetSettings(onlyHosts?: readonly string[]): Promise<void>;
  /** The phones of this udid with settings saved, whether they are connected now or not. */
  findSavedPhones(udid: string): Promise<Array<{ udid: string; host: string }>>;
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
  /**
   * Take away a lease's lock (a lease locks with `busy` alone): clear `busy`
   * where nothing else holds the phone (UNHELD in deviceClaims.ts), in one
   * conditional update, as releaseClaim's second step, and with it the
   * lease's stamps (`lastCmdExecutedAt`, `sessionStartTime`): left on the
   * row, the next preview or recording hold inherited them and was taken for
   * idle. A session still on the phone keeps it busy and its clock, and its
   * own release frees it later. True when `busy` was cleared.
   */
  releaseLeaseLock(udid: string, host: string): Promise<boolean>;
  /**
   * Write the manual hold `hold` (`manual_<user>_<udid>`: a preview, a
   * recording) and `busy`, in one conditional update, only where the phone
   * is isHoldable (deviceClaims.ts): no claim, pending or not, and nothing in
   * `session_id` but a manual hold. Clears the idle clock: a hold isn't a
   * session. False when it didn't take; nothing is written then.
   */
  takeManualHold(udid: string, host: string, hold: string): Promise<boolean>;
  /**
   * End a manual hold: exactly `hold`, or any manual hold when null. First
   * `session_id` is cleared where it is that hold, leaving any claim beside
   * it; then, unless a live lease holds the phone, `busy` and the session
   * bookkeeping are cleared (with `update`) where nothing else holds it
   * (UNHELD). Each step one conditional update. `released`: the hold was
   * there and is gone; `freed`: `busy` was cleared.
   */
  releaseManualHold(
    udid: string,
    host: string,
    hold: string | null,
    update: Partial<IDevice>,
  ): Promise<{ released: boolean; freed: boolean }>;
  /**
   * On a hub: the phone's node has just taken it (it answered a forwarded
   * stream/start), which its own report says only up to an interval later.
   * Sets `nodeBusy`, and `busy` with it, and `nodeHold` to `hold` when given,
   * as that report would; clears nothing. The node's next report replaces
   * `nodeBusy` and `nodeHold` as usual.
   */
  markNodeBusy(udid: string, host: string, hold?: string): Promise<void>;
  /**
   * Mark the phone of a session as just used, without reading it first: the
   * phone whose claim is the session's, or a row from before claims whose
   * `session_id` is (claimWhere). A manual hold in `session_id` beside the
   * claim doesn't hide it.
   */
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
