import 'reflect-metadata';
import { expect } from 'chai';
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
import {
  DEVICE_LOG_LINE_LIMIT,
  UNKNOWN_CLOCK,
  type DeviceLogLine,
} from '../../src/services/logcat/deviceLogBook';
import type { IDevice } from '../../src/interfaces/IDevice';
import { useScratchDatabase } from '../helpers/scratch-database';
import { FakeLogcatStreams, lineAt, settle, until } from '../helpers/fake-logcat';

const quiet = { info: () => undefined, warn: () => undefined, debug: () => undefined };

/** A node's service: its own phone's log stream fake, its rows held in `store`. */
class NodeSideDeviceLogs extends SessionDeviceLogs {
  writes = 0;
  constructor(
    readonly logcat: FakeLogcatStreams,
    readonly store: NodeDeviceLogStore,
    readonly unclaimed = 60_000,
  ) {
    super();
  }
  protected context() {
    return {
      pluginArgs: { bindHostOrIp: '127.0.0.1', hub: 'http://127.0.0.1:4724' },
      port: 4725,
      nodeId: 'node-1',
    } as any;
  }
  protected streams() {
    return this.logcat;
  }
  protected async readClock() {
    return UNKNOWN_CLOCK;
  }
  protected nodeStore() {
    return this.store;
  }
  protected unclaimedMs() {
    return this.unclaimed;
  }
  protected async writeLines() {
    this.writes += 1;
  }
}

/** A hub's service: no phone of its own here; it asks a node every 20 ms. */
class HubSideDeviceLogs extends SessionDeviceLogs {
  protected context() {
    return { pluginArgs: { bindHostOrIp: '127.0.0.1' }, port: 4724, nodeId: 'hub-1' } as any;
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
      support: new NodeDeviceLogsSupport(),
      logger: quiet,
      intervalMs: 20,
    });
  }
}

/** The phone as the node files it, and as the hub has it from the node's report. */
const NODE_PHONE: IDevice = {
  udid: 'phone-1',
  platform: 'android',
  host: 'http://127.0.0.1:4725',
  nodeId: 'node-1',
} as IDevice;

/** The node as the hub's collector sees it: the node's own store, behind its route. */
const nodeAt = (store: NodeDeviceLogStore, sessionId: string): NodeDeviceLogsSource => ({
  nodeOrigin: () => 'http://127.0.0.1:4725',
  nodeDeviceLogs: async (after) => ({ kind: 'answer', answer: store.read(sessionId, after) }),
});

const row = (n: number): DeviceLogLine => ({
  message: `line ${n}`,
  timestamp: new Date(1_700_000_000_000 + n),
});

