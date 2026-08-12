import 'reflect-metadata';
import { expect } from 'chai';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';

/**
 * Xenon owns this WebDriverAgent. It launches it through go-ios and keeps the
 * XCTest session alive for the live stream; the Appium driver is a guest.
 *
 * `appium:webDriverAgentUrl` is exactly how that is expressed —
 * `selectWdaStartupStrategyName` returns 'existing-url' on it before
 * considering anything else, and that strategy's `quit()` reads "Stopping
 * neither xcodebuild nor XCTest session since WDA lifecycle is not managed by
 * this driver".
 *
 * `appium:usePreinstalledWDA` invites the opposite. It does not change the
 * strategy — the URL already won — it only makes `launchOnce` run
 * `preparePreinstalled` first:
 *
 *   await driver.mobileKillApp(driver.wda.bundleIdForXctest);
 *   await cleanupApps(driver, [driver.wda.bundleIdForXctest]);
 *
 * Both halves were observed against a real iPhone: the uninstall as "Removing
 * WebDriverAgent runner app 'com.qasecret.WebDriverAgentRunner.xctrunner'",
 * leaving the device with no WDA at all, and the kill as the driver's own next
 * request failing with ECONNRESET because go-ios's runwda was gone while
 * iproxy still held the port.
 */
describe('WDA capability injection', () => {
  // The method is private by design; this is the one place its contract is
  // asserted, so it is reached deliberately rather than widening the API.
  const inject = (caps: any, url: string) =>
    (SessionLifecycleService.prototype as any).injectWDAUrl.call(
      Object.create(SessionLifecycleService.prototype),
      caps,
      url,
    );

  const WDA_URL = 'http://127.0.0.1:8100';

  it('reuses the running WDA by URL', () => {
    const caps: any = { alwaysMatch: {}, firstMatch: [{}] };
    inject(caps, WDA_URL);
    expect(caps.alwaysMatch['appium:webDriverAgentUrl']).to.equal(WDA_URL);
  });

  it('never invites the driver to manage the app', () => {
    const caps: any = { alwaysMatch: {}, firstMatch: [{}] };
    inject(caps, WDA_URL);
    expect(caps.alwaysMatch).to.not.have.property('appium:usePreinstalledWDA');
    expect(caps.alwaysMatch).to.not.have.property('appium:updatedWDABundleId');
  });

  it('strips the invitation even when the caller supplied it', () => {
    // Honouring it would kill the WDA Xenon is hosting. On this path the
    // capability is not the caller's to give.
    const caps: any = {
      alwaysMatch: { 'appium:usePreinstalledWDA': true, 'appium:updatedWDABundleId': 'com.x.WDA' },
      firstMatch: [{}],
    };
    inject(caps, WDA_URL);
    expect(caps.alwaysMatch).to.not.have.property('appium:usePreinstalledWDA');
    expect(caps.alwaysMatch).to.not.have.property('appium:updatedWDABundleId');
  });

  it('strips it from the other bucket too', () => {
    const caps: any = {
      alwaysMatch: {},
      firstMatch: [{ 'appium:usePreinstalledWDA': true, 'appium:updatedWDABundleId': 'com.x.WDA' }],
    };
    inject(caps, WDA_URL);
    expect(caps.firstMatch[0]).to.not.have.property('appium:usePreinstalledWDA');
    expect(caps.firstMatch[0]).to.not.have.property('appium:updatedWDABundleId');
  });

  it('keeps the injected url out of the other capability bucket', () => {
    // W3C forbids a property in both alwaysMatch and a firstMatch entry;
    // appium rejects the whole session if it happens.
    const caps: any = {
      alwaysMatch: {},
      firstMatch: [{ 'appium:webDriverAgentUrl': 'http://stale' }],
    };
    inject(caps, WDA_URL);
    expect(caps.firstMatch[0]).to.not.have.property('appium:webDriverAgentUrl');
    expect(caps.alwaysMatch['appium:webDriverAgentUrl']).to.equal(WDA_URL);
  });

  it('falls back to firstMatch[0] when there is no alwaysMatch', () => {
    const caps: any = { firstMatch: [{ 'appium:udid': 'abc' }] };
    inject(caps, WDA_URL);
    expect(caps.firstMatch[0]['appium:webDriverAgentUrl']).to.equal(WDA_URL);
    expect(caps.firstMatch[0]).to.not.have.property('appium:usePreinstalledWDA');
  });

  it('strips the caps that conflict with reusing a WDA by URL', () => {
    const caps: any = {
      alwaysMatch: { 'appium:wdaLocalPort': 8100, 'appium:derivedDataPath': '/tmp/dd' },
      firstMatch: [{ 'appium:mjpegServerPort': 9100, 'appium:usePrebuiltWDA': true }],
    };
    inject(caps, WDA_URL);
    expect(caps.alwaysMatch).to.not.have.property('appium:wdaLocalPort');
    expect(caps.alwaysMatch).to.not.have.property('appium:derivedDataPath');
    expect(caps.firstMatch[0]).to.not.have.property('appium:mjpegServerPort');
    expect(caps.firstMatch[0]).to.not.have.property('appium:usePrebuiltWDA');
  });
});
