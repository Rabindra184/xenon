import 'reflect-metadata';
import { expect } from 'chai';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import request from '../helpers/loopbackRequest';
import * as jose from 'jose';
import { Container } from 'typedi';
import { errors as xenonErrors } from '@appium/base-driver';
import { XenonPlugin } from '../../src/plugin';
import { commandAuthDeps, registerSessionGateway } from '../../src/app/registerCommandAuth';
import { insertBeforeRoutes } from '../../src/app/insertBeforeRoutes';
import { hubGatewayOptions, nodeGatewayOptions } from '../../src/gateway/defaultGateway';
import {
  HUB_CREATE_AUDIENCE,
  HUB_TOKEN_HEADER,
  HubSessionTokenIssuer,
} from '../../src/gateway/hubSessionToken';
import {
  NodeBasePathResolver,
  WEBDRIVER_INFO_PATH,
  webdriverInfoHandler,
} from '../../src/gateway/nodeWebDriverUrl';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { SessionOwnerResolver } from '../../src/services/device-access/SessionOwnerResolver';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { XenonManager } from '../../src/device-managers';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore, PrismaPendingSessionStore } from '../../src/data-service/prisma-store';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { DASHBORD_EVENT_MANAGER } from '../../src/dashboard/event-manager';
import SessionType from '../../src/enums/SessionType';
import * as deviceUtils from '../../src/device-utils';
import { hashToken } from '../../src/services/lease/leaseToken';
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
 * `POST /session` through a Xenon hub, in Appium 3's own server(): the hub is
 * Appium's real umbrella driver with Xenon's real plugin, the session gateway
 * from the production wiring (hubGatewayOptions), the real
 * SessionLifecycleService and a scratch SQLite database. The node runs the
 * production node wiring too (nodeGatewayOptions), so the hub's token is
 * checked by the node's real create layer against the hub's JWKS; what the
 * node then does with the grant is node-gateway-create-appium-server.spec.ts.
 * Here a stand-in records it and the node's fake driver answers.
 */

const quiet = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const HUB_NODE_ID = 'hub-node-id';
const SECRETS = ['SECRET-SESSION-JWT', 'SECRET-LEASE-TOKEN'];

/** Another plugin, ahead of Xenon's in the chain, that can refuse a create. */
class GatekeeperPlugin {
  constructor(public name: string) {}
  async createSession(next: () => any, _driver: any, ...args: any[]) {
    if (args[2]?.alwaysMatch?.['gatekeeper:refuse']) {
      throw new (appiumBaseDriver().errors.InvalidArgumentError)('refused by another plugin');
    }
    return next();
  }
}

