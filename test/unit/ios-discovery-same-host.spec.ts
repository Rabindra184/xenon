import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { utilities as IOSUtils } from 'appium-ios-device';
import * as simctlModule from 'node-simctl';
import { IOSDiscoveryService } from '../../src/device-managers/ios/IOSDiscoveryService';
import IOSDeviceManager from '../../src/device-managers/IOSDeviceManager';
import IOSStreamService from '../../src/device-managers/ios/IOSStreamService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceUtils from '../../src/device-utils';
import { PluginContext } from '../../src/PluginContext';
import { PortAllocator } from '../../src/services/PortAllocator';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { IDevice } from '../../src/interfaces/IDevice';

/**
 * A hub on :4724 and a node on :4725 on one Mac both see the same iPhone and
 * the same simulators, and the hub's table holds the node's rows too. A row
 * is a server's own only by udid AND host, as the Android discovery and
 * localDeviceHosts have it. iOS discovery looked rows up by udid alone, so
 * the hub could take the node's row for its own: its host, ports and busy
 * state.
 *
 * Nothing real is asked: usbmux, go-ios, simctl and the store are fakes.
 */

const IP = '192.168.0.104';
const HUB = `http://${IP}:4724`;
const NODE = `http://${IP}:4725`;
const IPHONE = 'test-iphone-00008150-shared';
const SIM = 'TEST-SIM-5A0C-shared';

function context(args: Partial<IPluginArgs>, port: number): PluginContext {
  const ctx = new PluginContext();
  ctx.setContext(Object.assign({}, DefaultPluginArgs, args), port, 'test-hub', '');
  return ctx;
}

describe("iOS discovery takes only its own host's row for a udid", () => {
  let rows: Array<Partial<IDevice>>;

  const nodeRow = (udid: string, over: Partial<IDevice> = {}): Partial<IDevice> => ({
    udid,
    host: NODE,
    platform: 'ios',
    realDevice: true,
    wdaLocalPort: 8200,
    mjpegServerPort: 9200,
    busy: true,
    session_id: 'node-session-1',
    screenWidth: '1320',
    screenHeight: '2868',
    ...over,
  });

  // resetTestContainer() (test/helpers/test-container.ts) stubs these two on
  // the prototype for the rest of the process, so in a full run discovery
  // never reaches them. Put the real ones on this instance.
  const real = (fn: any) => fn.wrappedMethod ?? fn;

  function hubDiscovery(connected: string[] = [IPHONE]): IOSDiscoveryService {
    const svc = new IOSDiscoveryService(context({ bindHostOrIp: IP }, 4724));
    const proto = IOSDiscoveryService.prototype as any;
    Object.assign(svc, {
      fetchLocalIOSDevices: real(proto.fetchLocalIOSDevices),
      fetchLocalSimulators: real(proto.fetchLocalSimulators),
    });
    (svc as any).trackingInitialized = true; // no usbmux listener
    sinon.stub(svc, 'getConnectedDevices').resolves(connected);
    sinon.stub(svc as any, 'fetchRealDeviceNetworkIp').resolves(''); // no go-ios
    return svc;
  }

  beforeEach(() => {
    rows = [];
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: async (filter: Record<string, unknown>) =>
        rows.find((r) => Object.entries(filter).every(([k, v]) => (r as any)[k] === v)) ?? null,
    } as any);
    const real = Container.get.bind(Container);
    sinon.stub(Container, 'get').callsFake((token: any) => {
      if (token === PortAllocator) {
        return { tryAcquire: async (purpose: string) => (purpose === 'wda' ? 28400 : 29400) };
      }
      if (token === IOSStreamService) return { getStreamStatus: () => undefined };
      return real(token);
    });
    sinon.stub(deviceUtils, 'getUtilizationTime').resolves(0 as any);
    sinon.stub(IOSUtils, 'getOSVersion').resolves('26.7');
    sinon.stub(IOSUtils, 'getDeviceName').resolves('iPhone 17 Pro');
    sinon.stub(IOSUtils, 'getDeviceInfo').rejects(new Error('no lockdown in tests'));
  });

  afterEach(() => sinon.restore());

  describe('a real iPhone', () => {
    it("builds the hub's own row when only the node's row for the udid is known", async () => {
      rows = [nodeRow(IPHONE)];

      const [phone] = await hubDiscovery().fetchLocalIOSDevices(rows as IDevice[]);

      expect(phone.host).to.equal(HUB);
      expect(phone.busy, "the node's session is not the hub's").to.equal(false);
      expect(phone.session_id).to.not.equal('node-session-1');
      expect(phone.wdaLocalPort, "the hub's own port").to.equal(28400);
    });

    it("reuses the hub's own row", async () => {
      const own = nodeRow(IPHONE, {
        host: HUB,
        wdaLocalPort: 28123,
        busy: false,
        session_id: undefined,
      });
      rows = [nodeRow(IPHONE), own];
      const svc = hubDiscovery();
      const getDeviceInfo = sinon.spy(svc, 'getDeviceInfo');

      const [phone] = await svc.fetchLocalIOSDevices(rows as IDevice[]);

      expect(getDeviceInfo.called, 'no need to ask the phone again').to.equal(false);
      expect(phone.host).to.equal(HUB);
      expect(phone.wdaLocalPort).to.equal(28123);
    });

    it("an attach (getDeviceInfo) never takes the node's row", async () => {
      rows = [nodeRow(IPHONE)];

      const phone = await hubDiscovery().getDeviceInfo(IPHONE);

      expect(phone.host).to.equal(HUB);
      expect(phone.wdaLocalPort).to.equal(28400);
      expect(phone.mjpegServerPort).to.equal(29400);
      expect(phone.busy).to.equal(false);
    });
  });

  it("a simulator on the shared Mac gets the hub's own ports, not the node's row's", async () => {
    class FakeSimctl {
      async list() {
        return { runtimes: [] };
      }
      async getDevicesByParsing(platform: string) {
        return platform === 'iOS'
          ? { '26.0': [{ udid: SIM, name: 'iPhone 17', state: 'Booted', sdk: '26.0' }] }
          : {};
      }
    }
    sinon.stub(simctlModule as any, 'default').value(FakeSimctl);
    rows = [nodeRow(SIM, { realDevice: false })];

    const [sim] = await hubDiscovery([]).fetchLocalSimulators();

    expect(sim.host).to.equal(HUB);
    expect(sim.wdaLocalPort).to.equal(28400);
    expect(sim.mjpegServerPort).to.equal(29400);
  });

  it("IOSDeviceManager reads a phone's stored screen size from that phone's own row", async () => {
    rows = [
      nodeRow(IPHONE),
      nodeRow(IPHONE, { host: HUB, screenWidth: '750', screenHeight: '1334' }),
    ];
    // Bypass the constructor: it checks ideviceinstaller.
    const manager: any = Object.create(IOSDeviceManager.prototype);
    manager.context = context({ bindHostOrIp: IP }, 4724);
    manager.log = { info: () => undefined, debug: () => undefined, warn: () => undefined };

    const info = await manager.getAdditionalDeviceInfo({
      udid: IPHONE,
      host: HUB,
      realDevice: true,
    });

    expect(info.screenWidth).to.equal('750');
    expect(info.screenHeight).to.equal('1334');
  });
});
