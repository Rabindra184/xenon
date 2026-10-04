import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserSessionService } from '../../src/services/UserSessionService';
import { UserService } from '../../src/services/UserService';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { prisma } from '../../src/prisma';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * How long the credential behind a request lasts, as authMiddleware sees it.
 *
 * - req.auth.credentialExpiresAt: when a Bearer token or an API key stops
 *   working, so what it mints (POST /auth/token, POST /profile/tokens) can't
 *   outlive it.
 * - The dashboard cookie's Max-Age, renewed on every request, follows
 *   XENON_USER_SESSION_TTL_MS. It was renewed at a fixed 24 hours, so a
 *   longer setting signed people out after a day away anyway.
 */
describe('authMiddleware: how long the credential lasts', () => {
  let dir: string;
  let keys: JwtKeyService;
  let restore: () => void;
  let ttlBefore: string | undefined;
  const member = { id: 'u1', role: 'MEMBER', status: 'ACTIVE' };

  function res() {
    const out: any = { cookies: [] as any[] };
    out.status = (c: number) => {
      out.code = c;
      return out;
    };
    out.json = (b: any) => {
      out.body = b;
      return out;
    };
    out.cookie = (name: string, value: string, opts: any) => {
      out.cookies.push({ name, value, opts });
      return out;
    };
    return out;
  }

  async function run(headers: Record<string, string>) {
    const req: any = { headers, query: {}, path: '/x' };
    const r = res();
    const next = sinon.spy();
    await authMiddleware(req, r, next);
    expect(next.calledOnce, `refused: ${JSON.stringify(r.body)}`).to.equal(true);
    return { req, res: r };
  }

  beforeEach(async () => {
    ttlBefore = process.env.XENON_USER_SESSION_TTL_MS;
    restore = saveRegistrations(JwtKeyService, UserService, ApiKeyService, UserSessionService);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-cred-life-'));
    keys = new JwtKeyService();
    await keys.init(dir);
    Container.set(JwtKeyService, keys);
    Container.set(UserService, { findById: sinon.stub().resolves(member) } as any);
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().resolves(null),
      verify: sinon.stub().resolves(null),
    } as any);
    const sessions = new UserSessionService();
    sinon.stub(sessions, 'resolve').resolves(null);
    Container.set(UserSessionService, sessions);
    sinon.stub(prisma.teamMember, 'findMany').resolves([] as any);
  });

  afterEach(() => {
    if (ttlBefore === undefined) delete process.env.XENON_USER_SESSION_TTL_MS;
    else process.env.XENON_USER_SESSION_TTL_MS = ttlBefore;
    sinon.restore();
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('req.auth.credentialExpiresAt', () => {
    it("is a Bearer token's exp", async () => {
      const token = await keys.sign(
        { sub: 'u1', scopes: 'read' },
        { audience: 'xenon-rest', ttlSeconds: 600 },
      );
      const { req } = await run({ authorization: `Bearer ${token}` });
      const exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp;
      expect(req.auth.credentialExpiresAt).to.equal(exp * 1000);
    });

    it("is an API key's expiresAt, and absent for a key that never expires", async () => {
      const expiresAt = new Date(Date.now() + 3_600_000);
      const verifyPair = Container.get(ApiKeyService).verifyPair as sinon.SinonStub;
      verifyPair.resolves({ id: 'k1', userId: 'u1', scopes: 'read', rateLimit: 300, expiresAt });
      const pair = { 'x-xenon-access-key': 'xen_a', 'x-xenon-token': 'tk' };
      expect((await run(pair)).req.auth.credentialExpiresAt).to.equal(expiresAt.getTime());

      verifyPair.resolves({
        id: 'k1',
        userId: 'u1',
        scopes: 'read',
        rateLimit: 300,
        expiresAt: null,
      });
      expect((await run(pair)).req.auth.credentialExpiresAt).to.equal(undefined);
    });

    it('is absent for a dashboard sign-in, which renews itself', async () => {
      (Container.get(UserSessionService).resolve as sinon.SinonStub).resolves({
        id: 's1',
        userId: 'u1',
      });
      const { req } = await run({ cookie: 'xenon_dashboard_session=s1' });
      expect(req.auth.kind).to.equal('user-session');
      expect(req.auth.credentialExpiresAt).to.equal(undefined);
    });
  });

  describe("the dashboard cookie's renewed Max-Age", () => {
    it('follows XENON_USER_SESSION_TTL_MS, longer than a day included', async () => {
      process.env.XENON_USER_SESSION_TTL_MS = String(7 * 24 * 3_600_000);
      (Container.get(UserSessionService).resolve as sinon.SinonStub).resolves({
        id: 's1',
        userId: 'u1',
      });
      const { res: r } = await run({ cookie: 'xenon_dashboard_session=s1' });
      expect(r.cookies[0].opts.maxAge).to.equal(7 * 24 * 3_600_000);
    });

    it('is 24 hours by default', async () => {
      delete process.env.XENON_USER_SESSION_TTL_MS;
      (Container.get(UserSessionService).resolve as sinon.SinonStub).resolves({
        id: 's1',
        userId: 'u1',
      });
      const { res: r } = await run({ cookie: 'xenon_dashboard_session=s1' });
      expect(r.cookies[0].opts.maxAge).to.equal(24 * 3_600_000);
    });
  });
});