describe('A node records its phone’s device log for its hub', function () {
  this.timeout(60_000);
  let logcat: FakeLogcatStreams;
  let store: NodeDeviceLogStore;

  beforeEach(() => {
    logcat = new FakeLogcatStreams();
    store = new NodeDeviceLogStore();
  });
  afterEach(() => logcat.cleanup());

  it('holds the lines for the hub, whatever its dashboard setting, and writes none', async () => {
    const logs = new NodeSideDeviceLogs(logcat, store);
    const since = Date.now() - 60_000;
    await logs.start({ sessionId: 'n1', device: NODE_PHONE, since });
    logcat.proc.stdout.write(lineAt(since - 600_000, 'before the session'));
    logcat.proc.stdout.write(lineAt(since + 1_000, 'first'));
    logcat.proc.stdout.write(lineAt(since + 2_000, 'FATAL EXCEPTION: main', 'E', 'AndroidRuntime'));
    await settle();

    const held = store.read('n1', null);
    expect(held.state).to.equal('recording');
    expect(held.lines.map((l) => l.seq)).to.deep.equal([1, 2]);
    expect(held.lines[1].message).to.match(/ E AndroidRuntime: FATAL EXCEPTION: main$/);
    expect(held.lines[1].timestamp).to.equal(since + 2_000);

    await logs.stop('n1');
    expect(store.read('n1', 2).state).to.equal('ended');
    expect(logs.writes).to.equal(0);
  });

  it('keeps the session’s line limit, so a hub is sent no more than its own phone’s session keeps', async () => {
    const logs = new NodeSideDeviceLogs(logcat, store);
    const since = Date.now() - 60_000;
    await logs.start({ sessionId: 'n2', device: NODE_PHONE, since });
    for (let i = 0; i < DEVICE_LOG_LINE_LIMIT + 5; i++) {
      logcat.proc.stdout.write(lineAt(since + 1_000 + i, `line ${i}`));
    }
    logcat.proc.stdout.write(lineAt(since + 30_000, 'the end', 'E', 'AndroidRuntime'));
    const held = () => (store as any).entries.get('n2').lines.length;
    await until(() => held() === DEVICE_LOG_LINE_LIMIT + 2, 20_000);
    await logs.stop('n2');

    let after: number | null = null;
    const all: string[] = [];
    for (;;) {
      const page = store.read('n2', after);
      all.push(...page.lines.map((l) => l.message));
      if (!page.more) break;
      after = page.lines[page.lines.length - 1].seq;
    }
    // The limit, a note that only errors are kept from there, the error, and
    // a note that the 5 other lines were left out.
    expect(all).to.have.length(DEVICE_LOG_LINE_LIMIT + 3);
    expect(all[DEVICE_LOG_LINE_LIMIT]).to.contain('only errors are kept');
    expect(all[DEVICE_LOG_LINE_LIMIT + 1]).to.match(/ E AndroidRuntime: the end$/);
    expect(all[DEVICE_LOG_LINE_LIMIT + 2]).to.contain('5 device log lines were left out');
  });

  it('stops recording a session no hub has asked about', async () => {
    const logs = new NodeSideDeviceLogs(logcat, store, 30);
    await logs.start({ sessionId: 'n3', device: NODE_PHONE, since: Date.now() });
    expect(logcat.getMultiplexer(NODE_PHONE.udid)?.clientCount).to.equal(1);

    await until(() => !logs.isRecording('n3'));
    expect(logcat.getMultiplexer(NODE_PHONE.udid)?.clientCount ?? 0).to.equal(0);
    expect(store.read('n3', null)).to.deep.equal({ state: 'off', lines: [], more: false });
    // Ending it later does nothing more.
    await logs.stop('n3');
    expect(store.read('n3', null).state).to.equal('off');
  });

  it('records to the end once a hub has asked', async () => {
    const logs = new NodeSideDeviceLogs(logcat, store, 30);
    const since = Date.now() - 1_000;
    await logs.start({ sessionId: 'n4', device: NODE_PHONE, since });
    store.read('n4', null);
    await new Promise((r) => setTimeout(r, 80));

    expect(logs.isRecording('n4')).to.equal(true);
    logcat.proc.stdout.write(lineAt(Date.now(), 'still here'));
    await settle();
    expect(store.read('n4', null).lines.map((l) => l.message)).to.have.length(1);
    await logs.stop('n4');
  });

  it('keeps a session that ended before any hub asked, for the hub’s last ask', async () => {
    const logs = new NodeSideDeviceLogs(logcat, store, 30);
    const since = Date.now() - 1_000;
    await logs.start({ sessionId: 'n5', device: NODE_PHONE, since });
    logcat.proc.stdout.write(lineAt(Date.now(), 'a short session'));
    await settle();
    await logs.stop('n5');
    await new Promise((r) => setTimeout(r, 80));

    const held = store.read('n5', null);
    expect(held.state).to.equal('ended');
    expect(held.lines).to.have.length(1);
  });
});

