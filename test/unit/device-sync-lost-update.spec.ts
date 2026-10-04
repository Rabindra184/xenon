import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { prisma } from '../../src/prisma';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { addNewDevice, blockDevice } from '../../src/data-service/device-service';
import { updateDeviceList } from '../../src/device-utils';
import { localDeviceHosts } from '../../src/device-managers/localDeviceHosts';
import { XenonManager } from '../../src/device-managers';
import { SocketServer } from '../../src/services/SocketServer';
import { NotificationService } from '../../src/services/NotificationService';
import { IDevice } from '../../src/interfaces/IDevice';
import { saveRegistrations } from '../helpers/container-registration';
import { fakeDeviceSettingTable, fakeDeviceTable, Row } from '../helpers/fake-device-table';

/**
 * The periodic device sync reads every row, runs discovery (seconds of adb or
 * simctl), then writes each phone back. A write that lands in between (a
 * preview's hold, a session's lock, a team change, a stream's port) must
 * survive the sync. On the lab, a sync erased the S9+'s preview hold this way,
 * and stream/stop then had no hold to release.
 *
 * These run the real PrismaDeviceStore against an in-memory device table that
 * follows Prisma's rules: `undefined` leaves a column alone, `null` clears it,
 * and an upsert takes `create` for a new row and `update` for a known one.
 */

const HOST = 'http://127.0.0.1:4723';
const BIND = '127.0.0.1';
const LOCAL = localDeviceHosts({ bindHostOrIp: BIND }, 4723);

/** What AndroidDeviceManager returns for a phone it already knows (~158-166). */
const androidEcho = (known: IDevice): IDevice =>
  ({ ...known, state: 'device', busy: known.busy || false }) as IDevice;

/** What IOSDiscoveryService.getSimulators returns for every simulator, known or not. */
const simulatorAsDiscovered = (over: Partial<IDevice> = {}): IDevice =>
  ({
    udid: 'sim-1',
    name: 'iPhone 16',
    sdk: '18.0',
    state: 'Booted',
    busy: false,
    realDevice: false,
    platform: 'ios',
    deviceType: 'simulator',
    host: HOST,
    totalUtilizationTimeMilliSec: 0,
    sessionStartTime: 0,
    ...over,
  }) as IDevice;

const S9: Row = {
  udid: 's9',
  host: HOST,
  name: 'Galaxy S9+',
  platform: 'android',
  deviceType: 'real',
  realDevice: true,
  state: 'device',
  sdk: '10',
  mjpegServerPort: 9100,
};

