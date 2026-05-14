import 'reflect-metadata';
import { expect } from 'chai';
import { buildCapabilityBag } from '../../../src/services/lease/buildCapabilityBag';

const ANDROID_DEVICE = {
  udid: 'u-a', host: 'h:4723', platform: 'android', sdk: '14', name: 'Pixel 7',
} as any;
const IOS_DEVICE = {
  udid: 'u-i', host: 'h:4723', platform: 'ios', sdk: '17.4', name: 'iPhone 15',
} as any;

describe('buildCapabilityBag', () => {
  it('emits W3C-prefixed Android caps with the requested ports', () => {
    const bag = buildCapabilityBag(ANDROID_DEVICE, {
      systemPort: 8201, chromedriverPort: 9515, mjpegServerPort: 7811,
    }, 'lse_abc', undefined);
    expect(bag.platformName).to.equal('Android');
    expect(bag['appium:automationName']).to.equal('UiAutomator2');
    expect(bag['appium:udid']).to.equal('u-a');
    expect(bag['appium:deviceName']).to.equal('Pixel 7');
    expect(bag['appium:platformVersion']).to.equal('14');
    expect(bag['appium:systemPort']).to.equal(8201);
    expect(bag['appium:chromedriverPort']).to.equal(9515);
    expect(bag['appium:mjpegServerPort']).to.equal(7811);
    expect(bag['appium:newCommandTimeout']).to.equal(120);
    expect(bag['xenon:options']).to.deep.equal({ leaseId: 'lse_abc' });
  });

  it('emits iOS caps with wdaLocalPort + mjpegServerPort only', () => {
    const bag = buildCapabilityBag(IOS_DEVICE, {
      wdaLocalPort: 8100, mjpegServerPort: 9100,
    }, 'lse_def', 'b-1');
    expect(bag.platformName).to.equal('iOS');
    expect(bag['appium:automationName']).to.equal('XCUITest');
    expect(bag['appium:wdaLocalPort']).to.equal(8100);
    expect(bag['appium:systemPort']).to.equal(undefined);
    expect(bag['xenon:options']).to.deep.equal({ leaseId: 'lse_def', buildId: 'b-1' });
  });
});
