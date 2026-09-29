import 'reflect-metadata';
import { EventEmitter } from 'events';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { prisma } from '../../src/prisma';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { removeNodeDevices } from '../../src/data-service/device-service';
import {
  removeStaleDevices,
  unregisterNodeFromHub,
  updateDeviceList,
} from '../../src/device-utils';
import * as helpers from '../../src/helpers';
import NodeDevices from '../../src/device-managers/NodeDevices';
import AndroidDeviceManager from '../../src/device-managers/AndroidDeviceManager';
import { IOSDiscoveryService } from '../../src/device-managers/ios/IOSDiscoveryService';
import { IosTracker } from '../../src/device-managers/iOSTracker';
import { XenonManager } from '../../src/device-managers';
import {
  isLocalDeviceHost,
  LocalHostArgs,
  localDeviceHosts,
  parseAdbRemote,
} from '../../src/device-managers/localDeviceHosts';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { SocketServer } from '../../src/services/SocketServer';
import { NotificationService } from '../../src/services/NotificationService';
import { IDevice } from '../../src/interfaces/IDevice';
import { saveRegistrations } from '../helpers/container-registration';
import { fakeDeviceTable, Row } from '../helpers/fake-device-table';

/**
 * A hub on :4724 and a node on :4725 on one machine share an IP, so their
 * phones' hosts differ only by port. Seen on 2026-09-28: the node registered
 * its phone with the hub, and the hub's own local sync deleted it a few
 * seconds later as "no longer discovered on this host", because it decided
 * which rows were its own by IP.
 */

const IP = '192.168.0.104';
const HUB = `http://${IP}:4724`;
const NODE = `http://${IP}:4725`;

const hubHosts = (over: Partial<LocalHostArgs> = {}) =>
  localDeviceHosts({ bindHostOrIp: IP, ...over }, 4724);
const nodeHosts = (over: Partial<LocalHostArgs> = {}) =>
  localDeviceHosts({ bindHostOrIp: IP, ...over }, 4725);

const phone = (udid: string, host: string, over: Row = {}): Row => ({
  udid,
  host,
  name: udid,
  platform: 'android',
  deviceType: 'real',
  realDevice: true,
  state: 'device',
  sdk: '14',
  ...over,
});

const context = (args: Partial<IPluginArgs>, port: number) => {
  const ctx = new PluginContext();
  ctx.setContext(Object.assign({}, DefaultPluginArgs, args), port, 'test-node', '');
  return ctx;
};

describe('localDeviceHosts', () => {
  it("is this server's origin when nothing else files a phone elsewhere", () => {
    const local = hubHosts();
    expect(local.origin).to.equal(HUB);
    expect([...local.hosts]).to.deep.equal([HUB]);
  });

  it('adds both remoteMachineProxyIP forms: with the port (Android) and as given (iOS)', () => {
    expect([...hubHosts({ remoteMachineProxyIP: '203.0.113.7' }).hosts]).to.have.members([
      HUB,
      'http://203.0.113.7:4724',
      '203.0.113.7',
    ]);
  });

  it('adds each adbRemote server, with adb’s default port when none is given', () => {
    expect(parseAdbRemote('10.0.0.9')).to.deep.equal({ adbHost: '10.0.0.9', adbPort: 5037 });
    expect([...hubHosts({ adbRemote: ['10.0.0.9', '10.0.0.8:5038'] }).hosts]).to.have.members([
      HUB,
      'http://10.0.0.9:5037',
      'http://10.0.0.8:5038',
    ]);
  });

  it('matches a whole host only, never an IP, a prefix or a path', () => {
    const local = hubHosts();
    expect(isLocalDeviceHost(local, HUB)).to.equal(true);
    for (const other of [
      NODE,
      IP,
      `${HUB}/wd/hub`,
      `http://${IP}/wd/hub`,
      'http://192.168.0.10:4724',
    ]) {
      expect(isLocalDeviceHost(local, other), other).to.equal(false);
    }
    expect(isLocalDeviceHost(local, undefined)).to.equal(false);
  });
});

