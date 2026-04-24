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

  // Phase 2: when set, restrict to devices whose teamId is null (shared pool)
  // OR matches this id. Admin callers omit this to see everything.
  callerTeamId?: string | null;
}
