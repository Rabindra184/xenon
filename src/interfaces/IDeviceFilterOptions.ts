import { Platform } from '../types/Platform';
import { DeviceType } from '../types/DeviceType';

export interface IDeviceFilterOptions {
  platform?: Platform;
  platformVersion?: string;
  name?: string;
  busy?: boolean;
  offline?: boolean;
  userBlocked?: boolean;
  udid?: string | string[];
  deviceType?: DeviceType;
  minSDK?: string;
  maxSDK?: string;
  session_id?: string;
  filterByHost?: string;
  tags?: string[];

  // Team-scope filter (Phase 4A). Undefined = no filter (admin / unscoped).
  // Empty array = only shared-pool devices (teamId IS NULL). Non-empty array
  // = shared pool + devices in any of the listed teams. The widening from
  // single -> set is for Phase 3's User-keyed multi-team membership;
  // token-narrowed callers pass a single-element array.
  callerTeamIds?: string[];
}
