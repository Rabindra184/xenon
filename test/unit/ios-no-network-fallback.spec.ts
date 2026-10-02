import 'reflect-metadata';
import { expect } from 'chai';
import axios from 'axios';
import childProcess from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs-extra';
import sinon from 'sinon';
import { Container } from 'typedi';
import { utilities as IOSUtils } from 'appium-ios-device';
import { IOSDiscoveryService } from '../../src/device-managers/ios/IOSDiscoveryService';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import { WDAClient } from '../../src/device-managers/ios/WDAClient';
import * as ownDeviceRow from '../../src/device-managers/ownDeviceRow';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceUtils from '../../src/device-utils';
import { PluginContext } from '../../src/PluginContext';
import { PortAllocator } from '../../src/services/PortAllocator';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { IDevice } from '../../src/interfaces/IDevice';

/**
 * Xenon never reaches WebDriverAgent over the network, only through the
 * phone's own forwarded port on 127.0.0.1.
 *
 * An iPhone's network address was meant to come from go-ios `ios info`, which
 * has no such value (its lockdown values carry no IPAddress), so detection
 * asked for it on every pass for nothing. The fallbacks that used it never
 * ran for an iPhone. A simulator's address is the Mac's own, so they sent a
 * simulator's commands to this Mac's port 8100, which can be an iPhone's
 * WebDriverAgent: WDA names no phone.
 */

const IP = '192.168.0.104';
const PHONE = 'test-iphone-00008110-net';
const ADDRESS = '10.9.8.7';

