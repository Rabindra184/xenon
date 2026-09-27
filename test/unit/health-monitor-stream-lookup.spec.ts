import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { HealthMonitorService } from '../../src/device-managers/HealthMonitorService';
import { XenonManager } from '../../src/device-managers';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';

// Named like the real managers: the monitor picks one by constructor.name.
class AndroidDeviceManager {
  checkHealth = async () => ({ healthStatus: 'Healthy' });
}
class IOSDeviceManager {
  checkHealth = async () => ({ healthStatus: 'Healthy' });
}

// A device busy with an Appium session this process no longer knows about,
// which is the case the monitor reclaims, unless a stream is still running.
function lostSessionDevice(platform: 'android' | 'ios') {
  return {
    udid: `${platform}-1`,
    host: 'http://127.0.0.1:4723',
    platform,
    busy: true,
    session_id: 'appium-session-not-in-memory',
    cloud: false,
  };
}

describe('HealthMonitorService — stream lookups', () => {
  let updateDevice: sinon.SinonSpy;
  let device: ReturnType<typeof lostSessionDevice>;
  let androidStatus: sinon.SinonStub;
  let iosStatus: sinon.SinonStub;

  const reclaimed = () =>
    updateDevice.getCalls().some((c) => c.args[2]?.busy === false && !c.args[2]?.session_id);

  beforeEach(() => {
    sinon.stub(process, 'kill');
    updateDevice = sinon.spy(async () => undefined);
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      getAllDevices: async () => [device],
      updateDevice,
    } as any);
    sinon.stub(SESSION_MANAGER, 'isValidSession').returns(false);
    androidStatus = sinon.stub().returns({ status: 'running' });
    iosStatus = sinon.stub().returns({ status: 'running' });
    const real = Container.get.bind(Container);
    // Only the class tokens answer. TypeDI 0.10 ignores @Service({ name }), so
    // a lookup by name falls through to the real container and throws, as it
    // does in the server.
    sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === XenonManager) {
        return {
          deviceInstances: async () => [new AndroidDeviceManager(), new IOSDeviceManager()],
        } as any;
      }
      if (token === AndroidStreamService) return { getStreamStatus: androidStatus } as any;
      if (token === IOSStreamService) return { getStreamStatus: iosStatus } as any;
      return real(token);
    });
  });

  afterEach(() => sinon.restore());

  const run = () => (new HealthMonitorService({} as any) as any).checkAllDevices();

  it('leaves an Android device with a running stream alone', async () => {
    device = lostSessionDevice('android');
    await run();
    expect(reclaimed(), 'reclaimed a device with a live stream').to.equal(false);
    expect(androidStatus.called, 'asked the stream service').to.equal(true);
  });

  it('leaves an iOS device with a running stream alone', async () => {
    device = lostSessionDevice('ios');
    await run();
    expect(reclaimed(), 'reclaimed a device with a live stream').to.equal(false);
    expect(iosStatus.called, 'asked the stream service').to.equal(true);
  });

  it('cancels a reclaim when the stream appears before the final re-check', async () => {
    device = lostSessionDevice('android');
    androidStatus.onFirstCall().returns(undefined);
    await run();
    expect(reclaimed()).to.equal(false);
  });

  it('still reclaims a device with no stream', async () => {
    device = lostSessionDevice('android');
    androidStatus.returns(undefined);
    await run();
    expect(reclaimed()).to.equal(true);
  });
});
