import getPort from 'get-port';
import { ISessionCapability } from './interfaces/ISessionCapability';
import _ from 'lodash';
import { IDevice } from './interfaces/IDevice';

export enum XENON_CAPABILITIES {
  BUILD_NAME = 'build',
  SESSION_NAME = 'name',

  VIDEO_RECORDING = 'record_video',
  RECORD_VIDEO = 'recordVideo', // camelCase alias
  VIDEO_RESOLUTION = 'video_resolution',
  LIVE_VIDEO = 'live_video',
  SCREENSHOT_ON_FAILURE = 'screenshot_on_failure',
  SCREENSHOT_ON_FAIL = 'screenshotOnFailure', // camelCase alias

  XENON_OPTIONS = 'xenon:options',
  SAVE_DEVICE_LOGS = 'saveDeviceLogs',
  SAVE_LOGS = 'save_device_logs', // snake_case alias

  SCREENSHOT_ON_EVERY_COMMAND = 'screenshot_on_every_command',
  SCREENSHOT_EVERY_COMMAND = 'screenshotOnEveryCommand',
}

function isCapabilityAlreadyPresent(caps: ISessionCapability, capabilityName: string) {
  return _.has(caps.alwaysMatch, capabilityName) || _.has(caps.firstMatch[0], capabilityName);
}

function deleteAlwaysMatch(caps: ISessionCapability, capabilityName: string) {
  if (_.has(caps.alwaysMatch, capabilityName)) delete caps.alwaysMatch[capabilityName];
}

export async function androidCapabilities(caps: ISessionCapability, freeDevice: IDevice) {
  caps.firstMatch[0]['appium:udid'] = freeDevice.udid;
  caps.firstMatch[0]['platformName'] = freeDevice.platform;
  caps.firstMatch[0]['appium:systemPort'] = await getPort();
  caps.firstMatch[0]['appium:chromeDriverPort'] = await getPort();
  caps.firstMatch[0]['appium:adbRemoteHost'] = freeDevice.adbRemoteHost;
  caps.firstMatch[0]['appium:adbPort'] = freeDevice.adbPort;
  if (freeDevice.chromeDriverPath)
    caps.firstMatch[0]['appium:chromedriverExecutable'] = freeDevice.chromeDriverPath;
  if (!isCapabilityAlreadyPresent(caps, 'appium:mjpegServerPort')) {
    caps.firstMatch[0]['appium:mjpegServerPort'] = await getPort();
  }
  deleteAlwaysMatch(caps, 'platformName');
  deleteAlwaysMatch(caps, 'appium:udid');
  deleteAlwaysMatch(caps, 'appium:systemPort');
  deleteAlwaysMatch(caps, 'appium:chromeDriverPort');
  deleteAlwaysMatch(caps, 'appium:adbRemoteHost');
  deleteAlwaysMatch(caps, 'appium:adbPort');
}

export async function iOSCapabilities(
  caps: ISessionCapability,
  freeDevice: {
    udid: any;
    name: string;
    realDevice: boolean;
    sdk: string;
    platform: string;
    mjpegServerPort?: number;
    wdaLocalPort?: number;
    derivedDataPath?: string;
  },
) {
  caps.firstMatch[0]['appium:udid'] = freeDevice.udid;
  caps.firstMatch[0]['platformName'] = freeDevice.platform;
  caps.firstMatch[0]['appium:deviceName'] = freeDevice.name;
  caps.firstMatch[0]['appium:platformVersion'] = freeDevice.sdk;
  caps.firstMatch[0]['appium:wdaLocalPort'] = freeDevice.wdaLocalPort;
  caps.firstMatch[0]['appium:mjpegServerPort'] = freeDevice.mjpegServerPort;
  caps.firstMatch[0]['appium:derivedDataPath'] = freeDevice.derivedDataPath;

  // Technical Optimization: Reuse existing WDA tunnel if Stream Service is active
  // This prevents "Port Occupied" errors when the dashboard is open and speeds up startup by 15-30s
  try {
    const streamService = (
      await import('./device-managers/ios/IOSStreamService')
    ).default.getInstance();
    const streamStatus = streamService.getStreamStatus(freeDevice.udid);

    console.log(
      `[Xenon] 🔍 Checking Stream Status for ${freeDevice.udid}: ${streamStatus?.status || 'None'}`,
    );

    if (streamStatus && (streamStatus.status === 'running' || streamStatus.status === 'starting')) {
      const wdaUrl = `http://127.0.0.1:${streamStatus.wdaPort}`;
      caps.firstMatch[0]['appium:webDriverAgentUrl'] = wdaUrl;

      // If we are reusing the WDA, we MUST NOT pass wdaLocalPort or mjpegServerPort
      // as XCUITestDriver will still try to verify they are free and fail if busy.
      delete caps.firstMatch[0]['appium:wdaLocalPort'];
      delete caps.firstMatch[0]['appium:mjpegServerPort'];
      if (caps.alwaysMatch) {
        delete caps.alwaysMatch['appium:wdaLocalPort'];
        delete caps.alwaysMatch['appium:mjpegServerPort'];
      }

      console.log(
        `[Xenon] 🚀 Optimization: Reusing active WDA tunnel at ${wdaUrl} for ${freeDevice.udid}. Port check bypassed.`,
      );
    }
  } catch (e: any) {
    console.warn(`[Xenon] ⚠️ Failed to check Stream Service: ${e.message}`);
  }

  // Senior Resiliency: Inject higher defaults for WebDriverAgent in enterprise environments
  if (!isCapabilityAlreadyPresent(caps, 'appium:wdaLaunchTimeout')) {
    // 180s is safer for physical devices that might need WDA signing/installation
    caps.firstMatch[0]['appium:wdaLaunchTimeout'] = 180000;
  }
  if (!isCapabilityAlreadyPresent(caps, 'appium:wdaConnectionTimeout')) {
    // 120s is safer for remote devices
    caps.firstMatch[0]['appium:wdaConnectionTimeout'] = 120000;
  }

  const deleteMatch = [
    'appium:wdaLocalPort',
    'appium:mjpegServerPort',
    'appium:udid',
    'appium:deviceName',
    'platformName',
  ];
  deleteMatch.forEach((value) => deleteAlwaysMatch(caps, value));
}

