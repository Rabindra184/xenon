import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import { prisma } from '../../src/prisma';
import GridRouter from '../../src/app/routers/grid';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import {
  allocateDeviceForSession,
  releaseBlockedDevices,
  removeStaleDevices,
  updateDeviceList,
} from '../../src/device-utils';
import { localDeviceHosts } from '../../src/device-managers/localDeviceHosts';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { XenonManager } from '../../src/device-managers';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs, IPluginArgs } from '../../src/interfaces/IPluginArgs';
import { SocketServer } from '../../src/services/SocketServer';
import { NotificationService } from '../../src/services/NotificationService';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import { IDevice } from '../../src/interfaces/IDevice';
import * as helpers from '../../src/helpers';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * The hub/node busy race, on a real SQLite database with the migrations
 * applied. A hub keeps its nodes' phones in its own table, from each node's
 * report (`POST /xenon/api/register`, every 30 s by default). The report used
 * to be written whole: a node that had not yet been handed the hub's session
 * said `busy: false` and freed the phone for a second client, and its copy of
 * the team, tags, reservation and block replaced the hub's.
 */

const IP = '192.168.0.104';
const HUB = `http://${IP}:4724`;
const NODE = `http://${IP}:4725`;
const HUB_ID = 'hub-process';
const NODE_ID = 'node-process';
const T0 = Date.UTC(2026, 8, 29, 12, 0, 0);

const nodePhone = (udid: string, over: Record<string, unknown> = {}) => ({
  udid,
  host: NODE,
  nodeId: NODE_ID,
  name: 'Galaxy S9+',
  platform: 'android',
  deviceType: 'real',
  realDevice: true,
  state: 'device',
  sdk: '10',
  offline: false,
  userBlocked: false,
  ...over,
});

const caps = (udid: string) =>
  ({
    alwaysMatch: { platformName: 'Android', 'appium:udid': udid },
    firstMatch: [{}],
  }) as any;

