import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import { SessionDeviceLogs } from '../../src/services/logcat/SessionDeviceLogs';
import { NodeDeviceLogStore } from '../../src/services/logcat/NodeDeviceLogStore';
import {
  NodeDeviceLogsCollector,
  StoredLine,
} from '../../src/services/logcat/NodeDeviceLogsCollector';
import {
  NodeDeviceLogsSource,
  NodeDeviceLogsSupport,
} from '../../src/services/logcat/nodeDeviceLogs';
import { UNKNOWN_CLOCK, type DeviceLogLine } from '../../src/services/logcat/deviceLogBook';
import { HUB_TOKEN_HEADER } from '../../src/gateway/hubSessionToken';
import { UNKNOWN_SESSION_BODY } from '../../src/middleware/commandAuth';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { useScratchDatabase } from '../helpers/scratch-database';
import { ADMIN, selectorHealthApp } from '../helpers/selector-health-fixture';
import { NODE_ID, useHubAndNode } from '../helpers/hub-node-pair';
import { FakeLogcatStreams, lineAt, until } from '../helpers/fake-logcat';

/**
 * A hub writes the Device logs of a session on a node's phone, collected from
 * the node: the node records its phone's log for the session the hub created
 * (its dashboard off) and holds the lines; the hub asks for them with its
 * session token (per-command auth is on) and writes them as the session page
 * reads them. The node's `adb logcat` is fake; everything from it to the
 * hub's rows is the real thing.
 */

const quiet = { info: () => undefined, warn: () => undefined, debug: () => undefined };

/** The node's service, its phone's log stream fake. */
class NodeSideDeviceLogs extends SessionDeviceLogs {
  constructor(
    readonly logcat: FakeLogcatStreams,
    readonly unclaimed = 60_000,
  ) {
    super();
  }
  protected streams() {
    return this.logcat;
  }
  protected async readClock() {
    return UNKNOWN_CLOCK;
  }
  protected unclaimedMs() {
    return this.unclaimed;
  }
}

/** The hub's service: none of the phones are its own; it asks the node every 50 ms. */
class HubSideDeviceLogs extends SessionDeviceLogs {
  protected context(): any {
    return {
      pluginArgs: { ...DefaultPluginArgs, bindHostOrIp: '127.0.0.1' },
      port: 4799,
      nodeId: 'hub-1',
    };
  }
  protected collectorFor(
    source: NodeDeviceLogsSource,
    onLines: (rows: DeviceLogLine[]) => Promise<void>,
    storedTail: StoredLine[],
  ) {
    return new NodeDeviceLogsCollector({
      source,
      onLines,
      storedTail,
      support: Container.get(NodeDeviceLogsSupport),
      logger: quiet,
      intervalMs: 50,
    });
  }
}

