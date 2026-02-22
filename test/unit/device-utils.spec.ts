import 'reflect-metadata';
import sinon from 'sinon';
import * as DeviceUtils from '../../src/device-utils';
import * as DeviceService from '../../src/data-service/device-service';
import chai from 'chai';
import sinonChai from 'sinon-chai';
import { XenonDatabase } from '../../src/data-service/db';
import ip from 'ip';
import { addNewDevice, getDevice, getAllDevices } from '../../src/data-service/device-service';
import { XenonManager } from '../../src/device-managers';
import { Container } from 'typedi';
import { allocateDeviceForSession } from '../../src/device-utils';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { IDevice } from '../../src/interfaces/IDevice';
import {
  createTestXenonManager,
  setupTestContainer,
  resetTestContainer,
} from '../helpers/test-container';

chai.should();
chai.use(sinonChai);
const expect = chai.expect;
const sandbox = sinon.createSandbox();

describe('Device Utils', () => {
  const hub1Device = {
    systemPort: 56205,
    sdk: '10',
    realDevice: true,
    name: 'emulator-5555',
    busy: false,
    state: 'device',
    udid: 'emulator-5555',
    platform: 'android',
    deviceType: 'real',
    host: 'http://192.168.0.225:4723',
    totalUtilizationTimeMilliSec: 40778,
    sessionStartTime: 1667113345897,
    offline: false,
    lastCmdExecutedAt: 1667113356356,
  };
  const hub2Device = {
    systemPort: 56205,
    sdk: '10',
    realDevice: true,
    name: 'emulator-5555',
    busy: false,
    state: 'device',
    udid: 'emulator-5555',
    platform: 'android',
    deviceType: 'real',
    host: 'http://192.168.0.226:4723',
    totalUtilizationTimeMilliSec: 40778,
    sessionStartTime: 1667113345897,
    offline: false,
    lastCmdExecutedAt: 1667113356356,
  };
  const localDeviceiOS = {
    name: 'iPhone SE (3rd generation)',
    udid: '14C1078F-74C1-4672-BDB7-B65FC85FBFB4',
    state: 'Shutdown',
    sdk: '16.0',
    platform: 'ios',
    wdaLocalPort: 53712,
    busy: false,
    realDevice: false,
    deviceType: 'simulator',
    host: `http://${ip.address()}:4723`,
    totalUtilizationTimeMilliSec: 0,
    sessionStartTime: 0,
    offline: false,
  };

  // device with host
  const noHostDevice = {
    systemPort: 56205,
    sdk: '10',
    realDevice: true,
    name: 'emulator-9999',
    busy: false,
    state: 'device',
    udid: 'emulator-9999',
    platform: 'android',
    deviceType: 'real',
    totalUtilizationTimeMilliSec: 40778,
    sessionStartTime: 1667113345897,
    offline: false,
    lastCmdExecutedAt: 1667113356356,
    userBlocked: false,
    host: '127.0.0.1',
  };

  const emulator5555 = {
    systemPort: 56206,
    sdk: '11',
    realDevice: false,
    name: 'emulator-5555',
    busy: false,
    state: 'device',
    udid: 'emulator-5555',
    platform: 'android',
    deviceType: 'simulator',
    host: '192.168.0.226',
    totalUtilizationTimeMilliSec: 0,
    sessionStartTime: 0,
    offline: false,
    userBlocked: false,
  };

  const devices = [
    hub1Device,
    hub2Device,
    localDeviceiOS,
    noHostDevice,
    emulator5555,
  ] as unknown as IDevice[];

  const pluginArgs = Object.assign({}, DefaultPluginArgs, {
    remote: [`http://${ip.address()}:4723`],
    iosDeviceType: 'both',
    androidDeviceType: 'both',
  });

  afterEach(function () {
    sandbox.restore();
  });

  before(async () => {
    await resetTestContainer();
    await setupTestContainer();
  });

  it('Allocate devices for session with host filter', async () => {
    (await XenonDatabase.DeviceModel).removeDataOnly();
    const deviceManager = createTestXenonManager(
      Object.assign({}, pluginArgs, { maxSessions: 3, platform: 'android' }),
    );
    await addNewDevice(devices);
    const capabilities = {
      alwaysMatch: {
        platformName: 'android',
        'appium:app': '/Downloads/VodQA.apk',
        'appium:deviceAvailabilityTimeout': 1800,
        'appium:deviceRetryInterval': 100,
        'appium:filterByHost': '192.168.0.226',
      },
      firstMatch: [{}],
    };
    const allocatedDeviceForFirstSession = await DeviceUtils.allocateDeviceForSession(
      capabilities,
      1000,
      1000,
      pluginArgs,
    );

    async function getFilteredDevice(udid: string, host: string) {
      return (await XenonDatabase.DeviceModel).chain().find({ udid, host }).data();
    }

    const foundDevice = (
      await getFilteredDevice(
        allocatedDeviceForFirstSession.udid,
        allocatedDeviceForFirstSession.host,
      )
    )[0];

    expect(foundDevice.busy).to.be.true;
    await allocateDeviceForSession(capabilities, 1000, 1000, pluginArgs).catch((error) =>
      expect(error)
        .to.be.an('error')
        .with.property(
          'message',
          'Device is busy or blocked.. Device request: {"platform":"android","udid":"emulator-5555","filterByHost":"192.168.0.226"}',
        ),
    );
  });
  it('Allocating device should set device to be busy', async function () {
    (await XenonDatabase.DeviceModel).removeDataOnly();
    const deviceManager = createTestXenonManager(
      Object.assign({}, pluginArgs, { maxSessions: 3, platform: 'android' }),
    );
    await addNewDevice(devices);
    const capabilities = {
      alwaysMatch: {
        platformName: 'android',
        'appium:app': '/Downloads/VodQA.apk',
        'appium:deviceAvailabilityTimeout': 1800,
        'appium:deviceRetryInterval': 100,
      },
      firstMatch: [{}],
    };
    const allocatedDeviceForFirstSession = await DeviceUtils.allocateDeviceForSession(
      capabilities,
      1000,
      1000,
      pluginArgs,
    );

    async function getFilteredDevice(udid: string, host: string) {
      return (await XenonDatabase.DeviceModel).chain().find({ udid, host }).data();
    }

    const foundDevice = (
      await getFilteredDevice(
        allocatedDeviceForFirstSession.udid,
        allocatedDeviceForFirstSession.host,
      )
    )[0];

    expect(foundDevice.busy).to.be.true;

    let filterDeviceWithSameUDID = (await XenonDatabase.DeviceModel)
      .chain()
      .find({ udid: allocatedDeviceForFirstSession.udid })
      .data();
    expect(filterDeviceWithSameUDID.length).to.be.greaterThanOrEqual(1);
    // one device should be busy and the other is not
    filterDeviceWithSameUDID.filter((device) => device.busy).length.should.be.equal(1);

    const allocatedDeviceForSecondSession = await DeviceUtils.allocateDeviceForSession(
      capabilities,
      1000,
      1000,
      pluginArgs,
    );
    // allocatedDeviceForSecondSession should not be the same as allocatedDeviceForFirstSession
    expect(allocatedDeviceForFirstSession).to.not.be.equal(allocatedDeviceForSecondSession);

    const foundSecondDevice = (await XenonDatabase.DeviceModel)
      .chain()
      .find({
        udid: allocatedDeviceForSecondSession.udid,
        host: allocatedDeviceForSecondSession.host,
      })
      .data()[0];
    expect(foundSecondDevice.busy).to.be.true;

    await allocateDeviceForSession(capabilities, 1000, 1000, pluginArgs).catch((error) =>
      expect(error)
        .to.be.an('error')
        .with.property(
          'message',
          `Device is busy or blocked.. Device request: {"platform":"android","udid":"${allocatedDeviceForFirstSession.udid}","filterByHost":"192.168.0.226"}`,
        ),
    );
  });

  it('should release blocked devices that have no activity for more than the timeout', async () => {
    (await XenonDatabase.DeviceModel).removeDataOnly();
    // mock setUtilizationTime
    sandbox.stub(DeviceUtils, 'setUtilizationTime' as any).callsFake(sinon.fake());

    const unbusyDevices = devices.map((device) => ({
      ...device,
      busy: false,
    })) as unknown as IDevice[];
    await addNewDevice(unbusyDevices);

    const targetDevice = unbusyDevices[0];
    await (
      await XenonDatabase.DeviceModel
    )
      .chain()
      .find({ udid: targetDevice.udid, host: targetDevice.host })
      .update(function (device: IDevice) {
        device.busy = true;
        device.lastCmdExecutedAt = new Date().getTime() - 100000;
      });

    const releaseBlockedDevicesMock = sandbox.spy(DeviceService, 'unblockDevice');
    await DeviceUtils.releaseBlockedDevices(20);
    releaseBlockedDevicesMock.should.have.been.calledWith(targetDevice.udid, targetDevice.host);
  });

  it('should release device on node that is not used for more than the timeout', async () => {
    (await XenonDatabase.DeviceModel).removeDataOnly();
    // mock setUtilizationTime
    sandbox.stub(DeviceUtils, 'setUtilizationTime' as any).callsFake(sinon.fake());

    const unbusyDevices = devices.map((device) => ({
      ...device,
      busy: false,
    })) as unknown as IDevice[];
    const deviceOnAnotherNode = {
      ...unbusyDevices[0],
      host: 'http://anotherhost:4723',
    };
    unbusyDevices.push(deviceOnAnotherNode);
    await addNewDevice(unbusyDevices);

    await (
      await XenonDatabase.DeviceModel
    )
      .chain()
      .find({ udid: deviceOnAnotherNode.udid, host: deviceOnAnotherNode.host })
      .update(function (device: IDevice) {
        device.busy = true;
        device.lastCmdExecutedAt = new Date().getTime() - 100000;
      });

    const unblockDeviceMock = sandbox.spy(DeviceService, 'unblockDevice');
    await DeviceUtils.releaseBlockedDevices(20);
    unblockDeviceMock.should.have.been.calledWith(
      deviceOnAnotherNode.udid,
      deviceOnAnotherNode.host,
    );
  });

  it('Block and unblock device', async () => {
    (await XenonDatabase.DeviceModel).removeDataOnly();
    // mock setUtilizationTime
    sandbox.stub(DeviceUtils, 'setUtilizationTime' as any).callsFake(sinon.fake());

    const unbusyDevices = devices.map((device) => ({
      ...device,
      busy: false,
    })) as unknown as IDevice[];
    await addNewDevice(unbusyDevices);

    const targetDevice = unbusyDevices[0];

    // action: block device
    await DeviceService.blockDevice(targetDevice.udid, targetDevice.host);

    // assert device is busy
    expect(
      (await XenonDatabase.DeviceModel)
        .chain()
        .find({ udid: targetDevice.udid, host: targetDevice.host })
        .data()[0],
    ).to.have.property('busy', true);

    // set lastCommandTimestamp, otherwise it won't be picked up as device to unblock
    (await XenonDatabase.DeviceModel)
      .chain()
      .find({ udid: targetDevice.udid, host: targetDevice.host })
      .update(function (device: IDevice) {
        device.lastCmdExecutedAt = new Date().getTime();
      });

    let unblockCandidates = await DeviceUtils.unblockCandidateDevices();

    // assert: device should be part of candidate list to unblock
    expect(unblockCandidates.map((item) => item.udid)).to.include(targetDevice.udid);

    // action: release blocked devices
    await DeviceService.unblockDevice(targetDevice.udid, targetDevice.host);

    // assert: device should not be part of candidate list to unblock
    unblockCandidates = await DeviceUtils.unblockCandidateDevices();
    expect(unblockCandidates.map((item) => item.udid)).to.not.include(targetDevice.udid);

    const device = (await XenonDatabase.DeviceModel)
      .chain()
      .find({ udid: targetDevice.udid, host: targetDevice.host })
      .data()[0];
    expect(device).to.be.not.undefined;
    expect(device?.busy).to.be.false;
  });

  it('should remove stale devices', async () => {
    (await XenonDatabase.DeviceModel).removeDataOnly();
    expect(
      (await XenonDatabase.DeviceModel).chain().find({ udid: 'emulator-9999' }).data().length,
    ).to.be.equal(0);
  });
});
