import 'reflect-metadata';
import sinon from 'sinon';
import chai, { expect } from 'chai';
import AndroidDeviceManager from '../../src/device-managers/AndroidDeviceManager';
import * as Helper from '../../src/helpers';
import * as DeviceUtils from '../../src/device-utils';
import { getAdbOriginal } from './GetAdbOriginal';
import ip from 'ip';
import _ from 'lodash';
import { XenonDatabase } from '../../src/data-service/db';
import { DeviceWithPath } from '@devicefarmer/adbkit';
import chaiAsPromised from 'chai-as-promised';
import { createTestAndroidManager } from '../helpers/test-container';

chai.use(chaiAsPromised);

const sandbox = sinon.createSandbox();

let adb: any;
let cloneAdb: any;

describe('Android Device Manager', function () {
  this.timeout(500000);
  afterEach(function () {
    sandbox.restore();
  });

  async function getCloneAdb() {
    const clone = await adb.clone({
      remoteAdbHost: '192.168.0.104',
      adbPort: 5037,
      udid: null,
      appDeviceReadyTimeout: null,
      useKeystore: null,
      keystorePath: null,
      keystorePassword: null,
      keyAlias: null,
      keyPassword: null,
      curDeviceId: null,
      emulatorPort: null,
      logcat: null,
      instrumentProc: null,
      suppressKillServer: null,
      jars: {},
      adbHost: '192.168.0.104',
      adbExecTimeout: 20000,
      remoteAppsCacheLimit: 10,
      buildToolsVersion: null,
      allowOfflineDevices: false,
      allowDelayAdb: true,
    });
    // Manually set adbRemoteHost to match implementation's ExtendedADB interface usage
    clone.adbRemoteHost = '192.168.0.104';
    return clone;
  }

  it('Android Device List to have added state', async () => {
    const androidDevices = createTestAndroidManager({ platform: 'android' });
    const deviceList = new Map();
    adb = await getAdbOriginal();
    cloneAdb = await getCloneAdb();
    deviceList.set(adb, [{ udid: 'emulator-5554', state: 'device' }]);
    deviceList.set(cloneAdb, [{ udid: 'emulator-5555', state: 'device' }]);

    const getConnectedDevicesStub = sandbox
      .stub(androidDevices, 'getConnectedDevices' as any)
      .returns(Promise.resolve(deviceList));

    const getDeviceVersion = sandbox.stub(androidDevices, 'getDeviceVersion' as any);
    getDeviceVersion.onFirstCall().returns(Promise.resolve('9'));
    getDeviceVersion.onSecondCall().returns(Promise.resolve('13'));

    sandbox.stub(androidDevices, 'getDeviceName' as any).returns(Promise.resolve('sdk_phone_x86'));

    const realDevice = sandbox.stub(androidDevices, 'isRealDevice' as any);
    realDevice.onFirstCall().returns(Promise.resolve(false));
    realDevice.onSecondCall().returns(Promise.resolve(true));

    sandbox.stub(Helper, 'getFreePort' as any).returns(Promise.resolve(54321));
    sandbox.stub(DeviceUtils, 'getUtilizationTime' as any).returns(Promise.resolve(0));

    const devices = await androidDevices.getDevices({ androidDeviceType: 'both' }, []);

    expect(getConnectedDevicesStub.called).to.be.true;

    expect(devices).to.deep.equal([
      {
        busy: false,
        adbRemoteHost: undefined,
        adbPort: 5037,
        name: 'sdk_phone_x86',
        state: 'device',
        deviceType: 'emulator',
        sdk: '9',
        realDevice: false,
        udid: 'emulator-5554',
        platform: 'android',
        systemPort: 54321,
        host: `http://${ip.address()}:4723`,
        sessionStartTime: 0,
        totalUtilizationTimeMilliSec: 0,
        userBlocked: false,
      },
      {
        busy: false,
        adbRemoteHost: '192.168.0.104',
        adbPort: 5037,
        name: 'sdk_phone_x86',
        state: 'device',
        deviceType: 'real',
        sdk: '13',
        realDevice: true,
        udid: 'emulator-5555',
        platform: 'android',
        systemPort: 54321,
        host: 'http://192.168.0.104:5037',
        sessionStartTime: 0,
        totalUtilizationTimeMilliSec: 0,
        userBlocked: false,
      },
    ]);
  });

  it('Android Device List to have added state - Only emulators', async () => {
    const androidDevices = createTestAndroidManager({ platform: 'android' });
    const deviceList = new Map();
    adb = await getAdbOriginal();
    deviceList.set(adb, [
      { udid: 'emulator-5554', state: 'device' },
      { udid: 'emulator-5555', state: 'device' },
    ]);
    sandbox.stub(androidDevices, 'getConnectedDevices' as any).returns(deviceList);

    const getDeviceVersion = sandbox.stub(androidDevices, 'getDeviceVersion' as any);
    getDeviceVersion.onFirstCall().returns('9');
    getDeviceVersion.onSecondCall().returns('13');

    sandbox.stub(androidDevices, 'getDeviceName' as any).returns('sdk_phone_x86');
    const realDevice = sandbox.stub(androidDevices, 'isRealDevice' as any);
    realDevice.onFirstCall().returns(false);
    realDevice.onSecondCall().returns(true);
    sandbox.stub(Helper, 'getFreePort' as any).returns(54321);
    sandbox.stub(DeviceUtils, 'getUtilizationTime' as any).returns(0);
    const devices = await androidDevices.getDevices({ androidDeviceType: 'simulated' }, []);
    expect(devices).to.deep.equal([
      {
        busy: false,
        adbPort: 5037,
        adbRemoteHost: undefined,
        name: 'sdk_phone_x86',
        state: 'device',
        deviceType: 'emulator',
        sdk: '9',
        realDevice: false,
        udid: 'emulator-5554',
        platform: 'android',
        systemPort: 54321,
        host: `http://${ip.address()}:4723`,
        sessionStartTime: 0,
        totalUtilizationTimeMilliSec: 0,
        userBlocked: false,
      },
    ]);
  });

  it('Android Device List to have added state - Only real devices', async () => {
    const androidDevices = createTestAndroidManager({ platform: 'android' });
    const deviceList = new Map();
    adb = await getAdbOriginal();
    deviceList.set(adb, [
      { udid: 'emulator-5554', state: 'device' },
      { udid: 'YOGAA1BBB4124', state: 'device' },
    ]);
    sandbox.stub(androidDevices, 'getConnectedDevices' as any).returns(deviceList);

    const getDeviceVersion = sandbox.stub(androidDevices, 'getDeviceVersion' as any);
    getDeviceVersion.onFirstCall().returns('9');
    getDeviceVersion.onSecondCall().returns('13');

    sandbox.stub(androidDevices, 'getDeviceName' as any).returns('Nexus 6');
    const realDevice = sandbox.stub(androidDevices, 'isRealDevice' as any);
    realDevice.onFirstCall().returns(false);
    realDevice.onSecondCall().returns(true);
    sandbox.stub(Helper, 'getFreePort' as any).returns(54322);
    sandbox.stub(DeviceUtils, 'getUtilizationTime' as any).returns(0);
    const devices = await androidDevices.getDevices({ androidDeviceType: 'real' }, []);
    expect(devices).to.deep.equal([
      {
        busy: false,
        name: 'Nexus 6',
        adbPort: 5037,
        adbRemoteHost: undefined,
        state: 'device',
        deviceType: 'real',
        sdk: '13',
        realDevice: true,
        udid: 'YOGAA1BBB4124',
        platform: 'android',
        systemPort: 54322,
        host: `http://${ip.address()}:4723`,
        sessionStartTime: 0,
        totalUtilizationTimeMilliSec: 0,
        userBlocked: false,
      },
    ]);
  });
  it('Android Device List to have host as remoteMachineProxyIP if provided', async () => {
    (await XenonDatabase.DeviceModel).removeDataOnly();
    const androidDevices = createTestAndroidManager({
      platform: 'android',
      skipChromeDownload: true,
      remoteMachineProxyIP: 'http://10.1.1.1:3333',
    });
    const deviceList = new Map();
    adb = await getAdbOriginal();
    deviceList.set(adb, [
      { udid: 'emulator-5554', state: 'device' },
      { udid: 'YOGAA1BBB4124', state: 'device' },
    ]);
    sandbox.stub(androidDevices, 'getConnectedDevices' as any).returns(deviceList);

    const getDeviceVersion = sandbox.stub(androidDevices, 'getDeviceVersion' as any);
    getDeviceVersion.onFirstCall().returns('9');
    getDeviceVersion.onSecondCall().returns('13');

    sandbox.stub(androidDevices, 'getDeviceName' as any).returns('Nexus 6');
    const realDevice = sandbox.stub(androidDevices, 'isRealDevice' as any);
    realDevice.onFirstCall().returns(false);
    realDevice.onSecondCall().returns(true);
    sandbox.stub(Helper, 'getFreePort' as any).returns(54322);
    sandbox.stub(DeviceUtils, 'getUtilizationTime' as any).returns(0);
    const devices = await androidDevices.getDevices({ androidDeviceType: 'real' }, []);
    expect(devices).to.deep.equal([
      {
        busy: false,
        name: 'Nexus 6',
        adbPort: 5037,
        adbRemoteHost: undefined,
        state: 'device',
        deviceType: 'real',
        sdk: '13',
        realDevice: true,
        udid: 'YOGAA1BBB4124',
        platform: 'android',
        systemPort: 54322,
        host: 'http://10.1.1.1:3333',
        sessionStartTime: 0,
        totalUtilizationTimeMilliSec: 0,
        userBlocked: false,
      },
    ]);
  });

  it("Should handle error when adb doesn't respond", async () => {
    const androidDevices = createTestAndroidManager({ platform: 'android' });
    const deviceList = new Map();
    adb = await getAdbOriginal();
    deviceList.set(adb, [
      { udid: 'emulator-9999', state: 'device' },
      { udid: 'emulator-7777', state: 'device' },
    ]);

    const mockAdbExec = (args: any) => {
      if (args.includes('emulator-9999')) {
        return Promise.reject(new Error('Adb timeout'));
      } else {
        return Promise.resolve('foo');
      }
    };

    sandbox.stub(androidDevices, 'getConnectedDevices' as any).returns(deviceList);
    const adbStub = sandbox.stub(adb, 'adbExec' as any);
    adbStub.callsFake(mockAdbExec);

    const devices = await androidDevices.getDevices({ androidDeviceType: 'both' }, []);

    const resultDevices = _.map(devices, (device) => {
      return { udid: device.udid };
    });
    // check that emulator-7777 is returned and emulator-9999 is not
    expect(resultDevices).to.have.deep.members([
      {
        udid: 'emulator-7777',
      },
    ]);

    expect(resultDevices).to.not.have.deep.members([
      {
        udid: 'emulator-9999',
      },
    ]);
  });

  it('should handle device never completing boot', async () => {
    const androidDevices = createTestAndroidManager({ platform: 'android' });
    adb = await getAdbOriginal();
    sandbox
      .stub(androidDevices, 'waitBootComplete' as any)
      .throwsException(new Error('Adb timeout'));

    expect(() => {
      androidDevices.onDeviceAdded(adb, {
        udid: 'emulator-9999',
        state: 'device',
      } as any as DeviceWithPath);
    }).to.not.throw();
  });
});
