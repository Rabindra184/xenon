import 'reflect-metadata';
import { EventEmitter } from 'events';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import { useScratchDatabase } from '../helpers/scratch-database';
import { saveRegistrations } from '../helpers/container-registration';
import { OWN_NODE_ID } from '../helpers/own-node-id';
import GridRouter from '../../src/app/routers/grid';
import reservationRouter from '../../src/app/routers/reservation';
import { prisma } from '../../src/prisma';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import {
  addNewDevice,
  cleanExpiredReservations,
  removeDevice,
} from '../../src/data-service/device-service';
import { removeStaleDevices, updateDeviceList } from '../../src/device-utils';
import * as helpers from '../../src/helpers';
import AndroidDeviceManager from '../../src/device-managers/AndroidDeviceManager';
import { IOSDiscoveryService } from '../../src/device-managers/ios/IOSDiscoveryService';
import { IosTracker } from '../../src/device-managers/iOSTracker';
import { XenonManager } from '../../src/device-managers';
import { localDeviceHosts } from '../../src/device-managers/localDeviceHosts';
import { resetDevicesAtBoot } from '../../src/data-service/deviceSettings';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { IDevice } from '../../src/interfaces/IDevice';
import { SocketServer } from '../../src/services/SocketServer';
import { NotificationService } from '../../src/services/NotificationService';
import { TeamService } from '../../src/services/TeamService';

/**
 * A phone's Device row is deleted whenever the phone goes: unplugged,
 * rebooted, offline or unauthorized in adb, an iPhone detached, a simulator
 * no longer reported, a restart of the server, and on a hub its node gone or
 * missing one health probe. The row was the only place an admin's settings
 * for the phone lived (team, tags, maintenance, reservation), so each of
 * those reset them. A team is a device boundary: a team's phone came back in
 * the shared pool, visible to every member.
 *
 * These run the real PrismaDeviceStore on a scratch database.
 */

const IP = '10.0.0.1';
const OWN = `http://${IP}:4723`;
const NODE = `http://${IP}:4725`;
const UDID = 'R5CT32ABCDE';
const HOUR = 60 * 60 * 1000;

const ADMIN = { userId: 'usr_admin', role: 'ADMIN', scopes: 'admin,devices,sessions,read' };
const MEMBER = {
  userId: 'usr_member',
  role: 'MEMBER',
  scopes: 'devices,sessions,read',
  teamIds: [] as string[],
};

const phone = (udid: string, host = OWN, over: Partial<IDevice> = {}): IDevice =>
  ({
    udid,
    host,
    name: `Phone ${udid}`,
    platform: 'android',
    deviceType: 'real',
    realDevice: true,
    state: 'device',
    sdk: '14',
    busy: false,
    userBlocked: false,
    totalUtilizationTimeMilliSec: 0,
    sessionStartTime: 0,
    nodeId: host === OWN ? OWN_NODE_ID : 'node-1',
    ...over,
  }) as IDevice;

function appAs(caller: Record<string, unknown>, args: IPluginArgs) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { kind: 'user-session', rateLimit: 1000, ...caller };
    next();
  });
  const router = express.Router();
  GridRouter.register(router, args);
  router.use('/reservation', reservationRouter);
  app.use(router);
  return app;
}

