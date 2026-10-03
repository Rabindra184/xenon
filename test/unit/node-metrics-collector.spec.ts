import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { NodeMetricsCollector } from '../../src/services/metrics/NodeMetricsCollector';
import {
  NODE_METRICS_HEADER,
  NodeAsk,
  NodeMetricsState,
  NodeMetricsSupport,
  readNodeMetricsReply,
} from '../../src/services/metrics/nodeMetrics';
import { MetricSample } from '../../src/services/metrics/types';

const sample = (at: number): MetricSample => ({
  at,
  deviceCpuPct: 5,
  deviceMemMb: 1,
  deviceMemTotalMb: 2,
  appCpuPct: null,
  appMemMb: null,
  appId: null,
});
const answer = (state: NodeMetricsState, ats: number[]): NodeAsk => ({
  kind: 'answer',
  answer: { platform: 'android', state, samples: ats.map(sample) },
});

describe('NodeMetricsCollector: the hub collects a node session’s figures', () => {
  let clock: sinon.SinonFakeTimers;
  let replies: NodeAsk[];
  let asked: Array<number | null>;
  let got: number[];
  let warned: string[];
  let support: NodeMetricsSupport;
  /** While set, an ask waits on it: a node slow to answer. */
  let gate: Promise<void> | null;

  const source = {
    nodeOrigin: () => 'http://node:4723',
    nodeMetrics: async (after: number | null): Promise<NodeAsk> => {
      asked.push(after);
      if (gate) await gate;
      return replies.shift() ?? answer('sampling', []);
    },
  };
  const make = (after: number | null = null) =>
    new NodeMetricsCollector({
      source,
      hooks: { onSample: (s) => got.push(s.at), onGiveUp: () => undefined },
      support,
      logger: { info: () => undefined, warn: (m: string) => warned.push(m) },
      after,
    });

  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 0 });
    replies = [];
    asked = [];
    got = [];
    warned = [];
    gate = null;
    support = new NodeMetricsSupport();
    support.now = () => clock.now;
    support.logger = { warn: (m: string) => warned.push(m) };
  });
  afterEach(() => clock.restore());

  it('asks every 10 s from the newest sample it has, and passes the samples on', async () => {
    replies = [answer('sampling', [1, 2]), answer('sampling', [3])];
    const c = make();
    c.start();
    await clock.tickAsync(10_000);
    await clock.tickAsync(10_000);
    expect(asked).to.deep.equal([null, 2]);
    expect(got).to.deep.equal([1, 2, 3]);
    expect(c.state()).to.equal('sampling');
  });

  it('starts from the newest sample stored, after a hub restart', async () => {
    const c = make(500);
    c.start();
    await clock.tickAsync(10_000);
    expect(asked).to.deep.equal([500]);
  });

  it('asks once more when the session ends, and takes the last samples', async () => {
    replies = [answer('sampling', [1]), answer('ended', [2, 3])];
    const c = make();
    c.start();
    await clock.tickAsync(10_000);
    await c.stop();
    expect(got).to.deep.equal([1, 2, 3]);
    expect(c.state()).to.equal('stopped');
    await clock.tickAsync(30_000);
    expect(asked).to.have.length(2);
  });

  it('stops asking when the node says off, or that its sampler stopped', async () => {
    for (const [state, ats, expected] of [
      ['off', [], 'off'],
      ['stopped', [7], 'stopped'],
    ] as const) {
      asked = [];
      replies = [answer(state, [...ats])];
      const c = make();
      c.start();
      await clock.tickAsync(30_000);
      expect(asked, state).to.have.length(1);
      expect(c.state(), state).to.equal(expected);
      await c.stop();
      expect(asked, `${state}: no last ask`).to.have.length(1);
    }
  });

  it('stops asking a node without the route, says so once, and asks it again later', async () => {
    replies = [{ kind: 'unsupported', status: 404 }];
    const first = make();
    first.start();
    await clock.tickAsync(10_000);
    expect(first.state()).to.equal('off');

    const second = make();
    second.start();
    await clock.tickAsync(10_000);
    expect(asked).to.have.length(1);
    expect(second.state()).to.equal('off');
    expect(warned.filter((m) => m.includes('http://node:4723'))).to.have.length(1);

    await clock.tickAsync(10 * 60_000);
    const third = make();
    third.start();
    await clock.tickAsync(10_000);
    expect(asked).to.have.length(2);
  });

  it('keeps the figures it has when the node later says off or refuses: it says stopped', async () => {
    for (const last of [answer('off', []), { kind: 'refused' } as NodeAsk]) {
      asked = [];
      replies = [answer('sampling', [1]), last];
      const c = make();
      c.start();
      await clock.tickAsync(20_000);
      expect(asked, last.kind).to.have.length(2);
      expect(c.state(), last.kind).to.equal('stopped');
    }
  });

  it("stops asking when the node refuses the hub's token", async () => {
    replies = [{ kind: 'refused' }];
    const c = make();
    c.start();
    await clock.tickAsync(30_000);
    expect(asked).to.have.length(1);
    expect(c.state()).to.equal('off');
  });

  it('keeps asking an unreachable node, saying so once per outage', async () => {
    replies = [
      { kind: 'unavailable', reason: 'ECONNREFUSED' },
      { kind: 'unavailable', reason: 'ECONNREFUSED' },
      answer('sampling', [1]),
      { kind: 'unavailable', reason: 'timeout' },
    ];
    const c = make();
    c.start();
    await clock.tickAsync(40_000);
    expect(asked).to.have.length(4);
    expect(got).to.deep.equal([1]);
    expect(warned).to.have.length(2);
    expect(c.state()).to.equal('sampling');
  });

  it('finishes stopping when the node is unreachable', async () => {
    replies = [{ kind: 'unavailable', reason: 'timeout' }];
    const c = make();
    c.start();
    await c.stop();
    expect(asked).to.have.length(1);
  });

  it('never asks twice at once, or takes a sample twice', async () => {
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    replies = [answer('sampling', [1, 2]), answer('sampling', [2, 3])];
    const c = make();
    c.start();
    await clock.tickAsync(10_000); // the first ask, held by the node
    await clock.tickAsync(20_000); // two more ticks while it is held
    expect(asked).to.have.length(1);

    gate = null;
    release();
    await clock.tickAsync(10_000); // the first answer arrives; the next ask goes
    expect(asked).to.deep.equal([null, 2]);
    expect(got).to.deep.equal([1, 2, 3]);
  });
});

