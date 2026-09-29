import 'reflect-metadata';
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import * as jose from 'jose';
import { Container } from 'typedi';
import ControlRouter from '../../src/app/routers/control';
import { issueToken } from '../../src/app/routers/auth';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { csrfMiddleware } from '../../src/middleware/csrfMiddleware';
import {
  HUB_CONTROL_AUDIENCE,
  HUB_TOKEN_HEADER,
  HubSessionTokenIssuer,
} from '../../src/gateway/hubSessionToken';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { XenonManager } from '../../src/device-managers';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { SessionOwnerResolver } from '../../src/services/device-access/SessionOwnerResolver';
import { LiveSessionOwners } from '../../src/services/device-access/LiveSessionOwners';
import { config } from '../../src/config';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';
import { loopbackServers } from '../helpers/loopbackServer';

/**
 * A hub forwards five of its /control actions on a node's phone (tap, swipe,
 * text, keyevent, touchAndHold) to the phone's node. It sent them with no
 * credential at all, so a node with auth enabled refused every one (its CSRF
 * check, then its login), and device control of a node's phone only worked
 * with the node's auth off.
 *
 * The hub now signs each forwarded call for the user it acts for: audience
 * xenon-node-control, one minute, naming the user, whether they are an admin,
 * the phone and its node. The node accepts it for /control on that phone
 * only, then runs its own ownership guard with that user, whose session it
 * knows (LiveSessionOwners).
 */

// Named like the real manager: /control picks one by constructor.name.
class AndroidDeviceManager {
  taps: string[] = [];
  tap = async (udid: string) => {
    this.taps.push(udid);
  };
}

