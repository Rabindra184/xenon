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
  NodeSessionProbeSupport,
  registerNodeSessionStatus,
} from '../../src/gateway/nodeSessionStatus';
import { registerNodeSessionMetrics } from '../../src/gateway/nodeSessionMetrics';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { NodeMetricsStore } from '../../src/services/metrics/NodeMetricsStore';
import { NodeMetricsCollector } from '../../src/services/metrics/NodeMetricsCollector';
import { NodeMetricsSupport } from '../../src/services/metrics/nodeMetrics';
import { MetricSample, MetricsSampler, SamplerHooks } from '../../src/services/metrics/types';
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
import { saveRegistrations } from '../helpers/container-registration';
import { useScratchDatabase } from '../helpers/scratch-database';
import {
  FAKE_AUTOMATION,
  appiumBaseDriver,
  quietAppiumLogs,
  umbrellaWith,
} from '../helpers/appium-umbrella';

/**
 * A hub collects CPU and memory for a session on a node's phone from the
 * node: against a node in Appium 3's own server() (Appium's umbrella with
 * Xenon's plugin, the production node gateway, and the node's session-status
 * and session-metrics routes), with per-command auth on, so every ask carries
 * the hub's session token. The node's phone sampler is replaced by one the
 * test drives; everything between it and the hub's writes is the real thing.
 */

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const NODE_ID = 'node-1';

/** The node's sampler service, its phone sampler replaced by one the test drives. */
class NodeSideMetrics extends SessionMetricsService {
  hooks: SamplerHooks[] = [];
  stopped = 0;
  protected samplerFor(_id: string, _d: any, _c: any, hooks: SamplerHooks): MetricsSampler {
    this.hooks.push(hooks);
    return { start: () => undefined, stop: async () => void (this.stopped += 1) };
  }
}

/** The hub's sampler service: this hub's own phones are none, it asks the node every 50 ms. */
class HubSideMetrics extends SessionMetricsService {
  written: number[] = [];
  protected context(): any {
    return {
      pluginArgs: { ...DefaultPluginArgs, bindHostOrIp: '127.0.0.1' },
      port: 4799,
      nodeId: 'hub-1',
    };
  }
  protected async writeSamples(_id: string, samples: MetricSample[]): Promise<void> {
    this.written.push(...samples.map((s) => s.at));
  }
  protected collectorFor(source: any, hooks: SamplerHooks, after: number | null): MetricsSampler {
    return new NodeMetricsCollector({
      source,
      hooks,
      after,
      support: Container.get(NodeMetricsSupport),
      logger: quiet,
      intervalMs: 50,
    });
  }
}

const until = async (ok: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const at = (t: number): MetricSample => ({
  at: t,
  deviceCpuPct: 12,
  deviceMemMb: 900,
  deviceMemTotalMb: 4000,
  appCpuPct: 3,
  appMemMb: 150,
  appId: 'com.android.settings',
});

describe('a hub collects a node session’s CPU and memory', function () {
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
  let nodeMetrics: NodeSideMetrics;

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
      SessionMetricsService,
      NodeMetricsStore,
      NodeMetricsSupport,
    );
    nodeMetrics = new NodeSideMetrics();
    Container.set(SessionMetricsService, nodeMetrics);
    Container.set(NodeMetricsStore, new NodeMetricsStore());
    Container.set(NodeMetricsSupport, new NodeMetricsSupport());
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

  /** A hub (its public keys) and a node. */
  async function boot() {
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
          registerNodeSessionStatus(api, pluginArgs);
          registerNodeSessionMetrics(api, pluginArgs);
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

  it("the hub collects a node session's figures as it runs, and the last ones when it ends", async () => {
    await boot();
    const sessionId = await nodeSession();

    // The node samples the session the hub created, its dashboard off.
    expect(nodeMetrics.hooks).to.have.length(1);
    nodeMetrics.hooks[0].onSample(at(1000));
    nodeMetrics.hooks[0].onSample(at(2000));

    const hub = new HubSideMetrics();
    const device = {
      udid: 'phone-1',
      host: nodeOrigin,
      nodeId: NODE_ID,
      platform: 'android',
      realDevice: true,
    } as any;
    hub.start({ sessionId, device, capabilities: {}, source: hubSide(sessionId) });
    expect(hub.recordingState(sessionId)).to.equal('sampling');

    // Live: asked with the hub's token (per-command auth is on), every 50 ms here.
    await until(
      () =>
        hub.written.length === 0 &&
        Container.get(NodeMetricsStore).read(sessionId, null).samples.length === 0,
    );

    nodeMetrics.hooks[0].onSample(at(3000));
    const token = await Container.get(HubSessionTokenIssuer).tokenFor(sessionId);
    const del = await request(nodeOrigin)
      .delete(`/node/session/${sessionId}`)
      .set(HUB_TOKEN_HEADER, token as string);
    expect(del.status, JSON.stringify(del.body)).to.equal(200);
    expect(nodeMetrics.stopped).to.equal(1);
    expect(Container.get(NodeMetricsStore).read(sessionId, 2000).state).to.equal('ended');

    await hub.stop(sessionId);
    expect(hub.written).to.deep.equal([1000, 2000, 3000]);
  });

  it("an older node's sessions say they aren't recorded", async () => {
    await boot();
    const sessionId = await nodeSession();
    const hub = new HubSideMetrics();
    const device = {
      udid: 'phone-1',
      host: nodeOrigin,
      nodeId: NODE_ID,
      platform: 'android',
      realDevice: true,
    } as any;
    const older = Object.assign(hubSide(sessionId), {
      nodeMetrics: async () => ({ kind: 'unsupported', status: 404 }),
    });
    hub.start({ sessionId, device, capabilities: {}, source: older as any });
    await until(() => hub.recordingState(sessionId) === 'off');
  });
});
