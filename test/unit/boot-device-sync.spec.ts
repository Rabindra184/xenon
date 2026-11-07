import 'reflect-metadata';
import net, { AddressInfo } from 'net';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import waitUntil from 'async-wait-until';
import { prisma } from '../../src/prisma';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import * as deviceUtils from '../../src/device-utils';
import * as helpers from '../../src/helpers';
import NodeDevices from '../../src/device-managers/NodeDevices';
import { XenonManager } from '../../src/device-managers';
import { IosTracker } from '../../src/device-managers/iOSTracker';
import { localDeviceHosts } from '../../src/device-managers/localDeviceHosts';
import { ServerManager } from '../../src/services/ServerManager';
import { SocketServer } from '../../src/services/SocketServer';
import { NotificationService } from '../../src/services/NotificationService';
import { IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { IDevice } from '../../src/interfaces/IDevice';
import { saveRegistrations } from '../helpers/container-registration';
import { fakeDeviceSettingTable, fakeDeviceTable, Row } from '../helpers/fake-device-table';

/**
 * Appium opens its port only once every plugin's updateServer has finished,
 * so a start must not wait long on another server. Seen with 2.17.0: a hub
 * whose database still listed its own phones under its old DHCP address
 * (http://192.168.0.104:4723, now .102) asked that address whether it was a
 * live node, and a host that drops packets takes four 30 s timeouts to give
 * up, so the port opened 2 min 4 s after the plugin loaded. A node whose hub
 * doesn't answer waited the same way before reporting its phones.
 */

const IP = '192.168.0.102';
const HUB = `http://${IP}:4723`;
const NODE = `http://${IP}:4725`;

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

/** A promise this test settles when it chooses, as a host that drops packets never does. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

/** Whether a promise settles within a time no probe of another server can beat. */
const settlesSoon = (p: Promise<unknown>) =>
  Promise.race([
    p.then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), 1_000)),
  ]);

describe('A start never waits on another server', () => {
  let table: ReturnType<typeof fakeDeviceTable>;
  let discover: (known: IDevice[]) => Promise<IDevice[]>;
  let restoreContainer: () => void;
  let savedStore: unknown;

  const seed = (rows: Row[]) => {
    table = fakeDeviceTable(rows);
    for (const m of Object.keys(table.delegate) as Array<keyof typeof table.delegate>) {
      sinon.stub(prisma.device as any, m).callsFake(table.delegate[m] as any);
    }
    const settings = fakeDeviceSettingTable();
    for (const m of Object.keys(settings.delegate) as Array<keyof typeof settings.delegate>) {
      sinon.stub(prisma.deviceSetting as any, m).callsFake(settings.delegate[m] as any);
    }
  };

  const boot = (port: number, args: Partial<IPluginArgs>) =>
    (Container.get(ServerManager) as any).syncDevicesAtBoot(
      localDeviceHosts({ bindHostOrIp: IP }, port),
      args as IPluginArgs,
    ) as Promise<void>;

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
    sinon.stub(prisma.leaseMember as any, 'findMany').resolves([]);
    savedStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
  });

  afterEach(() => {
    (DeviceStoreFactory as any)._deviceStore = savedStore;
    sinon.restore();
    restoreContainer();
  });

  describe('on a hub, a row whose server never answers', () => {
    // Takes the connection and never answers, as a host past a dropped route
    // looks to the client: nothing but the timeout ends the request.
    let silent: net.Server;
    let sockets: net.Socket[];
    let silentHost: string;

    beforeEach(async () => {
      sockets = [];
      silent = net.createServer((s) => {
        sockets.push(s);
      });
      await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
      silentHost = `http://127.0.0.1:${(silent.address() as AddressInfo).port}`;
      // The real probe, with a limit this test can wait for.
      sinon.stub(deviceUtils.BOOT_PROBE, 'timeoutMs').value(300);
    });

    afterEach(async () => {
      sockets.forEach((s) => s.destroy());
      await new Promise<void>((r) => silent.close(() => r()));
    });

    it('is asked once, briefly, and gone before the port opens', async () => {
      seed([phone('old-row', silentHost)]);
      discover = async () => [phone('own-phone', HUB) as IDevice];

      expect(await settlesSoon(boot(4723, {}))).to.equal(true);

      expect(table.row('own-phone')).to.include({ host: HUB });
      expect(table.row('old-row')).to.equal(undefined);
      expect(sockets).to.have.length(1);
    });
  });

  it('a node opens while its hub never answers, and reports its phones once it does', async () => {
    seed([]);
    discover = async () => [phone('node-phone', NODE) as IDevice];
    const hubAnswer = deferred<boolean>();
    const alive = sinon.stub(helpers, 'isXenonRunning').returns(hubAnswer.promise);
    const post = sinon.stub(NodeDevices.prototype, 'postDevicesToHub').resolves();

    expect(await settlesSoon(boot(4725, { hub: HUB }))).to.equal(true);

    expect(table.row('node-phone')).to.include({ host: NODE });
    expect(alive.calledWith(HUB)).to.equal(true);
    expect(post.called).to.equal(false);

    hubAnswer.resolve(true);
    await waitUntil(() => post.called, { timeout: 2_000 });
    expect(post.firstCall.args[1]).to.equal('add');
    expect((post.firstCall.args[0] as IDevice[]).map((d) => d.udid)).to.deep.equal(['node-phone']);
  });

  it("a node's report that fails is logged, and never fails the start", async () => {
    seed([]);
    sinon.stub(deviceUtils, 'reportDevicesToHub').rejects(new Error('hub refused'));
    const warn = sinon.spy((Container.get(ServerManager) as any).logger, 'warn');
    const unhandled = sinon.spy();
    process.on('unhandledRejection', unhandled);
    try {
      await boot(4725, { hub: HUB });
      await waitUntil(() => warn.called, { timeout: 2_000 });
      expect(String(warn.firstCall.args[0])).to.include('hub refused');
      await new Promise((r) => setImmediate(r));
      expect(unhandled.called).to.equal(false);
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
