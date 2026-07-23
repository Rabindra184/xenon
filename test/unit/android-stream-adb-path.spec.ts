import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import AndroidDeviceManager from '../../src/device-managers/AndroidDeviceManager';

// Regression: the capture loop used to spawn bare 'adb', relying on the process
// PATH. When Xenon is launched from a GUI (e.g. the Xenon Control app) that PATH
// lacks the Android SDK platform-tools dir, so streaming died with
// `Capture failure: spawn adb ENOENT` even though appium-adb (which resolves via
// ANDROID_HOME) could still list devices. The stream must resolve the real adb
// binary path the same way every other ADB call does.

// Build an instance WITHOUT running the constructor (which starts a watchdog
// interval), then drive the private resolver directly.
function makeService() {
  const svc: any = Object.create(AndroidStreamService.prototype);
  svc.sessions = new Map<string, any>();
  return svc;
}

describe('AndroidStreamService adb-path resolution', () => {
  let containerStub: sinon.SinonStub;

  function stubManager(fakeAdb: any, throws = false) {
    const fakeManager = {
      getAdbForDevice: async () => {
        if (throws) throw new Error('ADB is not available');
        return fakeAdb;
      },
    };
    containerStub = sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === AndroidDeviceManager) return fakeManager as any;
      return (containerStub as any).wrappedMethod.call(Container, token);
    });
  }

  afterEach(() => sinon.restore());

  it('resolves the adb binary path from appium-adb instead of bare "adb"', async () => {
    stubManager({ executable: { path: '/opt/android/platform-tools/adb' } });
    const svc = makeService();

    const { adbPath, adbHostArgs } = await svc.resolveAdbInvocation('android-1');

    expect(adbPath).to.equal('/opt/android/platform-tools/adb');
    expect(adbPath).to.not.equal('adb'); // the whole point: not the PATH-relative name
    expect(adbHostArgs).to.deep.equal([]);
  });

  it('prepends -H/-P host args for a remote adb instance', async () => {
    stubManager({
      executable: { path: '/opt/android/platform-tools/adb' },
      adbHost: '10.0.0.5',
      adbPort: 5037,
    });
    const svc = makeService();

    const { adbPath, adbHostArgs } = await svc.resolveAdbInvocation('android-1');

    expect(adbPath).to.equal('/opt/android/platform-tools/adb');
    expect(adbHostArgs).to.deep.equal(['-H', '10.0.0.5', '-P', '5037']);
  });

  it('falls back to bare "adb" (best-effort) when resolution throws', async () => {
    stubManager(null, true);
    const svc = makeService();

    const { adbPath, adbHostArgs } = await svc.resolveAdbInvocation('android-1');

    expect(adbPath).to.equal('adb');
    expect(adbHostArgs).to.deep.equal([]);
  });
});
