import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import request from '../helpers/loopbackRequest';
import { Container } from 'typedi';
import { XenonPlugin } from '../../src/plugin';
import { commandAuthDeps, registerSessionGateway } from '../../src/app/registerCommandAuth';
import { nodeGatewayOptions } from '../../src/gateway/defaultGateway';
import { HUB_TOKEN_HEADER, HubSessionTokenIssuer } from '../../src/gateway/hubSessionToken';
import {
  NODE_SESSION_STATUS_HEADER,
  NodeSessionProbeSupport,
  registerNodeSessionStatus,
} from '../../src/gateway/nodeSessionStatus';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { XenonManager } from '../../src/device-managers';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore, PrismaPendingSessionStore } from '../../src/data-service/prisma-store';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { RemoteSession } from '../../src/sessions/RemoteSession';
import { AppiumUmbrella } from '../../src/sessions/appiumUmbrella';
import { HealthErrorType } from '../../src/sessions/XenonSession';
import { config } from '../../src/config';
import { SessionDeviceLogs } from '../../src/services/logcat/SessionDeviceLogs';
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';
import {
  FAKE_AUTOMATION,
  appiumBaseDriver,
  quietAppiumLogs,
  umbrellaWith,
} from '../helpers/appium-umbrella';

/**
 * The hub's heartbeat on a session a node runs (RemoteSession.checkHealth),
 * against a node in Appium 3's own server(): Appium's umbrella with Xenon's
 * plugin, the production node gateway, and the node's session-status route.
 *
 * The heartbeat runs every ~30 s. Sent as a WebDriver command, it restarted
 * the node driver's new-command timeout and Xenon's idle clock, so a session
 * its client abandoned was never ended, and its phone never freed. It asks the
 * node's umbrella instead, which runs no command. An older node without that
 * route is still probed the old way, and the hub says so once.
 */

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const NODE_ID = 'node-1';

