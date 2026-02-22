import 'reflect-metadata';
import Sinon from 'sinon';
import axios from 'axios';
import { expect } from 'chai';
import IOSDeviceManager from '../../src/device-managers/IOSDeviceManager';
import { IOSDiscoveryService } from '../../src/device-managers/ios/IOSDiscoveryService';

let sandbox = Sinon.createSandbox();
beforeEach(function () {
  if (IOSDiscoveryService.prototype.getDevices.restore) {
    IOSDiscoveryService.prototype.getDevices.restore();
  }
  Sinon.restore();
  sandbox = Sinon.createSandbox();
});

afterEach(function () {
  Sinon.restore();
  sandbox.restore();
});

const stubResponse = {
  data: [
    {
      name: 'iPad (8th generation)',
      udid: '3F74FBC0-D50E-4317-8C33-428C1CE55C27',
      state: 'Shutdown',
      sdk: '14.2',
      platform: 'ios',
      busy: false,
      realDevice: false,
      deviceType: 'simulator',
    },
  ],
  status: 200,
  statusText: 'OK',
  headers: {},
  config: {},
};

describe('Remote IOS', async () => {
  it('Fetch remote devices', async function () {
    let stub = Sinon.stub(axios, 'post').resolves(stubResponse);
    const iosDevices = new IOSDeviceManager({});

    sandbox.stub(IOSDiscoveryService.prototype, 'getDevices').resolves([
      {
        wdaLocalPort: 54093,
        udid: '00001111-00115D822222002E',
        sdk: '14.1.1',
        name: 'Sai’s iPhone',
        busy: false,
        realDevice: true,
        deviceType: 'real',
        platform: 'ios',
        host: 'http://127.0.0.1:4723',
        derivedDataPath: 'dummy',
        mjpegServerPort: 54093,
        sessionStartTime: 0,
        totalUtilizationTimeMilliSec: 0,
      }
    ]);

    const devices = await iosDevices.getDevices({ iosDeviceType: 'both' }, []);

    expect(devices).to.have.lengthOf(1);
    expect(devices[0].udid).to.equal('00001111-00115D822222002E');
  });
});
