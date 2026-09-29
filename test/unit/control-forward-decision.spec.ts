import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import ControlRouter from '../../src/app/routers/control';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { XenonManager } from '../../src/device-managers';
import { InternalHttpClient } from '../../src/InternalHttpClient';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { saveRegistrations } from '../helpers/container-registration';

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
  let manager: AndroidDeviceManager;
  let post: sinon.SinonStub;
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
    post = sinon.stub(InternalHttpClient, 'post').resolves({ data: {} } as any);
  });

  afterEach(() => {
    Object.assign(context, savedContext);
    sinon.restore();
    restore();
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
    expect(post.called, 'never forwarded to itself').to.equal(false);
  });

  it('forwards a node’s phone once, never retried', async () => {
    device = {
      udid: 'node-phone',
      host: 'http://10.0.0.9:4725',
      nodeId: 'node-9',
      platform: 'android',
    };

    const res = await tap('node-phone', '192.168.0.104:4723');

    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect(manager.taps).to.deep.equal([]);
    expect(post.calledOnce).to.equal(true);
    expect(post.firstCall.args[0]).to.equal(
      'http://10.0.0.9:4725/xenon/api/control/node-phone/tap',
    );
    expect(post.firstCall.args[2]).to.include({ retry: false });
  });
});
