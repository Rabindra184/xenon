import 'reflect-metadata';
import sinon from 'sinon';
import AndroidDeviceManager, {
  includesAndroidDevice,
} from '../../src/device-managers/AndroidDeviceManager';
import { DeviceWithPath } from '@devicefarmer/adbkit';
import Adb from '@devicefarmer/adbkit';
import { ADB as AppiumADB } from 'appium-adb';
import { expect } from 'chai';
import { createTestAndroidManager, resetTestContainer } from '../helpers/test-container';
import { useScratchDatabase } from '../helpers/scratch-database';
import { getAdbOriginal } from './GetAdbOriginal';

const sandbox = sinon.createSandbox();

describe('Android Device Manager', () => {
  // deviceInfo() leases the phone's ports through Prisma. Without a database
  // of its own that was the developer's ~/.cache/xenon/xenon.db.
  useScratchDatabase();
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

  afterEach(async function () {
    sandbox.restore();
    await resetTestContainer();
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

  // A phone adb reports as plugged (and every phone connected when the server
  // starts) went through onDeviceAdded with no androidDeviceType check: a
  // hub set to emulators only listed a real phone until its next sync pruned
  // it, and could hand it to a session meanwhile.
  describe('a plugged phone', () => {
    const plug = async (androidDeviceType: 'real' | 'simulated' | 'both', real: boolean) => {
      const manager = createTestAndroidManager({ platform: 'android', androidDeviceType });
      sandbox.stub(manager, 'waitBootComplete').resolves(true);
      sandbox.stub(manager, 'isRealDevice' as any).resolves(real);
      // Stands for the rest of the add: the port lease, the row, the hub.
      const deviceInfo = sandbox.stub(manager, 'deviceInfo' as any).resolves(undefined);
      await manager.onDeviceAdded(adb, { id: 'plugged-1', type: 'device' } as any);
      return deviceInfo.called;
    };

    it('is ignored when the server doesn’t serve its kind', async () => {
      expect(await plug('simulated', true), 'a real phone, emulators only').to.equal(false);
      expect(await plug('real', false), 'an emulator, real phones only').to.equal(false);
    });

    it('is added when the server serves its kind', async () => {
      expect(await plug('simulated', false)).to.equal(true);
      expect(await plug('real', true)).to.equal(true);
      expect(await plug('both', true)).to.equal(true);
      expect(await plug('both', false)).to.equal(true);
    });
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

// The one rule discovery and a plugged phone both apply.
describe('includesAndroidDevice', () => {
  const real = { deviceType: 'real', state: 'device' };
  const emulator = { deviceType: 'emulator', state: 'device' };
  const offlineEmulator = { deviceType: 'emulator', state: 'offline' };

  it('real: real phones only', () => {
    expect(includesAndroidDevice(real, 'real')).to.equal(true);
    expect(includesAndroidDevice(emulator, 'real')).to.equal(false);
  });

  it('simulated: emulators only, booted ones when bootedEmulators is on', () => {
    expect(includesAndroidDevice(real, 'simulated')).to.equal(false);
    expect(includesAndroidDevice(emulator, 'simulated')).to.equal(true);
    expect(includesAndroidDevice(offlineEmulator, 'simulated')).to.equal(true);
    expect(includesAndroidDevice(offlineEmulator, 'simulated', true)).to.equal(false);
  });

  it('both: everything, emulators booted when bootedEmulators is on', () => {
    expect(includesAndroidDevice(real, 'both')).to.equal(true);
    expect(includesAndroidDevice(emulator, 'both', true)).to.equal(true);
    expect(includesAndroidDevice(offlineEmulator, 'both', true)).to.equal(false);
    expect(includesAndroidDevice({ ...real, state: 'offline' }, 'both', true)).to.equal(true);
  });
});
