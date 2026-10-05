import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { Container } from 'typedi';
import request from './loopbackRequest';
import { XenonPlugin } from '../../src/plugin';
import { commandAuthDeps, registerSessionGateway } from '../../src/app/registerCommandAuth';
import { nodeGatewayOptions } from '../../src/gateway/defaultGateway';
import { HUB_TOKEN_HEADER, HubSessionTokenIssuer } from '../../src/gateway/hubSessionToken';
import {
  NodeSessionProbeSupport,
  registerNodeSessionStatus,
} from '../../src/gateway/nodeSessionStatus';
import { registerNodeSessionMetrics } from '../../src/gateway/nodeSessionMetrics';
import { registerNodeSessionDeviceLogs } from '../../src/gateway/nodeSessionDeviceLogs';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { XenonManager } from '../../src/device-managers';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore, PrismaPendingSessionStore } from '../../src/data-service/prisma-store';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { RemoteSession } from '../../src/sessions/RemoteSession';
import { AppiumUmbrella } from '../../src/sessions/appiumUmbrella';
import { config } from '../../src/config';
import { saveRegistrations } from './container-registration';
import type { ScratchDatabase } from './scratch-database';
import {
  FAKE_AUTOMATION,
  appiumBaseDriver,
  quietAppiumLogs,
  umbrellaWith,
} from './appium-umbrella';

export const NODE_ID = 'node-1';
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

export interface HubAndNode {
  /** The node's origin, once booted. */
  readonly nodeOrigin: string;
  /** Starts the hub (its public keys only) and the node, its phone `phone-1`. */
  boot(nodeArgs?: Record<string, unknown>): Promise<void>;
  /** A session on the node's phone, created as the hub creates it. */
  nodeSession(): Promise<string>;
  /** The hub's object for that session. */
  hubSide(sessionId: string): RemoteSession;
  /** The hub's DELETE of the session, forwarded to the node. */
  deleteOnNode(sessionId: string): Promise<void>;
}

/**
 * A hub and a node in one process, for what a hub collects from a node about
 * a session it runs: the node in Appium 3's own server() (Appium's umbrella
 * with Xenon's plugin, the production node gateway, and the node's
 * session-status, metrics and device-log routes), with per-command auth on,
 * so every ask carries the hub's session token. The hub serves only its
 * public keys: the spec plays the hub's side through the session's
 * RemoteSession.
 *
 * Call it inside a `describe`, after useScratchDatabase(). `services` are the
 * container ids the spec replaces in its own `beforeEach`; they are put back
 * after each test.
 */
export function useHubAndNode(scratch: ScratchDatabase, services: unknown[] = []): HubAndNode {
  const servers: http.Server[] = [];
  let dirs: string[];
  let hubKeys: JwtKeyService;
  let appiumLogs: { restore(): void };
  let restore: () => void;
  let saved: { store: unknown; pending: unknown; context: Partial<PluginContext> };
  let authDisabledBefore: boolean;
  let commandAuthBefore: string | undefined;
  let nodeOrigin = '';

  before(async () => {
    appiumLogs = quietAppiumLogs();
    dirs = [fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-hub-node-keys-'))];
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
      ...services,
    );
    // One process plays both sides: the hub's keys sign, the node checks them.
    Container.set(JwtKeyService, hubKeys);
    Container.set(HubSessionTokenIssuer, new HubSessionTokenIssuer());
    Container.set(AppiumUmbrella, new AppiumUmbrella());
    Container.set(NodeSessionProbeSupport, new NodeSessionProbeSupport());
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

  async function boot(nodeArgs: Record<string, unknown> = {}) {
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
    const hubUrl = `http://127.0.0.1:${port(hubServer)}`;
    const pluginArgs = {
      ...DefaultPluginArgs,
      hub: hubUrl,
      bindHostOrIp: '127.0.0.1',
      enableDashboard: false,
      deviceAvailabilityTimeoutMs: 1_000,
      deviceAvailabilityQueryIntervalMs: 100,
      ...nodeArgs,
    } as any;

    const umbrella = umbrellaWith([[XenonPlugin, 'xenon']]);
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
          registerNodeSessionStatus(api, pluginArgs);
          registerNodeSessionMetrics(api, pluginArgs);
          registerNodeSessionDeviceLogs(api, pluginArgs);
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

  const hubSide = (sessionId: string) =>
    new RemoteSession({
      sessionId,
      device: { udid: 'phone-1', host: nodeOrigin, nodeId: NODE_ID, platform: 'android' } as any,
      sessionResponse: {},
      xenonOption: {},
      baseUrl: `${nodeOrigin}/node`,
    });

  async function deleteOnNode(sessionId: string): Promise<void> {
    const token = await Container.get(HubSessionTokenIssuer).tokenFor(sessionId);
    const res = await request(nodeOrigin)
      .delete(`/node/session/${sessionId}`)
      .set(HUB_TOKEN_HEADER, token as string);
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
  }

  return {
    get nodeOrigin() {
      return nodeOrigin;
    },
    boot,
    nodeSession,
    hubSide,
    deleteOnNode,
  };
}
