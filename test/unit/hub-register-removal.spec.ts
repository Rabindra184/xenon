import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { Container } from 'typedi';
import GridRouter from '../../src/app/routers/grid';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { SocketServer } from '../../src/services/SocketServer';
import { NotificationService } from '../../src/services/NotificationService';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * A node asks the hub to forget its phones with `POST /xenon/api/register`:
 * `type=remove` with the phones (one unplugged, or pruned as stale), and
 * `type=unregister&host=` once per host when it shuts down. The hub matched
 * the host of either as a substring whenever it wasn't a URL, and a remove
 * with no host matched the udid alone, so a node (an older one sends its bare
 * IP) could delete the hub's own phones, or another node's. Only the asking
 * node's phones go: by its nodeId when it names one, else by exact host, and
 * never one of the hub's own.
 */
describe('a node’s request to forget its phones, on the hub', () => {
  const scratch = useScratchDatabase();
  const HUB_NODE_ID = 'hub-node-id';
  const HUB = 'http://10.0.0.1:4724';
  const NODE = 'http://10.0.0.1:4725';
  const OTHER_NODE = 'http://10.0.0.1:4726';
  let app: express.Express;
  let context: PluginContext;
  let saved: { context: Partial<PluginContext>; store: unknown };
  let restore: () => void;

  beforeEach(async () => {
    restore = saveRegistrations(SocketServer, NotificationService);
    Container.set({
      id: SocketServer,
      value: {
        emitToDashboard: () => undefined,
        emitToDashboardForDevices: async () => undefined,
        hasScopedDashboard: () => false,
      },
    });
    Container.set({ id: NotificationService, value: { dispatchEvent: async () => undefined } });
    context = Container.get(PluginContext);
    saved = { context: { ...context }, store: (DeviceStoreFactory as any)._deviceStore };
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
    const pluginArgs = { ...DefaultPluginArgs, bindHostOrIp: '10.0.0.1' } as any;
    context.setContext(pluginArgs, 4724, HUB_NODE_ID, '');

    app = express();
    app.use(express.json());
    // The node's per-node key: role ADMIN, scope devices.
    app.use((req: any, _res, next) => {
      req.auth = { userId: 'node-key-owner', role: 'ADMIN', scopes: 'devices' };
      next();
    });
    const router = express.Router();
    GridRouter.register(router, pluginArgs);
    app.use('/xenon/api', router);

    await scratch.db.device.deleteMany({});
    const rows: Array<[string, string, string | null]> = [
      ['emulator-5554', HUB, HUB_NODE_ID],
      ['hub-iphone', HUB, HUB_NODE_ID],
      // The hub's own iPhone, filed under a bare remoteMachineProxyIP.
      ['hub-bare-iphone', '10.0.0.1', HUB_NODE_ID],
      ['emulator-5554', NODE, 'node-1'],
      ['node-phone', NODE, 'node-1'],
      ['node-iphone', '10.0.0.1', 'node-1'],
      ['emulator-5554', OTHER_NODE, 'node-2'],
      ['other-node-phone', OTHER_NODE, 'node-2'],
    ];
    for (const [udid, host, nodeId] of rows) {
      await scratch.db.device.create({
        data: { udid, host, nodeId, platform: 'android', name: udid } as any,
      });
    }
  });

  afterEach(() => {
    Object.assign(context, saved.context);
    (DeviceStoreFactory as any)._deviceStore = saved.store;
    sinon.restore();
    restore();
  });

  const left = async () =>
    (await scratch.db.device.findMany({ select: { udid: true, host: true } }))
      .map((d) => `${d.udid}@${d.host}`)
      .sort();
  const ALL = [
    `emulator-5554@${HUB}`,
    `emulator-5554@${NODE}`,
    `emulator-5554@${OTHER_NODE}`,
    'hub-bare-iphone@10.0.0.1',
    `hub-iphone@${HUB}`,
    'node-iphone@10.0.0.1',
    `node-phone@${NODE}`,
    `other-node-phone@${OTHER_NODE}`,
  ];
  const without = (...gone: string[]) => ALL.filter((row) => !gone.includes(row));

  const register = (type: string, body: unknown, query: Record<string, string> = {}) =>
    request(app)
      .post('/xenon/api/register')
      .query({ type, ...query })
      .send(body as any)
      .expect(200);

  describe('unregister (a node shutting down)', () => {
    it('by the node’s exact host takes its phones there, and nobody else’s', async () => {
      await register('unregister', [], { host: NODE });
      expect(await left()).to.deep.equal(without(`emulator-5554@${NODE}`, `node-phone@${NODE}`));
    });

    it('by a bare IP (an older node) takes only what is filed under exactly it, never the hub’s', async () => {
      await register('unregister', [], { host: '10.0.0.1' });
      expect(await left()).to.deep.equal(without('node-iphone@10.0.0.1'));
    });

    it('naming the hub’s own host takes none of the hub’s phones', async () => {
      await register('unregister', [], { host: HUB });
      expect(await left()).to.deep.equal(ALL);
    });

    it('with the node’s id takes every phone it reported, whatever the host', async () => {
      await register('unregister', [], { host: NODE, nodeId: 'node-1' });
      expect(await left()).to.deep.equal(
        without(`emulator-5554@${NODE}`, `node-phone@${NODE}`, 'node-iphone@10.0.0.1'),
      );
    });

    it('with the hub’s own id takes nothing', async () => {
      await register('unregister', [], { host: HUB, nodeId: HUB_NODE_ID });
      expect(await left()).to.deep.equal(ALL);
    });
  });

  describe('remove (a node’s phone unplugged or stale)', () => {
    it('takes that phone at the node’s exact host only', async () => {
      await register('remove', [{ udid: 'emulator-5554', host: NODE }]);
      expect(await left()).to.deep.equal(without(`emulator-5554@${NODE}`));
    });

    it('with a bare IP (an older node) takes nothing', async () => {
      await register('remove', [{ udid: 'emulator-5554', host: '10.0.0.1' }]);
      expect(await left()).to.deep.equal(ALL);
    });

    it('with no host takes nothing, never every row with that udid', async () => {
      await register('remove', [{ udid: 'emulator-5554' }]);
      expect(await left()).to.deep.equal(ALL);
    });

    it('naming one of the hub’s own phones takes nothing', async () => {
      await register('remove', [{ udid: 'emulator-5554', host: HUB }]);
      expect(await left()).to.deep.equal(ALL);
    });

    it('with the node’s id takes its phone, even filed under a bare host', async () => {
      await register('remove', [{ udid: 'node-iphone', host: '10.0.0.1', nodeId: 'node-1' }]);
      expect(await left()).to.deep.equal(without('node-iphone@10.0.0.1'));
    });
  });
});