describe('An admin’s settings for a phone outlive its Device row', () => {
  const scratch = useScratchDatabase();
  let args: IPluginArgs;
  let context: PluginContext;
  let savedContext: Partial<PluginContext>;
  let savedStore: unknown;
  let restoreContainer: () => void;
  let events: Array<{ event: string; data: any; scope: any }>;
  let discover: (known: IDevice[]) => Promise<IDevice[]>;
  let usbmux: EventEmitter;

  const local = () => localDeviceHosts(args, 4723);
  const admin = () => appAs(ADMIN, args);
  const member = () => appAs(MEMBER, args);
  const row = (udid = UDID, host = OWN) => DeviceStoreFactory.getStore().findDevice({ udid, host });

  /** Team, tags and maintenance, through the routes the dashboard calls. */
  async function configure(udid = UDID, host = OWN) {
    const team = await request(admin()).put(`/device/${udid}/team`).send({ teamId: 'team-a' });
    expect(team.status, JSON.stringify(team.body)).to.equal(200);
    const tags = await request(admin())
      .post('/device/tags')
      .send({ udid, host, tags: ['lab-1', 'smoke'] });
    expect(tags.status, JSON.stringify(tags.body)).to.equal(200);
    const block = await request(admin()).post('/block').send({ udid, host });
    expect(block.status, JSON.stringify(block.body)).to.equal(200);
  }

  function expectConfigured(device: IDevice | null) {
    expect(device, 'the phone is back').to.not.equal(null);
    expect(device).to.include({ teamId: 'team-a', userBlocked: true });
    expect(device?.tags).to.deep.equal(['lab-1', 'smoke']);
  }

  beforeEach(async () => {
    events = [];
    discover = async () => [];
    usbmux = new EventEmitter();
    restoreContainer = saveRegistrations(
      SocketServer,
      NotificationService,
      XenonManager,
      IosTracker,
    );
    Container.set({
      id: SocketServer,
      value: {
        emitToDashboard: () => undefined,
        emitToDashboardForDevices: async (event: string, data: any, scope: any) => {
          events.push({ event, data, scope });
        },
        hasScopedDashboard: () => false,
      },
    });
    Container.set({ id: NotificationService, value: { dispatchEvent: async () => undefined } });
    Container.set({
      id: XenonManager,
      value: { getDevices: (known: IDevice[]) => discover(known) },
    });
    Container.set({ id: IosTracker, value: { getListener: () => usbmux } });

    args = { ...DefaultPluginArgs, bindHostOrIp: IP } as IPluginArgs;
    context = Container.get(PluginContext);
    savedContext = { ...context };
    context.setContext(args, 4723, OWN_NODE_ID, '');
    savedStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();

    await scratch.db.deviceSetting.deleteMany({});
    await scratch.db.device.deleteMany({});
    await scratch.db.team.deleteMany({});
    await scratch.db.team.create({ data: { id: 'team-a', name: 'Team A' } });
    await scratch.db.team.create({ data: { id: 'team-b', name: 'Team B' } });
  });

  afterEach(() => {
    (DeviceStoreFactory as any)._deviceStore = savedStore;
    Object.assign(context, savedContext);
    sinon.restore();
    restoreContainer();
  });

  describe('on this server’s own phones', () => {
    it('keeps them when the phone is unplugged and plugged back in', async () => {
      await addNewDevice([phone(UDID)]);
      await configure();

      await removeDevice([{ udid: UDID, host: OWN }]);
      expect(await row()).to.equal(null);
      await addNewDevice([phone(UDID)]);

      expectConfigured(await row());
    });

    it('keeps them when adb reports the phone offline, then back', async () => {
      const manager = new AndroidDeviceManager(context);
      sinon.stub(manager as any, 'waitBootComplete').resolves();
      sinon.stub(manager as any, 'isRealDevice').resolves(true);
      sinon.stub(manager as any, 'deviceInfo').callsFake(async (d: any) => phone(d.udid));
      const tracker = new EventEmitter();
      await manager.createLocalAdbTracker(tracker as any, {} as any)();
      const change = tracker.listeners('change')[0] as (d: object) => Promise<void>;

      await change({ id: UDID, type: 'device' });
      await configure();
      await change({ id: UDID, type: 'offline' });
      expect(await row()).to.equal(null);
      await change({ id: UDID, type: 'device' });

      expectConfigured(await row());
    });

    it('keeps them when an iPhone is detached and attached again', async () => {
      const ios = new IOSDiscoveryService(context);
      sinon
        .stub(ios as any, 'getDeviceInfo')
        .callsFake(async (udid: any) => phone(udid, OWN, { platform: 'ios' as any }));
      ios.trackIOSDevices();
      const attached = usbmux.listeners('attached')[0] as (udid: string) => Promise<void>;
      const detached = usbmux.listeners('detached')[0] as (udid: string) => Promise<void>;

      await attached('iphone-1');
      await configure('iphone-1');
      await detached('iphone-1');
      expect(await row('iphone-1')).to.equal(null);
      await attached('iphone-1');

      expectConfigured(await row('iphone-1'));
    });

    it('keeps them when discovery stops reporting the phone, then reports it again', async () => {
      const sim = phone('sim-1', OWN, { platform: 'ios' as any, deviceType: 'simulator' });
      discover = async () => [sim];
      await updateDeviceList(local());
      await configure('sim-1');

      discover = async () => []; // shut down, with bootedSimulators on
      await updateDeviceList(local());
      expect(await row('sim-1')).to.equal(null);
      discover = async () => [sim];
      await updateDeviceList(local());

      expectConfigured(await row('sim-1'));
    });

    it('keeps them across a restart of the server', async () => {
      await addNewDevice([phone(UDID)]);
      await configure();

      await resetDevicesAtBoot(DeviceStoreFactory.getStore(), args, local());
      expect(await row()).to.equal(null);
      discover = async () => [phone(UDID)];
      await updateDeviceList(local());

      expectConfigured(await row());
    });

    it('saves, at the first start after an upgrade, the settings rows kept only on the row', async () => {
      // Written before this change: the settings live on the row alone.
      await scratch.db.device.create({
        data: {
          udid: UDID,
          host: OWN,
          nodeId: 'the-previous-boot',
          platform: 'android',
          teamId: 'team-a',
          tags: JSON.stringify(['lab-1', 'smoke']),
          userBlocked: true,
        },
      });

      await resetDevicesAtBoot(DeviceStoreFactory.getStore(), args, local());
      expect(await row()).to.equal(null);
      await addNewDevice([phone(UDID)]);

      expectConfigured(await row());
    });

    it('starts the phone in its team in the same write: a member never sees it in between', async () => {
      await addNewDevice([phone(UDID)]);
      await configure();
      await removeDevice([{ udid: UDID, host: OWN }]);

      // useScratchDatabase stubs the delegate already: read its calls.
      const upsert = prisma.device.upsert as unknown as sinon.SinonStub;
      upsert.resetHistory();
      events = [];
      await addNewDevice([phone(UDID)]);

      // The row is created with its team: no later write puts it there.
      expect(upsert.callCount).to.equal(1);
      expect((upsert.firstCall.args[0] as any).create).to.include({ teamId: 'team-a' });
      // The dashboards that may see it are told, and only those.
      const added = events.find((e) => e.event === 'device_added');
      expect(added?.scope).to.deep.equal({ udid: UDID, teamId: 'team-a' });
      // A member of no team doesn't get it from the device list.
      const list = await request(member()).get('/devices');
      expect(list.status).to.equal(200);
      expect(list.body.map((d: IDevice) => d.udid)).to.not.include(UDID);
    });

    it('keeps a reservation until it ends, and not after', async () => {
      await addNewDevice([phone(UDID), phone('other')]);
      for (const udid of [UDID, 'other']) {
        const r = await request(admin())
          .post('/reservation')
          .send({ udid, host: OWN, reservedBy: 'Dana', duration: '1h', reason: 'release' });
        expect(r.status, JSON.stringify(r.body)).to.equal(200);
      }
      // 'other' ends while it is unplugged.
      await removeDevice([
        { udid: UDID, host: OWN },
        { udid: 'other', host: OWN },
      ]);
      const now = Date.now();
      sinon.stub(Date, 'now').returns(now + 30 * 60 * 1000);
      await addNewDevice([phone(UDID)]);
      (Date.now as sinon.SinonStub).returns(now + 2 * HOUR);
      await addNewDevice([phone('other')]);

      expect(await row()).to.include({
        reservedBy: 'Dana',
        reservedByUserId: 'usr_admin',
        reservationReason: 'release',
      });
      expect((await row())?.reservedUntil).to.be.closeTo(now + HOUR, 5_000);
      const other = await row('other');
      expect(other?.reservedBy ?? null).to.equal(null);
      expect(other?.reservedUntil ?? null).to.equal(null);
    });

    it('keeps what was cleared cleared', async () => {
      await addNewDevice([phone(UDID)]);
      await configure();
      expect(
        (await request(admin()).put(`/device/${UDID}/team`).send({ teamId: null })).status,
      ).to.equal(200);
      expect(
        (await request(admin()).post('/device/tags').send({ udid: UDID, host: OWN, tags: [] }))
          .status,
      ).to.equal(200);
      expect(
        (await request(admin()).post('/unblock').send({ udid: UDID, host: OWN })).status,
      ).to.equal(200);

      await removeDevice([{ udid: UDID, host: OWN }]);
      await addNewDevice([phone(UDID)]);

      const back = await row();
      expect(back?.teamId ?? null).to.equal(null);
      expect(back?.userBlocked).to.equal(false);
      expect(back?.tags ?? []).to.deep.equal([]);
    });
  });

  describe('on a hub, for a node’s phones', () => {
    const report = (over: Partial<IDevice> = {}) =>
      request(admin())
        .post('/register?type=add')
        .send([phone('node-phone', NODE, over)]);

    it('keeps them when the node unregisters and registers again', async () => {
      expect((await report()).status).to.equal(200);
      await configure('node-phone', NODE);

      const gone = await request(admin()).post(
        `/register?type=unregister&host=${encodeURIComponent(NODE)}&nodeId=node-1`,
      );
      expect(gone.status).to.equal(200);
      expect(await row('node-phone', NODE)).to.equal(null);
      expect((await report()).status).to.equal(200);

      expectConfigured(await row('node-phone', NODE));
    });

    it('keeps them when the node misses a health probe', async () => {
      expect((await report()).status).to.equal(200);
      await configure('node-phone', NODE);

      sinon.stub(helpers, 'isXenonRunning').resolves(false);
      await removeStaleDevices(local());
      expect(await row('node-phone', NODE)).to.equal(null);
      expect((await report()).status).to.equal(200);

      expectConfigured(await row('node-phone', NODE));
    });

    it('takes no setting from the node’s report, on a new row or a known one', async () => {
      const own = { teamId: 'team-b', tags: ['from-node'], userBlocked: true } as Partial<IDevice>;
      expect((await report(own)).status).to.equal(200);
      let hubRow = await row('node-phone', NODE);
      expect(hubRow?.teamId ?? null).to.equal(null);
      expect(hubRow?.userBlocked).to.equal(false);

      await configure('node-phone', NODE);
      await request(admin()).post('/unblock').send({ udid: 'node-phone', host: NODE });
      await request(admin()).post(
        `/register?type=unregister&host=${encodeURIComponent(NODE)}&nodeId=node-1`,
      );
      expect((await report(own)).status).to.equal(200);

      hubRow = await row('node-phone', NODE);
      expect(hubRow).to.include({ teamId: 'team-a', userBlocked: false });
      expect(hubRow?.tags).to.deep.equal(['lab-1', 'smoke']);
    });

    it('never gives a node’s phone the settings of the hub’s own phone with that udid', async () => {
      // emulator-5554 is on every machine that runs an emulator.
      await addNewDevice([phone('emulator-5554')]);
      await request(admin())
        .post('/device/tags')
        .send({ udid: 'emulator-5554', host: OWN, tags: ['hub-only'] });
      await request(admin()).post('/block').send({ udid: 'emulator-5554', host: OWN });

      const r = await request(admin())
        .post('/register?type=add')
        .send([phone('emulator-5554', NODE)]);
      expect(r.status).to.equal(200);

      const nodeRow = await row('emulator-5554', NODE);
      expect(nodeRow?.userBlocked).to.equal(false);
      expect(nodeRow?.tags ?? null).to.equal(null);
    });

    it('keeps them across a restart of the hub, which keeps its nodes’ phones', async () => {
      expect((await report()).status).to.equal(200);
      await configure('node-phone', NODE);

      await resetDevicesAtBoot(DeviceStoreFactory.getStore(), args, local());

      expectConfigured(await row('node-phone', NODE));
    });
  });

  describe('what the dashboard and the API save', () => {
    const saved = (udid = UDID, host = OWN) =>
      scratch.db.deviceSetting.findUnique({ where: { udid_host: { udid, host } } });

    it('saves a team on every phone of the udid, connected or not', async () => {
      await addNewDevice([phone(UDID), phone(UDID, NODE)]);
      await scratch.db.deviceSetting.create({ data: { udid: UDID, host: 'http://10.0.0.9:4723' } });

      const r = await request(admin()).put(`/device/${UDID}/team`).send({ teamId: 'team-a' });

      expect(r.status).to.equal(200);
      expect(r.body).to.deep.equal({ ok: true, updated: 3 });
      for (const host of [OWN, NODE, 'http://10.0.0.9:4723']) {
        expect(await saved(UDID, host), host).to.include({ teamId: 'team-a' });
      }
      expect(await row(UDID, OWN)).to.include({ teamId: 'team-a' });
      expect(await row(UDID, NODE)).to.include({ teamId: 'team-a' });
    });

    it('answers 404 for a udid it has neither a row nor saved settings for', async () => {
      const r = await request(admin()).put('/device/nobody/team').send({ teamId: 'team-a' });

      expect(r.status).to.equal(404);
      expect(await scratch.db.deviceSetting.count()).to.equal(0);
    });

    it('saves tags and maintenance on the phone named, and only for a phone it has', async () => {
      await addNewDevice([phone(UDID), phone(UDID, NODE)]);

      await request(admin())
        .post('/device/tags')
        .send({ udid: UDID, host: OWN, tags: ['lab-1'] });
      await request(admin()).post('/block').send({ udid: UDID, host: OWN });
      const unknown = await request(admin())
        .post('/device/tags')
        .send({ udid: 'nobody', host: OWN, tags: ['x'] });

      expect(await saved()).to.include({ tags: '["lab-1"]', userBlocked: true, teamId: null });
      expect(await saved(UDID, NODE)).to.equal(null);
      expect(unknown.status).to.equal(404);
      expect(await saved('nobody')).to.equal(null);

      await request(admin()).post('/unblock').send({ udid: UDID, host: OWN });
      expect(await saved()).to.include({ tags: '["lab-1"]', userBlocked: false });
    });

    it('saves a reservation, its extension and its release', async () => {
      await addNewDevice([phone(UDID)]);
      const host = encodeURIComponent(OWN);

      await request(member())
        .post('/reservation')
        .send({ udid: UDID, host: OWN, reservedBy: 'Dana', duration: '1h', reason: 'release' });
      const taken = await saved();
      expect(taken).to.include({
        reservedBy: 'Dana',
        reservedByUserId: 'usr_member',
        reservationReason: 'release',
      });

      await request(member()).post(`/reservation/${UDID}/${host}/extend`).send({ duration: '1h' });
      expect((await saved())?.reservedUntil).to.be.closeTo(
        Number(taken?.reservedUntil) + HOUR,
        1_000,
      );

      await request(member()).delete(`/reservation/${UDID}/${host}`);
      expect(await saved()).to.include({
        reservedBy: null,
        reservedByUserId: null,
        reservedUntil: null,
        reservationReason: null,
      });
    });

    it('clears a reservation the sweep ends', async () => {
      await addNewDevice([phone(UDID)]);
      await request(member())
        .post('/reservation')
        .send({ udid: UDID, host: OWN, reservedBy: 'Dana', duration: '1h' });
      const later = Date.now() + 2 * HOUR;
      sinon.stub(Date, 'now').returns(later);

      await cleanExpiredReservations();

      expect(await saved()).to.include({ reservedBy: null, reservedUntil: null });
    });
  });

  describe('a setting saved while the phone’s row is being made', () => {
    it('is on the new row, and in its event, though it came after the row read the settings', async () => {
      await addNewDevice([phone(UDID)]);
      await configure();
      await removeDevice([{ udid: UDID, host: OWN }]);
      // An admin moves the phone to team B after addDevices read its saved
      // settings and before it created the row: the row isn't there to write.
      const upsert = prisma.device.upsert as unknown as sinon.SinonStub;
      upsert.callsFake(async (call: any) => {
        await DeviceStoreFactory.getStore().updateDevice(UDID, OWN, { teamId: 'team-b' });
        return scratch.db.device.upsert(call);
      });
      events = [];

      await addNewDevice([phone(UDID)]);

      expect(await row()).to.include({ teamId: 'team-b', userBlocked: true });
      const added = events.find((e) => e.event === 'device_added');
      expect(added?.scope).to.deep.equal({ udid: UDID, teamId: 'team-b' });
    });
  });

  describe('removeDevicesFromDatabaseBeforeRunningThePlugin', () => {
    it('forgets the saved settings of this server’s own phones at start, and keeps its nodes’', async () => {
      await addNewDevice([phone(UDID)]);
      await configure();
      expect(
        (
          await request(admin())
            .post('/register?type=add')
            .send([phone('node-phone', NODE)])
        ).status,
      ).to.equal(200);
      await configure('node-phone', NODE);

      await resetDevicesAtBoot(
        DeviceStoreFactory.getStore(),
        { ...args, removeDevicesFromDatabaseBeforeRunningThePlugin: true },
        local(),
      );
      await addNewDevice([phone(UDID)]);

      const own = await row();
      expect(own?.teamId ?? null).to.equal(null);
      expect(own?.userBlocked).to.equal(false);
      expect(own?.tags ?? null).to.equal(null);
      expectConfigured(await row('node-phone', NODE));
      expect(
        await scratch.db.deviceSetting.findMany({ select: { udid: true, host: true } }),
      ).to.deep.equal([{ udid: 'node-phone', host: NODE }]);
    });

    it('on a node, forgets those of every phone, as it clears every phone', async () => {
      await addNewDevice([phone(UDID), phone('other', 'http://10.0.0.1:4799')]);
      await request(admin()).post('/block').send({ udid: UDID, host: OWN });
      await request(admin()).post('/block').send({ udid: 'other', host: 'http://10.0.0.1:4799' });

      await resetDevicesAtBoot(
        DeviceStoreFactory.getStore(),
        {
          ...args,
          hub: 'http://10.0.0.2:4723',
          removeDevicesFromDatabaseBeforeRunningThePlugin: true,
        },
        local(),
      );

      expect(await scratch.db.device.count()).to.equal(0);
      expect(await scratch.db.deviceSetting.count()).to.equal(0);
    });
  });
});