describe('Device sync keeps writes made while it ran (lost update)', () => {
  let table: ReturnType<typeof fakeDeviceTable>;
  let emits: Array<[string, any]>;
  let notified: Array<[string, any]>;
  let discover: (known: IDevice[]) => Promise<IDevice[]>;
  let restoreContainer: () => void;
  let savedStore: unknown;

  const seed = (rows: Row[]) => {
    table = fakeDeviceTable(rows);
    for (const m of Object.keys(table.delegate) as Array<keyof typeof table.delegate>) {
      sinon.stub(prisma.device as any, m).callsFake(table.delegate[m] as any);
    }
    // The phones' saved settings (deviceSettings.ts), so none reach a database.
    const settings = fakeDeviceSettingTable();
    for (const m of Object.keys(settings.delegate) as Array<keyof typeof settings.delegate>) {
      sinon.stub(prisma.deviceSetting as any, m).callsFake(settings.delegate[m] as any);
    }
  };

  beforeEach(() => {
    emits = [];
    notified = [];
    restoreContainer = saveRegistrations(XenonManager, SocketServer, NotificationService);
    Container.set({
      id: XenonManager,
      value: { getDevices: (known: IDevice[]) => discover(known) },
    });
    Container.set({
      id: SocketServer,
      value: {
        emitToDashboard: (event: string, data: any) => emits.push([event, data]),
        emitToDashboardForDevices: async (event: string, data: any) => {
          emits.push([event, data]);
        },
        hasScopedDashboard: () => false,
      },
    });
    Container.set({
      id: NotificationService,
      value: { dispatchEvent: async (event: string, data: any) => notified.push([event, data]) },
    });
    sinon.stub(prisma.lease as any, 'findMany').resolves([]);
    savedStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
  });

  afterEach(() => {
    (DeviceStoreFactory as any)._deviceStore = savedStore;
    sinon.restore();
    restoreContainer();
  });

  it('keeps a preview hold taken while discovery ran', async () => {
    seed([S9]);
    discover = async (known) => {
      await blockDevice('s9', HOST, 'manual_user-1_s9');
      return known.map(androidEcho);
    };

    await updateDeviceList(LOCAL);

    expect(table.row('s9')).to.include({ busy: true, session_id: 'manual_user-1_s9' });
  });

  it('keeps a session lock taken while discovery ran, so the phone is not handed out twice', async () => {
    seed([S9]);
    discover = async (known) => {
      const locked = await DeviceStoreFactory.getStore().findAndLockDevice({
        platform: 'android',
      } as any);
      expect(locked?.udid).to.equal('s9');
      return known.map(androidEcho);
    };

    await updateDeviceList(LOCAL);

    expect(table.row('s9')).to.include({ busy: true });
    const second = await DeviceStoreFactory.getStore().findAndLockDevice({
      platform: 'android',
    } as any);
    expect(second).to.equal(null);
  });

  it('keeps a team change made while discovery ran', async () => {
    seed([S9]);
    discover = async (known) => {
      await DeviceStoreFactory.getStore().updateDevice('s9', HOST, { teamId: 'team-b' } as any);
      return known.map(androidEcho);
    };

    await updateDeviceList(LOCAL);

    expect(table.row('s9')).to.include({ teamId: 'team-b' });
  });

  it("keeps a stream's port written while discovery ran", async () => {
    seed([S9]);
    discover = async (known) => {
      await DeviceStoreFactory.getStore().updateDevice('s9', HOST, { mjpegServerPort: 9200 });
      return known.map(androidEcho);
    };

    await updateDeviceList(LOCAL);

    expect(table.row('s9')).to.include({ mjpegServerPort: 9200 });
  });

  it('leaves a simulator in a session busy, though discovery always reports it free', async () => {
    seed([
      {
        udid: 'sim-1',
        host: HOST,
        name: 'iPhone 16',
        platform: 'ios',
        deviceType: 'simulator',
        realDevice: false,
        state: 'Booted',
        busy: true,
        session_id: 'sess-1',
        sessionStartTime: 1234,
        totalUtilizationTimeMilliSec: 5000,
      },
    ]);
    discover = async () => [simulatorAsDiscovered()];

    await updateDeviceList(LOCAL);

    expect(table.row('sim-1')).to.include({
      busy: true,
      session_id: 'sess-1',
      sessionStartTime: 1234,
      totalUtilizationTimeMilliSec: 5000,
    });
  });

  it('still writes what discovery saw change: simulator state, a new port, a new IP', async () => {
    seed([
      {
        udid: 'sim-1',
        host: HOST,
        name: 'iPhone 16',
        platform: 'ios',
        deviceType: 'simulator',
        realDevice: false,
        state: 'Shutdown',
      },
      {
        udid: 'iphone',
        host: HOST,
        name: 'iPhone',
        platform: 'ios',
        deviceType: 'real',
        realDevice: true,
        state: 'Unknown',
        ip: '10.0.0.5',
      },
    ]);
    discover = async (known) => [
      simulatorAsDiscovered({ state: 'Booted', wdaLocalPort: 8101 }),
      { ...known.find((d) => d.udid === 'iphone'), ip: '10.0.0.9' } as IDevice,
    ];

    await updateDeviceList(LOCAL);

    expect(table.row('sim-1')).to.include({ state: 'Booted', wdaLocalPort: 8101 });
    expect(table.row('iphone')).to.include({ ip: '10.0.0.9' });
  });

  it('announces only a phone that is new', async () => {
    seed([S9]);
    const pixel = { ...S9, udid: 'pixel', name: 'Pixel 8' } as IDevice;
    discover = async (known) => [...known.map(androidEcho), pixel];

    await updateDeviceList(LOCAL);

    expect(emits.filter(([e]) => e === 'device_added').map(([, d]) => d.udid)).to.deep.equal([
      'pixel',
    ]);
    expect(notified.filter(([e]) => e === 'device_new').map(([, d]) => d.udid)).to.deep.equal([
      'pixel',
    ]);
    expect(table.row('pixel')).to.include({ name: 'Pixel 8', busy: false });
  });

  it('a plug-in event for a known phone refreshes its details but does not free it', async () => {
    seed([{ ...S9, busy: true, session_id: 'sess-2', sessionStartTime: 42 }]);

    // What the adb tracker's onDeviceAdded hands addNewDevice: a fresh deviceInfo.
    await addNewDevice(
      [{ ...S9, sdk: '11', busy: false, sessionStartTime: 0, userBlocked: false } as IDevice],
      BIND,
    );

    expect(table.row('s9')).to.include({
      sdk: '11',
      busy: true,
      session_id: 'sess-2',
      sessionStartTime: 42,
    });
    expect(emits.filter(([e]) => e === 'device_added')).to.have.length(0);
  });

  it("the hub takes a node's report of its phone busy as the node's, not a session of its own", async () => {
    seed([{ ...S9, host: 'http://10.0.0.2:4723' }]);

    await addNewDevice(
      [{ ...S9, host: 'http://10.0.0.2:4723', busy: true, session_id: 'node-sess' } as IDevice],
      undefined,
      { nodeReport: true },
    );

    expect(table.row('s9')).to.include({ busy: true, nodeBusy: true, session_id: null });
    expect(emits.filter(([e]) => e === 'device_added')).to.have.length(0);
  });
});

