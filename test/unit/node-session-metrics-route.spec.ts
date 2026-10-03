import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';
import {
  nodeSessionMetricsHandler,
  parseAfter,
  registerNodeSessionMetrics,
} from '../../src/gateway/nodeSessionMetrics';
import { NODE_METRICS_HEADER, NodeMetricsAnswer } from '../../src/services/metrics/nodeMetrics';
import { HUB_TOKEN_HEADER } from '../../src/gateway/hubSessionToken';
import {
  COMMAND_AUTH_UNAVAILABLE_BODY,
  UNKNOWN_SESSION_BODY,
} from '../../src/middleware/commandAuth';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const ANSWER: NodeMetricsAnswer = { platform: 'android', state: 'sampling', samples: [] };

describe("a node's session metrics route", () => {
  let verify: sinon.SinonStub;
  let read: sinon.SinonStub;
  let enforced: boolean;

  const app = () => {
    const a = express();
    a.get(
      '/xenon/api/node/sessions/:sessionId/metrics',
      nodeSessionMetricsHandler({
        hubTokens: { verify },
        enforced: () => enforced,
        read,
        logger: quiet,
      }),
    );
    return a;
  };
  const get = (q = '') => request(app()).get(`/xenon/api/node/sessions/s1/metrics${q}`);

  beforeEach(() => {
    verify = sinon.stub();
    read = sinon.stub().returns(ANSWER);
    enforced = false;
  });
  afterEach(() => sinon.restore());

  it('answers the figures, with no credential when per-command auth is off', async () => {
    const res = await get('?after=1500');
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ value: ANSWER });
    expect(res.headers[NODE_METRICS_HEADER]).to.equal('1');
    expect(read.calledOnceWithExactly('s1', 1500)).to.equal(true);
  });

  it("with per-command auth on, answers only the hub's token for that session", async () => {
    enforced = true;
    verify.withArgs('good', 's1').resolves(true);
    verify.withArgs('other', 's1').resolves(false);

    const missing = await get();
    const wrong = await get().set(HUB_TOKEN_HEADER, 'other');
    const right = await get().set(HUB_TOKEN_HEADER, 'good');

    expect([missing.status, missing.body]).to.deep.equal([404, UNKNOWN_SESSION_BODY]);
    expect([wrong.status, wrong.body]).to.deep.equal([404, UNKNOWN_SESSION_BODY]);
    expect(right.status).to.equal(200);
    expect(read.calledOnce).to.equal(true);
    for (const r of [missing, wrong, right]) expect(r.headers[NODE_METRICS_HEADER]).to.equal('1');
  });

  it("answers 503 when it can't check the hub's token", async () => {
    enforced = true;
    verify.rejects(new Error('JWKS unreachable'));
    const res = await get().set(HUB_TOKEN_HEADER, 'good');
    expect([res.status, res.body]).to.deep.equal([503, COMMAND_AUTH_UNAVAILABLE_BODY]);
    expect(read.called).to.equal(false);
  });

  it('reads anything but a time as no `after`', () => {
    expect(parseAfter('1500')).to.equal(1500);
    expect(parseAfter('1500.5')).to.equal(1500.5);
    // A 400-digit number is Infinity: it would drop every sample the node holds.
    for (const bad of [undefined, '', 'abc', '-5', '1e3', ['1'], '9'.repeat(400)]) {
      expect(parseAfter(bad), String(bad)).to.equal(null);
    }
  });

  it('exists only on a node', async () => {
    const mount = (hub?: string) => {
      const a = express();
      const r = express.Router();
      registerNodeSessionMetrics(r, { ...DefaultPluginArgs, hub } as any);
      a.use('/xenon/api', r);
      return a;
    };
    const onHub = await request(mount()).get('/xenon/api/node/sessions/s1/metrics');
    const onNode = await request(mount('http://127.0.0.1:1')).get(
      '/xenon/api/node/sessions/s1/metrics',
    );
    expect(onHub.status).to.equal(404);
    expect(onHub.headers[NODE_METRICS_HEADER]).to.equal(undefined);
    expect(onNode.headers[NODE_METRICS_HEADER]).to.equal('1');
  });
});
