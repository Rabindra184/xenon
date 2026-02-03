import 'reflect-metadata';
import chai, { expect } from 'chai';
import { XenonManager } from '../../src/device-managers';
import { Container } from 'typedi';
import { XenonDatabase } from '../../src/data-service/db';
import {
  updateDeviceList,
  allocateDeviceForSession,
  initializeStorage,
  cleanPendingSessions,
} from '../../src/device-utils';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import ip from 'ip';
import waitUntil from 'async-wait-until';
import { IDevice } from '../../src/interfaces/IDevice';
import { unblockDeviceMatchingFilter } from '../../src/data-service/device-service';
import chaiAsPromised from 'chai-as-promised';
import { createTestXenonManager } from '../helpers/test-container';

chai.use(chaiAsPromised);

const pluginArgs = Object.assign({}, DefaultPluginArgs, {
  remote: [`http://${ip.address()}:4723`],
  skipChromeDownload: true,
  platform: 'android',
});

describe('Android Test', () => {
  let deviceManager: XenonManager;

  before(async () => {
    (await XenonDatabase.DeviceModel).removeDataOnly();
    deviceManager = createTestXenonManager(pluginArgs);
    // adb devices should return devices
    expect(deviceManager.getDevices()).to.eventually.have.length.greaterThan(
      0,
      'No devices detected. Is adb running? Is there at least one device connected?',
    );
  });

  it('Allocate free device and verify the device state is busy in db', async () => {
    await initializeStorage();
    await deviceManager.getDevices();
    const hub = pluginArgs.hub;
    await updateDeviceList(pluginArgs.bindHostOrIp, hub);
    await cleanPendingSessions(0);
    await unblockDeviceMatchingFilter({});

    const capabilities = {
      alwaysMatch: {
        platformName: 'android',
        'appium:app': '/Downloads/VodQA.apk',
        'appium:deviceAvailabilityTimeout': 1800,
        'appium:deviceRetryInterval': 100,
      },
      firstMatch: [{}],
    };
    const devices = await allocateDeviceForSession(capabilities, 1000, 1000, pluginArgs);
    const allDeviceIds = (await XenonDatabase.DeviceModel)
      .chain()
      .find({ udid: devices.udid })
      .data();
    expect(allDeviceIds[0].busy).to.be.true;
  });

  it.skip('Allocate second free device and verify both the device state is busy in db', async () => {
    await initializeStorage();
    deviceManager = createTestXenonManager(Object.assign({}, pluginArgs, { platform: 'android' }));
    await updateDeviceList(pluginArgs.bindHostOrIp);
    const capabilities = {
      alwaysMatch: {
        platformName: 'android',
        'appium:app': '/Downloads/VodQA.apk',
        'appium:deviceAvailabilityTimeout': 1800,
        'appium:deviceRetryInterval': 100,
      },
      firstMatch: [{}],
    };

    // wait until there are two devices and both are not offline
    let devices: IDevice[];
    waitUntil(async () => {
      await updateDeviceList(pluginArgs.bindHostOrIp);
      devices = await deviceManager.getDevices();

      return devices.length === 2 && devices.every((device: IDevice) => !device.offline);
    });

    await allocateDeviceForSession(capabilities, 1000, 1000, pluginArgs);
    const allDeviceIds = (await XenonDatabase.DeviceModel).chain().find().data();
    allDeviceIds.forEach((device) => expect(device.busy).to.be.true);
  });

  it('Finding a device should throw error when all devices are busy', async () => {
    await initializeStorage();
    deviceManager = createTestXenonManager(pluginArgs);
    const hub = pluginArgs.hub;
    await updateDeviceList(pluginArgs.bindHostOrIp, hub);
    const capabilities = {
      alwaysMatch: {
        platformName: 'android',
        'appium:app': '/Downloads/VodQA.apk',
        'appium:deviceAvailabilityTimeout': 1800,
        'appium:deviceRetryInterval': 100,
      },
      firstMatch: [{}],
    };
    await allocateDeviceForSession(capabilities, 1000, 1000, pluginArgs).catch((error) =>
      expect(error)
        .to.be.an('error')
        .with.property(
          'message',
          'Device is busy or blocked.. Device request: {"platform":"android"}',
        ),
    );
  });
});
