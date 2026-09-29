import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import * as jose from 'jose';
import { Container } from 'typedi';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { PluginContext } from '../../src/PluginContext';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { NodeBasePathResolver, webdriverInfoHandler } from '../../src/gateway/nodeWebDriverUrl';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import {
  HUB_CREATE_AUDIENCE,
  HubSessionTokenIssuer,
  HubSessionTokenVerifier,
} from '../../src/gateway/hubSessionToken';
import { saveRegistrations } from '../helpers/container-registration';
import { loopbackServers } from '../helpers/loopbackServer';

/**
 * A create the hub forwards to a node runs once.
 *
 * InternalHttpClient retries a request on a 5xx or on its 30 s timeout. A
 * create is not safe to repeat: a first UiAutomator2 install easily outlasts
 * 30 s, and every retry started another session on the node, holding the phone
 * with nobody to end it. So the hub sends a create once, with a timeout sized
 * for a create, and the node takes the hub's create token only once.
 */
describe('a create the hub forwards runs once', () => {
  const loopback = loopbackServers();
  let context: PluginContext;
  let saved: Partial<PluginContext>;
  let restore: () => void;
  let timeoutBefore: string | undefined;

  beforeEach(() => {
    restore = saveRegistrations(NodeBasePathResolver);
    Container.set(NodeBasePathResolver, new NodeBasePathResolver());
    context = Container.get(PluginContext);
    saved = { ...context };
    // A client of its own, built now: one that reads XENON_HTTP_TIMEOUT_MS below.
    context.pluginArgs = { ...DefaultPluginArgs, tlsRejectUnauthorized: true } as any;
    context.nodeId = 'hub-node-id';
    context.nodeBasePath = '';
    timeoutBefore = process.env.XENON_HTTP_TIMEOUT_MS;
  });

  afterEach(async () => {
    Object.assign(context, saved);
    if (timeoutBefore === undefined) delete process.env.XENON_HTTP_TIMEOUT_MS;
    else process.env.XENON_HTTP_TIMEOUT_MS = timeoutBefore;
    sinon.restore();
    restore();
    await loopback.closeAll();
  });

  /** A node whose create answers with `answer` for each POST, in order. */
  async function node(answers: Array<{ delayMs?: number; status: number }>) {
    const creates: number[] = [];
    const app = express();
    app.use(express.json());
    app.get(
      '/xenon/api/webdriver',
      webdriverInfoHandler(() => ''),
    );
    app.post('/session', (_req, res) => {
      const n = creates.length;
      creates.push(Date.now());
      const answer = answers[Math.min(n, answers.length - 1)];
      setTimeout(() => {
        if (answer.status === 200) {
          res.json({ value: { sessionId: `s-${n + 1}`, capabilities: {} } });
        } else {
          res.status(answer.status).json({
            value: { error: 'unknown error', message: 'driver install failed', stacktrace: '' },
          });
        }
      }, answer.delayMs ?? 0);
    });
    const server = await loopback.serve(app);
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    const device = { udid: 'u1', host: origin, nodeId: 'node-peer', platform: 'android' } as any;
    return { creates, device };
  }

  const caps = { alwaysMatch: { platformName: 'Android' }, firstMatch: [{}] } as any;

  it('is not sent again when the node answers a 5xx', async () => {
    const { creates, device } = await node([{ status: 500 }, { status: 200 }]);
    const answer = await new SessionLifecycleService().forwardSessionRequest(device, caps);
    expect(creates.length, 'creates the node received').to.equal(1);
    expect(answer).to.be.instanceOf(Error);
  });

  it('waits for a create that outlasts the ordinary request timeout, and sends it once', async () => {
    process.env.XENON_HTTP_TIMEOUT_MS = '150';
    const { creates, device } = await node([{ status: 200, delayMs: 600 }]);
    const answer: any = await new SessionLifecycleService().forwardSessionRequest(device, caps);
    expect(creates.length, 'creates the node received').to.equal(1);
    expect(answer.value?.[0], JSON.stringify(answer?.message ?? answer)).to.equal('s-1');
  });
});

describe('the hub’s create token is taken once', () => {
  const loopback = loopbackServers();
  let dirs: string[];
  let restore: () => void;
  let hubKeys: JwtKeyService;
  let hubUrl: string;

  beforeEach(async () => {
    dirs = [fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-create-once-'))];
    restore = saveRegistrations(JwtKeyService, HubSessionTokenIssuer);
    hubKeys = new JwtKeyService();
    await hubKeys.init(dirs[0]);
    Container.set(JwtKeyService, hubKeys);
    Container.set(HubSessionTokenIssuer, new HubSessionTokenIssuer());
    const hub = express();
    hub.get('/xenon/api/auth/jwks.json', (_req, res) => res.json(hubKeys.jwks()));
    const server = await loopback.serve(hub);
    hubUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  afterEach(async () => {
    sinon.restore();
    restore();
    await loopback.closeAll();
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  const grant = { userId: 'alice', udid: 'phone-1', host: 'http://10.0.0.5:4725' };

  it('each create’s token has an id of its own', async () => {
    const issuer = Container.get(HubSessionTokenIssuer);
    const a = jose.decodeJwt((await issuer.createTokenFor(grant)) as string);
    const b = jose.decodeJwt((await issuer.createTokenFor(grant)) as string);
    expect(a.jti).to.be.a('string').and.not.equal('');
    expect(b.jti).to.be.a('string').and.not.equal(a.jti);
  });

  it('the node accepts it once and refuses it after that', async () => {
    const token = (await Container.get(HubSessionTokenIssuer).createTokenFor(grant)) as string;
    const node = new HubSessionTokenVerifier(hubUrl);
    expect(await node.verifyCreate(token)).to.deep.equal(grant);
    expect(await node.verifyCreate(token), 'the same token again').to.equal(null);
  });

  it('a token from a hub that sets no id (an older hub) is still accepted', async () => {
    const token = await hubKeys.sign(
      { sub: 'alice', udid: 'phone-1', host: 'http://10.0.0.5:4725' },
      { audience: HUB_CREATE_AUDIENCE, ttlSeconds: 120 },
    );
    const node = new HubSessionTokenVerifier(hubUrl);
    expect(await node.verifyCreate(token)).to.deep.equal(grant);
  });
});
