import 'reflect-metadata';
import { expect } from 'chai';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import request from 'supertest';
import { Container } from 'typedi';
import { XenonPlugin } from '../../src/plugin';
import { commandAuthDeps, registerSessionGateway } from '../../src/app/registerCommandAuth';
import { nodeGatewayOptions } from '../../src/gateway/defaultGateway';
import {
  HUB_CREATE_AUDIENCE,
  HUB_TOKEN_AUDIENCE,
  HUB_TOKEN_HEADER,
  HubSessionTokenIssuer,
} from '../../src/gateway/hubSessionToken';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { XenonManager } from '../../src/device-managers';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore, PrismaPendingSessionStore } from '../../src/data-service/prisma-store';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { config } from '../../src/config';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';
import {
  FAKE_AUTOMATION,
  appiumBaseDriver,
  quietAppiumLogs,
  umbrellaWith,
} from '../helpers/appium-umbrella';

/**
 * A Xenon node's side of a create the hub forwards, in Appium 3's own
 * server(): Appium's real umbrella with Xenon's real plugin, the production
 * node wiring (nodeGatewayOptions), the real SessionLifecycleService and a
 * scratch SQLite database of the node's own.
 *
 * Each instance has its own database, so the node cannot check the client's
 * key: the hub did. The hub's create carries a token it signed instead
 * (x-xenon-hub-token, audience xenon-node-create), naming the verified owner,
 * the phone and its node. The node checks it against the hub's JWKS, and it is
 * the session's credential: it attributes the session and passes
 * XENON_REQUIRE_SESSION_TOKEN.
 *
 * The hub here is only what the node talks to: an Appium server serving the
 * hub's public keys. What the hub sends is hub-gateway-create-appium-server.spec.ts.
 */

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const NODE_ID = 'node-1';

