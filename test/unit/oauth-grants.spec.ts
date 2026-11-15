import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { Container } from 'typedi';
import { OAuthError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { useScratchDatabase } from '../helpers/scratch-database';
import { seedUser, SeededUser } from '../helpers/seedUser';
import { saveRegistrations } from '../helpers/container-registration';
import { prisma } from '../../src/prisma';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { verifyBearerCredential } from '../../src/middleware/verifyCredential';
import { AuthCodes, AUTH_CODE_TTL_MS } from '../../src/services/oauth/authCodes';
import { GrantStore, SPENT_REFRESH_TOKEN_MEMORY_MS } from '../../src/services/oauth/grantStore';
import { ClientStore } from '../../src/services/oauth/clientStore';
import { XenonOAuthProvider } from '../../src/services/oauth/oauthProvider';

const DAY = 24 * 60 * 60 * 1000;
const RESOURCE = 'http://lab-mac:4723/xenon/mcp';
const REDIRECT = 'http://127.0.0.1:33418/callback';

/** A PKCE pair: the verifier the agent keeps and its S256 challenge. */
function pkce(seed = Math.random().toString(36)) {
  const verifier = createHash('sha256').update(seed).digest('base64url') + 'abcdefghij';
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function oauthError(promise: Promise<unknown>): Promise<OAuthError> {
  try {
    await promise;
  } catch (err) {
    expect(err, String(err)).to.be.instanceOf(OAuthError);
    return err as OAuthError;
  }
  throw new Error('expected an OAuth error');
}

/**
 * The sign-in's codes and grants: an authorization code is used once, a
 * refresh token rotates on every use, and a second use of either revokes
 * what the first gave (Review Focus 3).
 */
describe('sign-in codes and grants', () => {
  useScratchDatabase({ wholeSuite: true });

  let member: SeededUser;
  let admin: SeededUser;
  let keys: JwtKeyService;
  let keyDir: string;
  let restoreContainer: () => void;
  let client: OAuthClientInformationFull;
  let otherClient: OAuthClientInformationFull;
  let codes: AuthCodes;
  let grants: GrantStore;
  let provider: XenonOAuthProvider;
  const savedEnv = { ...process.env };

  before(async () => {
    member = await seedUser('MEMBER', { name: 'Agent Owner' });
    admin = await seedUser('ADMIN', { name: 'Lab Admin' });
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-oauth-grants-'));
    keys = new JwtKeyService();
    await keys.init(keyDir);
    const clients = new ClientStore();
    client = await clients.registerClient({
      client_name: 'Claude Code',
      redirect_uris: [REDIRECT],
    } as OAuthClientInformationFull);
    otherClient = await clients.registerClient({
      client_name: 'Other',
      redirect_uris: [REDIRECT],
    } as OAuthClientInformationFull);
  });

  beforeEach(async () => {
    restoreContainer = saveRegistrations(JwtKeyService);
    Container.set(JwtKeyService, keys);
    await prisma.mcpGrant.deleteMany({});
    await prisma.user.updateMany({
      where: { id: { in: [member.user.id, admin.user.id] } },
      data: { status: 'ACTIVE' },
    });
    await prisma.user.update({ where: { id: admin.user.id }, data: { role: 'ADMIN' } });
    codes = new AuthCodes();
    grants = new GrantStore();
    provider = new XenonOAuthProvider({ codes, grants, clients: new ClientStore() });
  });

  afterEach(() => {
    sinon.restore();
    restoreContainer();
    for (const k of ['XENON_MCP_REFRESH_IDLE_DAYS', 'XENON_MCP_REFRESH_MAX_DAYS']) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  after(() => fs.rmSync(keyDir, { recursive: true, force: true }));

  function issue(
    opts: { userId?: string; scopes?: string[]; challenge?: string; clientId?: string } = {},
  ) {
    const pair = pkce();
    const code = codes.issue({
      userId: opts.userId ?? member.user.id,
      clientId: opts.clientId ?? client.client_id,
      redirectUri: REDIRECT,
      codeChallenge: opts.challenge ?? pair.challenge,
      scopes: opts.scopes ?? ['xenon:devices:read', 'appium:use'],
      resource: RESOURCE,
    });
    return { code, ...pair };
  }

  async function signIn(opts: Parameters<typeof issue>[0] = {}) {
    const { code, verifier } = issue(opts);
    return provider.exchangeAuthorizationCode(client, code, verifier, REDIRECT, new URL(RESOURCE));
  }

  async function claimsOf(accessToken: string) {
    return keys.verify(accessToken, { audience: 'xenon-mcp' });
  }

  describe('authorization codes', () => {
    it('a code works once, and its second use revokes what the first gave', async () => {
      const { code, verifier } = issue();
      const tokens = await provider.exchangeAuthorizationCode(client, code, verifier, REDIRECT);
      const { gid } = await claimsOf(tokens.access_token);

      const err = await oauthError(
        provider.exchangeAuthorizationCode(client, code, verifier, REDIRECT),
      );
      expect(err.errorCode).to.equal('invalid_grant');

      const grant = await grants.find(String(gid));
      expect(grant?.revokedAt).to.be.instanceOf(Date);
      const refresh = await oauthError(
        provider.exchangeRefreshToken(client, tokens.refresh_token!),
      );
      expect(refresh.errorCode).to.equal('invalid_grant');
    });

    it('a second use while the first is still being answered revokes it too', async () => {
      const { code, verifier } = issue();
      const first = provider.exchangeAuthorizationCode(client, code, verifier, REDIRECT);
      const second = oauthError(
        provider.exchangeAuthorizationCode(client, code, verifier, REDIRECT),
      );
      const tokens = await first;
      expect((await second).errorCode).to.equal('invalid_grant');
      const { gid } = await claimsOf(tokens.access_token);
      expect((await grants.find(String(gid)))?.revokedAt).to.be.instanceOf(Date);
    });

    it('a code needs its own redirect_uri', async () => {
      const { code, verifier } = issue();
      const err = await oauthError(
        provider.exchangeAuthorizationCode(client, code, verifier, 'http://127.0.0.1:9/elsewhere'),
      );
      expect(err.errorCode).to.equal('invalid_grant');
    });

    it('a code needs its own verifier, and a failed try uses it up', async () => {
      const { code, verifier } = issue();
      const wrong = pkce('another').verifier;
      const err = await oauthError(
        provider.exchangeAuthorizationCode(client, code, wrong, REDIRECT),
      );
      expect(err.errorCode).to.equal('invalid_grant');
      const retry = await oauthError(
        provider.exchangeAuthorizationCode(client, code, verifier, REDIRECT),
      );
      expect(retry.errorCode).to.equal('invalid_grant');
      expect(await prisma.mcpGrant.count()).to.equal(0);
    });

    it('a code needs a verifier', async () => {
      const { code } = issue();
      const err = await oauthError(
        provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT),
      );
      expect(err.errorCode).to.equal('invalid_grant');
    });

    it('a plain challenge is refused: the verifier must hash to it', async () => {
      // A `plain` PKCE client sends the verifier itself as the challenge.
      const verifier = pkce('plain').verifier;
      const challenge = createHash('sha256').update('x').digest('base64url');
      const { code } = issue({ challenge });
      const plainVerifier = challenge;
      const err = await oauthError(
        provider.exchangeAuthorizationCode(client, code, plainVerifier, REDIRECT),
      );
      expect(err.errorCode).to.equal('invalid_grant');
      expect(verifier).to.not.equal(challenge);
      // And a challenge that is no S256 hash is never issued a code.
      expect(() =>
        codes.issue({
          userId: member.user.id,
          clientId: client.client_id,
          redirectUri: REDIRECT,
          codeChallenge: 'short-plain-verifier',
          scopes: [],
          resource: RESOURCE,
        }),
      ).to.throw();
    });

    it('a code belongs to its client', async () => {
      const { code, verifier } = issue();
      const err = await oauthError(
        provider.exchangeAuthorizationCode(otherClient, code, verifier, REDIRECT),
      );
      expect(err.errorCode).to.equal('invalid_grant');
      const challenge = await oauthError(provider.challengeForAuthorizationCode(otherClient, code));
      expect(challenge.errorCode).to.equal('invalid_grant');
    });

    it('a code is for the resource it was asked for', async () => {
      const { code, verifier } = issue();
      const err = await oauthError(
        provider.exchangeAuthorizationCode(
          client,
          code,
          verifier,
          REDIRECT,
          new URL('http://other-hub:4723/xenon/mcp'),
        ),
      );
      expect(err.errorCode).to.equal('invalid_target');
    });

    it('takes the resource with a trailing slash', async () => {
      const { code, verifier } = issue();
      const tokens = await provider.exchangeAuthorizationCode(
        client,
        code,
        verifier,
        REDIRECT,
        new URL(`${RESOURCE}/`),
      );
      expect(tokens.access_token).to.be.a('string');
    });

    it('names the challenge without using the code', async () => {
      const { code, verifier, challenge } = issue();
      expect(await provider.challengeForAuthorizationCode(client, code)).to.equal(challenge);
      const tokens = await provider.exchangeAuthorizationCode(client, code, verifier, REDIRECT);
      expect(tokens.access_token).to.be.a('string');
      const after = await oauthError(provider.challengeForAuthorizationCode(client, code));
      expect(after.errorCode).to.equal('invalid_grant');
    });

    it('a code expires after 60 s', async () => {
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
      const { code, verifier } = issue();
      clock.tick(AUTH_CODE_TTL_MS + 1);
      const err = await oauthError(
        provider.exchangeAuthorizationCode(client, code, verifier, REDIRECT),
      );
      expect(err.errorCode).to.equal('invalid_grant');
      expect(AUTH_CODE_TTL_MS).to.equal(60_000);
    });

    it("an Inactive user's code is refused", async () => {
      const { code, verifier } = issue();
      await prisma.user.update({ where: { id: member.user.id }, data: { status: 'INACTIVE' } });
      const err = await oauthError(
        provider.exchangeAuthorizationCode(client, code, verifier, REDIRECT),
      );
      expect(err.errorCode).to.equal('invalid_grant');
    });

    it('the authorize step is handed on, and refuses without a handler', async () => {
      const params = { codeChallenge: pkce().challenge, redirectUri: REDIRECT, scopes: [] };
      const err = await oauthError(provider.authorize(client, params, {} as any));
      expect(err.errorCode).to.equal('server_error');
      const begin = sinon.stub().resolves();
      const handed = new XenonOAuthProvider({ codes, grants, beginAuthorization: begin });
      await handed.authorize(client, params, {} as any);
      expect(begin.calledOnceWith(client, params)).to.equal(true);
      const bad = await oauthError(
        handed.authorize(client, { ...params, codeChallenge: 'plain' }, {} as any),
      );
      expect(bad.errorCode).to.equal('invalid_request');
    });
  });

  describe('access tokens', () => {
    it('are xenon-mcp JWTs of one hour with gid and the granted scopes', async () => {
      const tokens = await signIn({
        scopes: ['xenon:devices:read', 'xenon:devices:lock', 'offline_access'],
      });
      expect(tokens.token_type).to.equal('Bearer');
      expect(tokens.expires_in).to.equal(3600);
      expect(tokens.scope).to.equal('xenon:devices:lock xenon:devices:read');
      const claims = await claimsOf(tokens.access_token);
      expect(claims.aud).to.equal('xenon-mcp');
      expect(Number(claims.exp) - Number(claims.iat)).to.equal(3600);
      expect(claims.sub).to.equal(member.user.id);
      expect(claims.role).to.equal('MEMBER');
      expect(claims.scope).to.equal('xenon:devices:lock xenon:devices:read');
      expect(claims.scopes).to.equal('devices');
      expect(claims.roles).to.deep.equal([]);
      expect(claims.teamId).to.equal(null);
      const [grant] = await grants.listOf(member.user.id);
      expect(claims.gid).to.equal(grant.id);

      // REST takes it as it takes any xenon-mcp token.
      const verified = await verifyBearerCredential(tokens.access_token);
      expect(verified?.user.id).to.equal(member.user.id);
    });

    it('get the default scopes when none were asked for', async () => {
      const tokens = await signIn({ scopes: [] });
      expect(tokens.scope).to.equal('appium:use xenon:devices:read');
    });

    it("are cut to what the user's role allows", async () => {
      const all = [
        'appium:use',
        'xenon:analytics:read',
        'xenon:devices:lock',
        'xenon:devices:read',
        'xenon:execute',
        'xenon:recordings',
      ];
      const asMember = await claimsOf((await signIn({ scopes: all })).access_token);
      expect(asMember.roles).to.deep.equal([]);
      expect(String(asMember.scopes).split(',')).to.not.include('admin');

      const adminTokens = await signIn({ userId: admin.user.id, scopes: all });
      const asAdmin = await claimsOf(adminTokens.access_token);
      expect(asAdmin.roles).to.deep.equal(['admin']);
      expect(String(asAdmin.scopes).split(',')).to.include('admin');

      // Demoted since: the next refresh carries a member's power only.
      await prisma.user.update({ where: { id: admin.user.id }, data: { role: 'MEMBER' } });
      const refreshed = await provider.exchangeRefreshToken(client, adminTokens.refresh_token!);
      const after = await claimsOf(refreshed.access_token);
      expect(after.roles).to.deep.equal([]);
      expect(String(after.scopes).split(',')).to.not.include('admin');
      expect(after.role).to.equal('MEMBER');
    });

    it('are refused when nothing asked for can be granted', async () => {
      const err = await oauthError(signIn({ scopes: ['offline_access', 'openid'] }));
      expect(err.errorCode).to.equal('invalid_scope');
      expect(await prisma.mcpGrant.count()).to.equal(0);
    });

    it('are verified with the grant they came from', async () => {
      const tokens = await signIn();
      const info = await provider.verifyAccessToken(tokens.access_token);
      expect(info.clientId).to.equal(client.client_id);
      expect(info.scopes).to.deep.equal(['appium:use', 'xenon:devices:read']);
      expect(info.expiresAt).to.be.a('number');
      expect(info.extra?.userId).to.equal(member.user.id);
      const bad = await oauthError(provider.verifyAccessToken('not-a-token'));
      expect(bad.errorCode).to.equal('invalid_token');
    });
  });

  describe('refresh tokens', () => {
    it('are stored as their SHA-256 only', async () => {
      const tokens = await signIn();
      const rows = await prisma.mcpGrant.findMany({});
      expect(rows).to.have.length(1);
      expect(rows[0].tokenHash).to.not.equal(tokens.refresh_token);
      expect(rows[0].tokenHash).to.equal(
        createHash('sha256').update(tokens.refresh_token!).digest('hex'),
      );
      expect(Buffer.from(tokens.refresh_token!, 'base64url')).to.have.length(32);
    });

    it('refresh rotates: the old token is refused after use', async () => {
      const first = await signIn();
      const second = await provider.exchangeRefreshToken(client, first.refresh_token!);
      expect(second.refresh_token).to.be.a('string').and.not.equal(first.refresh_token);
      const third = await provider.exchangeRefreshToken(client, second.refresh_token!);
      expect(third.refresh_token).to.not.equal(second.refresh_token);
      // One sign-in, one gid, however often it refreshes.
      const gid = (await claimsOf(first.access_token)).gid;
      expect((await claimsOf(third.access_token)).gid).to.equal(gid);

      const err = await oauthError(provider.exchangeRefreshToken(client, first.refresh_token!));
      expect(err.errorCode).to.equal('invalid_grant');
    });

    it('a used token answers reused and revokes the chain', async () => {
      const first = await signIn();
      const second = await provider.exchangeRefreshToken(client, first.refresh_token!);
      const gid = String((await claimsOf(first.access_token)).gid);

      expect(await grants.rotate(first.refresh_token!)).to.equal('reused');
      const rows = await prisma.mcpGrant.findMany({
        where: { OR: [{ id: gid }, { rotatedFromId: gid }] },
      });
      expect(rows.length).to.be.greaterThan(1);
      for (const row of rows) expect(row.revokedAt, row.id).to.be.instanceOf(Date);
      // The newest token goes with it.
      expect(await grants.rotate(second.refresh_token!)).to.equal('invalid');
      expect(await grants.listOf(member.user.id)).to.deep.equal([]);
    });

    it('two refreshes with one token: one wins, and the chain is revoked', async () => {
      const first = await signIn();
      const results = await Promise.all([
        grants.rotate(first.refresh_token!),
        grants.rotate(first.refresh_token!),
      ]);
      expect(results.filter((r) => r === 'reused')).to.have.length(1);
      const winner = results.find((r) => typeof r === 'object') as { refreshToken: string };
      expect(await grants.rotate(winner.refreshToken)).to.equal('invalid');
    });

    it('rotate answers invalid for a token it never gave', async () => {
      expect(await grants.rotate('never-issued')).to.equal('invalid');
    });

    it('refresh stops after 30 days unused', async () => {
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
      const first = await signIn();
      clock.tick(29 * DAY);
      const second = await provider.exchangeRefreshToken(client, first.refresh_token!);
      clock.tick(30 * DAY + 60_000);
      const err = await oauthError(provider.exchangeRefreshToken(client, second.refresh_token!));
      expect(err.errorCode).to.equal('invalid_grant');
    });

    it('refresh stops after 90 days in all, however often it is used', async () => {
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
      let tokens = await signIn();
      for (let day = 20; day < 90; day += 20) {
        clock.tick(20 * DAY);
        tokens = await provider.exchangeRefreshToken(client, tokens.refresh_token!);
      }
      clock.tick(11 * DAY);
      const err = await oauthError(provider.exchangeRefreshToken(client, tokens.refresh_token!));
      expect(err.errorCode).to.equal('invalid_grant');
    });

    it('takes its limits from XENON_MCP_REFRESH_IDLE_DAYS and XENON_MCP_REFRESH_MAX_DAYS', async () => {
      process.env.XENON_MCP_REFRESH_IDLE_DAYS = '2';
      process.env.XENON_MCP_REFRESH_MAX_DAYS = '5';
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });

      const idle = await signIn();
      clock.tick(2 * DAY + 60_000);
      expect(
        (await oauthError(provider.exchangeRefreshToken(client, idle.refresh_token!))).errorCode,
      ).to.equal('invalid_grant');

      let tokens = await signIn();
      for (let i = 0; i < 4; i += 1) {
        clock.tick(DAY);
        tokens = await provider.exchangeRefreshToken(client, tokens.refresh_token!);
      }
      clock.tick(DAY + 60_000);
      expect(
        (await oauthError(provider.exchangeRefreshToken(client, tokens.refresh_token!))).errorCode,
      ).to.equal('invalid_grant');
    });

    it('ignores a limit that is not a whole number of days', async () => {
      process.env.XENON_MCP_REFRESH_IDLE_DAYS = 'abc';
      process.env.XENON_MCP_REFRESH_MAX_DAYS = '0';
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
      const tokens = await signIn();
      clock.tick(29 * DAY);
      const next = await provider.exchangeRefreshToken(client, tokens.refresh_token!);
      expect(next.refresh_token).to.be.a('string');
    });

    it("an Inactive user's refresh is refused, and their grant revoked", async () => {
      const tokens = await signIn();
      const gid = String((await claimsOf(tokens.access_token)).gid);
      await prisma.user.update({ where: { id: member.user.id }, data: { status: 'INACTIVE' } });
      const err = await oauthError(provider.exchangeRefreshToken(client, tokens.refresh_token!));
      expect(err.errorCode).to.equal('invalid_grant');
      expect((await grants.find(gid))?.revokedAt).to.be.instanceOf(Date);
    });

    it("a deleted user's refresh is refused", async () => {
      const gone = await seedUser('MEMBER');
      const tokens = await signIn({ userId: gone.user.id });
      await gone.cleanup();
      const err = await oauthError(provider.exchangeRefreshToken(client, tokens.refresh_token!));
      expect(err.errorCode).to.equal('invalid_grant');
    });

    it("another client's refresh token is refused and stays usable", async () => {
      const tokens = await signIn();
      const err = await oauthError(
        provider.exchangeRefreshToken(otherClient, tokens.refresh_token!),
      );
      expect(err.errorCode).to.equal('invalid_grant');
      const next = await provider.exchangeRefreshToken(client, tokens.refresh_token!);
      expect(next.refresh_token).to.be.a('string');
    });

    it('a refresh may narrow the scopes, never widen them', async () => {
      const tokens = await signIn({ scopes: ['xenon:devices:read', 'appium:use'] });
      const wider = await oauthError(
        provider.exchangeRefreshToken(client, tokens.refresh_token!, ['xenon:devices:lock']),
      );
      expect(wider.errorCode).to.equal('invalid_scope');
      const narrower = await provider.exchangeRefreshToken(client, tokens.refresh_token!, [
        'xenon:devices:read',
      ]);
      expect(narrower.scope).to.equal('xenon:devices:read');
      // The grant keeps what was granted.
      const full = await provider.exchangeRefreshToken(client, narrower.refresh_token!);
      expect(full.scope).to.equal('appium:use xenon:devices:read');
    });

    it('a refresh naming another resource is invalid_target, and keeps the token', async () => {
      const checked = new XenonOAuthProvider({
        codes,
        grants,
        clients: new ClientStore(),
        resourceMatches: (resource) => resource.href.replace(/\/$/, '') === RESOURCE,
      });
      const { code, verifier } = issue();
      const tokens = await checked.exchangeAuthorizationCode(
        client,
        code,
        verifier,
        REDIRECT,
        new URL(RESOURCE),
      );
      const wrong = await oauthError(
        checked.exchangeRefreshToken(
          client,
          tokens.refresh_token!,
          undefined,
          new URL('http://other.example/xenon/mcp'),
        ),
      );
      expect(wrong.errorCode).to.equal('invalid_target');
      const next = await checked.exchangeRefreshToken(
        client,
        tokens.refresh_token!,
        undefined,
        new URL(`${RESOURCE}/`),
      );
      expect(next.refresh_token).to.be.a('string');
    });

    it('a used token asking for other scopes still revokes the chain', async () => {
      const tokens = await signIn({ scopes: ['xenon:devices:read', 'appium:use'] });
      const next = await provider.exchangeRefreshToken(client, tokens.refresh_token!);
      const err = await oauthError(
        provider.exchangeRefreshToken(client, tokens.refresh_token!, ['xenon:devices:lock']),
      );
      expect(err.errorCode).to.equal('invalid_grant');
      expect(await grants.rotate(next.refresh_token!)).to.equal('invalid');
    });
  });

  describe('without a signing key', () => {
    it('spends neither the code nor the refresh token, and leaves no grant', async () => {
      const tokens = await signIn();
      const grantsBefore = await prisma.mcpGrant.count();
      const { code, verifier } = issue();
      Container.set(JwtKeyService, new JwtKeyService());

      const exchange = await oauthError(
        provider.exchangeAuthorizationCode(client, code, verifier, REDIRECT),
      );
      expect(exchange.errorCode).to.equal('server_error');
      const refresh = await oauthError(
        provider.exchangeRefreshToken(client, tokens.refresh_token!),
      );
      expect(refresh.errorCode).to.equal('server_error');
      expect(await prisma.mcpGrant.count()).to.equal(grantsBefore);

      Container.set(JwtKeyService, keys);
      expect(
        (await provider.exchangeAuthorizationCode(client, code, verifier, REDIRECT)).access_token,
      ).to.be.a('string');
      expect(
        (await provider.exchangeRefreshToken(client, tokens.refresh_token!)).refresh_token,
      ).to.be.a('string');
    });
  });

  describe('from the container', () => {
    it('shares one code store, grant store and client store with the routes', async () => {
      const restore = saveRegistrations(AuthCodes, GrantStore, ClientStore);
      try {
        expect(Container.get(AuthCodes)).to.equal(Container.get(AuthCodes));
        const defaults = new XenonOAuthProvider();
        expect(defaults.clientsStore).to.equal(Container.get(ClientStore));
        const { verifier, challenge } = pkce();
        const code = Container.get(AuthCodes).issue({
          userId: member.user.id,
          clientId: client.client_id,
          redirectUri: REDIRECT,
          codeChallenge: challenge,
          scopes: [],
          resource: RESOURCE,
        });
        const tokens = await defaults.exchangeAuthorizationCode(client, code, verifier, REDIRECT);
        const { gid } = await claimsOf(tokens.access_token);
        expect(await Container.get(GrantStore).find(String(gid))).to.not.equal(null);
      } finally {
        restore();
      }
    });
  });

  describe('what counts as use', () => {
    it('a sign-in and a refresh note the client as used', async () => {
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
      const lastUsed = async () =>
        (await prisma.mcpClient.findUnique({
          where: { id: client.client_id },
        }))!.lastUsedAt.getTime();
      clock.tick(2 * 60 * 60_000);
      const tokens = await signIn();
      expect(await lastUsed()).to.equal(Date.now());
      clock.tick(2 * 60 * 60_000);
      await provider.exchangeRefreshToken(client, tokens.refresh_token!);
      expect(await lastUsed()).to.equal(Date.now());
    });
  });

  describe('spent refresh tokens', () => {
    it('are remembered for 7 days: a reuse inside them revokes the grant', async () => {
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
      const first = await signIn();
      const second = await provider.exchangeRefreshToken(client, first.refresh_token!);
      clock.tick(SPENT_REFRESH_TOKEN_MEMORY_MS - 60_000);
      expect(await grants.rotate(first.refresh_token!)).to.equal('reused');
      expect(await grants.rotate(second.refresh_token!)).to.equal('invalid');
    });

    it('are forgotten after 7 days, by a hub that only refreshes', async () => {
      const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
      const revokedOne = await signIn();
      const gone = String((await claimsOf(revokedOne.access_token)).gid);
      await grants.revoke(gone, 'test');
      const first = await signIn();
      const gid = String((await claimsOf(first.access_token)).gid);
      const second = await provider.exchangeRefreshToken(client, first.refresh_token!);
      expect(await prisma.mcpGrant.count({ where: { rotatedFromId: gid } })).to.equal(1);

      clock.tick(SPENT_REFRESH_TOKEN_MEMORY_MS + 60_000);
      // No new sign-in: only this refresh runs, and it prunes.
      const third = await provider.exchangeRefreshToken(client, second.refresh_token!);
      expect(await prisma.mcpGrant.count({ where: { rotatedFromId: gid } })).to.equal(1);
      expect(await prisma.mcpGrant.findUnique({ where: { id: gone } })).to.equal(null);
      // The forgotten token is simply invalid; the sign-in goes on.
      expect(await grants.rotate(first.refresh_token!)).to.equal('invalid');
      expect((await grants.find(gid))?.revokedAt).to.equal(null);
      expect(await grants.rotate(third.refresh_token!)).to.be.an('object');
    });
  });

  describe('the grant store', () => {
    it('lists a user’s live grants and revokes them all', async () => {
      await signIn();
      await signIn();
      await signIn({ userId: admin.user.id });
      const mine = await grants.listOf(member.user.id);
      expect(mine).to.have.length(2);
      expect(mine[0]).to.include.keys(
        'id',
        'clientId',
        'scopes',
        'createdAt',
        'lastUsedAt',
        'expiresAt',
      );
      expect(mine[0].clientId).to.equal(client.client_id);
      expect(mine[0]).to.not.have.property('tokenHash');

      const revoke = sinon.spy(grants, 'revoke');
      expect(await grants.revokeAllOf(member.user.id)).to.equal(2);
      expect(revoke.callCount).to.equal(2);
      expect(await grants.listOf(member.user.id)).to.deep.equal([]);
      expect(await grants.listOf(admin.user.id)).to.have.length(1);
    });

    it('revoking by any row of a chain revokes the whole chain', async () => {
      const first = await signIn();
      await provider.exchangeRefreshToken(client, first.refresh_token!);
      const spent = await prisma.mcpGrant.findFirst({ where: { rotatedFromId: { not: null } } });
      await grants.revoke(spent!.id, 'test');
      const gid = String((await claimsOf(first.access_token)).gid);
      expect((await grants.find(gid))?.revokedAt).to.be.instanceOf(Date);
      await grants.revoke('no-such-grant', 'test'); // nothing to do, no throw
    });

    it('revokeToken revokes the grant of its client’s refresh or access token only', async () => {
      const a = await signIn();
      await provider.revokeToken!(otherClient, { token: a.refresh_token! });
      expect(await grants.listOf(member.user.id)).to.have.length(1);
      await provider.revokeToken!(client, { token: a.refresh_token! });
      expect(await grants.listOf(member.user.id)).to.have.length(0);

      const b = await signIn();
      await provider.revokeToken!(otherClient, { token: b.access_token });
      expect(await grants.listOf(member.user.id)).to.have.length(1);
      await provider.revokeToken!(client, {
        token: b.access_token,
        token_type_hint: 'access_token',
      });
      expect(await grants.listOf(member.user.id)).to.have.length(0);

      await provider.revokeToken!(client, { token: 'garbage' }); // does nothing
    });
  });
});