describe('Saved phone settings: team deletion', () => {
  const scratch = useScratchDatabase();
  let savedStore: unknown;
  let restoreContainer: () => void;

  beforeEach(async () => {
    restoreContainer = saveRegistrations(SocketServer, NotificationService);
    Container.set({
      id: SocketServer,
      value: {
        emitToDashboard: () => undefined,
        emitToDashboardForDevices: async () => undefined,
        hasScopedDashboard: () => false,
      },
    });
    Container.set({ id: NotificationService, value: { dispatchEvent: async () => undefined } });
    savedStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
    await scratch.db.deviceSetting.deleteMany({});
    await scratch.db.device.deleteMany({});
    await scratch.db.team.deleteMany({});
    await scratch.db.team.create({ data: { id: 'team-a', name: 'Team A' } });
  });

  afterEach(() => {
    (DeviceStoreFactory as any)._deviceStore = savedStore;
    sinon.restore();
    restoreContainer();
  });

  it('refuses to delete a team one of whose phones is not connected now', async () => {
    const args = { ...DefaultPluginArgs, bindHostOrIp: IP } as IPluginArgs;
    await addNewDevice([phone(UDID)]);
    expect(
      (await request(appAs(ADMIN, args)).put(`/device/${UDID}/team`).send({ teamId: 'team-a' }))
        .status,
    ).to.equal(200);
    await removeDevice([{ udid: UDID, host: OWN }]);

    let refusal: Error | undefined;
    try {
      await Container.get(TeamService).delete('team-a');
    } catch (err) {
      refusal = err as Error;
    }
    expect(refusal?.message).to.match(/1 device\(s\) \(1 not connected now\)/);
    expect(await scratch.db.team.count({ where: { id: 'team-a' } })).to.equal(1);

    // The way out: the phone back in the shared pool, by its udid.
    const back = await request(appAs(ADMIN, args))
      .put(`/device/${UDID}/team`)
      .send({ teamId: null });
    expect(back.status, JSON.stringify(back.body)).to.equal(200);
    await Container.get(TeamService).delete('team-a');
    expect(await scratch.db.team.count({ where: { id: 'team-a' } })).to.equal(0);
  });
});