describe('A hub writes a node session’s device log', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  let node: NodeDeviceLogStore;
  let count = 0;
  let sessionId: string;

  beforeEach(async () => {
    count += 1;
    sessionId = `hub-dl-${count}`;
    node = new NodeDeviceLogStore();
    node.begin(sessionId);
    await scratch.db.session.create({
      data: {
        id: sessionId,
        device_udid: NODE_PHONE.udid,
        device_platform: 'android',
        device_version: '10',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: 'node-1',
        has_live_video: false,
      },
    });
  });

  const stored = () =>
    scratch.db.log.findMany({
      where: { session_id: sessionId, log_type: 'DEVICE' },
      orderBy: { createdAt: 'asc' },
    });

  it('collects only a node’s phone, through its session, and never a cloud provider’s', () => {
    const hub = new HubSideDeviceLogs();
    const source = nodeAt(node, sessionId);
    expect(hub.appliesTo(NODE_PHONE, source)).to.equal(true);
    expect(hub.appliesTo(NODE_PHONE)).to.equal(false);
    expect(hub.appliesTo({ ...NODE_PHONE, cloud: 'browserstack' } as any, source)).to.equal(false);
    expect(hub.appliesTo({ ...NODE_PHONE, platform: 'ios' } as IDevice, source)).to.equal(false);
    // A node never collects from another server.
    expect(
      new NodeSideDeviceLogs(new FakeLogcatStreams(), node).appliesTo(
        { ...NODE_PHONE, nodeId: 'node-2', host: 'http://10.0.0.9:4725' } as IDevice,
        source,
      ),
    ).to.equal(false);
  });

  it('writes the lines as the node gives them, in its order, and the last ones at the end', async () => {
    const hub = new HubSideDeviceLogs();
    node.add(sessionId, [row(1), row(2)]);
    await hub.start({ sessionId, device: NODE_PHONE, source: nodeAt(node, sessionId) });

    await until(() => node.claimed(sessionId));
    await new Promise((r) => setTimeout(r, 50));
    expect((await stored()).map((r) => r.message)).to.deep.equal(['line 1', 'line 2']);

    // The node's last lines, then its session ends before the hub's.
    node.add(sessionId, [row(3), row(4)]);
    node.end(sessionId);
    await hub.stop(sessionId);

    const rows = await stored();
    expect(rows.map((r) => r.message)).to.deep.equal(['line 1', 'line 2', 'line 3', 'line 4']);
    // Each line keeps the node's time; each row its own `createdAt`, in order.
    expect(rows.map((r) => r.timestamp.getTime())).to.deep.equal(
      [1, 2, 3, 4].map((n) => row(n).timestamp.getTime()),
    );
    const created = rows.map((r) => r.createdAt.getTime());
    expect(
      created.every((t, i) => i === 0 || t > created[i - 1]),
      String(created),
    ).to.equal(true);
  });

  it('goes on after a restart after the newest line stored, without writing it twice', async () => {
    // Before the restart the hub wrote lines 1 to 3, the last two from an
    // answer whose lines the node still holds: it drops them only when the
    // next ask names them.
    const later = Date.now() + 60_000;
    await scratch.db.log.createMany({
      data: [1, 2, 3].map((n) => ({
        session_id: sessionId,
        log_type: 'DEVICE',
        message: row(n).message,
        timestamp: row(n).timestamp,
        createdAt: new Date(later + n),
      })),
    });
    node.add(sessionId, [1, 2, 3, 4, 5].map(row));
    node.read(sessionId, 1);

    const hub = new HubSideDeviceLogs();
    await hub.start({
      sessionId,
      device: NODE_PHONE,
      source: nodeAt(node, sessionId),
      resume: true,
    });
    node.end(sessionId);
    await hub.stop(sessionId);

    const rows = await stored();
    expect(rows.map((r) => r.message)).to.deep.equal([1, 2, 3, 4, 5].map((n) => `line ${n}`));
    expect(rows[3].createdAt.getTime()).to.be.greaterThan(later + 3);
  });

  it('a second stop waits for the first one’s last lines', async () => {
    // A node slow to answer: the first stop is still in its last ask.
    const slow = nodeAt(node, sessionId);
    const source: NodeDeviceLogsSource = {
      nodeOrigin: slow.nodeOrigin,
      nodeDeviceLogs: async (after) => {
        await new Promise((r) => setTimeout(r, 50));
        return slow.nodeDeviceLogs(after);
      },
    };
    const hub = new HubSideDeviceLogs();
    node.add(sessionId, [row(1)]);
    await hub.start({ sessionId, device: NODE_PHONE, source });
    await until(() => node.claimed(sessionId));
    node.add(sessionId, [row(2)]);
    node.end(sessionId);

    const first = hub.stop(sessionId);
    // The failure analysis, after a second ending's stop, reads them all.
    await hub.stop(sessionId);
    expect((await stored()).map((r) => r.message)).to.deep.equal(['line 1', 'line 2']);
    await first;
  });

  it('takes the node’s last lines though the session ends while collection resumes', async () => {
    class SlowToResume extends HubSideDeviceLogs {
      protected async storedTail(id: string) {
        await new Promise((r) => setTimeout(r, 50));
        return super.storedTail(id);
      }
    }
    const hub = new SlowToResume();
    node.add(sessionId, [row(1), row(2)]);
    node.end(sessionId);
    void hub.start({
      sessionId,
      device: NODE_PHONE,
      source: nodeAt(node, sessionId),
      resume: true,
    });
    await hub.stop(sessionId);
    expect((await stored()).map((r) => r.message)).to.deep.equal(['line 1', 'line 2']);
  });

  it('collects nothing from a node that doesn’t record the session', async () => {
    const hub = new HubSideDeviceLogs();
    node.forget(sessionId);
    await hub.start({ sessionId, device: NODE_PHONE, source: nodeAt(node, sessionId) });
    await hub.stop(sessionId);
    expect(await stored()).to.deep.equal([]);
  });
});
