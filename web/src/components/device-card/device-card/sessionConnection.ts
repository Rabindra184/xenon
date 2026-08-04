import { IDevice } from '../../../interfaces/IDevice';

const DEFAULT_BASE_PATH = '/wd/hub';

function automationNameFor(platform: IDevice['platform']): string {
  return platform === 'android' ? 'UiAutomator2' : 'XCUITest';
}

function platformNameFor(platform: IDevice['platform']): string {
  if (platform === 'android') return 'Android';
  if (platform === 'tvos') return 'tvOS';
  return 'iOS';
}

/** Appium client server URL derived from the device's Xenon node host. */
export function formatAppiumServerUrl(
  host?: string,
  basePath: string = DEFAULT_BASE_PATH,
): string {
  if (!host) return '—';
  try {
    const u = new URL(host.includes('://') ? host : `http://${host}`);
    const path = basePath.startsWith('/') ? basePath : `/${basePath}`;
    // Avoid double-appending when host already ends with the base path.
    const pathname = u.pathname.replace(/\/$/, '');
    if (pathname === path || pathname.endsWith(path)) {
      return `${u.protocol}//${u.host}${pathname}`;
    }
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return host;
  }
}

/** Minimal W3C capabilities to target this device on a Xenon/Appium server. */
export function buildSessionCapabilities(
  device: Pick<IDevice, 'platform' | 'udid' | 'sdk' | 'name'>,
): Record<string, string> {
  const caps: Record<string, string> = {
    platformName: platformNameFor(device.platform),
    'appium:automationName': automationNameFor(device.platform),
    'appium:udid': device.udid,
  };
  if (device.sdk && device.sdk !== 'Unknown' && device.sdk !== 'unknown') {
    caps['appium:platformVersion'] = device.sdk;
  }
  if (device.name) {
    caps['appium:deviceName'] = device.name;
  }
  return caps;
}

export function formatSessionCapabilitiesJson(
  device: Pick<IDevice, 'platform' | 'udid' | 'sdk' | 'name'>,
): string {
  return JSON.stringify(buildSessionCapabilities(device), null, 2);
}

export function deviceTypeLabel(
  deviceType?: IDevice['deviceType'],
): 'Real' | 'Simulator' | 'Emulator' | null {
  if (deviceType === 'real') return 'Real';
  if (deviceType === 'simulator') return 'Simulator';
  if (deviceType === 'emulator') return 'Emulator';
  return null;
}