export function getXenonCapabilities(caps: ISessionCapability) {
  const mergedCapabilites = Object.assign({}, caps.firstMatch[0], caps.alwaysMatch);

  // Helper to extract capability regardless of prefix or casing
  // Priority: xe: (Xenon) > xenon: > appium: > plain
  const getAnyCap = (snake: string, camel: string) => {
    const keys = [
      // Primary: xe: prefix (Xenon short form)
      `xe:${snake}`,
      `xe:${camel}`,
      // Secondary: xenon: prefix (Xenon full form)
      `xenon:${snake}`,
      `xenon:${camel}`,
      // Tertiary: appium: prefix
      `appium:${snake}`,
      `appium:${camel}`,
      // Plain capability names
      snake,
      camel,
    ];
    for (const key of keys) {
      if (mergedCapabilites[key] !== undefined) return mergedCapabilites[key];
    }
    return undefined;
  };

  const capabilities: Record<string, any> = {};

  // Normalize all essential capabilities to standard snake_case keys used by the plugin

  // 1. Video Recording
  const videoCap = getAnyCap(XENON_CAPABILITIES.VIDEO_RECORDING, XENON_CAPABILITIES.RECORD_VIDEO);
  capabilities[XENON_CAPABILITIES.VIDEO_RECORDING] =
    videoCap !== undefined ? String(videoCap) === 'true' : true;

  // 2. Screenshot on Failure
  const screenCapOnFail = getAnyCap(
    XENON_CAPABILITIES.SCREENSHOT_ON_FAILURE,
    XENON_CAPABILITIES.SCREENSHOT_ON_FAIL,
  );
  capabilities[XENON_CAPABILITIES.SCREENSHOT_ON_FAILURE] =
    screenCapOnFail !== undefined ? String(screenCapOnFail) === 'true' : true;

  // 3. Screenshot on Every Command
  const screenCapEvery = getAnyCap(
    XENON_CAPABILITIES.SCREENSHOT_ON_EVERY_COMMAND,
    XENON_CAPABILITIES.SCREENSHOT_EVERY_COMMAND,
  );
  capabilities[XENON_CAPABILITIES.SCREENSHOT_ON_EVERY_COMMAND] = String(screenCapEvery) === 'true';

  // 4. Save Logs
  const logsCap = getAnyCap(XENON_CAPABILITIES.SAVE_LOGS, XENON_CAPABILITIES.SAVE_DEVICE_LOGS);
  capabilities[XENON_CAPABILITIES.SAVE_DEVICE_LOGS] = String(logsCap) === 'true';

  // 5. Build and Session Names
  capabilities[XENON_CAPABILITIES.BUILD_NAME] = getAnyCap(
    XENON_CAPABILITIES.BUILD_NAME,
    'buildName',
  );
  capabilities[XENON_CAPABILITIES.SESSION_NAME] = getAnyCap(
    XENON_CAPABILITIES.SESSION_NAME,
    'sessionName',
  );

  console.log(
    '[CapabilityManager] Resolved Capabilities: ' +
    `Video=${capabilities[XENON_CAPABILITIES.VIDEO_RECORDING]}, ` +
    `EveryScreenshot=${capabilities[XENON_CAPABILITIES.SCREENSHOT_ON_EVERY_COMMAND]}, ` +
    `FailScreenshot=${capabilities[XENON_CAPABILITIES.SCREENSHOT_ON_FAILURE]}, ` +
    `SaveLogs=${capabilities[XENON_CAPABILITIES.SAVE_DEVICE_LOGS]}`,
  );

  return capabilities;
}