describe('a create the hub forwards, on the node, in Appium 3’s own server()', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  const servers: http.Server[] = [];
  let dirs: string[];
  let hubKeys: JwtKeyService;
  let appiumLogs: { restore(): void };
  let restore: () => void;
  let saved: { store: unknown; pending: unknown; context: Partial<PluginContext> };
  let authDisabledBefore: boolean;
  let gateBefore: string | undefined;

  let umbrella: any;
  let hubUrl: string;
  let nodeOrigin: string;
  let nodeAuthDisabled: boolean;

  async function keyService(): Promise<JwtKeyService> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-node-create-keys-'));
    dirs.push(dir);
    const keys = new JwtKeyService();
    await keys.init(dir);
    return keys;
  }

  before(async () => {
    appiumLogs = quietAppiumLogs();
    dirs = [];
    hubKeys = await keyService();
  });
  after(() => {
    appiumLogs.restore();
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    restore = saveRegistrations(JwtKeyService, HubSessionTokenIssuer, XenonManager);
    // The hub's keys sign here only because the test mints what the hub would send.
    Container.set(JwtKeyService, hubKeys);
    Container.set(HubSessionTokenIssuer, new HubSessionTokenIssuer());
    Container.set(XenonManager, {
      getMaxSessionCount: () => undefined,
      deviceInstances: async () => [],
    } as any);
    const context = Container.get(PluginContext);
    saved = {
      store: (DeviceStoreFactory as any)._deviceStore,
      pending: (DeviceStoreFactory as any)._pendingSessionStore,
      context: { ...context },
    };
    (DeviceStoreFactory as any)._deviceStore = new PrismaDeviceStore();
    (DeviceStoreFactory as any)._pendingSessionStore = new PrismaPendingSessionStore();
    authDisabledBefore = config.authDisabled;
    config.authDisabled = false;
    nodeAuthDisabled = false;
    gateBefore = process.env.XENON_REQUIRE_SESSION_TOKEN;
    delete process.env.XENON_REQUIRE_SESSION_TOKEN;
    await scratch.db.pendingSession.deleteMany({});
    await scratch.db.device.deleteMany({});
    await boot();
  });

  afterEach(async () => {
    for (const s of SESSION_MANAGER.getAllSessions()) SESSION_MANAGER.removeSession(s.getId());
    (DeviceStoreFactory as any)._deviceStore = saved.store;
    (DeviceStoreFactory as any)._pendingSessionStore = saved.pending;
    Object.assign(Container.get(PluginContext), saved.context);
    config.authDisabled = authDisabledBefore;
    if (gateBefore === undefined) delete process.env.XENON_REQUIRE_SESSION_TOKEN;
    else process.env.XENON_REQUIRE_SESSION_TOKEN = gateBefore;
    sinon.restore();
    restore();
    for (const s of servers.splice(0)) {
      s.closeAllConnections();
      await new Promise<void>((resolve) => http.Server.prototype.close.call(s, () => resolve()));
    }
  });

  const port = (s: http.Server) => (s.address() as { port: number }).port;

  async function boot() {
    const baseDriver = appiumBaseDriver();

    // The hub: only its public keys matter to the node.
    const hubServer: http.Server = await baseDriver.server({
      routeConfiguringFunction: baseDriver.routeConfiguringFunction(umbrellaWith([])),
      port: 0,
      hostname: '127.0.0.1',
      basePath: '/wd/hub',
      cliArgs: { basePath: '/wd/hub' },
      serverUpdaters: [
        (app: any) => {
          app.get('/xenon/api/auth/jwks.json', (_req: any, res: any) => res.json(hubKeys.jwks()));
        },
      ],
    });
    servers.push(hubServer);
    hubUrl = `http://127.0.0.1:${port(hubServer)}`;

    umbrella = umbrellaWith([[XenonPlugin, 'xenon']]);
    const nodeServer: http.Server = await baseDriver.server({
      routeConfiguringFunction: baseDriver.routeConfiguringFunction(umbrella),
      port: 0,
      hostname: '127.0.0.1',
      basePath: '/node',
      cliArgs: { basePath: '/node' },
      serverUpdaters: [
        (app: any) => {
          registerSessionGateway(
            app,
            { basePath: '/node' },
            commandAuthDeps({
              enabled: () => false,
              authDisabled: () => nodeAuthDisabled,
              logger: quiet,
            }),
            nodeGatewayOptions(hubUrl),
          );
        },
      ],
    });
    servers.push(nodeServer);
    nodeOrigin = `http://127.0.0.1:${port(nodeServer)}`;
    Container.get(PluginContext).setContext(
      {
        ...DefaultPluginArgs,
        hub: hubUrl,
        bindHostOrIp: '127.0.0.1',
        // Registers the node's LocalSession in SESSION_MANAGER, where its owner is read.
        enableDashboard: true,
        deviceAvailabilityTimeoutMs: 1_000,
        deviceAvailabilityQueryIntervalMs: 100,
      } as any,
      port(nodeServer),
      NODE_ID,
      '/node',
    );

    for (const udid of ['phone-1', 'phone-2']) {
      await scratch.db.device.create({
        data: {
          udid,
          host: nodeOrigin,
          nodeId: NODE_ID,
          platform: 'android',
          name: udid,
          sdk: '14',
          busy: false,
          userBlocked: false,
          offline: false,
        } as any,
      });
    }
  }

  /** What the hub mints for alice's create on phone-1. */
  const hubToken = (grant: Record<string, unknown> = {}) =>
    Container.get(HubSessionTokenIssuer).createTokenFor({
      userId: 'alice',
      udid: 'phone-1',
      host: nodeOrigin,
      ...grant,
    } as any) as Promise<string>;

  /** The capabilities as the hub forwards them: no credentials, the phone pinned. */
  const forwarded = (alwaysMatch: Record<string, unknown> = {}) => ({
    capabilities: {
      alwaysMatch: {
        platformName: 'Android',
        'appium:automationName': FAKE_AUTOMATION,
        'appium:newCommandTimeout': 0,
        'appium:udid': 'phone-1',
        // No video: it would start Xenon's real capture pipeline for the phone.
        'xe:options': { recordVideo: false },
        ...alwaysMatch,
      },
      firstMatch: [{}],
    },
  });

  const create = async (token: string | undefined, body = forwarded()) => {
    const req = request(nodeOrigin).post('/node/session');
    if (token !== undefined) req.set(HUB_TOKEN_HEADER, token);
    return req.send(body);
  };

  const row = (udid: string) => scratch.db.device.findFirst({ where: { udid } });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

  async function expectNothingCreated() {
    await settle();
    expect(Object.keys(umbrella.sessions), 'driver sessions').to.deep.equal([]);
    expect(await row('phone-1')).to.include({ busy: false, session_id: null });
    expect(await row('phone-2')).to.include({ busy: false, session_id: null });
    expect(await scratch.db.pendingSession.count()).to.equal(0);
  }

  it('attributes the session to the owner the hub’s token names', async () => {
    const res = await create(await hubToken());
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    const sessionId = res.body.value.sessionId;
    expect(Object.keys(umbrella.sessions)).to.deep.equal([sessionId]);
    const session = SESSION_MANAGER.getSession(sessionId) as any;
    expect(session.userId).to.equal('alice');
    expect(session.apiKeyId).to.equal(null);
    expect(await row('phone-1')).to.include({ busy: true, session_id: sessionId });
    expect(await scratch.db.pendingSession.count()).to.equal(0);
  });

  it('an unattributed create from the hub stays unattributed', async () => {
    const res = await create(await hubToken({ userId: null }));
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect((SESSION_MANAGER.getSession(res.body.value.sessionId) as any).userId).to.equal(null);
  });

  describe('with XENON_REQUIRE_SESSION_TOKEN on', () => {
    beforeEach(() => {
      process.env.XENON_REQUIRE_SESSION_TOKEN = '1';
    });

    it('the hub’s token admits the session', async () => {
      const res = await create(await hubToken());
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
    });

    it('a create with no credentials at all is refused, and nothing is allocated', async () => {
      // Before the gate is asked: on a node, only the hub's creates are taken.
      const res = await create(undefined);
      expect(res.status).to.equal(500);
      expect(res.body.value.error).to.equal('session not created');
      expect(res.body.value.message).to.include('through the hub');
      await expectNothingCreated();
    });

    it('client credentials the node cannot check are neither needed nor passed on', async () => {
      const res = await create(
        await hubToken(),
        forwarded({
          'xe:options': { accessKey: 'ak-unknown', token: 'CLIENT-SECRET', recordVideo: false },
        }),
      );
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      const session = SESSION_MANAGER.getSession(res.body.value.sessionId) as any;
      expect(session.userId).to.equal('alice');
      const inner = umbrella.sessions[res.body.value.sessionId];
      expect(JSON.stringify(inner.originalCaps)).to.not.include('CLIENT-SECRET');
    });
  });

  describe('a token that is not the hub’s grant for this create', () => {
    it('is refused when forged, expired or a command token, and nothing is allocated', async () => {
      const forger = await keyService();
      const claims = { sub: 'alice', udid: 'phone-1', host: nodeOrigin };
      const tokens = [
        await forger.sign(claims, { audience: HUB_CREATE_AUDIENCE, ttlSeconds: 120 }),
        await hubKeys.sign(claims, { audience: HUB_CREATE_AUDIENCE, ttlSeconds: -3600 }),
        await hubKeys.sign({ sid: 's-1' }, { audience: HUB_TOKEN_AUDIENCE, ttlSeconds: 300 }),
        'not-a-jwt',
      ];
      for (const token of tokens) {
        const res = await create(token);
        expect(res.status, token).to.equal(400);
        expect(res.body.value.error).to.equal('invalid argument');
        expect(res.body.value.message).to.include('session rejected');
      }
      await expectNothingCreated();
    });

    it('is refused the second time: a create token is taken once', async () => {
      const token = await hubToken();
      const first = await create(token);
      expect(first.status, JSON.stringify(first.body)).to.equal(200);
      const ended = await request(nodeOrigin).delete(`/node/session/${first.body.value.sessionId}`);
      expect(ended.status, JSON.stringify(ended.body)).to.equal(200);

      const again = await create(token);
      expect(again.status).to.equal(400);
      expect(again.body.value.error).to.equal('invalid argument');
      expect(again.body.value.message).to.include('session rejected');
      await expectNothingCreated();
    });

    it('is refused when the capabilities name another phone than the grant', async () => {
      const res = await create(await hubToken(), forwarded({ 'appium:udid': 'phone-2' }));
      expect(res.status).to.equal(400);
      expect(res.body.value.message).to.include('session rejected');
      await expectNothingCreated();
    });

    it('is refused, and the phone given back, when it names another node’s phone', async () => {
      const res = await create(await hubToken({ host: 'http://10.9.9.9:4725' }));
      expect(res.status).to.equal(400);
      expect(res.body.value.message).to.include('session rejected');
      await expectNothingCreated();
    });

    it('cannot be checked while the hub’s keys cannot be fetched: 503, and nothing is allocated', async () => {
      const token = await hubToken();
      const hub = servers[0];
      hub.closeAllConnections();
      await new Promise<void>((resolve) => http.Server.prototype.close.call(hub, () => resolve()));
      const res = await create(token);
      expect(res.status).to.equal(503);
      expect(res.body.value.error).to.equal('unknown error');
      await expectNothingCreated();
    });
  });

  describe('a create that did not come from the hub', () => {
    const direct = () =>
      create(
        undefined,
        forwarded({
          'xe:options': { accessKey: 'ak-node', token: 'node-secret', recordVideo: false },
        }),
      );

    it('is refused, saying to create sessions through the hub, and nothing is allocated', async () => {
      const res = await direct();
      expect(res.status).to.equal(500);
      expect(res.body.value.error).to.equal('session not created');
      expect(res.body.value.message).to.include('through the hub');
      expect(res.body.value.message).to.include(hubUrl);
      await expectNothingCreated();
    });

    it('is refused when it reaches the plugin without the gateway too', async () => {
      const lifecycle = new SessionLifecycleService();
      const caps = forwarded().capabilities as any;
      let refused: any;
      await lifecycle
        .createSession(() => ({}), umbrella, caps, { localOnly: true })
        .catch((error) => (refused = error));
      expect(refused?.message).to.include('through the hub');
      await expectNothingCreated();
    });

    it('still works on a node with auth disabled, as it did (local development)', async () => {
      nodeAuthDisabled = true;
      config.authDisabled = true;
      const res = await direct();
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
    });
  });

  it('with the node’s auth disabled, a token is not checked and the session is unattributed', async () => {
    nodeAuthDisabled = true;
    config.authDisabled = true;
    const res = await create('not-a-jwt');
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect((SESSION_MANAGER.getSession(res.body.value.sessionId) as any).userId).to.equal(null);
  });
});
