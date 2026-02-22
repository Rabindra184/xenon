import 'reflect-metadata';
import sinon from 'sinon';
import AndroidDeviceManager from '../../src/device-managers/AndroidDeviceManager';
import { DeviceWithPath } from '@devicefarmer/adbkit';
import Adb from '@devicefarmer/adbkit';
import { ADB as AppiumADB } from 'appium-adb';
import { expect } from 'chai';
import { createTestAndroidManager } from '../helpers/test-container';
import { getAdbOriginal } from './GetAdbOriginal';

const sandbox = sinon.createSandbox();

describe('Android Device Manager', () => {
  let adb: any;
  beforeEach(async () => {
    sandbox.restore();
    adb = await getAdbOriginal();
    // Neutralize real ADB discovery
    sandbox.stub(AppiumADB, 'createADB').returns(Promise.resolve(adb));
    sandbox.stub(Adb, 'createClient').returns({
      trackDevices: () => {
        const tracker = {
          on: sandbox.stub(),
        };
        return tracker;
      },
    } as any);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it('Android Device List to have added state', async () => {
    const androidDevices = createTestAndroidManager({ platform: 'android' });
    // @ts-expect-error - Accessing private member for testing
    androidDevices.adbAvailable = true;

    sandbox.stub(androidDevices, 'getConnectedDevices' as any).returns(
      Promise.resolve(
        new Map([
          [
            adb,
            [
              { udid: 'emulator-5554', state: 'device' },
              { udid: 'emulator-5555', state: 'device' },
            ],
          ],
        ]),
      ),
    );
    sandbox.stub(androidDevices, 'getDeviceVersion' as any).returns(Promise.resolve('9'));
    sandbox.stub(androidDevices, 'getDeviceName' as any).returns(Promise.resolve('sdk_phone_x86'));
    sandbox.stub(androidDevices, 'isRealDevice' as any).returns(Promise.resolve(false));

    const devices = await androidDevices.getDevices({ androidDeviceType: 'both' }, []);
    expect(devices.length).to.be.equal(2);
    expect(devices[0]).to.have.property('state', 'device');
    expect(devices[1]).to.have.property('state', 'device');
  });

  it('Android Device List to have added state - Only emulators', async () => {
    const androidDevices = createTestAndroidManager({
      platform: 'android',
      androidDeviceType: 'simulated',
    });
    // @ts-expect-error - Accessing private member for testing
    androidDevices.adbAvailable = true;

    sandbox.stub(androidDevices, 'getConnectedDevices' as any).returns(
      Promise.resolve(
        new Map([
          [
            adb,
            [
              { udid: 'emulator-5554', state: 'device' },
              { udid: 'emulator-5555', state: 'device' },
            ],
          ],
        ]),
      ),
    );
    sandbox.stub(androidDevices, 'getDeviceVersion' as any).returns(Promise.resolve('9'));
    sandbox.stub(androidDevices, 'getDeviceName' as any).returns(Promise.resolve('sdk_phone_x86'));
    sandbox.stub(androidDevices, 'isRealDevice' as any).returns(Promise.resolve(false));

    const devices = await androidDevices.getDevices({ androidDeviceType: 'simulated' }, []);
    expect(devices.length).to.be.equal(2);
    expect(devices[0]).to.have.property('state', 'device');
    expect(devices[1]).to.have.property('state', 'device');
  });

  it('Android Device List to have added state - Only real devices', async () => {
    const androidDevices = createTestAndroidManager({
      platform: 'android',
      androidDeviceType: 'real',
    });
    // @ts-expect-error - Accessing private member for testing
    androidDevices.adbAvailable = true;

    sandbox.stub(androidDevices, 'getConnectedDevices' as any).returns(
      Promise.resolve(
        new Map([
          [
            adb,
            [
              { udid: 'emulator-5554', state: 'device' },
              { udid: 'YOGAA1BBB4124', state: 'device' },
            ],
          ],
        ]),
      ),
    );
    sandbox.stub(androidDevices, 'getDeviceVersion' as any).returns(Promise.resolve('9'));
    sandbox.stub(androidDevices, 'getDeviceName' as any).returns(Promise.resolve('sdk_phone_x86'));
    sandbox.stub(androidDevices, 'isRealDevice' as any).callsFake(async (...args: any[]) => {
      const udid = args[1] as string;
      return udid === 'YOGAA1BBB4124';
    });

    const devices = await androidDevices.getDevices({ androidDeviceType: 'real' }, []);
    expect(devices.length).to.be.equal(1);
    expect(devices[0]).to.have.property('udid', 'YOGAA1BBB4124');
  });

  it('Android Device List to have host as remoteMachineProxyIP if provided', async () => {
    const androidDevices = createTestAndroidManager({
      platform: 'android',
      remoteMachineProxyIP: '192.168.0.104',
    });
    // @ts-expect-error - Accessing private member for testing
    androidDevices.adbAvailable = true;

    sandbox.stub(androidDevices, 'getConnectedDevices' as any).returns(
      Promise.resolve(
        new Map([
          [
            adb,
            [
              { udid: 'emulator-5554', state: 'device' },
              { udid: 'YOGAA1BBB4124', state: 'device' },
            ],
          ],
        ]),
      ),
    );
    sandbox.stub(androidDevices, 'getDeviceVersion' as any).returns(Promise.resolve('9'));
    sandbox.stub(androidDevices, 'getDeviceName' as any).returns(Promise.resolve('sdk_phone_x86'));
    sandbox.stub(androidDevices, 'isRealDevice' as any).returns(Promise.resolve(true));

    const devices = await androidDevices.getDevices({ androidDeviceType: 'both' }, []);
    expect(devices.length).to.be.equal(2);
    expect(devices[0]).to.have.property('host', 'http://192.168.0.104:4723');
    expect(devices[1]).to.have.property('host', 'http://192.168.0.104:4723');
  });

  it("Should handle error when adb doesn't respond", async () => {
    const androidDevices = createTestAndroidManager({ platform: 'android' });
    // @ts-expect-error - Accessing private member for testing
    androidDevices.adbAvailable = true;

    sandbox.stub(androidDevices, 'getConnectedDevices' as any).returns(
      Promise.resolve(
        new Map([
          [
            adb,
            [
              { udid: 'emulator-9999', state: 'device' },
              { udid: 'emulator-7777', state: 'device' },
            ],
          ],
        ]),
      ),
    );

    sandbox.stub(androidDevices, 'deviceInfo' as any).callsFake(async (device: any) => {
      if (device.udid === 'emulator-9999') {
        throw new Error('Adb timeout');
      }
      return { udid: device.udid, state: device.state, host: 'Local' };
    });

    const devices = await androidDevices.getDevices({ androidDeviceType: 'both' }, []);

    // check that emulator-7777 is returned and emulator-9999 is not
    expect(devices.length).to.be.equal(1);
    expect(devices[0]).to.have.property('udid', 'emulator-7777');
  });

  it('should handle device never completing boot', async () => {
    const androidDevices = createTestAndroidManager({ platform: 'android' });
    // @ts-expect-error - Accessing private member for testing
    androidDevices.adbAvailable = true;

    sandbox.stub(androidDevices, 'getAdb' as any).returns(Promise.resolve({ adbInstance: adb }));

    sandbox
      .stub(adb, 'shell')
      .withArgs(['getprop', 'sys.boot_completed'])
      .throwsException(new Error('Adb timeout'));

    expect(() => {
      androidDevices.onDeviceAdded(adb, {
        udid: 'emulator-9999',
        state: 'device',
        host: 'Local',
      } as any as DeviceWithPath);
    }).to.not.throw();
  });
});