describe("readNodeMetricsReply: what a node's answer means", () => {
  const h = { [NODE_METRICS_HEADER]: '1' };
  it('reads each answer', () => {
    expect(readNodeMetricsReply(404, {}, undefined)).to.deep.equal({
      kind: 'unsupported',
      status: 404,
    });
    expect(readNodeMetricsReply(404, h, {})).to.deep.equal({ kind: 'refused' });
    expect(
      readNodeMetricsReply(200, h, {
        value: { platform: 'ios', state: 'sampling', samples: [sample(1)] },
      }),
    ).to.deep.equal({
      kind: 'answer',
      answer: { platform: 'ios', state: 'sampling', samples: [sample(1)] },
    });
    // Without the header: an older node only for what an older node answers
    // (its login's 401, an unknown route's 404, a catch-all's 2xx). A proxy's
    // 502 or 503 in front of a new node is an outage, not an older node.
    expect(readNodeMetricsReply(401, {}, {})).to.deep.equal({ kind: 'unsupported', status: 401 });
    expect(readNodeMetricsReply(200, {}, '<html>')).to.deep.equal({
      kind: 'unsupported',
      status: 200,
    });
    for (const status of [500, 502, 503, 504]) {
      expect(readNodeMetricsReply(status, {}, 'Bad Gateway'), String(status)).to.deep.equal({
        kind: 'unavailable',
        reason: `answered ${status}`,
      });
    }
    expect(readNodeMetricsReply(503, h, {})).to.deep.equal({
      kind: 'unavailable',
      reason: 'answered 503',
    });
    expect(readNodeMetricsReply(200, h, { value: { state: 'weird', samples: [] } })).to.deep.equal({
      kind: 'unavailable',
      reason: 'answered 200',
    });
  });
});
