import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  MAX_PAGES_PER_ROUND,
  NodeDeviceLogsCollector,
} from '../../src/services/logcat/NodeDeviceLogsCollector';
import {
  NODE_DEVICE_LOGS_HEADER,
  NodeDeviceLogsAsk,
  NodeDeviceLogsState,
  NodeDeviceLogsSupport,
  nodeDeviceLogsSourceOf,
  readNodeDeviceLogsReply,
} from '../../src/services/logcat/nodeDeviceLogs';
import { OLDER_NODE_RECHECK_MS } from '../../src/gateway/nodeAsk';
import { RemoteSession } from '../../src/sessions/RemoteSession';
import { CloudSession } from '../../src/sessions/CloudSession';

const line = (seq: number) => ({ seq, message: `line ${seq}`, timestamp: 1000 + seq });
const answer = (state: NodeDeviceLogsState, seqs: number[], more = false): NodeDeviceLogsAsk => ({
  kind: 'answer',
  answer: { state, lines: seqs.map(line), more },
});

describe('NodeDeviceLogsCollector: the hub collects a node session’s device log', () => {
  let clock: sinon.SinonFakeTimers;
  let replies: NodeDeviceLogsAsk[];
  let asked: Array<number | null>;
  let got: string[];
  let times: number[];
  let warned: string[];
  let support: NodeDeviceLogsSupport;
  /** While set, an ask waits on it: a node slow to answer. */
  let gate: Promise<void> | null;

  const source = {
    nodeOrigin: () => 'http://node:4723',
    nodeDeviceLogs: async (after: number | null): Promise<NodeDeviceLogsAsk> => {
      asked.push(after);
      if (gate) await gate;
      return replies.shift() ?? answer('recording', []);
    },
  };
  /** While set, writing an answer's lines waits on it: a slow database. */
  let writing: Promise<void> | null;
  const make = (storedTail: Array<{ message: string; timestamp: number }> = []) =>
    new NodeDeviceLogsCollector({
      source,
      onLines: async (lines) => {
        if (writing) await writing;
        got.push(...lines.map((l) => l.message));
        times.push(...lines.map((l) => l.timestamp.getTime()));
      },
      support,
      logger: { info: () => undefined, warn: (m: string) => warned.push(m) },
      storedTail,
    });

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 0 });
    replies = [];
    asked = [];
    got = [];
    times = [];
    warned = [];
    gate = null;
    writing = null;
    support = new NodeDeviceLogsSupport();
    support.now = () => clock.now;
    support.logger = { warn: (m: string) => warned.push(m) };
  });
  afterEach(() => clock.restore());

  it('asks at once, then every 10 s after the newest line it has, and passes the lines on', async () => {
    replies = [answer('recording', [1, 2]), answer('recording', [3])];
    const c = make();
    c.start();
    await clock.tickAsync(0);
    expect(asked).to.deep.equal([null]);
    await clock.tickAsync(9_999);
    expect(asked).to.deep.equal([null]);
    await clock.tickAsync(1);
    expect(asked).to.deep.equal([null, 2]);
    expect(got).to.deep.equal(['line 1', 'line 2', 'line 3']);
    expect(times).to.deep.equal([1001, 1002, 1003]);
  });

  it('asks again at once while the node holds more, a few pages a round', async () => {
    replies = [answer('recording', [1, 2], true), answer('recording', [3, 4], true)];
    for (let i = 0; i < MAX_PAGES_PER_ROUND; i++) {
      replies.push(answer('recording', [5 + i], true));
    }
    const c = make();
    c.start();
    await clock.tickAsync(0);
    expect(asked).to.have.length(MAX_PAGES_PER_ROUND);
    expect(asked.slice(0, 3)).to.deep.equal([null, 2, 4]);
    // The rest wait for the next round, which asks until the node has no more.
    await clock.tickAsync(10_000);
    expect(asked).to.have.length(MAX_PAGES_PER_ROUND + 3);
    await c.stop();
  });

  it('asks once more when the session ends, and takes the last lines', async () => {
    replies = [answer('recording', [1]), answer('ended', [2, 3])];
    const c = make();
    c.start();
    await clock.tickAsync(0);
    await c.stop();
    expect(asked).to.deep.equal([null, 1]);
    expect(got).to.deep.equal(['line 1', 'line 2', 'line 3']);
    await clock.tickAsync(60_000);
    expect(asked).to.have.length(2);
  });

  it('stops asking once the node’s session ended and it has nothing more', async () => {
    replies = [answer('ended', [1, 2], true), answer('ended', [3])];
    const c = make();
    c.start();
    await clock.tickAsync(30_000);
    await c.stop();
    expect(asked).to.deep.equal([null, 2]);
    expect(got).to.deep.equal(['line 1', 'line 2', 'line 3']);
  });

  for (const [what, reply] of [
    ['the node doesn’t record the session', answer('off', [])],
    ['the node refuses the hub’s token', { kind: 'refused' } as NodeDeviceLogsAsk],
  ] as const) {
    it(`stops asking when ${what}`, async () => {
      replies = [reply];
      const c = make();
      c.start();
      await clock.tickAsync(30_000);
      await c.stop();
      expect(asked).to.deep.equal([null]);
    });
  }

  it('says once that a node is older, and leaves it alone for 10 minutes', async () => {
    replies = [{ kind: 'unsupported', status: 404 }];
    const first = make();
    first.start();
    await clock.tickAsync(30_000);
    await first.stop();
    expect(asked).to.deep.equal([null]);
    expect(warned).to.have.length(1);
    expect(warned[0]).to.contain('http://node:4723');

    // Another session on that node: not asked at all.
    const second = make();
    second.start();
    await clock.tickAsync(30_000);
    await second.stop();
    expect(asked).to.deep.equal([null]);

    // After 10 minutes it is asked again, and an older node is said only once.
    await clock.tickAsync(OLDER_NODE_RECHECK_MS);
    replies = [{ kind: 'unsupported', status: 404 }];
    const third = make();
    third.start();
    await clock.tickAsync(0);
    await third.stop();
    expect(asked).to.deep.equal([null, null]);
    expect(warned).to.have.length(1);
  });

  it('asks an unreachable node again, says so once, and doesn’t wait on it at the end', async () => {
    replies = [
      answer('recording', [1]),
      { kind: 'unavailable', reason: 'ECONNREFUSED' },
      { kind: 'unavailable', reason: 'ECONNREFUSED' },
    ];
    const c = make();
    c.start();
    await clock.tickAsync(20_000);
    expect(asked).to.deep.equal([null, 1, 1]);
    expect(warned).to.have.length(1);
    expect(warned[0]).to.contain('ECONNREFUSED');
    await c.stop();
    expect(asked).to.have.length(3);
  });

  it('still asks at the end after one failed ask: the node may have been busy', async () => {
    replies = [
      answer('recording', [1]),
      { kind: 'unavailable', reason: 'timeout' },
      answer('ended', [2, 3]),
    ];
    const c = make();
    c.start();
    await clock.tickAsync(10_000);
    await c.stop();
    expect(asked).to.deep.equal([null, 1, 1]);
    expect(got).to.deep.equal(['line 1', 'line 2', 'line 3']);
  });

  it('writes each answer before asking for the next, which drops it on the node', async () => {
    let release!: () => void;
    writing = new Promise((r) => (release = r));
    replies = [answer('recording', [1, 2], true), answer('recording', [3])];
    const c = make();
    c.start();
    await clock.tickAsync(0);
    expect(asked).to.deep.equal([null]);
    writing = null;
    release();
    await clock.tickAsync(0);
    expect(asked).to.deep.equal([null, 2]);
    await c.stop();
  });

  it('takes up again where it was when an unreachable node answers', async () => {
    replies = [
      answer('recording', [1]),
      { kind: 'unavailable', reason: 'timeout' },
      answer('recording', [2, 3]),
    ];
    const c = make();
    c.start();
    await clock.tickAsync(20_000);
    await c.stop();
    expect(asked).to.deep.equal([null, 1, 1, 3]);
    expect(got).to.deep.equal(['line 1', 'line 2', 'line 3']);
  });

  it('never asks while an ask is still waiting for its answer', async () => {
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    const c = make();
    c.start();
    await clock.tickAsync(35_000);
    expect(asked).to.have.length(1);
    gate = null;
    release();
    await clock.tickAsync(0);
    await c.stop();
  });

  it('ignores a line it already has', async () => {
    replies = [answer('recording', [1, 2]), answer('recording', [2, 3])];
    const c = make();
    c.start();
    await clock.tickAsync(10_000);
    await c.stop();
    expect(got).to.deep.equal(['line 1', 'line 2', 'line 3']);
  });

  describe('after a hub restart', () => {
    it('leaves out the lines the hub had stored, which the node sends again', async () => {
      // The node still holds the last page the hub received before it
      // restarted: it drops lines only when the next ask names them.
      replies = [answer('recording', [7, 8, 9, 10])];
      const c = make([line(6), line(7), line(8)]);
      c.start();
      await clock.tickAsync(0);
      await c.stop();
      expect(got).to.deep.equal(['line 9', 'line 10']);
    });

    it('keeps them all when the node doesn’t hold the newest stored line', async () => {
      replies = [answer('recording', [7, 8]), answer('recording', [9])];
      const c = make([line(5), line(6)]);
      c.start();
      await clock.tickAsync(0);
      expect(got).to.deep.equal(['line 7', 'line 8']);
      await c.stop();
      expect(got).to.deep.equal(['line 7', 'line 8', 'line 9']);
    });

    it('compares only the first answer', async () => {
      replies = [answer('recording', []), answer('recording', [8, 9])];
      const c = make([line(8)]);
      c.start();
      await clock.tickAsync(0);
      await c.stop();
      expect(got).to.deep.equal(['line 8', 'line 9']);
    });

    it('tells apart a line logcat printed twice in one millisecond', async () => {
      // B and its twin are the same line at the same time. The hub stored
      // the first only: the twin and C are new.
      const a = { seq: 1, message: 'A', timestamp: 1 };
      const b = { seq: 2, message: 'B', timestamp: 2 };
      const twin = { seq: 3, message: 'B', timestamp: 2 };
      const c3 = { seq: 4, message: 'C', timestamp: 3 };
      const page: NodeDeviceLogsAsk = {
        kind: 'answer',
        answer: { state: 'recording', lines: [a, b, twin, c3], more: false },
      };
      replies = [page];
      const first = make([a, b]);
      first.start();
      await clock.tickAsync(0);
      await first.stop();
      expect(got).to.deep.equal(['B', 'C']);

      // Both stored: only C is new.
      got = [];
      replies = [{ ...page }];
      const second = make([a, b, twin]);
      second.start();
      await clock.tickAsync(0);
      await second.stop();
      expect(got).to.deep.equal(['C']);
    });
  });
});