describe('a hub writes a node session’s device log', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  const pair = useHubAndNode(scratch, [
    SessionDeviceLogs,
    NodeDeviceLogStore,
    NodeDeviceLogsSupport,
  ]);
  let logcat: FakeLogcatStreams;

  beforeEach(() => {
    logcat = new FakeLogcatStreams();
    Container.set(NodeDeviceLogStore, new NodeDeviceLogStore());
    Container.set(NodeDeviceLogsSupport, new NodeDeviceLogsSupport());
  });
  afterEach(() => logcat.cleanup());

  /** Boots the pair, the node's device log service `nodeLogs`; no CPU and memory sampling. */
  async function boot(nodeLogs: NodeSideDeviceLogs) {
    Container.set(SessionDeviceLogs, nodeLogs);
    await pair.boot({ sessionMetrics: false });
  }

  /** The hub's row for the session, as onSessionStarted writes it. */
  const hubRow = (sessionId: string) =>
    scratch.db.session.create({
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

  /** The session's Device logs as the hub's session page gets them. */
  const page = async (sessionId: string): Promise<string[]> => {
    const res = await request(selectorHealthApp(ADMIN)).get(`/session/${sessionId}/logs/device`);
    expect(res.status, res.text).to.equal(200);
    return res.body.map((r: { message: string }) => r.message.replace(/^.*?Tag {5}: /, ''));
  };

  /** The page, once `ok` holds for it. */
  const pageOnce = async (sessionId: string, ok: (rows: string[]) => boolean) => {
    const end = Date.now() + 5_000;
    for (;;) {
      const rows = await page(sessionId);
      if (ok(rows)) return rows;
      if (Date.now() > end) throw new Error(`timed out at ${JSON.stringify(rows)}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  const device = () =>
    ({ udid: 'phone-1', host: pair.nodeOrigin, nodeId: NODE_ID, platform: 'android' }) as any;

  it('writes the lines as the session runs, and the last ones when it ends', async () => {
    const nodeLogs = new NodeSideDeviceLogs(logcat);
    await boot(nodeLogs);
    const sessionId = await pair.nodeSession();

    // The node records the session the hub created, its dashboard off.
    expect(nodeLogs.isRecording(sessionId)).to.equal(true);
    await until(() => logcat.procs.length === 1);
    logcat.proc.stdout.write(lineAt(Date.now() - 600_000, 'before the session'));
    logcat.proc.stdout.write(lineAt(Date.now(), 'app started'));

    await hubRow(sessionId);
    const hub = new HubSideDeviceLogs();
    await hub.start({ sessionId, device: device(), source: pair.hubSide(sessionId) });
    // Live: written while the session runs.
    expect(await pageOnce(sessionId, (rows) => rows.length > 0)).to.deep.equal(['app started']);

    // The test's last moments, then the hub's DELETE reaches the node.
    logcat.proc.stdout.write(lineAt(Date.now(), 'FATAL EXCEPTION: main'));
    await until(() => Container.get(NodeDeviceLogStore).read(sessionId, null).lines.length > 0);
    await pair.deleteOnNode(sessionId);
    expect(nodeLogs.isRecording(sessionId)).to.equal(false);
    await hub.stop(sessionId);

    expect(await page(sessionId)).to.deep.equal(['app started', 'FATAL EXCEPTION: main']);
  });

  it('asks only with the hub’s token for the session', async () => {
    await boot(new NodeSideDeviceLogs(logcat));
    const sessionId = await pair.nodeSession();
    const route = `/xenon/api/node/sessions/${sessionId}/device-logs`;

    const without = await request(pair.nodeOrigin).get(route);
    const forged = await request(pair.nodeOrigin).get(route).set(HUB_TOKEN_HEADER, 'forged');
    expect([without.status, without.body]).to.deep.equal([404, UNKNOWN_SESSION_BODY]);
    expect([forged.status, forged.body]).to.deep.equal([404, UNKNOWN_SESSION_BODY]);

    const asked = await pair.hubSide(sessionId).nodeDeviceLogs(null);
    expect(asked).to.deep.equal({
      kind: 'answer',
      answer: { state: 'recording', lines: [], more: false },
    });
    await pair.deleteOnNode(sessionId);
  });

  it('records nothing for a session that turned its device log off', async () => {
    const nodeLogs = new NodeSideDeviceLogs(logcat);
    await boot(nodeLogs);
    const sessionId = await pair.nodeSession({ 'xe:save_device_logs': false });

    expect(nodeLogs.isRecording(sessionId)).to.equal(false);
    expect(logcat.procs).to.have.length(0);
    expect(await pair.hubSide(sessionId).nodeDeviceLogs(null)).to.deep.equal({
      kind: 'answer',
      answer: { state: 'off', lines: [], more: false },
    });
    await pair.deleteOnNode(sessionId);
  });

  it('stops recording a session its hub doesn’t ask about', async () => {
    const nodeLogs = new NodeSideDeviceLogs(logcat, 50);
    await boot(nodeLogs);
    const sessionId = await pair.nodeSession();
    await until(() => !nodeLogs.isRecording(sessionId));

    expect(await pair.hubSide(sessionId).nodeDeviceLogs(null)).to.deep.equal({
      kind: 'answer',
      answer: { state: 'off', lines: [], more: false },
    });
    await pair.deleteOnNode(sessionId);
  });
});
