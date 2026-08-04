import { describe, it, expect } from 'vitest';
import {
  formatAppiumServerUrl,
  buildSessionCapabilities,
  formatSessionCapabilitiesJson,
  deviceTypeLabel,
} from './sessionConnection';

describe('formatAppiumServerUrl', () => {
  it('appends /wd/hub to a node host URL', () => {
    expect(formatAppiumServerUrl('http://192.168.0.104:4723')).toBe(
      'http://192.168.0.104:4723/wd/hub',
    );
  });

  it('does not double-append /wd/hub', () => {
    expect(formatAppiumServerUrl('http://192.168.0.104:4723/wd/hub')).toBe(
      'http://192.168.0.104:4723/wd/hub',
    );
  });

  it('returns em dash when host is missing', () => {
    expect(formatAppiumServerUrl(undefined)).toBe('—');
  });
});

describe('buildSessionCapabilities', () => {
  it('builds iOS XCUITest caps', () => {
    expect(
      buildSessionCapabilities({
        platform: 'ios',
        udid: 'UDID-1',
        sdk: '18.1',
        name: "Rabindra's iPhone",
      }),
    ).toEqual({
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:udid': 'UDID-1',
      'appium:platformVersion': '18.1',
      'appium:deviceName': "Rabindra's iPhone",
    });
  });

  it('builds Android UiAutomator2 caps', () => {
    expect(
      buildSessionCapabilities({
        platform: 'android',
        udid: 'emulator-5554',
        sdk: '14',
        name: 'Pixel_7',
      }),
    ).toEqual({
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:udid': 'emulator-5554',
      'appium:platformVersion': '14',
      'appium:deviceName': 'Pixel_7',
    });
  });

  it('formats pretty JSON', () => {
    const json = formatSessionCapabilitiesJson({
      platform: 'android',
      udid: 'x',
      sdk: '14',
      name: 'Phone',
    });
    expect(json).toContain('"platformName": "Android"');
    expect(json).toContain('"appium:udid": "x"');
  });
});

describe('deviceTypeLabel', () => {
  it('maps device types', () => {
    expect(deviceTypeLabel('real')).toBe('Real');
    expect(deviceTypeLabel('simulator')).toBe('Simulator');
    expect(deviceTypeLabel('emulator')).toBe('Emulator');
    expect(deviceTypeLabel(undefined)).toBeNull();
  });
});
