import 'reflect-metadata';
import { expect } from 'chai';
import request from '../helpers/loopbackRequest';
import { Container } from 'typedi';
import { SessionMetricsService } from '../../src/services/metrics/SessionMetricsService';
import { NodeMetricsStore } from '../../src/services/metrics/NodeMetricsStore';
import { NodeMetricsCollector } from '../../src/services/metrics/NodeMetricsCollector';
import { NodeMetricsSupport } from '../../src/services/metrics/nodeMetrics';
import { MetricSample, MetricsSampler, SamplerHooks } from '../../src/services/metrics/types';
import { SessionDeviceLogs } from '../../src/services/logcat/SessionDeviceLogs';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { useScratchDatabase } from '../helpers/scratch-database';
import { ADMIN, selectorHealthApp } from '../helpers/selector-health-fixture';
import { NODE_ID, useHubAndNode } from '../helpers/hub-node-pair';

/**
 * A hub collects CPU and memory for a session on a node's phone from the
 * node: against a node in Appium 3's own server() (Appium's umbrella with
 * Xenon's plugin, the production node gateway, and the node's session-status
 * and session-metrics routes), with per-command auth on, so every ask carries
 * the hub's session token. The node's phone sampler is replaced by one the
 * test drives; everything between it and the hub's writes is the real thing.
 */

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** The node's sampler service, its phone sampler replaced by one the test drives. */
class NodeSideMetrics extends SessionMetricsService {
  hooks: SamplerHooks[] = [];
  stopped = 0;
  protected samplerFor(_id: string, _d: any, _c: any, hooks: SamplerHooks): MetricsSampler {
    this.hooks.push(hooks);
    return { start: () => undefined, stop: async () => void (this.stopped += 1) };
  }
}

const hubContext = () => ({
  pluginArgs: { ...DefaultPluginArgs, bindHostOrIp: '127.0.0.1' },
  port: 4799,
  nodeId: 'hub-1',
});
const fastCollector = (source: any, hooks: SamplerHooks, after: number | null) =>
  new NodeMetricsCollector({
    source,
    hooks,
    after,
    support: Container.get(NodeMetricsSupport),
    logger: quiet,
    intervalMs: 50,
  });

/** The hub's sampler service: this hub's own phones are none, it asks the node every 50 ms. */
class HubSideMetrics extends SessionMetricsService {
  written: number[] = [];
  protected context(): any {
    return hubContext();
  }
  protected async writeSamples(_id: string, samples: MetricSample[]): Promise<void> {
    this.written.push(...samples.map((s) => s.at));
  }
  protected collectorFor(source: any, hooks: SamplerHooks, after: number | null): MetricsSampler {
    return fastCollector(source, hooks, after);
  }
}

/** The same, writing to the hub's database every 100 ms, as the page reads it. */
class HubStoringMetrics extends SessionMetricsService {
  protected context(): any {
    return hubContext();
  }
  protected flushIntervalMs(): number {
    return 100;
  }
  protected collectorFor(source: any, hooks: SamplerHooks, after: number | null): MetricsSampler {
    return fastCollector(source, hooks, after);
  }
}

const untilAsync = async (ok: () => Promise<boolean>, ms = 5000) => {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};
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
  const pair = useHubAndNode(scratch, [
    SessionMetricsService,
    NodeMetricsStore,
    NodeMetricsSupport,
    SessionDeviceLogs,
  ]);
  let nodeMetrics: NodeSideMetrics;

  beforeEach(() => {
    nodeMetrics = new NodeSideMetrics();
    Container.set(SessionMetricsService, nodeMetrics);
    Container.set(NodeMetricsStore, new NodeMetricsStore());
    Container.set(NodeMetricsSupport, new NodeMetricsSupport());
    // The node records the session's device log too; not here.
    Container.set(SessionDeviceLogs, {
      start: async () => undefined,
      stop: async () => undefined,
    } as any);
  });

  const boot = () => pair.boot();
  const nodeSession = () => pair.nodeSession();
  const hubSide = (sessionId: string) => pair.hubSide(sessionId);

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
      host: pair.nodeOrigin,
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
    await pair.deleteOnNode(sessionId);
    expect(nodeMetrics.stopped).to.equal(1);
    expect(Container.get(NodeMetricsStore).read(sessionId, 2000).state).to.equal('ended');

    await hub.stop(sessionId);
    expect(hub.written).to.deep.equal([1000, 2000, 3000]);
  });

  it("shows a node session's figures on the hub's own metrics route while it runs", async () => {
    await boot();
    const sessionId = await nodeSession();
    nodeMetrics.hooks[0].onSample(at(1000));
    nodeMetrics.hooks[0].onSample(at(2000));
    // The hub's row for the session, as onSessionStarted writes it.
    await scratch.db.session.create({
      data: {
        id: sessionId,
        device_udid: 'phone-1',
        device_platform: 'android',
        device_version: '14',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: NODE_ID,
        has_live_video: false,
        status: 'running',
      },
    });
    const hub = new HubStoringMetrics();
    const device = {
      udid: 'phone-1',
      host: pair.nodeOrigin,
      nodeId: NODE_ID,
      platform: 'android',
      realDevice: true,
    } as any;
    hub.start({ sessionId, device, capabilities: {}, source: hubSide(sessionId) });
    // The route asks the server's own service whether the session is sampled.
    Container.set(SessionMetricsService, hub);
    try {
      const page = selectorHealthApp(ADMIN);
      let body: any;
      await untilAsync(async () => {
        body = (await request(page).get(`/session/${sessionId}/metrics`)).body;
        return body?.samples?.length === 2;
      });
      expect(body.recording).to.equal('sampling');
      expect(body.samples.map((x: { t: number }) => x.t)).to.deep.equal([1000, 2000]);
      expect(body.samples[1]).to.include({ deviceCpu: 12, app: 'com.android.settings' });
    } finally {
      Container.set(SessionMetricsService, nodeMetrics);
      await hub.stop(sessionId);
    }
  });

  it("an older node's sessions say they aren't recorded", async () => {
    await boot();
    const sessionId = await nodeSession();
    const hub = new HubSideMetrics();
    const device = {
      udid: 'phone-1',
      host: pair.nodeOrigin,
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
