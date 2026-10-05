import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';
import {
  nodeSessionDeviceLogsHandler,
  registerNodeSessionDeviceLogs,
} from '../../src/gateway/nodeSessionDeviceLogs';
import {
  NODE_DEVICE_LOGS_HEADER,
  NodeDeviceLogsAnswer,
} from '../../src/services/logcat/nodeDeviceLogs';
import { HUB_TOKEN_HEADER } from '../../src/gateway/hubSessionToken';
import {
  COMMAND_AUTH_UNAVAILABLE_BODY,
  UNKNOWN_SESSION_BODY,
} from '../../src/middleware/commandAuth';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const ANSWER: NodeDeviceLogsAnswer = {
  state: 'recording',
  lines: [{ seq: 1, message: 'a line', timestamp: 1000 }],
  more: false,
};

describe("a node's session device log route", () => {
  let verify: sinon.SinonStub;
  let read: sinon.SinonStub;
  let enforced: boolean;

  const app = () => {
    const a = express();
    a.get(
      '/xenon/api/node/sessions/:sessionId/device-logs',
      nodeSessionDeviceLogsHandler({
        hubTokens: { verify },
        enforced: () => enforced,
        read,
        logger: quiet,
      }),
    );
    return a;
  };
  const get = (q = '') => request(app()).get(`/xenon/api/node/sessions/s1/device-logs${q}`);

  beforeEach(() => {
    verify = sinon.stub();
    read = sinon.stub().returns(ANSWER);
    enforced = false;
  });
  afterEach(() => sinon.restore());

  it('answers the lines after `after`, with no credential when per-command auth is off', async () => {
    const res = await get('?after=12');
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ value: ANSWER });
    expect(res.headers[NODE_DEVICE_LOGS_HEADER]).to.equal('1');
    expect(read.calledOnceWithExactly('s1', 12)).to.equal(true);
  });

  it('reads anything but a number as no `after`', async () => {
    await get('?after=-3');
    await get();
    expect(read.getCalls().map((c) => c.args[1])).to.deep.equal([null, null]);
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
    expect([right.status, right.body]).to.deep.equal([200, { value: ANSWER }]);
    // A refused ask neither reads nor drops the lines the hub hasn't collected.
    expect(read.calledOnce).to.equal(true);
    for (const r of [missing, wrong, right]) {
      expect(r.headers[NODE_DEVICE_LOGS_HEADER]).to.equal('1');
    }
  });

  it("answers 503 when it can't check the hub's token", async () => {
    enforced = true;
    verify.rejects(new Error('JWKS unreachable'));
    const res = await get().set(HUB_TOKEN_HEADER, 'good');
    expect([res.status, res.body]).to.deep.equal([503, COMMAND_AUTH_UNAVAILABLE_BODY]);
    expect(read.called).to.equal(false);
  });

  it('exists only on a node', async () => {
    const mount = (hub?: string) => {
      const a = express();
      const r = express.Router();
      registerNodeSessionDeviceLogs(r, { ...DefaultPluginArgs, hub } as any);
      a.use('/xenon/api', r);
      return a;
    };
    const onHub = await request(mount()).get('/xenon/api/node/sessions/s1/device-logs');
    const onNode = await request(mount('http://127.0.0.1:1')).get(
      '/xenon/api/node/sessions/s1/device-logs',
    );
    expect(onHub.status).to.equal(404);
    expect(onHub.headers[NODE_DEVICE_LOGS_HEADER]).to.equal(undefined);
    expect(onNode.status).to.equal(200);
    expect(onNode.headers[NODE_DEVICE_LOGS_HEADER]).to.equal('1');
    expect(onNode.body).to.deep.equal({ value: { state: 'off', lines: [], more: false } });
  });
});
