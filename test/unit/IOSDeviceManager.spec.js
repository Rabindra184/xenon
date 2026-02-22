import 'reflect-metadata';
import sinon from 'sinon';
import { expect } from 'chai';
import IOSDeviceManager from '../../src/device-managers/IOSDeviceManager';
import { IOSDiscoveryService } from '../../src/device-managers/ios/IOSDiscoveryService';
import * as Helper from '../../src/helpers';
import * as DeviceUtils from '../../src/device-utils';
import { deviceMock } from './fixtures/devices';
import ip from 'ip';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';

let sandbox = sinon.createSandbox();

beforeEach(() => {
  if (IOSDiscoveryService.prototype.getDevices.restore) {
    IOSDiscoveryService.prototype.getDevices.restore();
  }
  sinon.restore();
  sandbox = sinon.createSandbox();
});

afterEach(function () {
  sandbox.restore();
});

const pluginArgs = Object.assign({}, DefaultPluginArgs, {
  remote: [`http://${ip.address()}:4723`],
  skipChromeDownload: true,
});

describe('IOS Device Manager', () => {

  it('IOS Device List to have added state', async () => {
    const iosDevices = new IOSDeviceManager(pluginArgs, 4723);

    sandbox.stub(IOSDiscoveryService.prototype, 'getDevices').resolves([
      {
        udid: '00001111-00115D822222002E',
        sdk: '14.1.1',
        name: 'Sai’s iPhone',
        busy: false,
        realDevice: true,
        deviceType: 'real',
        platform: 'ios',
        wdaLocalPort: 54093,
        sessionStartTime: 0,
        totalUtilizationTimeMilliSec: 0,
        host: `http://${ip.address()}:4723`,
        derivedDataPath: 'dummy',
        mjpegServerPort: 54093,
      },
      {
        name: 'iPad Air (3rd generation)',
        udid: '0FBCBDCC-2FF1-4FCA-B034-60ABC86ED866',
        state: 'Shutdown',
        sdk: '13.5',
        platform: 'ios',
        deviceType: 'simulator',
        host: `http://${ip.address()}:4723`,
      },
      {
        name: 'iPad Air (3rd generation)',
        udid: '0FBCBDCC-2FF1-4FCA-B034-60ABC86E9999',
        state: 'Booted',
        sdk: '14.5',
        platform: 'ios',
        deviceType: 'simulator',
        host: `http://${ip.address()}:4723`,
      },
    ]);

    sandbox.stub(Helper, 'isMac').returns(true);
    const devices = await iosDevices.getDevices({ iosDeviceType: 'both' }, []);
    expect(devices).to.have.lengthOf(3);
    expect(devices[0].udid).to.equal('00001111-00115D822222002E');
    expect(devices[1].udid).to.equal('0FBCBDCC-2FF1-4FCA-B034-60ABC86ED866');
    expect(devices[2].udid).to.equal('0FBCBDCC-2FF1-4FCA-B034-60ABC86E9999');
  });

  it('Should consider only simulators that is given by user and all real devices', async () => {
    const simulators = [
      {
        name: 'iPhone 14',
        sdk: '16.1',
      },
      {
        name: 'iPhone 14 Plus',
        sdk: '16.1',
      },
    ];

    let iosDeviceManager = new IOSDeviceManager(
      Object.assign({ platform: 'iOS', simulators }, DefaultPluginArgs),
      4723,
    );

    const mockSims = deviceMock.filter((device) => device.platform === 'ios' && device.deviceType === 'simulator');
    sandbox.stub(IOSDiscoveryService.prototype, 'getDevices').resolves([
      {
        udid: '00001111-00115D822222002E',
        sdk: '14.1.1',
        name: 'Sai’s iPhone',
        busy: false,
        realDevice: true,
        deviceType: 'real',
        platform: 'ios',
        wdaLocalPort: 54093,
        sessionStartTime: 0,
        totalUtilizationTimeMilliSec: 0,
        host: `http://${ip.address()}:4723`,
        derivedDataPath: 'dummy',
        mjpegServerPort: 54093,
      },
      ...mockSims
    ]);

    sandbox.stub(Helper, 'getFreePort').returns(54093);
    sandbox.stub(DeviceUtils, 'getUtilizationTime').returns(0);
    const devices = await iosDeviceManager.getDevices({ iosDeviceType: 'real' }, []);
    devices.forEach((device) => {
      expect(device.platform).to.equal('ios');
    });
  });

  it('Should consider only simulators that is given by user and not real devices', async () => {
    const simulators = [
      {
        name: 'iPhone 14',
        sdk: '16.1',
      },
      {
        name: 'iPhone 14 Plus',
        sdk: '16.1',
      },
    ];
    let iosDeviceManager = new IOSDeviceManager(
      Object.assign({ platform: 'iOS', iosDeviceType: 'simulated', remote: ['http://127.0.0.1:4723'], simulators }, DefaultPluginArgs),
      4723,
    );

    const mockSims = deviceMock.filter((device) => device.platform === 'ios' && device.deviceType === 'simulator');
    sandbox.stub(IOSDiscoveryService.prototype, 'getDevices').resolves(mockSims);

    sandbox.stub(Helper, 'getFreePort').returns(54093);
    sandbox.stub(DeviceUtils, 'getUtilizationTime').returns(0);
    const devices = await iosDeviceManager.getDevices({ iosDeviceType: 'simulated' }, []);
    devices.forEach((device) => {
      expect(device.realDevice).to.be.false;
    });
  });

  it('IOS Device List to have added state - Include simulators with real devices', async () => {
    const iosDevices = new IOSDeviceManager(DefaultPluginArgs, 4723);

    sandbox.stub(IOSDiscoveryService.prototype, 'getDevices').resolves([
      {
        udid: '00001111-00115D822222002E',
        sdk: '14.1.1',
        name: 'Sai’s iPhone',
        busy: false,
        realDevice: true,
        deviceType: 'real',
        platform: 'ios',
        wdaLocalPort: 54093,
        host: `http://${ip.address()}:4723`,
        derivedDataPath: 'dummy',
        mjpegServerPort: 54093,
        sessionStartTime: 0,
        totalUtilizationTimeMilliSec: 0,
      },
      {
        name: 'iPad Air (3rd generation)',
        udid: '0FBCBDCC-2FF1-4FCA-B034-60ABC86ED866',
        state: 'Shutdown',
        sdk: '13.5',
        platform: 'ios',
        deviceType: 'simulator',
        host: `http://${ip.address()}:4723`,
      },
    ]);

    const devices = await iosDevices.getDevices({ iosDeviceType: 'both' }, []);
    expect(devices).to.have.lengthOf(2);
    expect(devices[0].udid).to.equal('00001111-00115D822222002E');
    expect(devices[1].udid).to.equal('0FBCBDCC-2FF1-4FCA-B034-60ABC86ED866');
  });

  it('IOS Device List to have added state - Only simulators', async () => {
    const iosDevices = new IOSDeviceManager(DefaultPluginArgs, 4723);

    sandbox.stub(IOSDiscoveryService.prototype, 'getDevices').resolves([
      {
        name: 'iPad Air (3rd generation)',
        udid: '0FBCBDCC-2FF1-4FCA-B034-60ABC86ED866',
        state: 'Shutdown',
        sdk: '13.5',
        platform: 'ios',
        deviceType: 'simulator',
        host: `http://${ip.address()}:4723`,
      },
    ]);

    sandbox.stub(Helper, 'getFreePort').returns(54093);
    sandbox.stub(DeviceUtils, 'getUtilizationTime').returns(0);
    const devices = await iosDevices.getDevices({ iosDeviceType: 'simulated' }, []);
    expect(devices).to.deep.equal([
      {
        name: 'iPad Air (3rd generation)',
        udid: '0FBCBDCC-2FF1-4FCA-B034-60ABC86ED866',
        state: 'Shutdown',
        sdk: '13.5',
        platform: 'ios',
        deviceType: 'simulator',
        host: `http://${ip.address()}:4723`,
      },
    ]);
  });

  it('IOS Device List to have added state - Only real devices', async () => {
    const iosDevices = new IOSDeviceManager(DefaultPluginArgs, 4723);

    sandbox.stub(IOSDiscoveryService.prototype, 'getDevices').resolves([
      {
        udid: '00001111-00115D822222002E',
        sdk: '14.1.1',
        name: 'Sai’s iPhone',
        busy: false,
        realDevice: true,
        deviceType: 'real',
        platform: 'ios',
        wdaLocalPort: 54093,
        sessionStartTime: 0,
        totalUtilizationTimeMilliSec: 0,
        host: `http://${ip.address()}:4723`,
        derivedDataPath: 'dummy',
        mjpegServerPort: 54093,
      }
    ]);

    const devices = await iosDevices.getDevices({ iosDeviceType: 'real' }, []);
    expect(devices).to.have.lengthOf(1);
    expect(devices[0].udid).to.equal('00001111-00115D822222002E');
  });
});