describe('POST /session through a hub, in Appium 3’s own server()', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  const servers: http.Server[] = [];
  let keyDir: string;
  let hubKeys: JwtKeyService;
  let appiumLogs: { restore(): void };
  let restore: () => void;
  let saved: { store: unknown; pending: unknown; context: Partial<PluginContext> };
  let authDisabledBefore: boolean;
  let gateBefore: string | undefined;

  let umbrella: any;
  let hubUrl: string;
  let nodeOrigin: string;
  let node: { commands: string[]; driver: any };
  let nodeRequests: Array<{
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: any;
  }>;
  let nodeCreates: Array<{ caps: any; grant: any }>;
  let nodeRefuses: boolean;
  let keys: Record<string, string>;
  let keyIds: Record<string, string>;
  let nodeSessions = 0;

  before(async () => {
    appiumLogs = quietAppiumLogs();
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-hub-create-keys-'));
    hubKeys = new JwtKeyService();
    await hubKeys.init(keyDir);
  });
  after(() => {
    appiumLogs.restore();
    fs.rmSync(keyDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    restore = saveRegistrations(
      JwtKeyService,
      HubSessionTokenIssuer,
      NodeBasePathResolver,
      SessionOwnerResolver,
      XenonManager,
    );
    Container.set(JwtKeyService, hubKeys);
    Container.set(HubSessionTokenIssuer, new HubSessionTokenIssuer());
    Container.set(NodeBasePathResolver, new NodeBasePathResolver());
    Container.set(SessionOwnerResolver, new SessionOwnerResolver());
    // No adb here: no health check, no extra device info.
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
    gateBefore = process.env.XENON_REQUIRE_SESSION_TOKEN;
    delete process.env.XENON_REQUIRE_SESSION_TOKEN;

    for (const model of [
      'pendingSession',
      'lease',
      'session',
      'device',
      'apiKey',
      'teamMember',
      'team',
      'user',
    ]) {
      await (scratch.db as any)[model].deleteMany({});
    }
    nodeRequests = [];
    nodeCreates = [];
    nodeRefuses = false;
    sinon.stub(DASHBORD_EVENT_MANAGER, 'onSessionStopped').resolves();
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

  /** A fake node driver: a session is whatever it is asked to create. */
  function fakeNodeDriver() {
    const commands: string[] = [];
    const sessions = new Set<string>();
    const driver = {
      log: quiet,
      protocol: 'W3C',
      sessionExists: (id: string) => sessions.has(id),
      proxyActive: () => false,
      canProxy: () => false,
      proxyRouteIsAvoided: () => false,
      executeCommand: async (command: string) => {
        commands.push(command);
        if (command === 'createSession') {
          const id = `node-session-${++nodeSessions}`;
          sessions.add(id);
          return [id, { platformName: 'Android' }];
        }
        return null;
      },
    };
    return { commands, driver };
  }

  async function boot(opts: { hubBase?: string; nodeBase?: string } = {}) {
    const baseDriver = appiumBaseDriver();
    const hubBase = opts.hubBase ?? '/wd/hub';
    const nodeBase = opts.nodeBase ?? '/node';

    umbrella = umbrellaWith([
      [XenonPlugin, 'xenon'],
      [GatekeeperPlugin, 'gatekeeper'],
    ]);
    const hubServer: http.Server = await baseDriver.server({
      routeConfiguringFunction: baseDriver.routeConfiguringFunction(umbrella),
      port: 0,
      hostname: '127.0.0.1',
      basePath: hubBase,
      cliArgs: { basePath: hubBase },
      serverUpdaters: [
        (app: any) => {
          app.get('/xenon/api/auth/jwks.json', (_req: any, res: any) => res.json(hubKeys.jwks()));
          registerSessionGateway(
            app,
            { basePath: hubBase },
            commandAuthDeps({
              enabled: () => false,
              authDisabled: () => false,
              logger: quiet,
            }),
            hubGatewayOptions({
              basePath: hubBase,
              isLocalHost: (host) => host === hubUrl,
              nodeId: () => HUB_NODE_ID,
              dashboard: () => false,
            }),
          );
        },
      ],
    });
    servers.push(hubServer);
    hubUrl = `http://127.0.0.1:${port(hubServer)}`;
    Container.get(PluginContext).setContext(
      {
        ...DefaultPluginArgs,
        bindHostOrIp: '127.0.0.1',
        enableDashboard: false,
        deviceAvailabilityTimeoutMs: 1_000,
        deviceAvailabilityQueryIntervalMs: 100,
      } as any,
      port(hubServer),
      HUB_NODE_ID,
      hubBase,
    );

    node = fakeNodeDriver();
    // The node's own create layer, from the production wiring; its lifecycle
    // is a stand-in that records the grant (see the node's own spec).
    const nodeLifecycle = {
      prepareSession: async (caps: any, opts?: { hubGrant?: unknown }) => {
        nodeCreates.push({ caps: JSON.parse(JSON.stringify(caps)), grant: opts?.hubGrant });
        if (nodeRefuses) throw new xenonErrors.InvalidArgumentError('the node refused');
        return { remote: false };
      },
      completeRemoteSession: async () => {
        throw new Error('a node never forwards a create');
      },
      releaseAllocation: async () => undefined,
    };
    const nodeOptions = nodeGatewayOptions(hubUrl);
    const nodeServer: http.Server = await baseDriver.server({
      routeConfiguringFunction: baseDriver.routeConfiguringFunction(node.driver),
      port: 0,
      hostname: '127.0.0.1',
      basePath: nodeBase,
      cliArgs: { basePath: nodeBase },
      serverUpdaters: [
        (app: any) => {
          insertBeforeRoutes(app, '/', (req: any, _res: any, next: any) => {
            if (!req.url.startsWith('/xenon/')) {
              nodeRequests.push({
                method: req.method,
                url: req.url,
                headers: { ...req.headers },
                body: req.body,
              });
            }
            next();
          });
          app.get(
            WEBDRIVER_INFO_PATH,
            webdriverInfoHandler(() => nodeBase),
          );
          registerSessionGateway(
            app,
            { basePath: nodeBase },
            commandAuthDeps({ enabled: () => false, authDisabled: () => false, logger: quiet }),
            { ...nodeOptions, create: { ...nodeOptions.create, lifecycle: () => nodeLifecycle } },
          );
        },
      ],
    });
    servers.push(nodeServer);
    nodeOrigin = `http://127.0.0.1:${port(nodeServer)}`;
  }

  /** alice (team A) and bob (team B), members with an ordinary sessions key each. */
  async function seedUsers() {
    keys = {};
    keyIds = {};
    for (const [id, team] of [
      ['alice', 'team-a'],
      ['bob', 'team-b'],
    ]) {
      await scratch.db.team.create({ data: { id: team, name: team } });
      await scratch.db.user.create({
        data: {
          id,
          email: `${id}@xenon.test`,
          name: id,
          passwordHash: 'x',
          accessKey: `ak-${id}`,
          role: 'MEMBER',
        },
      });
      await scratch.db.teamMember.create({ data: { teamId: team, userId: id } });
      const key = await Container.get(ApiKeyService).create({
        name: id,
        scopes: ['sessions'],
        userId: id,
      });
      keys[id] = key.raw;
      keyIds[id] = key.id;
    }
  }

  async function phone(udid: string, where: 'node' | 'hub', extra: Record<string, unknown> = {}) {
    await scratch.db.device.create({
      data: {
        udid,
        host: where === 'node' ? nodeOrigin : hubUrl,
        nodeId: where === 'node' ? 'node-1' : HUB_NODE_ID,
        platform: 'android',
        name: udid,
        sdk: '14',
        busy: false,
        userBlocked: false,
        offline: false,
        ...extra,
      } as any,
    });
  }

  const row = (udid: string) => scratch.db.device.findFirst({ where: { udid } });

  function capsFor(
    who: 'alice' | 'bob',
    xeOptions: Record<string, unknown> = {},
    alwaysMatch: Record<string, unknown> = {},
  ) {
    return {
      capabilities: {
        alwaysMatch: {
          platformName: 'Android',
          'appium:automationName': FAKE_AUTOMATION,
          'appium:newCommandTimeout': 0,
          // No video: it would start Xenon's real capture pipeline for the phone.
          'xe:options': {
            accessKey: `ak-${who}`,
            token: keys[who],
            recordVideo: false,
            ...xeOptions,
          },
          ...alwaysMatch,
        },
        firstMatch: [{}],
      },
    };
  }

  const creates = () => nodeRequests.filter((r) => r.method === 'POST' && /\/session$/.test(r.url));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

  describe('a node’s phone', () => {
    it('is created on the node and answered by the hub; Appium’s createSession never runs', async () => {
      await boot();
      await seedUsers();
      await phone('node-phone', 'node');
      const umbrellaCommands = sinon.spy(umbrella, 'executeCommand');
      const pluginCreate = sinon.spy(XenonPlugin.prototype, 'createSession');

      const res = await request(hubUrl).post('/wd/hub/session').send(capsFor('alice'));
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      const sessionId = res.body.value.sessionId;
      expect(sessionId).to.match(/^node-session-/);
      // The node's capabilities, plus the `desired` ones finalizeSession adds,
      // as a session created through Appium's route always had.
      expect(res.body.value.capabilities.platformName).to.equal('Android');
      expect(res.body.value.capabilities.desired['appium:udid']).to.equal('node-phone');
      expect(JSON.stringify(res.body)).to.not.include(keys.alice);

      // Appium never saw it: no umbrella command, no plugin, no promoted plugin.
      expect(umbrellaCommands.called).to.equal(false);
      expect(pluginCreate.called).to.equal(false);
      expect(umbrella.sessionlessPlugins).to.deep.equal([]);
      expect(Object.keys(umbrella.sessionPlugins)).to.deep.equal([]);
      expect(Object.keys(umbrella.sessions)).to.deep.equal([]);

      // The node created it, under its own base path.
      expect(node.commands).to.deep.equal(['createSession']);
      expect(creates().map((r) => r.url)).to.deep.equal(['/node/session']);

      // The hub's record of it.
      expect(await row('node-phone')).to.include({ busy: true, session_id: sessionId });
      const live = SESSION_MANAGER.getSession(sessionId) as any;
      expect(live?.getType()).to.equal(SessionType.REMOTE);
      expect(live.userId).to.equal('alice');
      expect(await scratch.db.pendingSession.count()).to.equal(0);

      // Its commands then go through the gateway to the node.
      await request(hubUrl).get(`/wd/hub/session/${sessionId}/url`).expect(200);
      expect(node.commands).to.deep.equal(['createSession', 'getUrl']);
      expect(umbrellaCommands.called).to.equal(false);
    });

    it('the node gets the hub’s token for the verified owner, never the client’s credentials', async () => {
      await boot();
      await seedUsers();
      await phone('node-phone', 'node');
      const res = await request(hubUrl)
        .post('/wd/hub/session')
        .set('x-xenon-access-key', 'ak-alice')
        .set('x-xenon-token', keys.alice)
        .set('authorization', 'Bearer SECRET-SESSION-JWT')
        .set('cookie', 'xenon_dashboard_session=SECRET-LEASE-TOKEN')
        .send(
          capsFor('alice', { sessionToken: SECRETS[0], leaseToken: SECRETS[1], buildId: 'b-1' }),
        );
      expect(res.status, JSON.stringify(res.body)).to.equal(200);

      const [sent] = creates();
      const everything = JSON.stringify({ headers: sent.headers, body: sent.body });
      for (const secret of [...SECRETS, keys.alice]) expect(everything).to.not.include(secret);
      for (const header of ['x-xenon-access-key', 'x-xenon-token', 'authorization', 'cookie']) {
        expect(sent.headers[header], header).to.equal(undefined);
      }
      // Options that are not secrets still travel.
      expect(sent.body.capabilities.alwaysMatch['xe:options']).to.deep.equal({
        recordVideo: false,
        buildId: 'b-1',
      });

      const claims = jose.decodeJwt(String(sent.headers[HUB_TOKEN_HEADER]));
      expect(claims).to.include({
        aud: HUB_CREATE_AUDIENCE,
        sub: 'alice',
        udid: 'node-phone',
        host: nodeOrigin,
      });
      // The node's real create layer checked it against the hub's keys.
      expect(nodeCreates).to.have.length(1);
      expect(nodeCreates[0].grant).to.deep.equal({
        userId: 'alice',
        udid: 'node-phone',
        host: nodeOrigin,
      });
      expect(JSON.stringify(nodeCreates[0].caps)).to.not.include(keys.alice);
    });

    it('a node that refuses it: the hub answers the error and frees the phone', async () => {
      await boot();
      await seedUsers();
      await phone('node-phone', 'node');
      nodeRefuses = true;
      const res = await request(hubUrl).post('/wd/hub/session').send(capsFor('alice'));
      expect(res.status).to.equal(500);
      expect(res.body.value.message).to.include('invalid argument');
      expect(await row('node-phone')).to.include({ busy: false, session_id: null });
      expect(SESSION_MANAGER.getAllSessions()).to.deep.equal([]);
      expect(await scratch.db.pendingSession.count()).to.equal(0);
    });
  });

  describe('the hub’s own phone', () => {
    it('is allocated once, in the gateway, and created by Appium through the plugin', async () => {
      await boot();
      await seedUsers();
      await phone('hub-phone', 'hub');
      const lifecycle = Container.get(SessionLifecycleService);
      const allocate = sinon.spy(deviceUtils, 'allocateDeviceForSession');
      const prepare = sinon.spy(lifecycle, 'prepareSession');
      const completeLocal = sinon.spy(lifecycle, 'completeLocalSession');
      const fallback = sinon.spy(lifecycle, 'createSession');

      const res = await request(hubUrl).post('/wd/hub/session').send(capsFor('alice'));
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      const sessionId = res.body.value.sessionId;
      expect(Object.keys(umbrella.sessions)).to.deep.equal([sessionId]);

      expect(allocate.callCount, 'allocations').to.equal(1);
      expect(prepare.callCount).to.equal(1);
      expect(completeLocal.callCount).to.equal(1);
      expect(fallback.called, 'the plugin’s own allocation').to.equal(false);
      expect(await row('hub-phone')).to.include({ busy: true, session_id: sessionId });
      expect(await scratch.db.pendingSession.count()).to.equal(0);
      expect(creates(), 'the node').to.deep.equal([]);

      // The driver never saw the credentials.
      const inner = umbrella.sessions[sessionId];
      expect(JSON.stringify(inner.originalCaps)).to.not.include(keys.alice);

      await request(hubUrl).delete(`/wd/hub/session/${sessionId}`).expect(200);
      expect(await row('hub-phone')).to.include({ busy: false, session_id: null });
    });

    it('is freed when Appium rejects the create after the plugin (no such driver)', async () => {
      await boot();
      await seedUsers();
      await phone('hub-phone', 'hub');
      const lookup = sinon.spy(umbrella.driverConfig, 'findMatchingDriver');
      const res = await request(hubUrl)
        .post('/wd/hub/session')
        .send(capsFor('alice', {}, { 'appium:automationName': 'NoSuchDriver' }));
      expect(res.status).to.equal(500);
      // Appium looked for the driver, after Xenon's plugin, and found none.
      expect(lookup.calledOnce).to.equal(true);
      expect(await lookup.firstCall.returnValue.catch((e: Error) => e.message)).to.include(
        'NoSuchDriver',
      );
      await settle();
      expect(await row('hub-phone')).to.include({ busy: false, session_id: null });
      expect(await scratch.db.pendingSession.count()).to.equal(0);
      expect(Object.keys(umbrella.sessions)).to.deep.equal([]);
    });

    it('is freed when Appium rejects the create before the plugin runs', async () => {
      await boot();
      await seedUsers();
      await phone('hub-phone', 'hub');
      const pluginCreate = sinon.spy(XenonPlugin.prototype, 'createSession');
      const res = await request(hubUrl)
        .post('/wd/hub/session')
        .send(capsFor('alice', {}, { 'gatekeeper:refuse': true }));
      expect(res.status).to.equal(400);
      expect(res.body.value.message).to.include('refused by another plugin');
      expect(pluginCreate.called, 'Xenon’s plugin').to.equal(false);
      await settle();
      expect(await row('hub-phone')).to.include({ busy: false, session_id: null });
      expect(await scratch.db.pendingSession.count()).to.equal(0);
    });
  });

  describe('a lease through the hub', () => {
    const LEASE_TOKEN = 'SECRET-LEASE-TOKEN';

    async function leaseNodePhone() {
      await phone('node-phone', 'node', { busy: true });
      await scratch.db.lease.create({
        data: {
          id: 'lse_1',
          tokenHash: hashToken(LEASE_TOKEN),
          deviceUdid: 'node-phone',
          deviceHost: nodeOrigin,
          actorId: keyIds.alice,
          status: 'active',
          expiresAt: Date.now() + 600_000,
          lastHeartbeatAt: Date.now(),
          allocatedPorts: '{}',
          capabilityBag: '{}',
        },
      });
    }

    it('its token opens the leased node phone; the node gets neither the lease id nor its token', async () => {
      await boot();
      await seedUsers();
      await leaseNodePhone();
      const res = await request(hubUrl)
        .post('/wd/hub/session')
        .send(capsFor('bob', { leaseId: 'lse_1', leaseToken: LEASE_TOKEN }));
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      const [sent] = creates();
      const body = JSON.stringify(sent.body);
      expect(body).to.not.include(LEASE_TOKEN);
      expect(body).to.not.include('lse_1');
      expect(sent.body.capabilities.alwaysMatch['appium:udid']).to.equal('node-phone');
      expect(nodeCreates[0].grant).to.deep.include({ userId: 'bob', udid: 'node-phone' });
      expect(await row('node-phone')).to.include({ session_id: res.body.value.sessionId });
    });

    it('without its token or its creator, is refused at the hub; the node sees nothing', async () => {
      await boot();
      await seedUsers();
      await leaseNodePhone();
      const res = await request(hubUrl)
        .post('/wd/hub/session')
        .send(capsFor('bob', { leaseId: 'lse_1' }));
      expect(res.status).to.equal(500);
      expect(res.body.value.message).to.include('lease lse_1 is not active');
      expect(creates()).to.deep.equal([]);
      expect(await row('node-phone')).to.include({ busy: true, session_id: null });
    });
  });

  describe('a team-scoped member through the hub', () => {
    it('reaches their team’s node phone, and another team’s member does not', async () => {
      await boot();
      await seedUsers();
      await phone('team-a-phone', 'node', { teamId: 'team-a' });

      const refused = await request(hubUrl).post('/wd/hub/session').send(capsFor('bob'));
      expect(refused.status).to.equal(500);
      expect(refused.body.value.message).to.include('No device matching request');
      expect(creates(), 'the node, for bob').to.deep.equal([]);
      expect(await row('team-a-phone')).to.include({ busy: false, session_id: null });

      const allowed = await request(hubUrl).post('/wd/hub/session').send(capsFor('alice'));
      expect(allowed.status, JSON.stringify(allowed.body)).to.equal(200);
      expect(nodeCreates.map((c) => c.grant.userId)).to.deep.equal(['alice']);
    });
  });

  describe('base paths', () => {
    it('a hub at the root creates on a node under its own base path', async () => {
      await boot({ hubBase: '', nodeBase: '/node' });
      await seedUsers();
      await phone('node-phone', 'node');
      const res = await request(hubUrl).post('/session').send(capsFor('alice'));
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      expect(creates().map((r) => r.url)).to.deep.equal(['/node/session']);
    });

    it('a node at the root is created at /session', async () => {
      await boot({ hubBase: '/wd/hub', nodeBase: '' });
      await seedUsers();
      await phone('node-phone', 'node');
      const res = await request(hubUrl).post('/wd/hub/session').send(capsFor('alice'));
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
      expect(creates().map((r) => r.url)).to.deep.equal(['/session']);
    });
  });
});