describe('A hub and a node on one machine keep to their own phones', () => {
  let table: ReturnType<typeof fakeDeviceTable>;
  let discover: (known: IDevice[]) => Promise<IDevice[]>;
  let restoreContainer: () => void;
  let savedStore: unknown;

  const seed = (rows: Row[]) => {
    table = fakeDeviceTable(rows);
    for (const m of Object.keys(table.delegate) as Array<keyof typeof table.delegate>) {
      sinon.stub(prisma.device as any, m).callsFake(table.delegate[m] as any);
    }
  };

  beforeEach(() => {
    discover = async () => [];
    restoreContainer = saveRegistrations(
      XenonManager,
      SocketServer,
      NotificationService,
      IosTracker,
    );
    Container.set({
      id: XenonManager,
      value: { getDevices: (known: IDevice[]) => discover(known) },
    });
    Container.set({
      id: SocketServer,
      value: {
        emitToDashboard: () => undefined,
        emitToDashboardForDevices: async () => undefined,
        hasScopedDashboard: () => false,
      },
    });
    Container.set({ id: NotificationService, value: { dispatchEvent: async () => undefined } });
    sinon.stub(prisma.lease as any, 'findMany').resolves([]);
    savedStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
  });

  afterEach(() => {
    (DeviceStoreFactory as any)._deviceStore = savedStore;
    sinon.restore();
    restoreContainer();
  });

  describe("the hub's local sync", () => {
    it("removes the hub's own stale phone and keeps the node's", async () => {
      seed([phone('hub-phone', HUB), phone('node-phone', NODE)]);

      await updateDeviceList(hubHosts());

      expect(table.row('hub-phone')).to.equal(undefined);
      expect(table.row('node-phone')).to.include({ host: NODE });
    });

    it("keeps phones on the hub's IP whose host has a path and another port or none", async () => {
      seed([
        phone('hub-phone', HUB),
        phone('behind-proxy', `http://${IP}/wd/hub`),
        phone('node-wd-hub', `${NODE}/wd/hub`),
      ]);

      await updateDeviceList(hubHosts());

      expect(table.row('hub-phone')).to.equal(undefined);
      expect(table.row('behind-proxy')).to.include({ host: `http://${IP}/wd/hub` });
      expect(table.row('node-wd-hub')).to.include({ host: `${NODE}/wd/hub` });
    });

    it('prunes its own phones filed under remoteMachineProxyIP, in both forms', async () => {
      seed([
        phone('android-proxied', 'http://203.0.113.7:4724'),
        phone('iphone-proxied', '203.0.113.7', { platform: 'ios' }),
        phone('node-phone', NODE),
      ]);

      await updateDeviceList(hubHosts({ remoteMachineProxyIP: '203.0.113.7' }));

      expect(table.row('android-proxied')).to.equal(undefined);
      expect(table.row('iphone-proxied')).to.equal(undefined);
      expect(table.row('node-phone')).to.include({ host: NODE });
    });

    it('treats a remoteMachineProxyIP with a path as one whole host', async () => {
      seed([
        phone('hub-iphone', 'https://lab.example.com/hub', { platform: 'ios' }),
        phone('node-iphone', 'https://lab.example.com/hub-node', { platform: 'ios' }),
      ]);

      await updateDeviceList(hubHosts({ remoteMachineProxyIP: 'https://lab.example.com/hub' }));

      expect(table.row('hub-iphone')).to.equal(undefined);
      expect(table.row('node-iphone')).to.include({ host: 'https://lab.example.com/hub-node' });
    });

    it('prunes a phone on one of its adbRemote servers that is gone', async () => {
      seed([phone('remote-adb', 'http://10.0.0.9:5037'), phone('node-phone', NODE)]);

      await updateDeviceList(hubHosts({ adbRemote: ['10.0.0.9'] }));

      expect(table.row('remote-adb')).to.equal(undefined);
      expect(table.row('node-phone')).to.include({ host: NODE });
    });
  });

  describe("the node's own sync", () => {
    it("prunes the node's stale phone, tells the hub, and leaves the hub's row alone", async () => {
      // One table for both, as when the two share a database.
      seed([phone('node-live', NODE), phone('node-gone', NODE), phone('hub-phone', HUB)]);
      discover = async (known) =>
        known.filter((d) => d.udid === 'node-live').map((d) => ({ ...d }) as IDevice);
      sinon.stub(helpers, 'isXenonRunning').resolves(true);
      const post = sinon.stub(NodeDevices.prototype, 'postDevicesToHub').resolves();

      await updateDeviceList(nodeHosts(), HUB);

      expect(table.row('node-gone')).to.equal(undefined);
      expect(table.row('node-live')).to.include({ host: NODE });
      expect(table.row('hub-phone')).to.include({ host: HUB });
      const removed = post.getCalls().filter((c) => c.args[1] === 'remove');
      expect(removed).to.have.length(1);
      expect((removed[0].args[0] as any[]).map((d) => d.udid)).to.deep.equal(['node-gone']);
    });
  });

  describe("the hub's stale-host check", () => {
    it('host-checks a node on the same IP, and drops its phones when it is down', async () => {
      seed([phone('hub-phone', HUB), phone('node-phone', NODE)]);
      const alive = sinon.stub(helpers, 'isXenonRunning').resolves(false);

      await removeStaleDevices(hubHosts());

      expect(alive.calledWith(NODE)).to.equal(true);
      expect(alive.calledWith(HUB)).to.equal(false);
      expect(table.row('node-phone')).to.equal(undefined);
      expect(table.row('hub-phone')).to.include({ host: HUB });
    });

    it("keeps a live node's phones", async () => {
      seed([phone('hub-phone', HUB), phone('node-phone', NODE)]);
      const alive = sinon.stub(helpers, 'isXenonRunning').resolves(true);

      await removeStaleDevices(hubHosts());

      expect(alive.calledWith(NODE)).to.equal(true);
      expect(table.row('node-phone')).to.include({ host: NODE });
      expect(table.row('hub-phone')).to.include({ host: HUB });
    });

    it("does not take a node whose IP starts with the hub's for its own", async () => {
      seed([phone('hub-phone', 'http://192.168.0.10:4724'), phone('node-phone', NODE)]);
      sinon.stub(helpers, 'isXenonRunning').resolves(false);

      await removeStaleDevices(localDeviceHosts({ bindHostOrIp: '192.168.0.10' }, 4724));

      expect(table.row('node-phone')).to.equal(undefined);
      expect(table.row('hub-phone')).to.include({ host: 'http://192.168.0.10:4724' });
    });

    it('never host-checks its own phones, in any host form', async () => {
      seed([
        phone('origin', HUB),
        phone('android-proxied', 'http://203.0.113.7:4724'),
        phone('iphone-proxied', '203.0.113.7', { platform: 'ios' }),
        phone('remote-adb', 'http://10.0.0.9:5037'),
      ]);
      const alive = sinon.stub(helpers, 'isXenonRunning').resolves(false);

      await removeStaleDevices(
        hubHosts({ remoteMachineProxyIP: '203.0.113.7', adbRemote: ['10.0.0.9'] }),
      );

      expect(alive.called).to.equal(false);
      for (const udid of ['origin', 'android-proxied', 'iphone-proxied', 'remote-adb']) {
        expect(table.row(udid), udid).to.not.equal(undefined);
      }
    });
  });

  describe('a node leaving the hub', () => {
    // The hub's /register?type=unregister handler.
    const hubReceives = () =>
      sinon
        .stub(NodeDevices.prototype, 'unRegisterNode')
        .callsFake(async (host: string, nodeId?: string) => {
          await removeNodeDevices([{ host, nodeId }], (d) => d.host === HUB);
        });

    it("removes only the node's phones from the hub", async () => {
      seed([phone('hub-phone', HUB), phone('node-phone', NODE)]);
      const sent = hubReceives();

      await unregisterNodeFromHub(HUB, nodeHosts());

      expect(sent.getCalls().map((c) => c.args[0])).to.deep.equal([NODE]);
      expect(table.row('node-phone')).to.equal(undefined);
      expect(table.row('hub-phone')).to.include({ host: HUB });
    });

    it('sends only URLs, which the hub matches exactly, never a bare proxy address', async () => {
      seed([phone('hub-phone', HUB), phone('other-node', 'http://203.0.113.7:4726')]);
      const sent = hubReceives();

      await unregisterNodeFromHub(HUB, nodeHosts({ remoteMachineProxyIP: '203.0.113.7' }));

      expect(sent.getCalls().map((c) => c.args[0])).to.have.members([
        NODE,
        'http://203.0.113.7:4725',
      ]);
      expect(table.row('other-node')).to.include({ host: 'http://203.0.113.7:4726' });
      expect(table.row('hub-phone')).to.include({ host: HUB });
    });
  });

  describe("the hub's Android discovery", () => {
    const localAdb = { adbPort: 5037 };
    let deviceInfo: sinon.SinonStub;

    // resetTestContainer() (test/helpers/test-container.ts) stubs these two on
    // the prototype for the rest of the process, so in a full run discovery
    // never reaches them. Put the real ones on this instance.
    const real = (fn: any) => fn.wrappedMethod ?? fn;

    const hubAndroid = (adb: object = localAdb) => {
      const manager = new AndroidDeviceManager(context({ bindHostOrIp: IP }, 4724));
      const proto = AndroidDeviceManager.prototype as any;
      Object.assign(manager, {
        getDevices: real(proto.getDevices),
        fetchAndroidDevices: real(proto.fetchAndroidDevices),
      });
      sinon.stub(manager as any, 'requireSdkRoot').resolves();
      sinon
        .stub(manager, 'getConnectedDevices')
        .resolves(new Map([[adb, [{ udid: 'shared', state: 'device' }]]]));
      deviceInfo = sinon
        .stub(manager as any, 'deviceInfo')
        .callsFake(async (device: any) => phone(device.udid, HUB));
      return manager;
    };

    it('builds its own row for a phone the node on the same IP already listed', async () => {
      const devices = await hubAndroid().getDevices({ androidDeviceType: 'both' }, [
        phone('shared', NODE) as IDevice,
      ]);

      expect(deviceInfo.calledOnce).to.equal(true);
      expect(devices.map((d) => d.host)).to.deep.equal([HUB]);
    });

    it('reuses its own row without asking the phone again', async () => {
      const devices = await hubAndroid().getDevices({ androidDeviceType: 'both' }, [
        phone('shared', HUB) as IDevice,
      ]);

      expect(deviceInfo.called).to.equal(false);
      expect(devices.map((d) => d.host)).to.deep.equal([HUB]);
    });

    it('reuses its row for a phone on an adbRemote server, filed under that server', async () => {
      const remote = 'http://10.0.0.9:5037';
      const devices = await hubAndroid({ adbHost: '10.0.0.9', adbPort: 5037 }).getDevices(
        { androidDeviceType: 'both' },
        [phone('shared', remote) as IDevice],
      );

      expect(deviceInfo.called).to.equal(false);
      expect(devices.map((d) => d.host)).to.deep.equal([remote]);
    });
  });

  describe('a phone unplugged from one server', () => {
    it("Android: removes that server's row only, not another's with the same udid", async () => {
      // emulator-5554 is on every machine running an emulator; the node's
      // IP starts with the hub's.
      const hub = 'http://192.168.0.10:4724';
      seed([phone('emulator-5554', hub), phone('emulator-5554', NODE)]);
      const args = Object.assign({}, DefaultPluginArgs, { bindHostOrIp: '192.168.0.10' });
      const manager = new AndroidDeviceManager(context(args, 4724));

      await (manager as any).onDeviceRemoved({ id: 'emulator-5554', type: 'offline' }, args);

      const left = (await prisma.device.findMany()) as Row[];
      expect(left.map((d) => d.host)).to.deep.equal([NODE]);
    });

    it("iOS: removes that server's row only", async () => {
      seed([phone('iphone', HUB, { platform: 'ios' }), phone('iphone', NODE, { platform: 'ios' })]);
      const usbmux = new EventEmitter();
      Container.set({ id: IosTracker, value: { getListener: () => usbmux } });
      new IOSDiscoveryService(context({ bindHostOrIp: IP }, 4724)).trackIOSDevices();

      await (usbmux.listeners('detached')[0] as (udid: string) => Promise<void>)('iphone');

      const left = (await prisma.device.findMany()) as Row[];
      expect(left.map((d) => d.host)).to.deep.equal([NODE]);
    });
  });
});
