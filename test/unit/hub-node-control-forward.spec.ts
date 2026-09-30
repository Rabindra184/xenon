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
import { InspectorService } from '../../src/services/InspectorService';
import http from 'http';
import AndroidStreamService from '../../src/device-managers/android/AndroidStreamService';
import AndroidH264StreamService from '../../src/device-managers/android/AndroidH264StreamService';

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
// Hub and node share this process, so each call records the server it ran
// on: an action the hub ran on its own would show up as `hub-1:...`.
class AndroidDeviceManager {
  taps: string[] = [];
  calls: string[] = [];
  failLogs = false;
  private at(name: string) {
    this.calls.push(`${Container.get(PluginContext).nodeId}:${name}`);
  }
  tap = async (udid: string) => {
    this.taps.push(udid);
  };
  getScreenshot = async () => {
    this.at('getScreenshot');
    return 'A'.repeat(200);
  };
  getClipboard = async () => {
    this.at('getClipboard');
    return 'copied';
  };
  setClipboard = async () => this.at('setClipboard');
  lock = async () => this.at('lock');
  unlock = async () => this.at('unlock');
  getDisplayState = async () => {
    this.at('getDisplayState');
    return 'on';
  };
  uninstallApp = async () => this.at('uninstallApp');
  listApps = async () => {
    this.at('listApps');
    return [{ bundleId: 'com.example' }];
  };
  getLogs = async () => {
    this.at('getLogs');
    if (this.failLogs) throw new Error('logcat failed on the node');
    return 'a log line';
  };
  executeShell = async () => {
    this.at('executeShell');
    return 'uid=2000(shell)';
  };
  installApp = async () => this.at('installApp');
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
  let nodeRequests: {
    method: string;
    path: string;
    url: string;
    headers: Record<string, unknown>;
  }[];

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
      InspectorService,
    );
    Container.set(JwtKeyService, hubKeys);
    Container.set(HubSessionTokenIssuer, new HubSessionTokenIssuer());
    Container.set(SessionOwnerResolver, new SessionOwnerResolver());
    Container.set(LiveSessionOwners, new LiveSessionOwners());
    manager = new AndroidDeviceManager();
    Container.set(XenonManager, { deviceInstances: async () => [manager] } as any);
    Container.set(InspectorService, {
      getSnapshot: async () => {
        manager.calls.push(`${Container.get(PluginContext).nodeId}:getSnapshot`);
        return { source: '<hierarchy/>' };
      },
    } as any);
    nodeRequests = [];
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
    node.use((req, _res, next) => {
      nodeRequests.push({
        method: req.method,
        path: req.path,
        url: req.originalUrl,
        headers: { ...req.headers },
      });
      next();
    });
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

  describe('which actions reach the node', () => {
    const asAlice = (method: 'get' | 'post', action: string, body?: Record<string, unknown>) => {
      const req = request(hubApp)[method](`/xenon/api/control/phone-1/${action}`);
      req.set('x-test-user', 'alice');
      return method === 'post' ? req.send(body ?? {}) : req;
    };
    const nodeSaw = (action: string) =>
      nodeRequests.filter((r) => r.path === `/xenon/api/control/phone-1/${action}`);

    // Each runs on the node and answers with the node's own reply.
    const FORWARDED: {
      method: 'get' | 'post';
      action: string;
      send?: Record<string, unknown>;
      call: string;
      reply: unknown;
    }[] = [
      {
        method: 'get',
        action: 'screenshot',
        call: 'getScreenshot',
        reply: { screenshot: 'A'.repeat(200) },
      },
      { method: 'get', action: 'clipboard', call: 'getClipboard', reply: { content: 'copied' } },
      {
        method: 'post',
        action: 'clipboard',
        send: { content: 'x' },
        call: 'setClipboard',
        reply: { success: true },
      },
      { method: 'post', action: 'lock', call: 'lock', reply: { success: true } },
      { method: 'post', action: 'unlock', call: 'unlock', reply: { success: true } },
      { method: 'get', action: 'display', call: 'getDisplayState', reply: { state: 'on' } },
      {
        method: 'post',
        action: 'uninstall',
        send: { bundleId: 'com.example' },
        call: 'uninstallApp',
        reply: { success: true },
      },
      { method: 'get', action: 'apps', call: 'listApps', reply: [{ bundleId: 'com.example' }] },
      { method: 'get', action: 'logs', call: 'getLogs', reply: { logs: 'a log line' } },
      {
        method: 'post',
        action: 'shell',
        send: { command: 'id' },
        call: 'executeShell',
        reply: { output: 'uid=2000(shell)' },
      },
      {
        method: 'get',
        action: 'inspector/snapshot',
        call: 'getSnapshot',
        reply: { source: '<hierarchy/>' },
      },
    ];

    for (const { method, action, send, call, reply } of FORWARDED) {
      it(`${method.toUpperCase()} ${action} runs on the node and answers with the node's reply`, async () => {
        const res = await asAlice(method, action, send);
        expect(res.status, JSON.stringify(res.body)).to.equal(200);
        expect(res.body).to.deep.equal(reply);
        expect(manager.calls).to.deep.equal([`node-1:${call}`]);
        expect(nodeSaw(action)).to.have.length(1);
      });
    }

    it('relays the node’s own error answer unchanged, sent once', async () => {
      manager.failLogs = true;
      const res = await asAlice('get', 'logs');
      expect(res.status).to.equal(500);
      expect(res.body).to.deep.equal({ error: 'logcat failed on the node' });
      expect(nodeSaw('logs')).to.have.length(1);
    });

    it('sends the node none of the caller’s credentials, only its own token', async () => {
      await request(hubApp)
        .post('/xenon/api/control/phone-1/lock')
        .set('x-test-user', 'alice')
        .set('cookie', 'xenon_dashboard_session=secret-session')
        .set('authorization', 'Bearer secret-jwt')
        .set('x-xenon-access-key', 'secret-key')
        .set('x-xenon-token', 'secret-token')
        .send({})
        .expect(200);
      const [sent] = nodeSaw('lock');
      for (const name of [
        'cookie',
        'authorization',
        'x-xenon-access-key',
        'x-xenon-token',
        'x-test-user',
      ]) {
        expect(sent.headers, name).to.not.have.property(name);
      }
      expect(sent.headers[HUB_TOKEN_HEADER]).to.be.a('string');
    });

    it('answers appium-session itself: the session is routed through the hub', async () => {
      const res = await asAlice('get', 'appium-session');
      expect(res.status).to.equal(200);
      expect(res.body).to.include({ status: 'success', sessionId: 's-1' });
      expect(nodeSaw('appium-session')).to.have.length(0);
    });

    // Not passed on yet: uploads need a relayed body, an app from the hub's
    // library isn't on the node, and a path is a path on one machine.
    // Omni's AI settings are the hub's. Anything added later is refused the
    // same way until it is on the list.
    const REFUSED: [method: 'get' | 'post', action: string, body?: Record<string, unknown>][] = [
      ['post', 'install', { appPath: '/tmp/app.apk' }],
      ['post', 'install-repository-app', { appId: 'app-1' }],
      ['post', 'upload-install'],
      ['get', 'omni-scan'],
      ['post', 'test-locator', { strategy: '-custom:ai-text', selector: 'OK' }],
      ['post', 'an-action-added-later'],
    ];

    describe('the live preview', () => {
      // phone-2 is free: a preview holds it on the node.
      const preview = (method: 'get' | 'post', action: string) => {
        const req = request(hubApp)[method](`/xenon/api/control/phone-2/${action}`);
        req.set('x-test-user', 'alice');
        return method === 'post' ? req.send({}) : req;
      };
      const nodeSawPreview = (action: string) =>
        nodeRequests.filter((r) => r.path === `/xenon/api/control/phone-2/${action}`);
      let started: string[];
      let stopped: string[];
      let mjpegPort: number;

      beforeEach(async () => {
        started = [];
        stopped = [];
        // The camera the node's MJPEG fan-out reads: a frame every 50 ms.
        const camera = express();
        camera.get('/', (_req, res) => {
          res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=f' });
          const timer = setInterval(() => res.write('--f\r\nFAKE-JPEG-FRAME\r\n'), 50);
          res.on('close', () => clearInterval(timer));
        });
        mjpegPort = ((await loopback.serve(camera)).address() as any).port;
        const mjpeg = Container.get(AndroidStreamService);
        const h264 = Container.get(AndroidH264StreamService);
        const where = () => Container.get(PluginContext).nodeId;
        sinon.stub(mjpeg, 'startStream').callsFake(async (udid: string) => {
          started.push(`${where()}:${udid}`);
          return { mjpegPort };
        });
        sinon.stub(mjpeg, 'stopStream').callsFake(async (udid: string) => {
          stopped.push(`${where()}:${udid}`);
        });
        sinon.stub(mjpeg, 'getStreamStatus').returns(undefined as any);
        sinon.stub(mjpeg, 'updateViewerCount');
        sinon.stub(h264, 'stop').resolves();
        sinon.stub(h264, 'getMultiplexer').returns(undefined);
      });

      it('starts on the node, which holds the phone, and the hub marks it busy for the node at once', async () => {
        const res = await preview('post', 'stream/start');
        expect(res.status, JSON.stringify(res.body)).to.equal(200);
        expect(res.body).to.include({ success: true, type: 'mjpeg' });
        expect(started).to.deep.equal(['node-1:phone-2']);
        const row = await scratch.db.device.findFirst({ where: { udid: 'phone-2' } });
        expect(row?.session_id).to.equal('manual_alice_phone-2');
        expect(row?.nodeBusy).to.equal(true);
        expect(row?.busy).to.equal(true);
      });

      it('status, leave and stop are the node’s answers', async () => {
        await preview('post', 'stream/start').expect(200);
        const status = await preview('get', 'stream/status');
        expect(status.status).to.equal(200);
        expect(status.body).to.include({ udid: 'phone-2', status: 'stopped' });
        await preview('post', 'stream/leave').expect(202);
        await preview('post', 'stream/stop').expect(200);
        expect(stopped).to.deep.equal(['node-1:phone-2']);
        for (const action of ['stream/status', 'stream/leave', 'stream/stop']) {
          expect(nodeSawPreview(action), action).to.have.length(1);
        }
      });

      it('mints the viewer’s ticket here, where the team check ran', async () => {
        const res = await preview('post', 'stream/ticket');
        expect(res.status).to.equal(200);
        expect(res.body.ticket).to.be.a('string');
        expect(nodeSawPreview('stream/ticket')).to.have.length(0);
      });

      it('relays the node’s MJPEG stream to the viewer, without the viewer’s ticket', async () => {
        const hubPort = ((await loopback.serve(hubApp)).address() as any).port;
        const got = await new Promise<{ type: string; body: string }>((resolve, reject) => {
          const req = http.get(
            {
              host: '127.0.0.1',
              port: hubPort,
              path: '/xenon/api/control/phone-2/stream?ticket=spent&t=1',
              headers: { 'x-test-user': 'alice' },
            },
            (res) => {
              let body = '';
              res.on('data', (chunk) => {
                body += chunk.toString();
                if (body.split('FAKE-JPEG-FRAME').length > 3) {
                  req.destroy();
                  resolve({ type: String(res.headers['content-type']), body });
                }
              });
            },
          );
          req.on('error', (e: any) => (e.code === 'ECONNRESET' ? undefined : reject(e)));
        });
        expect(got.type).to.include('multipart/x-mixed-replace');
        expect(started).to.deep.equal(['node-1:phone-2']);
        expect(nodeSawPreview('stream').map((r) => r.url)).to.deep.equal([
          '/xenon/api/control/phone-2/stream?t=1',
        ]);
        await preview('post', 'stream/stop').expect(200);
      });
    });

    it('refuses the rest, naming the node, and runs none of it on the hub', async () => {
      for (const [method, action, body] of REFUSED) {
        const res = await asAlice(method, action, body);
        expect(res.status, `${method} ${action}`).to.equal(501);
        expect(res.body.error, `${method} ${action}`).to.equal('not_available_through_hub');
        expect(res.body.message, `${method} ${action}`).to.include(nodeOrigin);
      }
      expect(nodeRequests).to.have.length(0);
      expect(manager.calls).to.deep.equal([]);
    });

    it('sends nothing to a cloud provider’s phone', async () => {
      const provider = express();
      let reached = 0;
      provider.use((_req, res) => {
        reached++;
        res.status(200).json({});
      });
      const providerOrigin = `http://127.0.0.1:${((await loopback.serve(provider)).address() as any).port}`;
      await scratch.db.device.create({
        data: {
          udid: 'cloud-1',
          host: providerOrigin,
          platform: 'android',
          name: 'cloud-1',
          cloud: JSON.stringify({ cloudName: 'example-cloud' }),
        } as any,
      });
      for (const [method, action, body] of [
        ['post', 'tap', { x: 1, y: 2 }],
        ['get', 'screenshot'],
        ['post', 'text', { text: 'a secret' }],
      ] as const) {
        const req = request(hubApp)
          [method](`/xenon/api/control/cloud-1/${action}`)
          .set('x-test-user', 'alice');
        const res = await (method === 'post' ? req.send(body ?? {}) : req);
        expect(res.status, action).to.equal(501);
        expect(res.body.error, action).to.equal('not_available_for_cloud_phone');
      }
      expect(reached).to.equal(0);
      expect(manager.taps).to.deep.equal([]);
    });

    it('a node that can’t be reached: 502, naming the node', async () => {
      await scratch.db.device.create({
        data: {
          udid: 'gone-1',
          host: 'http://127.0.0.1:1',
          nodeId: 'node-2',
          platform: 'android',
          name: 'gone-1',
        } as any,
      });
      const res = await request(hubApp)
        .get('/xenon/api/control/gone-1/screenshot')
        .set('x-test-user', 'alice');
      expect(res.status).to.equal(502);
      expect(res.body.error).to.equal('node_unreachable');
      expect(res.body.message).to.include('http://127.0.0.1:1');
      expect(manager.calls).to.deep.equal([]);
    });
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