describe('The hub/node busy race', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  let restoreContainer: () => void;
  let savedStore: unknown;
  let context: PluginContext;
  let savedContext: Partial<PluginContext>;
  let clock: sinon.SinonFakeTimers | undefined;
  const pluginArgs = { ...DefaultPluginArgs } as IPluginArgs;

  const app = () => {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => {
      (req as any).auth = {
        kind: 'api-key',
        userId: 'node-user',
        role: 'ADMIN',
        scopes: 'devices',
        rateLimit: 0,
      };
      next();
    });
    GridRouter.register(a as any, pluginArgs);
    return a;
  };

  /** The node's periodic report: its whole row for each phone. */
  const report = async (...phones: Record<string, unknown>[]) => {
    const res = await request(app()).post('/register').query({ type: 'add' }).send(phones);
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
  };

  const row = async (udid: string, host = NODE) =>
    (await scratch.db.device.findFirst({ where: { udid, host } })) as Record<string, any>;

  /** The hub allocates a phone for a create, as prepareSession does. */
  const allocate = (udid: string) =>
    allocateDeviceForSession(caps(udid), 2_000, 50, pluginArgs) as Promise<IDevice>;

  /** The create succeeded: the session is recorded on its phone. */
  const finalize = async (device: IDevice, sessionId: string) => {
    const svc = new SessionLifecycleService();
    sinon.stub(svc as any, 'createSessionInstance').returns({});
    sinon.stub(svc as any, 'applyPostSessionLogic').resolves();
    await (svc as any).finalizeSession(
      { protocol: 'W3C', value: [sessionId, { platformName: 'Android' }, 'W3C'] },
      device,
      caps(device.udid),
      {},
      false,
    );
  };

  const deleteSession = (sessionId: string) =>
    new SessionLifecycleService().deleteSession(async () => null, sessionId);

  /** Let the sweepers' fire-and-forget releases land before looking. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

  beforeEach(async () => {
    restoreContainer = saveRegistrations(
      XenonManager,
      SocketServer,
      NotificationService,
      'LocalStorage',
    );
    Container.set({
      id: XenonManager,
      value: {
        getMaxSessionCount: () => undefined,
        deviceInstances: async () => [],
        getDevices: async () => [],
      },
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
    Container.set({
      id: 'LocalStorage',
      value: { getItem: () => 0, setItem: async () => undefined },
    });
    sinon.stub(DASHBORD_EVENT_MANAGER, 'onSessionStopped').resolves();
    context = Container.get(PluginContext);
    savedContext = { nodeId: context.nodeId, pluginArgs: context.pluginArgs };
    context.nodeId = HUB_ID;
    context.pluginArgs = pluginArgs;
    savedStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
    await scratch.db.device.deleteMany({});
    await scratch.db.team.deleteMany({});
  });

  afterEach(() => {
    clock?.restore();
    clock = undefined;
    (DeviceStoreFactory as any)._deviceStore = savedStore;
    Object.assign(context, savedContext);
    sinon.restore();
    restoreContainer();
  });

  describe("a node's report while the hub holds a claim", () => {
    it('leaves the phone busy while the session is created, and while it runs', async () => {
      await scratch.db.device.create({ data: nodePhone('s9') as any });

      const device = await allocate('s9');
      // The node hasn't been handed the create yet: free, as far as it knows.
      await report(nodePhone('s9', { busy: false }));
      expect(await row('s9')).to.include({ busy: true });

      await finalize(device, 'hub-session-1');
      await report(nodePhone('s9', { busy: false, session_id: null }));
      expect(await row('s9')).to.include({ busy: true, session_id: 'hub-session-1' });

      // A second client can't be given the phone.
      let second: unknown;
      try {
        second = await allocateDeviceForSession(caps('s9'), 200, 50, pluginArgs);
      } catch (err) {
        second = err;
      }
      expect(second).to.be.an('error');
    });

    it('keeps the phone busy after the hub ends its claim while the node still reports it busy', async () => {
      await scratch.db.device.create({ data: nodePhone('s9') as any });
      const device = await allocate('s9');
      await finalize(device, 'hub-session-1');
      await report(nodePhone('s9', { busy: true, session_id: 'hub-session-1' }));

      await deleteSession('hub-session-1');
      expect(await row('s9')).to.include({ busy: true, nodeBusy: true, session_id: null });

      await report(nodePhone('s9', { busy: false, session_id: null }));
      expect(await row('s9')).to.include({ busy: false, nodeBusy: false });
    });

    it('keeps a hold the hub took (a preview, a recording) when the node reports the phone free', async () => {
      await scratch.db.device.create({
        data: nodePhone('s9', { busy: true, session_id: 'manual_u1_s9' }) as any,
      });

      await report(nodePhone('s9', { busy: false, session_id: null }));
      expect(await row('s9')).to.include({
        busy: true,
        nodeBusy: false,
        session_id: 'manual_u1_s9',
      });
    });

    it("counts a node's own busy with no claim, and frees it when the node does", async () => {
      await scratch.db.device.create({ data: nodePhone('s9') as any });

      await report(nodePhone('s9', { busy: true, session_id: 'node-local' }));
      expect(await row('s9')).to.include({ busy: true, nodeBusy: true });

      await report(nodePhone('s9', { busy: false, session_id: null }));
      expect(await row('s9')).to.include({ busy: false, nodeBusy: false });
    });
  });

  describe("a node's report and the settings the hub owns", () => {
    it('never overwrites the team, tags, reservation or block', async () => {
      const team = await scratch.db.team.create({ data: { name: 'Payments' } });
      const reservedUntil = Date.now() + 3_600_000;
      await scratch.db.device.create({
        data: {
          ...(nodePhone('s9') as any),
          teamId: team.id,
          tags: JSON.stringify(['smoke']),
          userBlocked: true,
          reservedBy: 'alice',
          reservedUntil,
          reservationReason: 'release check',
        },
      });

      // The node's copy of the row: none of the hub's settings.
      await report(
        nodePhone('s9', {
          busy: false,
          sdk: '11',
          teamId: null,
          tags: [],
          userBlocked: false,
          reservedBy: null,
          reservedUntil: null,
          reservationReason: null,
        }),
      );

      expect(await row('s9')).to.include({
        sdk: '11',
        teamId: team.id,
        tags: JSON.stringify(['smoke']),
        userBlocked: true,
        reservedBy: 'alice',
        reservedUntil,
        reservationReason: 'release check',
      });
    });
  });

  describe('a release for an ended session', () => {
    it("doesn't free a phone another session has claimed since", async () => {
      await scratch.db.device.create({ data: nodePhone('s9') as any });
      const svc = new SessionLifecycleService();

      // Create A takes the phone, and stalls.
      const a = await allocate('s9');
      // Its claim is given up (a timeout), and create B takes the phone.
      await scratch.db.device.updateMany({
        where: { udid: 's9' },
        data: { busy: false, lastCmdExecutedAt: null },
      });
      const b = await allocate('s9');
      await finalize(b, 'session-b');

      // Create A fails at last and gives its phone back.
      await svc.releaseAllocation({ device: a, pendingSessionId: 'pending-a' } as any);

      expect(await row('s9')).to.include({ busy: true, session_id: 'session-b' });
    });

    it("doesn't free a same-machine hub's row for the same udid", async () => {
      await scratch.db.device.create({ data: nodePhone('s9') as any });
      await scratch.db.device.create({
        data: { ...(nodePhone('s9') as any), host: HUB, nodeId: HUB_ID },
      });
      const svc = new SessionLifecycleService();

      // Two creates for the udid: one gets each row.
      const running = await allocate('s9');
      await finalize(running, 'session-running');
      const failing = await allocate('s9');
      expect([running.host, failing.host]).to.have.members([HUB, NODE]);

      // The second create fails and gives its phone back.
      await svc.releaseAllocation({ device: failing, pendingSessionId: 'pending' } as any);

      expect(await row('s9', failing.host)).to.include({ busy: false });
      expect(await row('s9', running.host)).to.include({
        busy: true,
        session_id: 'session-running',
      });
    });
  });

  describe('a claim still being created, and the idle sweeper', () => {
    it('is not idle at the new-command timeout, and is freed at its own timeout', async () => {
      clock = sinon.useFakeTimers({ now: T0, toFake: ['Date'] });
      await scratch.db.device.create({ data: nodePhone('s9') as any });
      await allocate('s9');

      // A first driver install: two minutes, past the 60 s new-command timeout.
      clock.setSystemTime(T0 + 120_000);
      await releaseBlockedDevices(60);
      await settle();
      expect(await row('s9')).to.include({ busy: true });

      // A create that never finished.
      clock.setSystemTime(T0 + 11 * 60_000);
      await releaseBlockedDevices(60);
      await settle();
      expect(await row('s9')).to.include({ busy: false });
    });

    it('frees a created session that went idle, as before', async () => {
      clock = sinon.useFakeTimers({ now: T0, toFake: ['Date'] });
      await scratch.db.device.create({ data: nodePhone('s9') as any });
      await finalize(await allocate('s9'), 'idle-session');

      clock.setSystemTime(T0 + 120_000);
      await releaseBlockedDevices(60);
      await settle();
      expect(await row('s9')).to.include({ busy: false, session_id: null });
    });
  });

  describe('a release racing a new claim', () => {
    it('a release that read the phone before its next claim leaves that claim alone', async () => {
      clock = sinon.useFakeTimers({ now: T0, toFake: ['Date'] });
      await scratch.db.device.create({ data: nodePhone('s9') as any });
      await finalize(await allocate('s9'), 'session-a');
      clock.setSystemTime(T0 + 120_000);

      // The idle sweeper reads the phone with session A on it. Before it
      // writes, A is deleted and session B claims the phone.
      const findMany = prisma.device.findMany as unknown as sinon.SinonStub;
      let interleaved = false;
      findMany.callsFake(async (args: any) => {
        const rows = await scratch.db.device.findMany(args);
        if (!interleaved && !args?.where) {
          interleaved = true;
          await deleteSession('session-a');
          await finalize(await allocate('s9'), 'session-b');
        }
        return rows;
      });

      await releaseBlockedDevices(60);
      await settle();

      expect(interleaved).to.equal(true);
      expect(await row('s9')).to.include({ busy: true, session_id: 'session-b' });
    });

    it('two releases of one session leave the next claim alone', async () => {
      await scratch.db.device.create({ data: nodePhone('s9') as any });
      await finalize(await allocate('s9'), 'session-a');

      await Promise.all([deleteSession('session-a'), deleteSession('session-a')]);
      await finalize(await allocate('s9'), 'session-b');
      await deleteSession('session-a');

      expect(await row('s9')).to.include({ busy: true, session_id: 'session-b' });
    });
  });

  describe('stale cleanup of node phones', () => {
    // The hub also files iPhones under a bare remoteMachineProxyIP, and so
    // does the node: the node's iPhone has a host the hub calls its own.
    const hubHosts = localDeviceHosts(
      { bindHostOrIp: IP, remoteMachineProxyIP: '203.0.113.7' },
      4724,
    );
    const nodeIphone = () =>
      nodePhone('iphone', { host: '203.0.113.7', platform: 'ios', deviceType: 'real' }) as any;

    it("the hub's local sync never prunes a phone carrying the node's id", async () => {
      await scratch.db.device.create({ data: nodeIphone() });
      await scratch.db.device.create({
        data: { ...(nodePhone('gone') as any), host: HUB, nodeId: HUB_ID },
      });

      await updateDeviceList(hubHosts);

      expect(await row('iphone', '203.0.113.7')).to.include({ nodeId: NODE_ID });
      expect(await row('gone', HUB)).to.equal(null);
    });

    it("drops the node's phones with the node, keyed on its id", async () => {
      await scratch.db.device.create({ data: nodeIphone() });
      await scratch.db.device.create({ data: nodePhone('s9') as any });
      await scratch.db.device.create({
        data: { ...(nodePhone('hub-phone') as any), host: HUB, nodeId: HUB_ID },
      });
      const alive = sinon.stub(helpers, 'isXenonRunning').callsFake(async (host) => host === NODE);

      await removeStaleDevices(hubHosts);
      expect(await row('iphone', '203.0.113.7'), 'kept while its node answers').to.not.equal(null);
      expect(await row('s9')).to.not.equal(null);

      alive.callsFake(async () => false);
      await removeStaleDevices(hubHosts);
      expect(await row('iphone', '203.0.113.7'), 'dropped with its node').to.equal(null);
      expect(await row('s9')).to.equal(null);
      expect(await row('hub-phone', HUB), "the hub's own").to.not.equal(null);
      expect(alive.calledWith(HUB)).to.equal(false);
    });
  });

  describe('a standalone server', () => {
    it('allocates, runs and frees its own phone as before', async () => {
      await scratch.db.device.create({
        data: { ...(nodePhone('pixel') as any), host: HUB, nodeId: HUB_ID },
      });

      const device = await allocate('pixel');
      expect(await row('pixel', HUB)).to.include({ busy: true });
      await finalize(device, 'local-session');
      expect(await row('pixel', HUB)).to.include({ busy: true, session_id: 'local-session' });

      await deleteSession('local-session');
      expect(await row('pixel', HUB)).to.include({
        busy: false,
        session_id: null,
        lastCmdExecutedAt: null,
        sessionStartTime: 0,
      });
      expect(await row('pixel', HUB)).to.not.include({ nodeBusy: true });

      // And it can be allocated again.
      await allocate('pixel');
      expect(await row('pixel', HUB)).to.include({ busy: true });
    });
  });
});
