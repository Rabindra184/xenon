import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Server } from 'http';
import type { AddressInfo } from 'net';
import { Container } from 'typedi';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth, OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { createOAuthMetadata } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { TooManyRequestsError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { useScratchDatabase } from '../helpers/scratch-database';
import { seedUser, SeededUser } from '../helpers/seedUser';
import { loopbackServers } from '../helpers/loopbackServer';
import request from '../helpers/loopbackRequest';
import { saveRegistrations } from '../helpers/container-registration';
import { createRouter } from '../../src/app/index';
import { oauthWellKnownRouter, resetOAuthRateLimits } from '../../src/app/routers/oauth';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { AuthCodes } from '../../src/services/oauth/authCodes';
import { ClientStore } from '../../src/services/oauth/clientStore';
import { PendingAuthorizations } from '../../src/services/oauth/pendingAuthorizations';
import { config } from '../../src/config';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { appiumBaseDriver, quietAppiumLogs, umbrellaWith } from '../helpers/appium-umbrella';

/** An agent's side of sign-in, as an MCP client keeps it (the SDK's OAuthClientProvider). */
let agents = 0;

class SpecAgent implements OAuthClientProvider {
  /**
   * Where this agent calls from, as the spec's trusted proxy says
   * (X-Forwarded-For): each agent its own, so registrations made across the
   * spec never meet the per-address limits.
   */
  readonly address = `198.18.${Math.floor(++agents / 250)}.${(agents % 250) + 1}`;
  info?: OAuthClientInformationMixed;
  saved?: OAuthTokens;
  verifier = '';
  authUrl?: URL;

  constructor(readonly redirectUrl = 'http://127.0.0.1:47831/callback') {}

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Spec Agent',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  state(): string {
    return 'spec-state';
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: OAuthTokens) {
    this.saved = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.authUrl = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
}

/**
 * Browser sign-in for agents, end to end: the SDK's own client auth helper
 * against a real server on loopback, with the user's consent posted as the
 * dashboard posts it.
 */
describe('agent sign-in (OAuth) end to end', () => {
  useScratchDatabase({ wholeSuite: true });

  const servers = loopbackServers();
  let member: SeededUser;
  let keys: JwtKeyService;
  let keyDir: string;
  let origin: string;
  let mcpUrl: string;
  let savedAuthDisabled: boolean;
  let savedPublicUrl: string | undefined;
  let restoreContainer: () => void;
  /** Where this test's own authorize and token requests come from (X-Forwarded-For). */
  let testAddress: string;
  let tests = 0;

  function appFor(trustProxy?: unknown): express.Express {
    const app = express();
    if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
    app.use(oauthWellKnownRouter({ ...DefaultPluginArgs }));
    app.use('/xenon', createRouter({ ...DefaultPluginArgs }));
    return app;
  }

  before(async () => {
    member = await seedUser('MEMBER', { name: 'Agent Owner' });
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-oauth-flow-'));
    keys = new JwtKeyService();
    await keys.init(keyDir);
  });

  after(() => {
    fs.rmSync(keyDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    savedAuthDisabled = config.authDisabled;
    savedPublicUrl = config.publicUrl;
    config.authDisabled = false;
    config.publicUrl = undefined;
    resetOAuthRateLimits();
    testAddress = `198.19.${Math.floor(++tests / 250)}.${(tests % 250) + 1}`;
    restoreContainer = saveRegistrations(JwtKeyService);
    Container.set(JwtKeyService, keys);
    const server: Server = await servers.serve(appFor('loopback'));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    mcpUrl = `${origin}/xenon/mcp`;
  });

  afterEach(async () => {
    sinon.restore();
    config.authDisabled = savedAuthDisabled;
    config.publicUrl = savedPublicUrl;
    restoreContainer();
    resetOAuthRateLimits();
    await servers.closeAll();
  });

  /** The SDK's auth() for this agent, its requests sent from the agent's own address. */
  function agentAuth(agent: SpecAgent, opts: { authorizationCode?: string } = {}) {
    return auth(agent, {
      serverUrl: mcpUrl,
      ...opts,
      fetchFn: (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set('x-forwarded-for', agent.address);
        return fetch(url, { ...init, headers });
      },
    });
  }

  /** The consent request the authorize step sent the browser to. */
  async function authorizeAsUser(url: URL, cookie = member.cookie): Promise<string> {
    const res = await request(origin)
      .get(url.pathname + url.search)
      .set('x-forwarded-for', testAddress)
      .set('cookie', cookie);
    expect(res.status, JSON.stringify(res.body)).to.equal(302);
    const match = /^\/xenon\/oauth\/consent\/([A-Za-z0-9_-]+)$/.exec(res.headers.location);
    expect(match, res.headers.location).to.not.equal(null);
    return match![1];
  }

  async function consent(requestId: string, allow: boolean, cookie = member.cookie) {
    return request(origin)
      .post(`/xenon/api/oauth/consent/${requestId}`)
      .set('cookie', cookie)
      .set('origin', origin)
      .send({ allow });
  }

  /** Registration, authorize, consent and the code exchange: the agent ends up holding tokens. */
  async function signIn(agent = new SpecAgent(), cookie = member.cookie): Promise<SpecAgent> {
    expect(await agentAuth(agent)).to.equal('REDIRECT');
    const requestId = await authorizeAsUser(agent.authUrl!, cookie);
    const allowed = await consent(requestId, true, cookie);
    expect(allowed.status, JSON.stringify(allowed.body)).to.equal(200);
    const back = new URL(allowed.body.redirectTo);
    expect(back.searchParams.get('state')).to.equal('spec-state');
    const code = back.searchParams.get('code')!;
    expect(code).to.be.a('string');
    expect(await agentAuth(agent, { authorizationCode: code })).to.equal('AUTHORIZED');
    return agent;
  }

  function tokenRequest(fields: Record<string, string>) {
    return request(origin)
      .post('/xenon/api/oauth/token')
      .set('x-forwarded-for', testAddress)
      .type('form')
      .send(fields);
  }

  it('an agent signs in and calls xenon_lab_info', async () => {
    const agent = await signIn();
    expect(agent.saved?.token_type).to.equal('Bearer');
    expect(agent.saved?.refresh_token).to.be.a('string');

    const client = new Client({ name: 'oauth-flow-spec', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(mcpUrl), { authProvider: agent }),
    );
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).to.include('xenon_lab_info');
      const result = (await client.callTool({ name: 'xenon_lab_info', arguments: {} })) as {
        content: Array<{ type: string; text: string }>;
      };
      const info = JSON.parse(result.content[0].text);
      expect(info.userId).to.equal(member.user.id);
      expect(info.role).to.equal('MEMBER');
    } finally {
      await client.close();
    }
  });

  it("an admin's agent gets the admin's teams and phones, never the admin scope", async () => {
    const admin = await seedUser('ADMIN', { name: 'Lab Admin' });
    const other = await seedUser('MEMBER', { name: 'Someone Else' });
    const agent = await signIn(new SpecAgent(), admin.cookie);
    const bearer = `Bearer ${agent.saved!.access_token}`;
    const claims = JSON.parse(
      Buffer.from(agent.saved!.access_token.split('.')[1], 'base64url').toString(),
    );
    // The agent asked for every scope, as the SDK's client does.
    expect(String(claims.scope).split(' ')).to.include('xenon:execute');
    expect(String(claims.scopes).split(',')).to.not.include('admin');
    expect(claims.roles).to.deep.equal([]);

    // No admin route: managing accounts, or another user's agents.
    const patch = await request(origin)
      .patch(`/xenon/api/users/${other.user.id}`)
      .set('authorization', bearer)
      .send({ role: 'ADMIN' });
    expect(patch.status, JSON.stringify(patch.body)).to.equal(403);
    expect(patch.body).to.deep.equal({ error: 'insufficient scope' });
    const bulk = await request(origin)
      .delete(`/xenon/api/oauth/grants?userId=${other.user.id}`)
      .set('authorization', bearer);
    expect(bulk.status).to.equal(403);
    expect(bulk.body).to.deep.equal({ error: 'insufficient scope' });
    // The admin, signed in to the dashboard, may.
    const asAdmin = await request(origin)
      .get('/xenon/api/users')
      .set('cookie', admin.cookie)
      .set('origin', origin);
    expect(asAdmin.status).to.equal(200);

    // What the agent may do still follows the admin's role: every team's phones.
    const me = await request(origin).get('/xenon/api/auth/me').set('authorization', bearer);
    expect(me.status, JSON.stringify(me.body)).to.equal(200);
    expect(me.body.role).to.equal('ADMIN');
  });

  it('the consent request names the agent, the hub and the scopes', async () => {
    const agent = new SpecAgent();
    await agentAuth(agent);
    const requestId = await authorizeAsUser(agent.authUrl!);
    const res = await request(origin)
      .get(`/xenon/api/oauth/consent/${requestId}`)
      .set('cookie', member.cookie);
    expect(res.status).to.equal(200);
    expect(res.body.requestId).to.equal(requestId);
    expect(res.body.client.name).to.equal('Spec Agent');
    expect(res.body.hub).to.equal(origin);
    expect(res.body.redirectUri).to.equal(agent.redirectUrl);
    // Asked for all the hub's scopes; a member is granted those a member may have.
    expect(res.body.scopes).to.include('xenon:devices:read');
    expect(res.body.scopes).to.include('appium:use');
    expect(res.body.expiresAt).to.be.a('string');
  });

  it('the metadata names this hub on plain HTTP', async () => {
    const host = 'lab-mac:4723';
    const as = await request(origin)
      .get('/.well-known/oauth-authorization-server')
      .set('host', host);
    expect(as.status).to.equal(200);
    const metadata = OAuthMetadataSchema.parse(as.body);
    expect(metadata.issuer).to.equal('http://lab-mac:4723');
    expect(metadata.authorization_endpoint).to.equal(
      'http://lab-mac:4723/xenon/api/oauth/authorize',
    );
    expect(metadata.token_endpoint).to.equal('http://lab-mac:4723/xenon/api/oauth/token');
    expect(metadata.registration_endpoint).to.equal('http://lab-mac:4723/xenon/api/oauth/register');
    expect(metadata.revocation_endpoint).to.equal('http://lab-mac:4723/xenon/api/oauth/revoke');
    expect(metadata.code_challenge_methods_supported).to.deep.equal(['S256']);
    expect(metadata.token_endpoint_auth_methods_supported).to.deep.equal(['none']);
    // The SDK's own router refuses exactly this issuer; that is why the hub
    // writes its documents itself.
    expect(() =>
      createOAuthMetadata({
        provider: {} as any,
        issuerUrl: new URL('http://lab-mac:4723'),
      }),
    ).to.throw();

    for (const where of [
      '/.well-known/oauth-protected-resource/xenon/mcp',
      '/.well-known/oauth-protected-resource',
    ]) {
      const prm = await request(origin).get(where).set('host', host);
      expect(prm.status, where).to.equal(200);
      const doc = OAuthProtectedResourceMetadataSchema.parse(prm.body);
      expect(doc.resource).to.equal('http://lab-mac:4723/xenon/mcp');
      expect(doc.authorization_servers).to.deep.equal(['http://lab-mac:4723']);
    }
  });

  it('XENON_MCP_CLIENT_DOCUMENTS=off stops offering client_id documents; agents still register and sign in', async () => {
    const saved = process.env.XENON_MCP_CLIENT_DOCUMENTS;
    try {
      const on = await request(origin).get('/.well-known/oauth-authorization-server');
      expect(on.body.client_id_metadata_document_supported).to.equal(true);

      process.env.XENON_MCP_CLIENT_DOCUMENTS = 'off';
      const off = await request(origin).get('/.well-known/oauth-authorization-server');
      expect(off.status).to.equal(200);
      expect(off.body.client_id_metadata_document_supported).to.equal(false);
      const agent = await signIn();
      expect(agent.saved?.access_token).to.be.a('string');
    } finally {
      if (saved === undefined) delete process.env.XENON_MCP_CLIENT_DOCUMENTS;
      else process.env.XENON_MCP_CLIENT_DOCUMENTS = saved;
    }
  });

  it('the 401 challenge names the protected-resource document the hub serves', async () => {
    const res = await request(origin)
      .post('/xenon/mcp')
      .set('accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).to.equal(401);
    const at = /resource_metadata="([^"]+)"/.exec(res.headers['www-authenticate'])![1];
    const doc = await request(origin).get(new URL(at).pathname);
    expect(doc.status).to.equal(200);
    expect(doc.body.resource).to.equal(mcpUrl);
  });

  it('deny redirects with error=access_denied', async () => {
    const agent = new SpecAgent();
    await agentAuth(agent);
    const requestId = await authorizeAsUser(agent.authUrl!);
    const denied = await consent(requestId, false);
    expect(denied.status).to.equal(200);
    const back = new URL(denied.body.redirectTo);
    expect(back.origin + back.pathname).to.equal(agent.redirectUrl);
    expect(back.searchParams.get('error')).to.equal('access_denied');
    expect(back.searchParams.get('state')).to.equal('spec-state');
    expect(back.searchParams.has('code')).to.equal(false);
    // A consent is answered once.
    expect((await consent(requestId, true)).status).to.equal(404);
  });

  describe('resource', () => {
    it('a wrong resource is refused', async () => {
      const agent = new SpecAgent();
      await agentAuth(agent);
      const url = new URL(agent.authUrl!);
      url.searchParams.set('resource', 'http://other.example:4723/xenon/mcp');
      const res = await request(origin)
        .get(url.pathname + url.search)
        .set('cookie', member.cookie);
      expect(res.status).to.equal(400);
      expect(res.headers.location).to.equal(undefined);
      expect(res.body.error).to.equal('invalid_target');
    });

    it('is accepted with and without a trailing slash, at authorize and at the exchange', async () => {
      for (const resource of [mcpUrl, `${mcpUrl}/`]) {
        const agent = new SpecAgent();
        await agentAuth(agent);
        const url = new URL(agent.authUrl!);
        url.searchParams.set('resource', resource);
        const requestId = await authorizeAsUser(url);
        const code = new URL((await consent(requestId, true)).body.redirectTo).searchParams.get(
          'code',
        )!;
        const res = await tokenRequest({
          grant_type: 'authorization_code',
          client_id: agent.info!.client_id,
          code,
          code_verifier: agent.verifier,
          redirect_uri: agent.redirectUrl,
          resource: resource.endsWith('/') ? mcpUrl : `${mcpUrl}/`,
        });
        expect(res.status, `${resource}: ${JSON.stringify(res.body)}`).to.equal(200);
        expect(res.body.access_token).to.be.a('string');
      }
    });

    it('a wrong resource at the code exchange is invalid_target, and leaves the code unused', async () => {
      const agent = new SpecAgent();
      await agentAuth(agent);
      const requestId = await authorizeAsUser(agent.authUrl!);
      const code = new URL((await consent(requestId, true)).body.redirectTo).searchParams.get(
        'code',
      )!;
      const fields = {
        grant_type: 'authorization_code',
        client_id: agent.info!.client_id,
        code,
        code_verifier: agent.verifier,
        redirect_uri: agent.redirectUrl,
      };
      const wrong = await tokenRequest({ ...fields, resource: 'http://other.example/xenon/mcp' });
      expect(wrong.status).to.equal(400);
      expect(wrong.body.error).to.equal('invalid_target');
      const right = await tokenRequest({ ...fields, resource: mcpUrl });
      expect(right.status, JSON.stringify(right.body)).to.equal(200);
    });

    it('a wrong resource on refresh is invalid_target, and leaves the refresh token working', async () => {
      const agent = await signIn();
      const fields = {
        grant_type: 'refresh_token',
        client_id: agent.info!.client_id,
        refresh_token: agent.saved!.refresh_token!,
      };
      const wrong = await tokenRequest({ ...fields, resource: 'http://127.0.0.1:1/xenon/mcp' });
      expect(wrong.status).to.equal(400);
      expect(wrong.body.error).to.equal('invalid_target');
      const right = await tokenRequest({ ...fields, resource: `${mcpUrl}/` });
      expect(right.status, JSON.stringify(right.body)).to.equal(200);
    });

    it('a resource given twice is refused', async () => {
      const agent = await signIn();
      const res = await request(origin)
        .post('/xenon/api/oauth/token')
        .type('form')
        .send(
          `grant_type=refresh_token&client_id=${agent.info!.client_id}` +
            `&refresh_token=${agent.saved!.refresh_token}` +
            `&resource=${encodeURIComponent(mcpUrl)}&resource=${encodeURIComponent(mcpUrl)}`,
        );
      expect(res.status).to.equal(400);
      expect(res.body.error).to.equal('invalid_target');
    });
  });

  describe('consent', () => {
    it('consent without the CSRF origin is refused 403', async () => {
      const agent = new SpecAgent();
      await agentAuth(agent);
      const requestId = await authorizeAsUser(agent.authUrl!);

      const noOrigin = await request(origin)
        .post(`/xenon/api/oauth/consent/${requestId}`)
        .set('cookie', member.cookie)
        .send({ allow: true });
      expect(noOrigin.status).to.equal(403);

      const foreign = await request(origin)
        .post(`/xenon/api/oauth/consent/${requestId}`)
        .set('cookie', member.cookie)
        .set('origin', 'https://evil.example')
        .send({ allow: true });
      expect(foreign.status).to.equal(403);

      // Neither used the request up.
      expect((await consent(requestId, true)).status).to.equal(200);
    });

    it('only a signed-in dashboard user may consent: a bearer token is refused 403', async () => {
      const signedIn = await signIn();
      const agent = new SpecAgent();
      await agentAuth(agent);
      const requestId = await authorizeAsUser(agent.authUrl!);
      const bearer = `Bearer ${signedIn.saved!.access_token}`;

      const read = await request(origin)
        .get(`/xenon/api/oauth/consent/${requestId}`)
        .set('authorization', bearer);
      expect(read.status).to.equal(403);
      expect(read.body.error).to.equal('dashboard_sign_in_required');

      const post = await request(origin)
        .post(`/xenon/api/oauth/consent/${requestId}`)
        .set('authorization', bearer)
        .send({ allow: true });
      expect(post.status).to.equal(403);
      expect(post.body.error).to.equal('dashboard_sign_in_required');
      expect((await consent(requestId, true)).status).to.equal(200);
    });

    it('authorize sends a browser with no sign-in to the consent page too, where consent is 401 until it signs in', async () => {
      // The dashboard cookie is SameSite=Strict, so the browser an agent
      // opens carries none: authorize can't tell who is signed in. The
      // consent page's own requests carry it, and its route guard sends a
      // signed-out visitor to sign in and back.
      const agent = new SpecAgent();
      await agentAuth(agent);
      const url = agent.authUrl!;
      const res = await request(origin).get(url.pathname + url.search);
      expect(res.status).to.equal(302);
      const match = /^\/xenon\/oauth\/consent\/([A-Za-z0-9_-]+)$/.exec(res.headers.location);
      expect(match, res.headers.location).to.not.equal(null);
      const requestId = match![1];

      const unauthenticated = await request(origin).get(`/xenon/api/oauth/consent/${requestId}`);
      expect(unauthenticated.status).to.equal(401);
      // Signed in afterwards, the same request is consented to.
      expect((await consent(requestId, true)).status).to.equal(200);
    });

    it('an unknown consent request is 404', async () => {
      const read = await request(origin)
        .get('/xenon/api/oauth/consent/no-such-request')
        .set('cookie', member.cookie);
      expect(read.status).to.equal(404);
      expect(read.body.error).to.equal('not_found');
      expect((await consent('no-such-request', true)).status).to.equal(404);
    });

    it('allow must be a boolean', async () => {
      const agent = new SpecAgent();
      await agentAuth(agent);
      const requestId = await authorizeAsUser(agent.authUrl!);
      const res = await request(origin)
        .post(`/xenon/api/oauth/consent/${requestId}`)
        .set('cookie', member.cookie)
        .set('origin', origin)
        .send({ allow: 'yes' });
      expect(res.status).to.equal(400);
      expect((await consent(requestId, true)).status).to.equal(200);
    });

    it('allowing scopes the user may not grant goes back with invalid_scope, and no code', async () => {
      const agent = new SpecAgent();
      await agentAuth(agent);
      const url = new URL(agent.authUrl!);
      url.searchParams.set('scope', 'xenon:no-such-scope');
      const requestId = await authorizeAsUser(url);
      const allowed = await consent(requestId, true);
      expect(allowed.status).to.equal(200);
      const back = new URL(allowed.body.redirectTo);
      expect(back.searchParams.get('error')).to.equal('invalid_scope');
      expect(back.searchParams.get('state')).to.equal('spec-state');
      expect(back.searchParams.has('code')).to.equal(false);
      expect((await consent(requestId, true)).status).to.equal(404);
    });

    it('a full code store answers too_many_requests (429), and the consent can be sent again', async () => {
      const agent = new SpecAgent();
      await agentAuth(agent);
      const requestId = await authorizeAsUser(agent.authUrl!);
      const issue = sinon
        .stub(Container.get(AuthCodes), 'issue')
        .throws(new TooManyRequestsError('too many sign-ins in progress'));
      const full = await consent(requestId, true);
      expect(full.status).to.equal(429);
      expect(full.body.error).to.equal('too_many_requests');
      issue.restore();
      expect((await consent(requestId, true)).status).to.equal(200);
    });
  });

  it('refresh gives a new pair and the old refresh token stops working', async () => {
    const agent = await signIn();
    const first = agent.saved!;
    expect(await agentAuth(agent)).to.equal('AUTHORIZED');
    const second = agent.saved!;
    expect(second.refresh_token).to.be.a('string');
    expect(second.refresh_token).to.not.equal(first.refresh_token);
    expect(second.access_token).to.be.a('string');

    const old = await tokenRequest({
      grant_type: 'refresh_token',
      client_id: agent.info!.client_id,
      refresh_token: first.refresh_token!,
    });
    expect(old.status).to.equal(400);
    expect(old.body.error).to.equal('invalid_grant');
    // A spent token presented again revokes the sign-in: the new one dies too.
    const next = await tokenRequest({
      grant_type: 'refresh_token',
      client_id: agent.info!.client_id,
      refresh_token: second.refresh_token!,
    });
    expect(next.status).to.equal(400);
    expect(next.body.error).to.equal('invalid_grant');
  });

  it('revoke ends the sign-in', async () => {
    const agent = await signIn();
    const res = await request(origin)
      .post('/xenon/api/oauth/revoke')
      .type('form')
      .send({ client_id: agent.info!.client_id, token: agent.saved!.refresh_token! });
    expect(res.status).to.equal(200);
    const after = await tokenRequest({
      grant_type: 'refresh_token',
      client_id: agent.info!.client_id,
      refresh_token: agent.saved!.refresh_token!,
    });
    expect(after.status).to.equal(400);
  });

  describe('redirect URIs and PKCE', () => {
    it('a loopback redirect URI matches on any port', async () => {
      const agent = new SpecAgent('http://127.0.0.1:47831/callback');
      await agentAuth(agent);
      const url = new URL(agent.authUrl!);
      url.searchParams.set('redirect_uri', 'http://127.0.0.1:51000/callback');
      const requestId = await authorizeAsUser(url);
      const back = new URL((await consent(requestId, true)).body.redirectTo);
      expect(back.origin).to.equal('http://127.0.0.1:51000');
      const res = await tokenRequest({
        grant_type: 'authorization_code',
        client_id: agent.info!.client_id,
        code: back.searchParams.get('code')!,
        code_verifier: agent.verifier,
        redirect_uri: 'http://127.0.0.1:51000/callback',
      });
      expect(res.status, JSON.stringify(res.body)).to.equal(200);
    });

    it('a loopback redirect URI with another path, or another loopback host, is refused', async () => {
      const agent = new SpecAgent('http://127.0.0.1:47831/callback');
      await agentAuth(agent);
      for (const redirect of ['http://127.0.0.1:47831/other', 'http://localhost:47831/callback']) {
        const url = new URL(agent.authUrl!);
        url.searchParams.set('redirect_uri', redirect);
        const res = await request(origin)
          .get(url.pathname + url.search)
          .set('cookie', member.cookie);
        expect(res.status, redirect).to.equal(400);
        expect(res.body.error).to.equal('invalid_request');
      }
    });

    it('any other redirect URI must match exactly, port included', async () => {
      const agent = new SpecAgent('https://agent.example/callback');
      await agentAuth(agent);
      const url = new URL(agent.authUrl!);
      url.searchParams.set('redirect_uri', 'https://agent.example:8443/callback');
      const res = await request(origin)
        .get(url.pathname + url.search)
        .set('cookie', member.cookie);
      expect(res.status).to.equal(400);
      expect(res.body.error).to.equal('invalid_request');
    });

    it('authorize is GET only: a POST never reaches it', async () => {
      const agent = new SpecAgent();
      await agentAuth(agent);
      const form = agent.authUrl!.search.slice(1);
      const anonymous = await request(origin)
        .post('/xenon/api/oauth/authorize')
        .set('origin', origin)
        .type('form')
        .send(form);
      expect(anonymous.status).to.equal(401);
      const signedIn = await request(origin)
        .post('/xenon/api/oauth/authorize')
        .set('origin', origin)
        .set('cookie', member.cookie)
        .type('form')
        .send(form);
      expect(signedIn.status).to.equal(404);
    });

    it('a plain or missing PKCE challenge is refused', async () => {
      const agent = new SpecAgent();
      await agentAuth(agent);
      const plain = new URL(agent.authUrl!);
      plain.searchParams.set('code_challenge_method', 'plain');
      const missing = new URL(agent.authUrl!);
      missing.searchParams.delete('code_challenge');
      for (const url of [plain, missing]) {
        const res = await request(origin)
          .get(url.pathname + url.search)
          .set('cookie', member.cookie);
        expect(res.status).to.equal(400);
        expect(res.headers.location).to.equal(undefined);
        expect(res.body.error).to.equal('invalid_request');
      }
    });

    it('no error before consent sends the browser to the agent: each is answered directly', async () => {
      // A self-registered agent may name any https redirect URI: an automatic
      // redirect there would make the hub's own link an open redirector.
      const agent = new SpecAgent('https://evil.example/cb');
      await agentAuth(agent);
      const variants: Array<[string, (u: URL) => void, string]> = [
        ['response_type', (u) => u.searchParams.set('response_type', 'x'), 'invalid_request'],
        ['no response_type', (u) => u.searchParams.delete('response_type'), 'invalid_request'],
        ['short challenge', (u) => u.searchParams.set('code_challenge', 'abc'), 'invalid_request'],
        [
          'unparsable resource',
          (u) => u.searchParams.set('resource', 'not a url'),
          'invalid_target',
        ],
        ['state twice', (u) => u.searchParams.append('state', 'again'), 'invalid_request'],
        ['scope twice', (u) => u.searchParams.append('scope', 'appium:use'), 'invalid_request'],
      ];
      for (const [what, change, error] of variants) {
        const url = new URL(agent.authUrl!);
        change(url);
        const res = await request(origin)
          .get(url.pathname + url.search)
          .set('x-forwarded-for', testAddress)
          .set('cookie', member.cookie);
        expect(res.status, what).to.equal(400);
        expect(res.headers.location, what).to.equal(undefined);
        expect(res.body.error, what).to.equal(error);
      }
    });

    it('a full pending store is answered directly, 429', async () => {
      const agent = new SpecAgent('https://evil.example/cb');
      await agentAuth(agent);
      sinon
        .stub(Container.get(PendingAuthorizations), 'add')
        .throws(new TooManyRequestsError('Too many sign-ins are waiting for consent'));
      const url = agent.authUrl!;
      const res = await request(origin)
        .get(url.pathname + url.search)
        .set('x-forwarded-for', testAddress);
      expect(res.status).to.equal(429);
      expect(res.headers.location).to.equal(undefined);
      expect(res.body.error).to.equal('too_many_requests');
    });

    it('a Host that makes no URL is invalid_target, answered directly', async () => {
      const agent = new SpecAgent('https://evil.example/cb');
      await agentAuth(agent);
      const url = new URL(agent.authUrl!);
      url.searchParams.delete('resource');
      const res = await request(origin)
        .get(url.pathname + url.search)
        .set('x-forwarded-for', testAddress)
        .set('host', 'bad host');
      expect(res.status).to.equal(400);
      expect(res.headers.location).to.equal(undefined);
      expect(res.body.error).to.equal('invalid_target');
    });
  });

  describe("the caller's address", () => {
    function register(forwardedFor: string, body: object = new SpecAgent().clientMetadata) {
      return request(origin)
        .post('/xenon/api/oauth/register')
        .set('x-forwarded-for', forwardedFor)
        .send(body);
    }

    it("counts a registration against the caller's address, as trustProxy reads it", async () => {
      const spy = sinon.spy(Container.get(ClientStore), 'registerClient');
      expect((await register('::ffff:198.51.100.7')).status).to.equal(201);
      expect((await register('2001:db8:1:2:aaaa::1')).status).to.equal(201);
      expect(spy.firstCall.args[1]).to.equal('198.51.100.7');
      expect(spy.secondCall.args[1]).to.equal('2001:db8:1:2::/64');
      const res = await register('198.51.100.8');
      expect(res.body.client_secret).to.equal(undefined);
      expect(res.body.token_endpoint_auth_method).to.equal('none');
    });

    it('limits registrations per address, failed ones included', async () => {
      const bad = { redirect_uris: ['http://agent.example/callback'] };
      for (let i = 0; i < 20; i++) {
        expect((await register('203.0.113.50', bad)).status).to.equal(400);
      }
      const limited = await register('203.0.113.50');
      expect(limited.status).to.equal(429);
      expect(limited.body.error).to.equal('too_many_requests');
      expect(limited.headers['retry-after']).to.match(/^\d+$/);
      // An IPv4-mapped spelling of the same address shares its count.
      expect((await register('::ffff:203.0.113.50')).status).to.equal(429);
      expect((await register('203.0.113.51')).status).to.equal(201);
    });

    it('limits token requests per address; one /64 is one address', async () => {
      const send = (xff: string) =>
        request(origin)
          .post('/xenon/api/oauth/token')
          .set('x-forwarded-for', xff)
          .type('form')
          .send({ grant_type: 'refresh_token', client_id: 'nobody', refresh_token: 'x' });
      for (let i = 0; i < 50; i++) {
        expect((await send(`2001:db8:5:6::${(i + 1).toString(16)}`)).status).to.equal(400);
      }
      expect((await send('2001:db8:5:6:ffff::1')).status).to.equal(429);
      expect((await send('2001:db8:5:7::1')).status).to.equal(400);
    });
    it('limits authorize requests per address', async () => {
      const send = (xff: string) =>
        request(origin)
          .get('/xenon/api/oauth/authorize?client_id=no-such-agent&response_type=code')
          .set('x-forwarded-for', xff);
      for (let i = 0; i < 100; i++) {
        expect((await send('203.0.113.70')).status).to.equal(400);
      }
      expect((await send('203.0.113.70')).status).to.equal(429);
      expect((await send('203.0.113.71')).status).to.equal(400);
    });

    it('limits revocations per address', async () => {
      const send = (xff: string) =>
        request(origin)
          .post('/xenon/api/oauth/revoke')
          .set('x-forwarded-for', xff)
          .type('form')
          .send({ client_id: 'no-such-agent', token: 'x' });
      for (let i = 0; i < 50; i++) {
        expect((await send('203.0.113.80')).status).to.equal(400);
      }
      expect((await send('203.0.113.80')).status).to.equal(429);
      expect((await send('203.0.113.81')).status).to.equal(400);
    });
  });

  describe('with auth disabled', () => {
    it('serves no sign-in and no metadata', async () => {
      config.authDisabled = true;
      for (const where of [
        '/.well-known/oauth-protected-resource/xenon/mcp',
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-authorization-server',
        '/xenon/api/oauth/authorize?client_id=x',
        '/xenon/api/oauth/consent/x',
      ]) {
        expect((await request(origin).get(where)).status, where).to.equal(404);
      }
      for (const where of [
        '/xenon/api/oauth/register',
        '/xenon/api/oauth/token',
        '/xenon/api/oauth/revoke',
      ]) {
        expect((await request(origin).post(where).send({})).status, where).to.equal(404);
      }
    });
  });

  describe("behind Appium's own server", () => {
    let appium: Server | undefined;
    let appiumLogs: { restore(): void };

    before(() => {
      appiumLogs = quietAppiumLogs();
    });
    after(() => appiumLogs.restore());

    // As ServerManager mounts them on Appium's app: Appium's body parsers,
    // CORS and catch-all 404 are all in the way.
    beforeEach(async () => {
      const baseDriver = appiumBaseDriver();
      appium = await baseDriver.server({
        routeConfiguringFunction: baseDriver.routeConfiguringFunction(umbrellaWith([])),
        port: 0,
        hostname: '127.0.0.1',
        basePath: '',
        cliArgs: {},
        serverUpdaters: [
          (app: express.Express) => {
            app.set('trust proxy', 'loopback');
            app.use(oauthWellKnownRouter({ ...DefaultPluginArgs }));
            app.use('/xenon', createRouter({ ...DefaultPluginArgs }));
          },
        ],
      });
      origin = `http://127.0.0.1:${(appium!.address() as AddressInfo).port}`;
      mcpUrl = `${origin}/xenon/mcp`;
    });

    afterEach(async () => {
      const s = appium;
      appium = undefined;
      if (!s) return;
      s.closeAllConnections();
      await new Promise<void>((resolve) => Server.prototype.close.call(s, () => resolve()));
    });

    it('an agent signs in, refreshes and lists its tools', async () => {
      const agent = await signIn();
      expect(await agentAuth(agent)).to.equal('AUTHORIZED');
      const client = new Client({ name: 'oauth-flow-spec', version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(mcpUrl), { authProvider: agent }),
      );
      try {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).to.include('xenon_lab_info');
      } finally {
        await client.close();
      }
    });

    it('a resource given twice is refused there too', async () => {
      const agent = await signIn();
      const res = await request(origin)
        .post('/xenon/api/oauth/token')
        .type('form')
        .send(
          `grant_type=refresh_token&client_id=${agent.info!.client_id}` +
            `&refresh_token=${agent.saved!.refresh_token}` +
            `&resource=${encodeURIComponent(mcpUrl)}&resource[x]=1`,
        );
      expect(res.status).to.equal(400);
      expect(res.body.error).to.equal('invalid_target');
    });

    it("with auth disabled, the metadata is Appium's 404", async () => {
      config.authDisabled = true;
      const res = await request(origin).get('/.well-known/oauth-authorization-server');
      expect(res.status).to.equal(404);
      expect(res.body.value.error).to.equal('unknown command');
    });
  });

  it('a node serves no sign-in routes and no metadata', async () => {
    const app = express();
    app.use(oauthWellKnownRouter({ ...DefaultPluginArgs, hub: 'http://hub.example:4723' } as any));
    const res = await request(app).get('/.well-known/oauth-authorization-server');
    expect(res.status).to.equal(404);
  });
});