describe('reading a node’s device log answer', () => {
  const has = { [NODE_DEVICE_LOGS_HEADER]: '1' };

  it('reads the lines, and leaves out any that isn’t one', () => {
    const reply = readNodeDeviceLogsReply(200, has, {
      value: {
        state: 'recording',
        more: true,
        lines: [
          line(1),
          { seq: 0, message: 'x', timestamp: 1 },
          { seq: 2.5, message: 'x', timestamp: 1 },
          { seq: 3, message: 42, timestamp: 1 },
          { seq: 4, message: 'x', timestamp: 'now' },
          null,
          line(5),
        ],
      },
    });
    expect(reply).to.deep.equal({
      kind: 'answer',
      answer: { state: 'recording', more: true, lines: [line(1), line(5)] },
    });
  });

  it('takes a node without the header for an older one only when it answers 401, 404 or 2xx', () => {
    for (const status of [200, 401, 404]) {
      expect(readNodeDeviceLogsReply(status, {}, {})).to.deep.equal({
        kind: 'unsupported',
        status,
      });
    }
    // A proxy's 502 in front of a node is an outage.
    expect(readNodeDeviceLogsReply(502, {}, {}).kind).to.equal('unavailable');
  });

  it('takes a 404 with the header for a refusal, and anything else it can’t read for an outage', () => {
    expect(readNodeDeviceLogsReply(404, has, {}).kind).to.equal('refused');
    expect(readNodeDeviceLogsReply(503, has, {}).kind).to.equal('unavailable');
    expect(readNodeDeviceLogsReply(200, has, { value: { state: 'x', lines: [] } }).kind).to.equal(
      'unavailable',
    );
  });

  it('asks only a session a node runs, never a cloud provider’s', () => {
    const opts = {
      sessionId: 's1',
      device: { udid: 'p', host: 'http://node:4723' } as any,
      sessionResponse: {},
      xenonOption: {},
      baseUrl: 'http://node:4723/wd/hub',
    };
    expect(nodeDeviceLogsSourceOf(new RemoteSession(opts))).to.not.equal(undefined);
    expect(nodeDeviceLogsSourceOf(new CloudSession(opts as any))).to.equal(undefined);
    expect(nodeDeviceLogsSourceOf(undefined)).to.equal(undefined);
  });
});
