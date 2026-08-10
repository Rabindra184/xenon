import { IDevice } from './IDevice';
import { DeviceTypeToInclude } from './IPluginArgs';
import { DisplayState } from '../device-managers/android/displayState';

export interface IDeviceManager {
  getDevices(
    deviceTypes: { androidDeviceType: DeviceTypeToInclude; iosDeviceType: DeviceTypeToInclude },
    existingDeviceDetails: Array<IDevice>,
  ): Promise<IDevice[]>;
  tap?(udid: string, x: number, y: number): Promise<void>;
  swipe?(
    udid: string,
    x: number,
    y: number,
    endX: number,
    endY: number,
    duration: number,
  ): Promise<void>;
  typeText?(udid: string, text: string): Promise<void>;
  pressKey?(udid: string, keyCode: string | number): Promise<void>;
  installApp?(udid: string, appPath: string): Promise<void>;
  uninstallApp?(udid: string, bundleId: string): Promise<void>;
  getScreenshot?(udid: string): Promise<string>;
  getClipboard?(udid: string): Promise<string>;
  setClipboard?(udid: string, content: string): Promise<void>;
  touchAndHold?(udid: string, x: number, y: number, duration: number): Promise<void>;
  lock?(udid: string): Promise<void>;
  unlock?(udid: string): Promise<void>;
  listApps?(udid: string): Promise<string[]>;
  getLogs?(udid: string): Promise<string>;
  getAdditionalDeviceInfo?(device: IDevice): Promise<Partial<IDevice>>;
  checkHealth?(device: IDevice): Promise<Partial<IDevice>>;
  recoverHealth?(device: IDevice): Promise<boolean>;
  readyForSession?(device: IDevice): Promise<boolean>;
  executeShell?(udid: string, command: string): Promise<string>;
  getPageSource?(udid: string): Promise<string>;
  /**
   * Android only for now. iOS has no equivalent read wired up, so it simply
   * does not implement this and the dashboard shows no display-state hint
   * there rather than a guessed one.
   */
  getDisplayState?(udid: string): Promise<DisplayState>;
}
