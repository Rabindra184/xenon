import getPort from 'get-port';
import { ISessionCapability } from './interfaces/ISessionCapability';
import _ from 'lodash';
import { IDevice } from './interfaces/IDevice';
import { Container } from 'typedi';
import log from './logger';

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

  NETWORK_PROFILE = 'network_profile',
  ISOLATION_PROFILE = 'isolation_profile',

  INTERCEPTOR = 'interceptor',
  INTERCEPTOR_ENABLED = 'interceptor_enabled',
  INTERCEPTOR_BUFFER_SIZE = 'interceptor_buffer_size',
  INTERCEPTOR_CAPTURE_BODIES = 'interceptor_capture_bodies',
  INTERCEPTOR_MOCKS = 'interceptor_mocks',
  INTERCEPTOR_INCLUDE_HOSTS = 'interceptor_include_hosts',
  INTERCEPTOR_EXCLUDE_HOSTS = 'interceptor_exclude_hosts',
}

// W3C lets clients omit firstMatch (default [{}]). Normalize-and-return so write
// paths can mutate caps.firstMatch[0] without per-line guarding.
function ensureFirstMatch(caps: ISessionCapability): Record<string, any> {
  if (!caps.firstMatch || caps.firstMatch.length === 0) caps.firstMatch = [{}];
  return caps.firstMatch[0];
}

function isCapabilityAlreadyPresent(caps: ISessionCapability, capabilityName: string) {
  return _.has(caps.alwaysMatch, capabilityName) || _.has(caps.firstMatch?.[0], capabilityName);
}

function deleteAlwaysMatch(caps: ISessionCapability, capabilityName: string) {
  if (_.has(caps.alwaysMatch, capabilityName)) delete caps.alwaysMatch[capabilityName];
}

