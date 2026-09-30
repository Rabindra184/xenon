import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { Container } from 'typedi';
import ControlRouter from '../../src/app/routers/control';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { XenonManager } from '../../src/device-managers';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { saveRegistrations } from '../helpers/container-registration';
import { loopbackServers } from '../helpers/loopbackServer';

/**
 * Whether a /control action is forwarded to another server is decided by the
 * phone's own row (its nodeId, else its exact host against this server's own
 * hosts), never by the Host header the caller happened to use. It was a
 * substring match on that header: a lab reached as `localhost` forwarded its
 * own phone's tap back to itself with no login, and the tap failed. A
 * forwarded tap is also sent once: InternalHttpClient's retry on a 5xx or a
 * timeout could land the same tap twice on a slow node.
 */

// The route finds the manager by constructor name.
class AndroidDeviceManager {
  taps: string[] = [];
  tap = async (udid: string) => {
    this.taps.push(udid);
  };
}

const OWN_HOST = 'http://192.168.0.104:4723';

function buildApp() {
  const app = express();
  app.use(express.json());
  const api = express.Router();
  api.use((req, _res, next) => {
    (req as any).auth = {
      kind: 'user-session',
      userId: 'usr_me',
      role: 'MEMBER',
      scopes: scopesForRole('MEMBER'),
      rateLimit: 100,
    };
    next();
  });
  ControlRouter.register(api);
  app.use('/xenon/api', api);
  return app;
}

describe('/control forwards only another server’s phone', () => {
  const loopback = loopbackServers();
  let manager: AndroidDeviceManager;
  let restore: () => void;
  let context: PluginContext;
  let savedContext: Partial<PluginContext>;
  let device: Record<string, unknown>;

  beforeEach(() => {
    restore = saveRegistrations(XenonManager);
    manager = new AndroidDeviceManager();
    Container.set(XenonManager, { deviceInstances: async () => [manager] } as any);
    context = Container.get(PluginContext);
    savedContext = { ...context };
    context.setContext(
      { ...DefaultPluginArgs, bindHostOrIp: '192.168.0.104' } as any,
      4723,
      'lab-1',
      '',
    );
    sinon
      .stub(DeviceStoreFactory, 'getStore')
      .returns({ findDevice: async () => ({ ...device }) } as any);
  });

  afterEach(async () => {
    Object.assign(context, savedContext);
    sinon.restore();
    restore();
    await loopback.closeAll();
  });

  const tap = (udid: string, hostHeader: string) =>
    request(buildApp())
      .post(`/xenon/api/control/${udid}/tap`)
      .set('Host', hostHeader)
      .send({ x: 1, y: 2 });

  it('taps this server’s own phone here, whatever name the caller used for the server', async () => {
    device = { udid: 'own-1', host: OWN_HOST, nodeId: 'lab-1', platform: 'android' };

    const res = await tap('own-1', 'localhost:4723');

    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect(manager.taps).to.deep.equal(['own-1']);
  });

  it('forwards a node’s phone once, never retried, and relays its answer', async () => {
    const node = express();
    const hits: string[] = [];
    node.use((req, res) => {
      hits.push(req.originalUrl);
      res.status(503).json({ error: 'node busy' });
    });
    const nodeOrigin = `http://127.0.0.1:${((await loopback.serve(node)).address() as any).port}`;
    device = { udid: 'node-phone', host: nodeOrigin, nodeId: 'node-9', platform: 'android' };

    const res = await tap('node-phone', '192.168.0.104:4723');

    expect(res.status).to.equal(503);
    expect(res.body).to.deep.equal({ error: 'node busy' });
    expect(manager.taps).to.deep.equal([]);
    expect(hits).to.deep.equal(['/xenon/api/control/node-phone/tap']);
  });
});