describe('the hub’s device control on a node’s phone', () => {
  const scratch = useScratchDatabase();
  const loopback = loopbackServers();
  let dirs: string[];
  let hubKeys: JwtKeyService;
  let manager: AndroidDeviceManager;
  let context: PluginContext;
  let saved: { context: Partial<PluginContext>; store: unknown; authDisabled: boolean };
  let restore: () => void;
  let hubUrl: string;
  let hubApp: express.Express;
  let nodeOrigin: string;
  let nodePort: number;
  let nodeArgs: any;

  beforeEach(async () => {
    dirs = [fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-control-keys-'))];
    hubKeys = new JwtKeyService();
    await hubKeys.init(dirs[0]);
    restore = saveRegistrations(
      JwtKeyService,
      HubSessionTokenIssuer,
      XenonManager,
      SessionOwnerResolver,
      LiveSessionOwners,
    );
    Container.set(JwtKeyService, hubKeys);
    Container.set(HubSessionTokenIssuer, new HubSessionTokenIssuer());
    Container.set(SessionOwnerResolver, new SessionOwnerResolver());
    Container.set(LiveSessionOwners, new LiveSessionOwners());
    manager = new AndroidDeviceManager();
    Container.set(XenonManager, { deviceInstances: async () => [manager] } as any);
    context = Container.get(PluginContext);
    saved = {
      context: { ...context },
      store: (DeviceStoreFactory as any)._deviceStore,
      authDisabled: config.authDisabled,
    };
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
    config.authDisabled = false;

    // The hub: its public keys, and its own /control with a caller named by a header.
    const hub = express();
    hub.get('/xenon/api/auth/jwks.json', (_req, res) => res.json(hubKeys.jwks()));
    hubUrl = `http://127.0.0.1:${((await loopback.serve(hub)).address() as any).port}`;
    hubApp = express();
    // One process plays both servers, and PluginContext is a singleton: each
    // app takes its own identity per request, so the hub's forward decision
    // (the phone's nodeId against this server's) sees the hub, not the node.
    hubApp.use((_req, _res, next) => {
      context.setContext(
        { ...DefaultPluginArgs, bindHostOrIp: '127.0.0.1' } as any,
        1,
        'hub-1',
        '',
      );
      next();
    });
    hubApp.use(express.json());
    hubApp.use((req: any, _res, next) => {
      const user = String(req.headers['x-test-user'] ?? '');
      const admin = user.startsWith('admin-');
      req.auth = {
        kind: 'user-session',
        userId: user,
        role: admin ? 'ADMIN' : 'MEMBER',
        scopes: admin ? 'admin,devices,sessions,read' : 'devices,sessions,read',
        rateLimit: 300,
        teamIds: undefined,
      };
      next();
    });
    const hubApi = express.Router();
    ControlRouter.register(hubApi);
    hubApp.use('/xenon/api', hubApi);

    // The node: its CSRF check, its login and its /control, as ServerManager mounts them.
    const node = express();
    node.use((_req, _res, next) => {
      context.setContext(nodeArgs, nodePort, 'node-1', '');
      next();
    });
    node.use(express.json());
    const nodeApi = express.Router();
    nodeApi.use(csrfMiddleware);
    nodeApi.use(authMiddleware);
    nodeApi.get('/whoami', (req: any, res) => res.json(req.auth));
    ControlRouter.register(nodeApi);
    node.use('/xenon/api', nodeApi);
    nodePort = ((await loopback.serve(node)).address() as any).port;
    nodeOrigin = `http://127.0.0.1:${nodePort}`;
    nodeArgs = { ...DefaultPluginArgs, hub: hubUrl, bindHostOrIp: '127.0.0.1' } as any;
    context.setContext(nodeArgs, nodePort, 'node-1', '');

    await scratch.db.device.deleteMany({});
    // alice's session runs on the node's phone.
    for (const udid of ['phone-1', 'phone-2']) {
      await scratch.db.device.create({
        data: {
          udid,
          host: nodeOrigin,
          nodeId: 'node-1',
          platform: 'android',
          name: udid,
          busy: udid === 'phone-1',
          session_id: udid === 'phone-1' ? 's-1' : null,
        } as any,
      });
    }
    Container.get(LiveSessionOwners).record('s-1', 'alice');
  });

  afterEach(async () => {
    Object.assign(context, saved.context);
    (DeviceStoreFactory as any)._deviceStore = saved.store;
    config.authDisabled = saved.authDisabled;
    sinon.restore();
    restore();
    await loopback.closeAll();
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  const tapThroughHub = (user: string) =>
    request(hubApp)
      .post('/xenon/api/control/phone-1/tap')
      .set('x-test-user', user)
      .send({ x: 10, y: 20 });

  const controlToken = (grant: Record<string, unknown> = {}) =>
    Container.get(HubSessionTokenIssuer).controlTokenFor({
      userId: 'alice',
      isAdmin: false,
      udid: 'phone-1',
      host: nodeOrigin,
      ...grant,
    } as any) as Promise<string>;

  const toNode = (method: 'get' | 'post', url: string, token?: string) => {
    const req = request(nodeOrigin)[method](url);
    if (token) req.set(HUB_TOKEN_HEADER, token);
    return method === 'post' ? req.send({ x: 1, y: 2 }) : req;
  };

  it('the owner’s tap through the hub reaches the node’s phone', async () => {
    const res = await tapThroughHub('alice');
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect(manager.taps).to.deep.equal(['phone-1']);
  });

  it('the hub signs the forwarded call for its user, that phone and its node', async () => {
    const seen: string[] = [];
    sinon.stub(Container.get(HubSessionTokenIssuer), 'controlTokenFor').callsFake(async (grant) => {
      seen.push(JSON.stringify(grant));
      return hubKeys.sign(
        { sub: grant.userId, adm: grant.isAdmin, udid: grant.udid, host: grant.host },
        { audience: HUB_CONTROL_AUDIENCE, ttlSeconds: 60 },
      );
    });
    await tapThroughHub('alice').expect(200);
    expect(seen.map((g) => JSON.parse(g))).to.deep.equal([
      { userId: 'alice', isAdmin: false, udid: 'phone-1', host: nodeOrigin },
    ]);
  });

  it('is a one-minute token /auth/token will never mint', async () => {
    const claims = jose.decodeJwt(await controlToken());
    expect(claims.aud).to.equal(HUB_CONTROL_AUDIENCE);
    expect((claims.exp as number) - (claims.iat as number)).to.equal(60);
    let refused: any;
    await issueToken(
      { userId: 'alice', role: 'ADMIN', scopes: 'admin' },
      { audience: HUB_CONTROL_AUDIENCE },
    ).catch((error) => (refused = error));
    expect(refused?.message).to.include('unsupported audience');
  });

  describe('on the node', () => {
    it('the node’s own ownership guard judges the user the hub named', async () => {
      const asBob = await controlToken({ userId: 'bob' });
      const bob = await toNode('post', '/xenon/api/control/phone-1/tap', asBob);
      expect(bob.status).to.equal(409);
      expect(bob.body.error).to.equal('device_in_use_by_session');
      const admin = await controlToken({ userId: 'admin-carol', isAdmin: true });
      await toNode('post', '/xenon/api/control/phone-1/tap', admin).expect(200);
      expect(manager.taps).to.deep.equal(['phone-1']);
    });

    it('is accepted for that phone’s /control only', async () => {
      const token = await controlToken();
      const otherPhone = await toNode('post', '/xenon/api/control/phone-2/tap', token);
      expect(otherPhone.status).to.equal(401);
      const notControl = await toNode('get', '/xenon/api/whoami', token);
      expect(notControl.status).to.equal(401);
      expect(manager.taps).to.deep.equal([]);
    });

    it('is refused when it names another node, or is another kind of hub token', async () => {
      const issuer = Container.get(HubSessionTokenIssuer);
      const tokens = [
        await controlToken({ host: 'http://10.9.9.9:4725' }),
        (await issuer.tokenFor('s-1')) as string,
        (await issuer.createTokenFor({
          userId: 'alice',
          udid: 'phone-1',
          host: nodeOrigin,
        })) as string,
        await hubKeys.sign(
          { sub: 'alice', adm: false, udid: 'phone-1', host: nodeOrigin },
          { audience: HUB_CONTROL_AUDIENCE, ttlSeconds: -3600 },
        ),
        'not-a-jwt',
      ];
      for (const token of tokens) {
        const res = await toNode('post', '/xenon/api/control/phone-1/tap', token);
        expect(res.status, token.slice(0, 20)).to.equal(401);
      }
      expect(manager.taps).to.deep.equal([]);
    });

    it('cannot be checked while the hub’s keys cannot be fetched: 503', async () => {
      const token = await controlToken();
      nodeArgs = { ...nodeArgs, hub: 'http://127.0.0.1:1' };
      const res = await toNode('post', '/xenon/api/control/phone-1/tap', token);
      expect(res.status).to.equal(503);
      expect(manager.taps).to.deep.equal([]);
    });

    it('a server that is not a node ignores it', async () => {
      const token = await controlToken();
      nodeArgs = { ...nodeArgs, hub: undefined };
      const res = await toNode('post', '/xenon/api/control/phone-1/tap', token);
      expect(res.status).to.not.equal(200);
      expect(manager.taps).to.deep.equal([]);
    });
  });
});
