import 'reflect-metadata';
import { expect } from 'chai';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';

/**
 * `appium:usePreinstalledWDA` sends appium-xcuitest-driver down
 * `preparePreinstalled`, which calls
 * `cleanupApps(driver, [driver.wda.bundleIdForXctest])` — removing every
 * installed app whose CFBundleName is WebDriverAgentRunner except the single
 * bundle id on that keep-list.
 *
 * Without `appium:updatedWDABundleId`, that keep-list holds the driver's own
 * default (`com.facebook.WebDriverAgentRunner.xctrunner`), so a differently
 * signed WDA — which is what Xenon launches — is not on it and gets
 * uninstalled from the device mid-session. Observed twice on a real iPhone,
 * logged verbatim by the driver as:
 *
 *   Removing WebDriverAgent runner app 'com.qasecret.WebDriverAgentRunner.xctrunner'
 *
 * after which every iOS feature fails with "WebDriverAgent is not installed"
 * until it is re-signed and reinstalled by hand.
 *
 * So the two capabilities are a pair. These tests pin that they can never be
 * emitted apart.
 */
describe('WDA capability injection', () => {
  // The method is private by design; this is the one place its contract is
  // asserted, so it is reached deliberately rather than widening the API.
  const inject = (caps: any, url: string, bundleId?: string | null) =>
    (SessionLifecycleService.prototype as any).injectWDAUrl.call(
      Object.create(SessionLifecycleService.prototype),
      caps,
      url,
      bundleId,
    );

  const WDA_URL = 'http://127.0.0.1:8100';
  const BUNDLE = 'com.qasecret.WebDriverAgentRunner.xctrunner';

  it('names the bundle whenever it claims a preinstalled WDA', () => {
    const caps: any = { alwaysMatch: {}, firstMatch: [{}] };
    inject(caps, WDA_URL, BUNDLE);
    expect(caps.alwaysMatch['appium:usePreinstalledWDA']).to.equal(true);
    expect(caps.alwaysMatch['appium:updatedWDABundleId']).to.equal(BUNDLE);
  });

  it('never claims a preinstalled WDA it cannot name', () => {
    // The destructive combination. `webDriverAgentUrl` alone still reuses the
    // running WDA and does not enter the cleanup path at all.
    const caps: any = { alwaysMatch: {}, firstMatch: [{}] };
    inject(caps, WDA_URL, null);
    expect(caps.alwaysMatch['appium:webDriverAgentUrl']).to.equal(WDA_URL);
    expect(caps.alwaysMatch['appium:usePreinstalledWDA']).to.equal(undefined);
    expect(caps.alwaysMatch['appium:updatedWDABundleId']).to.equal(undefined);
  });

  it('never claims one when the bundle id is simply absent', () => {
    const caps: any = { alwaysMatch: {}, firstMatch: [{}] };
    inject(caps, WDA_URL);
    expect(caps.alwaysMatch['appium:usePreinstalledWDA']).to.equal(undefined);
  });

  it('does not leave a stale pairing behind from the caller', () => {
    // A caller that already set the flag must not be able to smuggle it past
    // the check when the bundle id is unknown.
    const caps: any = {
      alwaysMatch: { 'appium:usePreinstalledWDA': true, 'appium:updatedWDABundleId': 'stale' },
      firstMatch: [{}],
    };
    inject(caps, WDA_URL, null);
    expect(caps.alwaysMatch['appium:usePreinstalledWDA']).to.equal(undefined);
    expect(caps.alwaysMatch['appium:updatedWDABundleId']).to.equal(undefined);
  });

  it('keeps the injected keys out of the other capability bucket', () => {
    // W3C forbids a property in both alwaysMatch and a firstMatch entry;
    // appium rejects the whole session if it happens.
    const caps: any = {
      alwaysMatch: {},
      firstMatch: [{ 'appium:webDriverAgentUrl': 'http://stale', 'appium:usePreinstalledWDA': true }],
    };
    inject(caps, WDA_URL, BUNDLE);
    expect(caps.firstMatch[0]['appium:webDriverAgentUrl']).to.equal(undefined);
    expect(caps.firstMatch[0]['appium:usePreinstalledWDA']).to.equal(undefined);
    expect(caps.alwaysMatch['appium:webDriverAgentUrl']).to.equal(WDA_URL);
  });

  it('strips the caps that conflict with reusing a WDA by URL', () => {
    const caps: any = {
      alwaysMatch: { 'appium:wdaLocalPort': 8100, 'appium:derivedDataPath': '/tmp/dd' },
      firstMatch: [{ 'appium:mjpegServerPort': 9100, 'appium:usePrebuiltWDA': true }],
    };
    inject(caps, WDA_URL, BUNDLE);
    expect(caps.alwaysMatch['appium:wdaLocalPort']).to.equal(undefined);
    expect(caps.alwaysMatch['appium:derivedDataPath']).to.equal(undefined);
    expect(caps.firstMatch[0]['appium:mjpegServerPort']).to.equal(undefined);
    expect(caps.firstMatch[0]['appium:usePrebuiltWDA']).to.equal(undefined);
  });
});