export async function androidCapabilities(caps: ISessionCapability, freeDevice: IDevice) {
  const fm = ensureFirstMatch(caps);
  fm['appium:udid'] = freeDevice.udid;
  fm['platformName'] = freeDevice.platform;
  fm['appium:systemPort'] = await getPort();
  fm['appium:chromeDriverPort'] = await getPort();
  fm['appium:adbRemoteHost'] = freeDevice.adbRemoteHost;
  fm['appium:adbPort'] = freeDevice.adbPort;
  if (freeDevice.chromeDriverPath)
    fm['appium:chromedriverExecutable'] = freeDevice.chromeDriverPath;
  if (!isCapabilityAlreadyPresent(caps, 'appium:mjpegServerPort')) {
    fm['appium:mjpegServerPort'] = await getPort();
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
  const fm = ensureFirstMatch(caps);
  fm['appium:udid'] = freeDevice.udid;
  fm['platformName'] = freeDevice.platform;
  fm['appium:deviceName'] = freeDevice.name;
  fm['appium:platformVersion'] = freeDevice.sdk;
  fm['appium:wdaLocalPort'] = freeDevice.wdaLocalPort;
  fm['appium:mjpegServerPort'] = freeDevice.mjpegServerPort;
  fm['appium:derivedDataPath'] = freeDevice.derivedDataPath;

  // Technical Optimization: Reuse existing WDA tunnel if Stream Service is active
  // This prevents "Port Occupied" errors when the dashboard is open and speeds up startup by 15-30s
  try {
    const { default: IOSStreamService } = await import('./device-managers/ios/IOSStreamService');
    const streamService = Container.get(IOSStreamService);
    const streamStatus = streamService.getStreamStatus(freeDevice.udid);

    log.info(
      `[Xenon] 🔍 Checking Stream Status for ${freeDevice.udid}: ${streamStatus?.status || 'None'}`,
    );

    if (streamStatus && (streamStatus.status === 'running' || streamStatus.status === 'starting')) {
      const wdaUrl = `http://127.0.0.1:${streamStatus.wdaPort}`;
      fm['appium:webDriverAgentUrl'] = wdaUrl;

      // If we are reusing the WDA, we MUST NOT pass wdaLocalPort or mjpegServerPort
      // as XCUITestDriver will still try to verify they are free and fail if busy.
      delete fm['appium:wdaLocalPort'];
      delete fm['appium:mjpegServerPort'];
      if (caps.alwaysMatch) {
        delete caps.alwaysMatch['appium:wdaLocalPort'];
        delete caps.alwaysMatch['appium:mjpegServerPort'];
      }

      log.info(
        `[Xenon] 🚀 Optimization: Reusing active WDA tunnel at ${wdaUrl} for ${freeDevice.udid}. Port check bypassed.`,
      );
    }
  } catch (e: any) {
    log.warn(`[Xenon] ⚠️ Failed to check Stream Service: ${e.message}`);
  }

  // Senior Resiliency: Inject higher defaults for WebDriverAgent in enterprise environments
  if (!isCapabilityAlreadyPresent(caps, 'appium:wdaLaunchTimeout')) {
    // 180s is safer for physical devices that might need WDA signing/installation
    fm['appium:wdaLaunchTimeout'] = 180000;
  }
  if (!isCapabilityAlreadyPresent(caps, 'appium:wdaConnectionTimeout')) {
    // 120s is safer for remote devices
    fm['appium:wdaConnectionTimeout'] = 120000;
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

export function extractTeamCap(caps: ISessionCapability): string | undefined {
  const merged = Object.assign({}, caps.firstMatch?.[0] || {}, caps.alwaysMatch || {});
  const prefixes = ['xenon:', 'xe:', 'appium:', ''];
  const names = ['teamId', 'team_id', 'team'];
  for (const prefix of prefixes) {
    for (const name of names) {
      const v = merged[prefix ? `${prefix}${name}` : name];
      if (typeof v === 'string' && v.length > 0) return v;
    }
  }
  return undefined;
}

export function extractAccessKeyCap(caps: ISessionCapability): string | undefined {
  const merged = Object.assign({}, caps.firstMatch?.[0] || {}, caps.alwaysMatch || {});
  const prefixes = ['xenon:', 'xe:', 'appium:', ''];
  const names = ['accessKey', 'access_key'];
  for (const prefix of prefixes) {
    for (const name of names) {
      const v = merged[prefix ? `${prefix}${name}` : name];
      if (typeof v === 'string' && v.length > 0) return v;
    }
  }
  return undefined;
}

// Returns the (accessKey, token) pair from df:options.{accessKey,token} or
// equivalently df:options.{access_key,token}. Returns undefined if either
// piece is missing — callers fall back to extractAccessKeyCap (legacy).
export function extractAccessKeyTokenPair(
  caps: ISessionCapability,
): { accessKey: string; token: string } | undefined {
  const merged = Object.assign({}, caps.firstMatch?.[0] || {}, caps.alwaysMatch || {});
  const dfOptions =
    merged['df:options'] ?? merged['xenon:df:options'] ?? merged['appium:df:options'];
  if (!dfOptions || typeof dfOptions !== 'object') return undefined;
  const accessKey = (dfOptions as any).accessKey ?? (dfOptions as any).access_key;
  const token = (dfOptions as any).token;
  if (typeof accessKey !== 'string' || typeof token !== 'string') return undefined;
  if (!accessKey || !token) return undefined;
  return { accessKey, token };
}

export function getXenonCapabilities(caps: ISessionCapability) {
  const mergedCapabilites = Object.assign({}, caps.firstMatch?.[0] ?? {}, caps.alwaysMatch);

  const getAnyCap = (snake: string, camel: string) => {
    // Strict prefix resolution: xe:, appium:, no-prefix — snake_case + camelCase fallbacks.
    // Also accept the namespaced `xenon:options.<name>` form, which is how other Appium
    // plugins document nested options and what most users naturally try first.
    const prefixes = ['xe:', 'appium:', ''];
    const names = [snake, camel];

    for (const prefix of prefixes) {
      for (const name of names) {
        const key = prefix ? `${prefix}${name}` : name;
        if (mergedCapabilites[key] !== undefined) return mergedCapabilites[key];
      }
    }

    const xenonOptions = mergedCapabilites[XENON_CAPABILITIES.XENON_OPTIONS];
    if (xenonOptions && typeof xenonOptions === 'object') {
      for (const name of names) {
        if (xenonOptions[name] !== undefined) return xenonOptions[name];
      }
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

  // 6. Network Profile
  capabilities[XENON_CAPABILITIES.NETWORK_PROFILE] = getAnyCap(
    XENON_CAPABILITIES.NETWORK_PROFILE,
    'networkProfile',
  );

  // 7. Isolation Profile
  capabilities[XENON_CAPABILITIES.ISOLATION_PROFILE] = getAnyCap(
    XENON_CAPABILITIES.ISOLATION_PROFILE,
    'isolationProfile',
  );

  // 8. Network Interceptor
  // Accept either a structured object (`xe:interceptor: { enabled, mocks, ... }`)
  // or individual flat keys for users who prefer them.
  const interceptorObj = getAnyCap(XENON_CAPABILITIES.INTERCEPTOR, 'interceptor');
  if (interceptorObj && typeof interceptorObj === 'object') {
    capabilities[XENON_CAPABILITIES.INTERCEPTOR_ENABLED] = !!interceptorObj.enabled;
    capabilities[XENON_CAPABILITIES.INTERCEPTOR_BUFFER_SIZE] = interceptorObj.bufferSize;
    capabilities[XENON_CAPABILITIES.INTERCEPTOR_CAPTURE_BODIES] =
      interceptorObj.captureBodies !== false;
    capabilities[XENON_CAPABILITIES.INTERCEPTOR_MOCKS] = Array.isArray(interceptorObj.mocks)
      ? interceptorObj.mocks
      : [];
    capabilities[XENON_CAPABILITIES.INTERCEPTOR_INCLUDE_HOSTS] = Array.isArray(
      interceptorObj.includeHosts,
    )
      ? interceptorObj.includeHosts
      : [];
    capabilities[XENON_CAPABILITIES.INTERCEPTOR_EXCLUDE_HOSTS] = Array.isArray(
      interceptorObj.excludeHosts,
    )
      ? interceptorObj.excludeHosts
      : [];
  } else {
    const enabledFlat = getAnyCap(XENON_CAPABILITIES.INTERCEPTOR_ENABLED, 'interceptorEnabled');
    capabilities[XENON_CAPABILITIES.INTERCEPTOR_ENABLED] =
      enabledFlat !== undefined ? String(enabledFlat) === 'true' : false;
    capabilities[XENON_CAPABILITIES.INTERCEPTOR_BUFFER_SIZE] = getAnyCap(
      XENON_CAPABILITIES.INTERCEPTOR_BUFFER_SIZE,
      'interceptorBufferSize',
    );
    capabilities[XENON_CAPABILITIES.INTERCEPTOR_CAPTURE_BODIES] = true;
    capabilities[XENON_CAPABILITIES.INTERCEPTOR_MOCKS] = [];
    const includeFlat = getAnyCap(
      XENON_CAPABILITIES.INTERCEPTOR_INCLUDE_HOSTS,
      'interceptorIncludeHosts',
    );
    const excludeFlat = getAnyCap(
      XENON_CAPABILITIES.INTERCEPTOR_EXCLUDE_HOSTS,
      'interceptorExcludeHosts',
    );
    capabilities[XENON_CAPABILITIES.INTERCEPTOR_INCLUDE_HOSTS] = Array.isArray(includeFlat)
      ? includeFlat
      : [];
    capabilities[XENON_CAPABILITIES.INTERCEPTOR_EXCLUDE_HOSTS] = Array.isArray(excludeFlat)
      ? excludeFlat
      : [];
  }

  log.debug(
    '[CapabilityManager] Resolved Capabilities: ' +
      `Video=${capabilities[XENON_CAPABILITIES.VIDEO_RECORDING]}, ` +
      `EveryScreenshot=${capabilities[XENON_CAPABILITIES.SCREENSHOT_ON_EVERY_COMMAND]}, ` +
      `FailScreenshot=${capabilities[XENON_CAPABILITIES.SCREENSHOT_ON_FAILURE]}, ` +
      `SaveLogs=${capabilities[XENON_CAPABILITIES.SAVE_DEVICE_LOGS]}`,
  );

  return capabilities;
}
