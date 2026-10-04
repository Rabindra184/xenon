import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import usbmux from 'usbmux';
import { Container } from 'typedi';
import { utilities as IOSUtils } from 'appium-ios-device';
import { IosTracker } from '../../src/device-managers/iOSTracker';
import { IOSDiscoveryService } from '../../src/device-managers/ios/IOSDiscoveryService';
import {
  isUsbmuxdUnavailable,
  resetUsbmuxdNotice,
  usbmuxdNotice,
} from '../../src/device-managers/ios/usbmuxd';
import log from '../../src/logger';

/**
 * A Linux machine with no usbmuxd (an Android-only node, a container): the
 * tracker's usbmux socket emitted 'error' with nobody listening, Node threw it
 * as an uncaught exception, and Xenon's handler ended the process seconds
 * after boot. Discovery's own poll caught its error but logged it every time.
 */

const enoent = Object.assign(new Error('connect ENOENT /var/run/usbmuxd'), {
  code: 'ENOENT',
  syscall: 'connect',
  address: '/var/run/usbmuxd',
});
const missingSocket = new Error(
  "The usbmuxd socket at '/var/run/usbmuxd' does not exist or is not accessible",
);

describe('iOS without usbmuxd', () => {
  let warn: sinon.SinonSpy;
  let error: sinon.SinonSpy;

  beforeEach(() => {
    resetUsbmuxdNotice();
    warn = sinon.spy();
    error = sinon.spy();
    sinon.stub(log, 'scope').returns({ warn, error, info: sinon.spy(), debug: sinon.spy() } as any);
  });
  afterEach(() => {
    sinon.restore();
    Container.remove(IosTracker);
    resetUsbmuxdNotice();
  });

  describe('isUsbmuxdUnavailable', () => {
    it('knows the socket errors and the library’s own message', () => {
      expect(isUsbmuxdUnavailable(enoent)).to.equal(true);
      expect(
        isUsbmuxdUnavailable(
          Object.assign(new Error('connect ECONNREFUSED /var/run/usbmuxd'), {
            code: 'ECONNREFUSED',
            address: '/var/run/usbmuxd',
          }),
        ),
      ).to.equal(true);
      expect(isUsbmuxdUnavailable(missingSocket)).to.equal(true);
    });

    it('leaves every other error alone', () => {
      expect(isUsbmuxdUnavailable(new Error('Listen failed'))).to.equal(false);
      expect(
        isUsbmuxdUnavailable(
          Object.assign(new Error('ENOENT'), { code: 'ENOENT', path: '/tmp/x' }),
        ),
      ).to.equal(false);
      expect(isUsbmuxdUnavailable(undefined)).to.equal(false);
    });
  });

  describe('the tracker', () => {
    it('survives the socket failing to connect, and says so once', () => {
      const socket = new EventEmitter();
      sinon.stub(usbmux, 'createListener').returns(socket as any);
      const tracker = new IosTracker();
      expect(tracker.getListener()).to.equal(socket);

      // An EventEmitter with no 'error' listener throws from emit: the crash.
      expect(() => socket.emit('error', enoent)).not.to.throw();
      expect(() => socket.emit('error', enoent)).not.to.throw();
      expect(warn.callCount).to.equal(1);
      expect(String(warn.firstCall.args[0])).to.match(/usbmuxd isn’t running/);
    });

    it('logs any other socket error rather than crashing', () => {
      const socket = new EventEmitter();
      sinon.stub(usbmux, 'createListener').returns(socket as any);
      new IosTracker();
      expect(() => socket.emit('error', new Error('Listen failed'))).not.to.throw();
      expect(error.callCount).to.equal(1);
      expect(warn.callCount).to.equal(0);
    });
  });

  describe('discovery', () => {
    it('finds no iPhones, warning once over repeated polls', async () => {
      sinon.stub(IOSUtils, 'getConnectedDevices').rejects(missingSocket);
      const discovery = new IOSDiscoveryService({} as any);
      expect(await discovery.getConnectedDevices()).to.deep.equal([]);
      expect(await discovery.getConnectedDevices()).to.deep.equal([]);
      expect(warn.callCount).to.equal(1);
      expect(error.callCount).to.equal(0);
    });

    it('still logs any other failure as an error', async () => {
      sinon.stub(IOSUtils, 'getConnectedDevices').rejects(new Error('lockdown failed'));
      const discovery = new IOSDiscoveryService({} as any);
      expect(await discovery.getConnectedDevices()).to.deep.equal([]);
      expect(error.callCount).to.equal(1);
      expect(warn.callCount).to.equal(0);
    });
  });

  it('usbmuxdNotice is one warning until it is reset', () => {
    const logger = { warn: sinon.spy() };
    usbmuxdNotice(logger, enoent);
    usbmuxdNotice(logger, enoent);
    expect(logger.warn.callCount).to.equal(1);
  });
});