describe('the hub’s heartbeat on a node’s session', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  const servers: http.Server[] = [];
  let dirs: string[];
  let hubKeys: JwtKeyService;
  let appiumLogs: { restore(): void };
  let restore: () => void;
  let saved: { store: unknown; pending: unknown; context: Partial<PluginContext> };
  let authDisabledBefore: boolean;
  let commandAuthBefore: string | undefined;
  let umbrella: any;
  let hubUrl: string;
  let nodeOrigin: string;

  before(async () => {
    appiumLogs = quietAppiumLogs();
    dirs = [fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-heartbeat-keys-'))];
    hubKeys = new JwtKeyService();
    await hubKeys.init(dirs[0]);
  });
  after(() => {
    appiumLogs.restore();
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    restore = saveRegistrations(
      JwtKeyService,
      HubSessionTokenIssuer,
      XenonManager,
      AppiumUmbrella,
      NodeSessionProbeSupport,
      SessionDeviceLogs,
    );
    // One process plays both sides: the hub's keys sign, the node checks them.
    Container.set(JwtKeyService, hubKeys);
    Container.set(HubSessionTokenIssuer, new HubSessionTokenIssuer());
    Container.set(AppiumUmbrella, new AppiumUmbrella());
    Container.set(NodeSessionProbeSupport, new NodeSessionProbeSupport());
    // A node records the device log of each session its hub creates; its
    // phone here is a row, so nothing may reach this machine's adb.
    Container.set(SessionDeviceLogs, {
      start: async () => undefined,
      stop: async () => undefined,
    } as any);
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
    // Per-command auth on: the node then takes the hub's token and nothing else.
    commandAuthBefore = process.env.XENON_REQUIRE_COMMAND_AUTH;
    process.env.XENON_REQUIRE_COMMAND_AUTH = '1';
    await scratch.db.pendingSession.deleteMany({});
    await scratch.db.device.deleteMany({});
  });

  afterEach(async () => {
    for (const s of SESSION_MANAGER.getAllSessions()) SESSION_MANAGER.removeSession(s.getId());
    (DeviceStoreFactory as any)._deviceStore = saved.store;
    (DeviceStoreFactory as any)._pendingSessionStore = saved.pending;
    Object.assign(Container.get(PluginContext), saved.context);
    config.authDisabled = authDisabledBefore;
    if (commandAuthBefore === undefined) delete process.env.XENON_REQUIRE_COMMAND_AUTH;
    else process.env.XENON_REQUIRE_COMMAND_AUTH = commandAuthBefore;
    sinon.restore();
    restore();
    for (const s of servers.splice(0)) {
      s.closeAllConnections();
      await new Promise<void>((resolve) => http.Server.prototype.close.call(s, () => resolve()));
    }
  });

  const port = (s: http.Server) => (s.address() as { port: number }).port;

  /** A hub (its public keys) and a node; `withRoute: false` is an older node. */
  async function boot({ withRoute = true } = {}) {
    const baseDriver = appiumBaseDriver();
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
    const pluginArgs = {
      ...DefaultPluginArgs,
      hub: hubUrl,
      bindHostOrIp: '127.0.0.1',
      enableDashboard: false,
      deviceAvailabilityTimeoutMs: 1_000,
      deviceAvailabilityQueryIntervalMs: 100,
    } as any;

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
            commandAuthDeps({ enabled: () => true, authDisabled: () => false, logger: quiet }),
            nodeGatewayOptions(hubUrl),
          );
          // What ServerManager mounts under /xenon/api on a node.
          const api = express.Router();
          registerNodeSessionStatus(
            api,
            withRoute ? pluginArgs : { ...pluginArgs, hub: undefined },
          );
          app.use('/xenon/api', api);
        },
      ],
    });
    servers.push(nodeServer);
    nodeOrigin = `http://127.0.0.1:${port(nodeServer)}`;
    Container.get(PluginContext).setContext(pluginArgs, port(nodeServer), NODE_ID, '/node');
    await scratch.db.device.create({
      data: {
        udid: 'phone-1',
        host: nodeOrigin,
        nodeId: NODE_ID,
        platform: 'android',
        name: 'phone-1',
        sdk: '14',
        busy: false,
        userBlocked: false,
        offline: false,
      } as any,
    });
  }

  /** A session on the node, created as the hub creates it. */
  async function nodeSession(): Promise<string> {
    const token = await Container.get(HubSessionTokenIssuer).createTokenFor({
      userId: 'alice',
      udid: 'phone-1',
      host: nodeOrigin,
    });
    const res = await request(nodeOrigin)
      .post('/node/session')
      .set(HUB_TOKEN_HEADER, token as string)
      .send({
        capabilities: {
          alwaysMatch: {
            platformName: 'Android',
            'appium:automationName': FAKE_AUTOMATION,
            'appium:newCommandTimeout': 0,
            'appium:udid': 'phone-1',
            'xe:options': { recordVideo: false },
          },
          firstMatch: [{}],
        },
      });
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    return res.body.value.sessionId;
  }

  /** The hub's object for that session. */
  const hubSide = (sessionId: string) =>
    new RemoteSession({
      sessionId,
      device: { udid: 'phone-1', host: nodeOrigin, nodeId: NODE_ID, platform: 'android' } as any,
      sessionResponse: {},
      xenonOption: {},
      baseUrl: `${nodeOrigin}/node`,
    });

  const idleClock = async () =>
    (await scratch.db.device.findFirst({ where: { udid: 'phone-1' } }))?.lastCmdExecutedAt;

  it('asks the node without sending the session a command', async () => {
    await boot();
    const sessionId = await nodeSession();
    const driver = umbrella.sessions[sessionId];
    const restarted = sinon.spy(driver, 'startNewCommandTimeout');
    const commands = sinon.spy(driver, 'executeCommand');
    const before = await idleClock();

    const health = await hubSide(sessionId).checkHealth();

    expect(health).to.deep.include({ isHealthy: true, errorType: HealthErrorType.NONE });
    expect(commands.callCount, 'commands the node’s driver ran').to.equal(0);
    expect(restarted.callCount, 'new-command timeouts restarted').to.equal(0);
    expect(await idleClock(), 'the node’s idle clock').to.equal(before);
  });

  it('reports a session the node no longer has as gone', async () => {
    await boot();
    const sessionId = await nodeSession();
    await umbrella.deleteSession(sessionId);
    const health = await hubSide(sessionId).checkHealth();
    expect(health).to.deep.include({
      isHealthy: false,
      errorType: HealthErrorType.SESSION_NOT_FOUND,
    });
  });

  it('the node answers only with the hub’s token for that session', async () => {
    await boot();
    const sessionId = await nodeSession();
    const other = await Container.get(HubSessionTokenIssuer).tokenFor('another-session');
    const statusOf = (token?: string) => {
      const req = request(nodeOrigin).get(`/xenon/api/node/sessions/${sessionId}`);
      return token ? req.set(HUB_TOKEN_HEADER, token) : req;
    };
    for (const res of [await statusOf(), await statusOf(other as string)]) {
      expect(res.status).to.equal(404);
      expect(res.body.value.error).to.equal('invalid session id');
      expect(res.headers[NODE_SESSION_STATUS_HEADER]).to.equal('1');
    }
    const own = await Container.get(HubSessionTokenIssuer).tokenFor(sessionId);
    const res = await statusOf(own as string);
    expect(res.status).to.equal(200);
    expect(res.body.value).to.deep.equal({ sessionId, exists: true });
  });

  it('asks no more than a command does: with per-command auth off, no token is needed', async () => {
    await boot();
    const sessionId = await nodeSession();
    delete process.env.XENON_REQUIRE_COMMAND_AUTH;
    const res = await request(nodeOrigin).get(`/xenon/api/node/sessions/${sessionId}`);
    expect(res.status).to.equal(200);
    expect(res.body.value).to.deep.equal({ sessionId, exists: true });
  });

  it('an older node without the route is probed the old way, and the hub says so once', async () => {
    await boot({ withRoute: false });
    const sessionId = await nodeSession();
    const warn = sinon.stub(Container.get(NodeSessionProbeSupport).logger, 'warn');
    const hub = hubSide(sessionId);
    expect(await hub.checkHealth()).to.deep.include({ isHealthy: true });
    expect(await hub.checkHealth()).to.deep.include({ isHealthy: true });
    expect(warn.callCount, 'warnings').to.equal(1);
    expect(String(warn.firstCall.args[0])).to.include(nodeOrigin);
  });
});