describe('Device sync keeps writes made while it ran, on the Loki test store', () => {
  const LOKI_HOST = 'http://loki-sync-test:4723';
  const LOKI_LOCAL = localDeviceHosts({ bindHostOrIp: 'loki-sync-test' }, 4723);
  const UDIDS = ['loki-s9', 'loki-sim', 'loki-pixel'];
  let emits: Array<[string, any]>;
  let discover: (known: IDevice[]) => Promise<IDevice[]>;
  let restoreContainer: () => void;
  let savedStore: unknown;
  let store: ReturnType<typeof DeviceStoreFactory.getStore>;

  const row = async (udid: string) =>
    (await store.findDevice({ udid, host: LOKI_HOST })) as IDevice;

  beforeEach(async () => {
    emits = [];
    restoreContainer = saveRegistrations(XenonManager, SocketServer, NotificationService);
    Container.set({
      id: XenonManager,
      value: { getDevices: (known: IDevice[]) => discover(known) },
    });
    Container.set({
      id: SocketServer,
      value: {
        emitToDashboard: (event: string, data: any) => emits.push([event, data]),
        emitToDashboardForDevices: async (event: string, data: any) => {
          emits.push([event, data]);
        },
        hasScopedDashboard: () => false,
      },
    });
    Container.set({ id: NotificationService, value: { dispatchEvent: async () => undefined } });
    sinon.stub(prisma.lease as any, 'findMany').resolves([]);
    savedStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = undefined;
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    store = DeviceStoreFactory.getStore();
    process.env.NODE_ENV = env;
    expect(store.constructor.name).to.equal('LokiDeviceStore');
    for (const udid of UDIDS) await store.removeDevices({ udid });
    // Every sync below also prunes phones on this host it didn't discover.
    discover = async (known) => known.filter((d) => d.host === LOKI_HOST).map(androidEcho);
  });

  afterEach(async () => {
    for (const udid of UDIDS) await store.removeDevices({ udid });
    (DeviceStoreFactory as any)._deviceStore = savedStore;
    sinon.restore();
    restoreContainer();
  });

  it('keeps a preview hold taken while discovery ran', async () => {
    await addNewDevice([{ ...S9, udid: 'loki-s9', host: LOKI_HOST } as IDevice]);
    discover = async (known) => {
      await blockDevice('loki-s9', LOKI_HOST, 'manual_user-1_loki-s9');
      return known.filter((d) => d.host === LOKI_HOST).map(androidEcho);
    };

    await updateDeviceList(LOKI_LOCAL);

    expect(await row('loki-s9')).to.include({ busy: true, session_id: 'manual_user-1_loki-s9' });
  });

  it('leaves a simulator in a session busy, and still takes its new state', async () => {
    await addNewDevice([
      simulatorAsDiscovered({ udid: 'loki-sim', host: LOKI_HOST, state: 'Shutdown' }),
    ]);
    await store.updateDevice('loki-sim', LOKI_HOST, { busy: true, session_id: 'sess-1' });
    discover = async () => [
      simulatorAsDiscovered({ udid: 'loki-sim', host: LOKI_HOST, state: 'Booted' }),
    ];

    await updateDeviceList(LOKI_LOCAL);

    expect(await row('loki-sim')).to.include({
      busy: true,
      session_id: 'sess-1',
      state: 'Booted',
    });
  });

  it('a plug-in event for a known phone does not free it, and announces only new phones', async () => {
    await addNewDevice([{ ...S9, udid: 'loki-s9', host: LOKI_HOST } as IDevice]);
    await store.updateDevice('loki-s9', LOKI_HOST, { busy: true, session_id: 'sess-2' });
    emits = [];

    await addNewDevice([
      { ...S9, udid: 'loki-s9', host: LOKI_HOST, busy: false } as IDevice,
      { ...S9, udid: 'loki-pixel', host: LOKI_HOST, name: 'Pixel 8' } as IDevice,
    ]);

    expect(await row('loki-s9')).to.include({ busy: true, session_id: 'sess-2' });
    expect(emits.filter(([e]) => e === 'device_added').map(([, d]) => d.udid)).to.deep.equal([
      'loki-pixel',
    ]);
  });
});