describe('iOS: WebDriverAgent only through the phone’s own forwarded port', () => {
  beforeEach(() => {
    sinon.stub(process, 'kill');
  });

  afterEach(() => sinon.restore());

  describe('detection', () => {
    let commands: string[];

    function discovery(): IOSDiscoveryService {
      const ctx = new PluginContext();
      ctx.setContext(Object.assign({}, DefaultPluginArgs, { bindHostOrIp: IP }), 4724, 'test', '');
      const svc = new IOSDiscoveryService(ctx);
      // resetTestContainer() stubs this on the prototype in a full run.
      const proto = IOSDiscoveryService.prototype as any;
      (svc as any).fetchLocalIOSDevices =
        proto.fetchLocalIOSDevices.wrappedMethod ?? proto.fetchLocalIOSDevices;
      (svc as any).trackingInitialized = true; // no usbmux listener
      sinon.stub(svc, 'getConnectedDevices').resolves([PHONE]);
      return svc;
    }

    beforeEach(() => {
      commands = [];
      // The go-ios binary is present, and every command it would run is recorded.
      const exists = fs.existsSync;
      sinon
        .stub(fs, 'existsSync')
        .callsFake((p: any) => String(p).endsWith('goIOS/ios') || exists(p));
      sinon.stub(childProcess, 'exec').callsFake(((cmd: string, ...rest: any[]) => {
        commands.push(cmd);
        const done = rest.find((a) => typeof a === 'function');
        done?.(null, '{}', '');
        return new EventEmitter() as any;
      }) as any);
      sinon.stub(DeviceStoreFactory, 'getStore').returns({ findDevice: async () => null } as any);
      const real = Container.get.bind(Container);
      sinon.stub(Container, 'get').callsFake((token: any) => {
        if (token === PortAllocator) return { tryAcquire: async () => 28400 };
        if (token === IOSStreamService) return { getStreamStatus: () => undefined };
        return real(token);
      });
      sinon.stub(deviceUtils, 'getUtilizationTime').resolves(0 as any);
      sinon.stub(IOSUtils, 'getOSVersion').resolves('26.5');
      sinon.stub(IOSUtils, 'getDeviceName').resolves('iPhone 14 Plus');
      sinon.stub(IOSUtils, 'getDeviceInfo').rejects(new Error('no lockdown in tests'));
    });

    const asksForAnAddress = () => commands.filter((c) => /\binfo --udid\b/.test(c));

    it('asks go-ios nothing about a known iPhone on each pass', async () => {
      const own = { udid: PHONE, host: `http://${IP}:4724`, platform: 'ios', ip: '' };

      const [phone] = await discovery().fetchLocalIOSDevices([own as IDevice]);

      expect(phone.udid).to.equal(PHONE);
      expect(asksForAnAddress()).to.deep.equal([]);
    });

    it('asks go-ios nothing about the address of an iPhone it adds', async () => {
      const phone = await discovery().getDeviceInfo(PHONE);

      expect(phone.ip).to.equal('');
      expect(asksForAnAddress()).to.deep.equal([]);
    });
  });

  describe('WDAClient', () => {
    it("retries a failed command on no host but 127.0.0.1, even with the phone's address", async () => {
      const urls: string[] = [];
      const refuse = async (url: string) => {
        urls.push(url);
        throw Object.assign(new Error(`connect ECONNREFUSED ${url}`), { code: 'ECONNREFUSED' });
      };
      sinon.stub(axios, 'post').callsFake(refuse as any);
      sinon.stub(axios, 'get').callsFake(refuse as any);
      sinon.stub(DeviceStoreFactory, 'getStore').returns({
        findDevice: async () => ({ udid: PHONE, wdaLocalPort: 28100, ip: ADDRESS }),
      } as any);
      const real = Container.get.bind(Container);
      sinon.stub(Container, 'get').callsFake((token: any) => {
        if (token === IOSStreamService) {
          return {
            getStreamStatus: () => undefined,
            getWDASessionId: () => undefined,
            setWDASessionId: () => undefined,
          };
        }
        return real(token);
      });

      const err = await new WDAClient()
        .sendWDACommand(PHONE, 'post', '/wda/tap', { x: 10, y: 10 })
        .then(
          () => null,
          (e: Error) => e,
        );

      expect(err?.message).to.match(/ECONNREFUSED/);
      expect(urls).to.not.deep.equal([]);
      expect(urls.filter((u) => !u.startsWith('http://127.0.0.1:28100/'))).to.deep.equal([]);
    });
  });

  describe('the stream watchdog', () => {
    let spawned: string[];

    function fakeProcess(exitCode: number | null): any {
      return Object.assign(new EventEmitter(), { exitCode, kill: () => true });
    }

    function streamWith(forwardExitCode: number | null): any {
      // Bypass the constructor: it starts watchdog intervals.
      const svc: any = Object.create(IOSStreamService.prototype);
      svc.sessions = new Map([
        [
          PHONE,
          {
            udid: PHONE,
            status: 'running',
            wdaPort: 28100,
            mjpegPort: 29100,
            wdaProcess: fakeProcess(null),
            forwardWDAProcess: fakeProcess(forwardExitCode),
            forwardMJPEGProcess: fakeProcess(null),
          },
        ],
      ]);
      return svc;
    }

    beforeEach(() => {
      spawned = [];
      sinon.stub(childProcess, 'spawn').callsFake(((cmd: string, args: string[]) => {
        spawned.push([cmd, ...(args ?? [])].join(' '));
        return fakeProcess(null);
      }) as any);
      // Something answers ready on the phone's address, port 8100; the
      // phone's own forwarded port refuses.
      sinon.stub(axios, 'get').callsFake((async (url: string) => {
        if (url.startsWith(`http://${ADDRESS}:`))
          return { status: 200, data: { value: { ready: true } } };
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      }) as any);
      sinon.stub(ownDeviceRow, 'findOwnDevice').resolves({ udid: PHONE, ip: ADDRESS } as any);
    });

    it('calls a stream whose forward died unresponsive, whatever answers on the network', async () => {
      expect(await streamWith(1).isStreamResponsive(PHONE)).to.equal(false);
      expect(spawned, 'no forward-only restart').to.deep.equal([]);
    });

    it('calls a stream whose forward is hung unresponsive, whatever answers on the network', async () => {
      expect(await streamWith(null).isStreamResponsive(PHONE)).to.equal(false);
      expect(spawned, 'no forward-only restart').to.deep.equal([]);
    });
  });
});
