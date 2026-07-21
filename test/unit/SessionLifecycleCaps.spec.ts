import 'reflect-metadata';
import chai from 'chai';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { ISessionCapability } from '../../src/interfaces/ISessionCapability';

chai.should();
const expect = chai.expect;

// injectWDAUrl is a private method that mutates only its `caps` argument (no
// `this` usage), so we can exercise it directly off the prototype without
// constructing the DI-heavy service.
const injectWDAUrl = (SessionLifecycleService.prototype as any).injectWDAUrl as (
  caps: ISessionCapability,
  wdaUrl: string,
  bundleId?: string | null,
) => void;

const URL = 'http://127.0.0.1:8100';

describe('SessionLifecycleService.injectWDAUrl — W3C capability composition', () => {
  it('writes the WDA caps to alwaysMatch only, never to both buckets', () => {
    const caps: ISessionCapability = {
      alwaysMatch: { 'appium:automationName': 'XCUITest' },
      firstMatch: [{ 'appium:udid': 'abc' }],
    } as any;

    injectWDAUrl(caps, URL, 'com.qasecret.WebDriverAgentRunner');

    // Present in alwaysMatch...
    expect(caps.alwaysMatch!['appium:webDriverAgentUrl']).to.equal(URL);
    expect(caps.alwaysMatch!['appium:usePreinstalledWDA']).to.equal(true);
    expect(caps.alwaysMatch!['appium:updatedWDABundleId']).to.equal('com.qasecret.WebDriverAgentRunner');
    // ...and NOT in firstMatch — the bug was duplicating into both, which appium
    // rejects with "property 'webDriverAgentUrl' should not exist on both
    // primary and secondary object".
    expect(caps.firstMatch![0]).to.not.have.property('appium:webDriverAgentUrl');
    expect(caps.firstMatch![0]).to.not.have.property('appium:usePreinstalledWDA');
    expect(caps.firstMatch![0]).to.not.have.property('appium:updatedWDABundleId');
  });

  it('falls back to firstMatch[0] when there is no alwaysMatch', () => {
    const caps: ISessionCapability = { firstMatch: [{ 'appium:udid': 'abc' }] } as any;
    injectWDAUrl(caps, URL);
    expect(caps.firstMatch![0]['appium:webDriverAgentUrl']).to.equal(URL);
    expect(caps.firstMatch![0]['appium:usePreinstalledWDA']).to.equal(true);
  });

  it('scrubs conflicting WDA caps from both buckets', () => {
    const caps: ISessionCapability = {
      alwaysMatch: { 'appium:usePrebuiltWDA': true, 'appium:wdaLocalPort': 8100 },
      firstMatch: [{ 'appium:derivedDataPath': '/x', 'appium:mjpegServerPort': 9100 }],
    } as any;

    injectWDAUrl(caps, URL);

    for (const bucket of [caps.alwaysMatch!, caps.firstMatch![0]]) {
      expect(bucket).to.not.have.property('appium:usePrebuiltWDA');
      expect(bucket).to.not.have.property('appium:derivedDataPath');
      expect(bucket).to.not.have.property('appium:wdaLocalPort');
      expect(bucket).to.not.have.property('appium:mjpegServerPort');
    }
  });

  it('omits updatedWDABundleId when no bundleId is supplied', () => {
    const caps: ISessionCapability = { alwaysMatch: {}, firstMatch: [{}] } as any;
    injectWDAUrl(caps, URL);
    expect(caps.alwaysMatch!).to.not.have.property('appium:updatedWDABundleId');
  });
});
