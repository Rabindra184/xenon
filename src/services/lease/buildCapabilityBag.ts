import { IDevice } from '../../interfaces/IDevice';

export interface AllocatedPorts {
  systemPort?: number;
  chromedriverPort?: number;
  mjpegServerPort?: number;
  wdaLocalPort?: number;
}

export function buildCapabilityBag(
  device: IDevice,
  ports: AllocatedPorts,
  leaseId: string,
  buildId?: string,
): Record<string, any> {
  const isAndroid = String(device.platform).toLowerCase() === 'android';
  const bag: Record<string, any> = {
    platformName: isAndroid ? 'Android' : 'iOS',
    'appium:automationName': isAndroid ? 'UiAutomator2' : 'XCUITest',
    'appium:udid': device.udid,
    'appium:newCommandTimeout': 120,
  };
  if (device.name) bag['appium:deviceName'] = device.name;
  if (device.sdk) bag['appium:platformVersion'] = device.sdk;

  if (isAndroid) {
    if (ports.systemPort) bag['appium:systemPort'] = ports.systemPort;
    if (ports.chromedriverPort) bag['appium:chromedriverPort'] = ports.chromedriverPort;
  } else {
    if (ports.wdaLocalPort) bag['appium:wdaLocalPort'] = ports.wdaLocalPort;
  }
  if (ports.mjpegServerPort) bag['appium:mjpegServerPort'] = ports.mjpegServerPort;

  const xenonOptions: Record<string, any> = { leaseId };
  if (buildId) xenonOptions.buildId = buildId;
  bag['xenon:options'] = xenonOptions;
  return bag;
}
