import 'reflect-metadata';
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { Container } from 'typedi';
import request from '../helpers/loopbackRequest';
import { loopbackServers } from '../helpers/loopbackServer';
import { saveRegistrations } from '../helpers/container-registration';
import { registerCommandAuth } from '../../src/app/registerCommandAuth';
import { CommandCallerVerifier } from '../../src/middleware/commandCaller';
import { readBasicCredential } from '../../src/middleware/basicCredential';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { UserService } from '../../src/services/UserService';

/**
 * Per-command auth takes a `xenon-session` token as the Basic password, with
 * the user `xenon-session`: what appium-mcp sends for the `remoteServerUrl`
 * xenon_session_capabilities gives it when per-command auth is on. The token
 * is checked as session create checks one (a live signature, audience and
 * lifetime, an ACTIVE subject, the `sessions` scope), and then judged as a
 * Bearer token is: its user must own the session.
 */

const EXACT_UNKNOWN_SESSION =
  '{"value":{"error":"invalid session id","message":"A session is either terminated or not started","stacktrace":""}}';

function appiumDir() {
  return path.dirname(require.resolve('appium/package.json'));
}

function appiumExpress(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(require.resolve('express', { paths: [appiumDir()] }));
}

const USERS: Record<string, { id: string; role: string; status: string }> = {
  alice: { id: 'alice', role: 'MEMBER', status: 'ACTIVE' },
  bob: { id: 'bob', role: 'MEMBER', status: 'ACTIVE' },
  gone: { id: 'gone', role: 'MEMBER', status: 'INACTIVE' },
};
const OWNERS: Record<string, string> = { 's-alice': 'alice', 's-bob': 'bob' };

const basic = (user: string, password: string) => ({
  authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
});

describe('per-command auth: a xenon-session token as the Basic password', () => {
  const loopback = loopbackServers();
  let keyDir: string;
  let keys: JwtKeyService;
  let restore: () => void;
  let ran: string[];
  let warnings: string[];
  let verifyKeyPair: sinon.SinonStub;

  before(async () => {
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-session-basic-'));
    keys = new JwtKeyService();
    await keys.init(keyDir);
  });
  after(() => fs.rmSync(keyDir, { recursive: true, force: true }));

  beforeEach(() => {
    restore = saveRegistrations(JwtKeyService, UserService);
    Container.set(JwtKeyService, keys);
    Container.set(UserService, { findById: async (id: string) => USERS[id] ?? null } as any);
    ran = [];
    warnings = [];
    verifyKeyPair = sinon.stub().resolves(null);
  });
  afterEach(async () => {
    restore();
    await loopback.closeAll();
  });

  async function lab() {
    const app = appiumExpress()();
    app.use(appiumExpress().json());
    app.get('/wd/hub/session/:sessionId/url', (req: any, res: any) => {
      ran.push(req.params.sessionId);
      res.json({ value: 'https://example.test/' });
    });
    const placed = registerCommandAuth(
      app,
      { basePath: '/wd/hub' },
      {
        enabled: () => true,
        authDisabled: () => false,
        verifier: new CommandCallerVerifier({ verifyKeyPair, verifyBearer: async () => null }),
        ownerOf: async (id: string) => OWNERS[id] ?? null,
        logger: {
          info: () => undefined,
          warn: (m: string) => warnings.push(m),
          error: () => undefined,
        },
      },
    );
    expect(placed.placed).to.equal(true);
    return loopback.serve(app);
  }

  const sessionToken = (
    sub: string,
    opts: { audience?: string; ttlSeconds?: number; scopes?: string } = {},
  ) =>
    keys.sign(
      { sub, teamId: null, scopes: opts.scopes ?? 'sessions' },
      { audience: opts.audience ?? 'xenon-session', ttlSeconds: opts.ttlSeconds ?? 600 },
    );

  async function expectRefused(res: request.Response) {
    expect(res.status).to.equal(404);
    expect(res.text).to.equal(EXACT_UNKNOWN_SESSION);
    expect(ran).to.deep.equal([]);
  }

  it('reads the user xenon-session as a session token, never as a key pair', () => {
    expect(readBasicCredential(basic('xenon-session', 'a.b.c').authorization)).to.deep.equal({
      kind: 'session-token',
      token: 'a.b.c',
    });
    expect(readBasicCredential(basic('ak-alice', 'tok').authorization)).to.deep.equal({
      kind: 'pair',
      accessKey: 'ak-alice',
      token: 'tok',
    });
  });

  it("per-command auth accepts a xenon-session token as the Basic password for the owner's session", async () => {
    const server = await lab();
    const res = await request(server)
      .get('/wd/hub/session/s-alice/url')
      .set(basic('xenon-session', await sessionToken('alice')));
    expect(res.status, res.text).to.equal(200);
    expect(ran).to.deep.equal(['s-alice']);
    expect(verifyKeyPair.called).to.equal(false);
  });

  it("refuses it for a session the token's user doesn't own", async () => {
    const server = await lab();
    const token = await sessionToken('alice');
    await expectRefused(
      await request(server).get('/wd/hub/session/s-bob/url').set(basic('xenon-session', token)),
    );
    expect(warnings.join('\n')).to.include('not the session owner');
    expect(warnings.join('\n')).not.to.include(token);
  });

  it('refuses an expired or wrong-audience token', async () => {
    const server = await lab();
    const expired = await sessionToken('alice', { ttlSeconds: -120 });
    const rest = await sessionToken('alice', { audience: 'xenon-rest' });
    const mcp = await sessionToken('alice', { audience: 'xenon-mcp' });
    for (const token of [expired, rest, mcp, 'not-a-jwt']) {
      await expectRefused(
        await request(server).get('/wd/hub/session/s-alice/url').set(basic('xenon-session', token)),
      );
    }
  });

  it("refuses one without the sessions scope, or whose user isn't active", async () => {
    const server = await lab();
    for (const token of [
      await sessionToken('alice', { scopes: 'read' }),
      await sessionToken('gone'),
    ]) {
      await expectRefused(
        await request(server).get('/wd/hub/session/s-alice/url').set(basic('xenon-session', token)),
      );
    }
  });
});
