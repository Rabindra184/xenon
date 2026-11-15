import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { createHash } from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { Container } from 'typedi';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { useScratchDatabase } from '../helpers/scratch-database';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';
import { seedUser, SeededUser } from '../helpers/seedUser';
import { loopbackServers } from '../helpers/loopbackServer';
import request from '../helpers/loopbackRequest';
import { saveRegistrations } from '../helpers/container-registration';
import { drainLeaseQueues } from '../helpers/lease-queue';
import { createRouter } from '../../src/app/index';
import { resetOAuthRateLimits } from '../../src/app/routers/oauth';
import { registerCommandAuth } from '../../src/app/registerCommandAuth';
import { CommandCallerVerifier } from '../../src/middleware/commandCaller';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { ALL_GRANULAR_SCOPES, resolveMcpGrant } from '../../src/services/token/mcpScopes';
import { AuthCodes } from '../../src/services/oauth/authCodes';
import { ClientStore } from '../../src/services/oauth/clientStore';
import { GrantStore } from '../../src/services/oauth/grantStore';
import { XenonOAuthProvider } from '../../src/services/oauth/oauthProvider';
import { watchDepartedUsers } from '../../src/services/oauth/departedUsers';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserService } from '../../src/services/UserService';
import { LeaseService } from '../../src/services/lease/LeaseService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';

const REDIRECT = 'http://127.0.0.1:33419/callback';
const SCOPES = ['xenon:devices:read', 'xenon:devices:lock', 'appium:use'];

/** A PKCE pair: the verifier the agent keeps and its S256 challenge. */
function pkce() {
  const verifier =
    createHash('sha256').update(Math.random().toString(36)).digest('base64url') + 'abcdefghij';
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Revoking an agent's sign-in (a grant): from the grants routes, a replayed
 * code, or its user going Inactive or deleted. Its access tokens stop at once
 * on /xenon/mcp, REST and per-command auth, each used first so whatever
 * they cache is warm, and its agent's leases end.
 */
describe("revoking an agent's sign-in", function () {
  this.timeout(60_000);
  useScratchDatabase({ wholeSuite: true });
  useOwnNodeId();

  const servers = loopbackServers();
  const stamp = Date.now();
  let phones = 0;
  const made: string[] = [];
  // Port 1 has nothing listening: the lease's ports go through a stubbed
  // port client, so nothing is sent to "the phone's server".
  const DEVICE_HOST = 'http://127.0.0.1:1';

  let member: SeededUser;
  let other: SeededUser;
  let admin: SeededUser;
  let keys: JwtKeyService;
  let keyDir: string;
  let store: any;
  let svc: LeaseService;
  let client: OAuthClientInformationFull;
  let provider: XenonOAuthProvider;
  let savedAuthDisabled: boolean;
  let restoreContainer: () => void;
  let stopWatching: () => void;
  let origin: string;
  let commandLab: string;
  let sessionOwner: string;

  before(async () => {
    savedAuthDisabled = config.authDisabled;
    config.authDisabled = false;
    restoreContainer = saveRegistrations(JwtKeyService, LeaseService);
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-oauth-revoke-'));
    keys = new JwtKeyService();
    await keys.init(keyDir);
    Container.set(JwtKeyService, keys);

    store = DeviceStoreFactory.getStore();
    const portClient = {
      allocate: sinon.stub().resolves({ systemPort: 13100 }),
      release: sinon.stub().resolves({ released: 1 }),
      extend: sinon.stub().resolves({ extended: 1 }),
    };
    const noAuth = { nodePairAuth: async () => ({ accessKey: '', token: '' }) };
    svc = new LeaseService(prisma, store, portClient, noAuth);
    Container.set(LeaseService, svc);

    member = await seedUser('MEMBER', { name: 'Agent Owner' });
    other = await seedUser('MEMBER', { name: 'Someone Else' });
    admin = await seedUser('ADMIN', { name: 'Lab Admin' });
    client = await Container.get(ClientStore).registerClient({
      client_name: 'Claude Code',
      redirect_uris: [REDIRECT],
    } as OAuthClientInformationFull);
    provider = new XenonOAuthProvider();
    stopWatching = watchDepartedUsers();
  });

  beforeEach(async () => {
    resetOAuthRateLimits();
    const app = express();
    app.use('/xenon', createRouter({ ...DefaultPluginArgs }));
    const server: Server = await servers.serve(app);
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // Per-command auth as the session gateway runs it, with the real
    // verifiers and their cache; the session is `sessionOwner`'s.
    sessionOwner = member.user.id;
    const lab = express();
    lab.get('/wd/hub/session/:sessionId/url', (req, res) =>
      res.json({ value: req.params.sessionId }),
    );
    const placed = registerCommandAuth(
      lab,
      { basePath: '/wd/hub' },
      {
        enabled: () => true,
        authDisabled: () => false,
        verifier: new CommandCallerVerifier(),
        ownerOf: async () => sessionOwner,
        logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      },
    );
    expect(placed.placed).to.equal(true);
    const labServer: Server = await servers.serve(lab);
    commandLab = `http://127.0.0.1:${(labServer.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await servers.closeAll();
    await drainLeaseQueues(svc);
    await prisma.user.updateMany({
      where: { id: { in: [member.user.id, other.user.id] } },
      data: { status: 'ACTIVE', role: 'MEMBER' },
    });
    resetOAuthRateLimits();
  });

  // Loki is one collection for the whole process: take the phones back out.
  after(async () => {
    stopWatching();
    if (!(store instanceof PrismaDeviceStore)) {
      for (const udid of made) await store.removeDevices({ udid });
    }
    config.authDisabled = savedAuthDisabled;
    restoreContainer();
    fs.rmSync(keyDir, { recursive: true, force: true });
  });

  /** A sign-in as the token route makes one: a code, exchanged once. */
  async function signIn(
    user: SeededUser,
    scopes: readonly string[] = SCOPES,
  ): Promise<{ token: string; grantId: string; code: string; verifier: string }> {
    const pair = pkce();
    const code = Container.get(AuthCodes).issue({
      userId: user.user.id,
      clientId: client.client_id,
      redirectUri: REDIRECT,
      codeChallenge: pair.challenge,
      scopes: [...scopes],
      resource: `${origin}/xenon/mcp`,
    });
    const tokens = await provider.exchangeAuthorizationCode(
      client,
      code,
      pair.verifier,
      REDIRECT,
      new URL(`${origin}/xenon/mcp`),
    );
    const claims = await keys.verify(tokens.access_token, { audience: 'xenon-mcp' });
    return {
      token: tokens.access_token,
      grantId: String(claims.gid),
      code,
      verifier: pair.verifier,
    };
  }

  /** A phone a lease can take. */
  async function phone(): Promise<string> {
    const udid = `orv-${stamp}-${++phones}`;
    made.push(udid);
    const row = await prisma.device.create({
      data: {
        udid,
        host: DEVICE_HOST,
        name: udid,
        platform: 'android',
        sdk: '14',
        busy: false,
        offline: false,
        userBlocked: false,
        deviceType: 'real',
        realDevice: true,
        nodeId: OWN_NODE_ID,
      } as any,
    });
    await store.addDevices([row as any]);
    return udid;
  }

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  function mcp(headers: Record<string, string>) {
    return request(origin)
      .post('/xenon/mcp')
      .set(headers)
      .set('accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'oauth-revoke-spec', version: '1.0.0' },
        },
      });
  }

  const rest = (headers: Record<string, string>) =>
    request(origin).get('/xenon/api/auth/me').set(headers);

  const command = (headers: Record<string, string>) =>
    request(commandLab).get('/wd/hub/session/s-1/url').set(headers);

  /** The three surfaces, each asked once (or twice, so a cache is warm). */
  async function statuses(headers: Record<string, string>): Promise<number[]> {
    return [
      (await mcp(headers)).status,
      (await rest(headers)).status,
      (await command(headers)).status,
    ];
  }

  async function callTool(
    headers: Record<string, string>,
    name: string,
    args: Record<string, unknown>,
  ): Promise<any> {
    const mcpClient = new Client({ name: 'oauth-revoke-spec', version: '1.0.0' });
    await mcpClient.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/xenon/mcp`), {
        requestInit: { headers },
      }),
    );
    try {
      const result = (await mcpClient.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError, result.content[0].text).to.not.equal(true);
      return JSON.parse(result.content[0].text);
    } finally {
      await mcpClient.close();
    }
  }

  async function acquire(headers: Record<string, string>, udid: string): Promise<string> {
    return (await callTool(headers, 'xenon_acquire_device', { udid })).lockId;
  }

  const leaseRow = (id: string): Promise<any> => prisma.lease.findUnique({ where: { id } });
  const grantRow = (id: string): Promise<any> => prisma.mcpGrant.findUnique({ where: { id } });

  function revoke(id: string, as: SeededUser) {
    return request(origin)
      .delete(`/xenon/api/oauth/grants/${encodeURIComponent(id)}`)
      .set('cookie', as.cookie)
      .set('origin', origin);
  }

  it("a revoked grant's access token is refused at once on /xenon/mcp, REST and per-command auth", async () => {
    const { token, grantId } = await signIn(member);
    // Used first, twice, so every cache of it is warm.
    expect(await statuses(bearer(token))).to.deep.equal([200, 200, 200]);
    expect(await statuses(bearer(token))).to.deep.equal([200, 200, 200]);

    const res = await revoke(grantId, member);
    expect(res.status, JSON.stringify(res.body)).to.equal(204);

    expect(await statuses(bearer(token))).to.deep.equal([401, 401, 404]);
    expect((await grantRow(grantId)).revokedAt).to.be.instanceOf(Date);
  });

  it('the session token an agent drives WebDriver with stops with its grant', async () => {
    const { token, grantId } = await signIn(member);
    const answer = await callTool(bearer(token), 'xenon_session_capabilities', {});
    const sessionToken = answer.capabilities.alwaysMatch['xe:options'].sessionToken;
    expect((await keys.verify(sessionToken, { audience: 'xenon-session' })).gid).to.equal(grantId);
    // As appium-mcp sends it under per-command auth: the hub URL's Basic password.
    const basic = {
      authorization: `Basic ${Buffer.from(`xenon-session:${sessionToken}`).toString('base64')}`,
    };
    expect((await command(basic)).status).to.equal(200);
    expect((await command(basic)).status).to.equal(200);

    expect((await revoke(grantId, member)).status).to.equal(204);

    expect((await command(basic)).status).to.equal(404);
  });

  it('a token without gid works as before', async () => {
    // As POST /auth/token mints one: no grant behind it.
    const grant = resolveMcpGrant('devices,read', ['xenon:devices:read']);
    const token = await keys.sign(
      {
        sub: member.user.id,
        scopes: grant.flat.join(','),
        scope: grant.granular.join(' '),
        roles: grant.roles,
      },
      { audience: 'xenon-mcp', ttlSeconds: 600 },
    );
    expect(await statuses(bearer(token))).to.deep.equal([200, 200, 200]);

    // Revoking every sign-in of the user leaves it as it was, and stops theirs.
    const signedIn = await signIn(member);
    expect(await statuses(bearer(signedIn.token))).to.deep.equal([200, 200, 200]);
    const all = await request(origin)
      .delete(`/xenon/api/oauth/grants?userId=${member.user.id}`)
      .set('cookie', admin.cookie)
      .set('origin', origin);
    expect(all.status, JSON.stringify(all.body)).to.equal(200);
    expect(all.body.revoked).to.be.at.least(1);
    expect(await statuses(bearer(token))).to.deep.equal([200, 200, 200]);
    expect(await statuses(bearer(signedIn.token))).to.deep.equal([401, 401, 404]);
  });

  it("a grant's token can't make credentials that would outlive it: 403", async () => {
    const asMember = bearer((await signIn(member)).token);
    // A browser sign-in never carries the admin scope, so an admin's agent is
    // refused the admin routes by their scope guard first (`insufficient
    // scope`). This check stands behind that: a grant's token that somehow
    // had `admin` is refused too. Signed here with the real grant's gid.
    const adminSignIn = (await signIn(admin, ALL_GRANULAR_SCOPES)).token;
    const { gid } = await keys.verify(adminSignIn, { audience: 'xenon-mcp' });
    const asAdmin = bearer(
      await keys.sign(
        { sub: admin.user.id, role: 'ADMIN', scopes: 'admin,devices,sessions', gid },
        { audience: 'xenon-mcp', ttlSeconds: 600 },
      ),
    );
    const asAdminAgent = bearer(adminSignIn);
    for (const path of ['/xenon/api/apikeys', '/xenon/api/users']) {
      const refused = await request(origin).post(path).set(asAdminAgent).send({});
      expect(refused.status, path).to.equal(403);
      expect(refused.body.error, path).to.equal('insufficient scope');
    }
    const calls: Array<[string, () => request.Test]> = [
      [
        'POST /auth/token (xenon-rest)',
        () =>
          request(origin)
            .post('/xenon/api/auth/token')
            .set(asMember)
            .send({ audience: 'xenon-rest' }),
      ],
      [
        'POST /auth/token (xenon-mcp)',
        () =>
          request(origin)
            .post('/xenon/api/auth/token')
            .set(asMember)
            .send({ audience: 'xenon-mcp' }),
      ],
      [
        'POST /profile/tokens',
        () =>
          request(origin).post('/xenon/api/profile/tokens').set(asMember).send({ name: 'agent' }),
      ],
      [
        'POST /profile/access-key/rotate',
        () => request(origin).post('/xenon/api/profile/access-key/rotate').set(asAdmin).send({}),
      ],
      [
        'POST /apikeys',
        () =>
          request(origin)
            .post('/xenon/api/apikeys')
            .set(asAdmin)
            .send({ name: 'k', scopes: ['read'] }),
      ],
      [
        'POST /users',
        () =>
          request(origin)
            .post('/xenon/api/users')
            .set(asAdmin)
            .send({ email: `agent-made-${stamp}@xenon.local`, name: 'Made', role: 'MEMBER' }),
      ],
      [
        'POST /users/:id/reset-link',
        () =>
          request(origin)
            .post(`/xenon/api/users/${member.user.id}/reset-link`)
            .set(asAdmin)
            .send({}),
      ],
    ];
    for (const [what, call] of calls) {
      const res = await call();
      expect(res.status, `${what}: ${JSON.stringify(res.body)}`).to.equal(403);
      expect(res.body.error, what).to.equal('agent_sign_in_cannot_make_credentials');
    }
    expect(await prisma.apiKey.count({ where: { name: { in: ['agent', 'k'] } } })).to.equal(0);

    // A token without gid mints as before.
    const plain = await keys.sign(
      { sub: member.user.id, scopes: 'devices,read' },
      { audience: 'xenon-rest', ttlSeconds: 600 },
    );
    const minted = await request(origin)
      .post('/xenon/api/auth/token')
      .set(bearer(plain))
      .send({ audience: 'xenon-rest' });
    expect(minted.status, JSON.stringify(minted.body)).to.equal(200);
  });

  it("a lease a grant's token takes over REST is the grant's, and ends with it", async () => {
    const { token, grantId } = await signIn(member);
    const udid = await phone();
    const res = await request(origin)
      .post('/xenon/api/sdk/leases')
      .set(bearer(token))
      .send({ filters: { platform: 'android', udid }, durationMs: 600_000, heartbeatSeconds: 30 });
    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    const row = await leaseRow(res.body.leaseId);
    expect(row.grantId).to.equal(grantId);
    expect(row.heartbeatFree ?? false).to.equal(false);

    expect((await revoke(grantId, member)).status).to.equal(204);
    expect((await leaseRow(res.body.leaseId)).endReason).to.equal('grant_revoked');
  });

  it("revoking all of a user's sign-ins includes one past its limits whose last token still works", async () => {
    const { token, grantId } = await signIn(other);
    const leaseId = await acquire(bearer(token), await phone());
    // Begun 91 days ago: past XENON_MCP_REFRESH_MAX_DAYS (90), so it can't
    // refresh, but its last hour-long access token is still good.
    await prisma.mcpGrant.update({
      where: { id: grantId },
      data: { createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) },
    });
    expect((await mcp(bearer(token))).status).to.equal(200);

    const all = await request(origin)
      .delete(`/xenon/api/oauth/grants?userId=${other.user.id}`)
      .set('cookie', admin.cookie)
      .set('origin', origin);
    expect(all.status).to.equal(200);
    expect((await grantRow(grantId)).revokedAt).to.be.instanceOf(Date);
    expect(await statuses(bearer(token))).to.deep.equal([401, 401, 404]);
    expect((await leaseRow(leaseId)).endReason).to.equal('grant_revoked');
  });

  it("revoking another user's sign-in takes the admin scope, a SUPER_ADMIN's included", async () => {
    const theirs = await signIn(other);
    const root = await seedUser('SUPER_ADMIN', { name: 'Root' });
    const readOnly = await keys.sign(
      { sub: root.user.id, scopes: 'read' },
      { audience: 'xenon-rest', ttlSeconds: 600 },
    );
    const refused = await request(origin)
      .delete(`/xenon/api/oauth/grants/${theirs.grantId}`)
      .set(bearer(readOnly));
    expect(refused.status).to.equal(404);
    expect((await grantRow(theirs.grantId)).revokedAt).to.equal(null);

    const withAdmin = await keys.sign(
      { sub: root.user.id, scopes: 'admin' },
      { audience: 'xenon-rest', ttlSeconds: 600 },
    );
    const allowed = await request(origin)
      .delete(`/xenon/api/oauth/grants/${theirs.grantId}`)
      .set(bearer(withAdmin));
    expect(allowed.status).to.equal(204);
  });

  it("revoking ends the grant's leases", async () => {
    const { token, grantId } = await signIn(member);
    const udid = await phone();
    const leaseId = await acquire(bearer(token), udid);
    expect((await leaseRow(leaseId)).grantId).to.equal(grantId);

    expect((await revoke(grantId, member)).status).to.equal(204);

    const row = await leaseRow(leaseId);
    expect(row.status).to.equal('released');
    expect(row.endReason).to.equal('grant_revoked');
    expect((await store.findDevice({ udid, host: DEVICE_HOST }))?.busy).to.equal(false);
  });

  it("a member can't revoke another user's grant: 404 as for an unknown id; an admin can", async () => {
    const theirs = await signIn(other);
    const unknown = await revoke('no-such-grant', member);
    expect(unknown.status).to.equal(404);

    const refused = await revoke(theirs.grantId, member);
    expect(refused.status).to.equal(404);
    expect(refused.body).to.deep.equal(unknown.body);
    expect((await grantRow(theirs.grantId)).revokedAt).to.equal(null);
    expect((await mcp(bearer(theirs.token))).status).to.equal(200);

    const byAdmin = await revoke(theirs.grantId, admin);
    expect(byAdmin.status).to.equal(204);
    expect((await grantRow(theirs.grantId)).revokedAt).to.be.instanceOf(Date);
    expect((await mcp(bearer(theirs.token))).status).to.equal(401);

    // Once revoked, it is gone from its owner's view too.
    expect((await revoke(theirs.grantId, other)).body).to.deep.equal(unknown.body);
  });

  it('GET /oauth/grants lists only my live sign-ins', async () => {
    const mine = await signIn(member);
    const gone = await signIn(member);
    await signIn(other);
    expect((await revoke(gone.grantId, member)).status).to.equal(204);

    const res = await request(origin).get('/xenon/api/oauth/grants').set('cookie', member.cookie);
    expect(res.status).to.equal(200);
    const ids = res.body.map((g: any) => g.id);
    expect(ids).to.include(mine.grantId);
    expect(ids).to.not.include(gone.grantId);
    const listed = res.body.find((g: any) => g.id === mine.grantId);
    expect(Object.keys(listed).sort()).to.deep.equal(
      ['clientName', 'createdAt', 'id', 'lastUsedAt', 'scopes'].sort(),
    );
    expect(listed.clientName).to.equal('Claude Code');
    expect(listed.scopes).to.include('xenon:devices:read');
    // Every grant listed is the caller's own.
    const owners = await prisma.mcpGrant.findMany({ where: { id: { in: ids } } });
    expect(owners.every((g: any) => g.userId === member.user.id)).to.equal(true);
  });

  it("revoking all of a user's sign-ins is for admins", async () => {
    const res = await request(origin)
      .delete(`/xenon/api/oauth/grants?userId=${other.user.id}`)
      .set('cookie', member.cookie)
      .set('origin', origin);
    expect(res.status).to.equal(403);

    const missing = await request(origin)
      .delete('/xenon/api/oauth/grants')
      .set('cookie', admin.cookie)
      .set('origin', origin);
    expect(missing.status).to.equal(400);
  });

  it("setting a user Inactive revokes their grants and ends their agents' leases", async () => {
    const { token, grantId } = await signIn(member);
    const viaGrant = await acquire(bearer(token), await phone());
    // A key-pair agent: a heartbeat-free lease under no grant.
    const key = await Container.get(ApiKeyService).create({
      name: 'agent key',
      scopes: ['devices', 'read'],
      userId: member.user.id,
    });
    const keyPair = { 'x-xenon-access-key': member.user.accessKey, 'x-xenon-token': key.raw };
    const viaKey = await acquire(keyPair, await phone());
    const keyLease = await leaseRow(viaKey);
    expect(keyLease.heartbeatFree).to.equal(true);
    expect(keyLease.grantId).to.equal(null);

    const res = await request(origin)
      .patch(`/xenon/api/users/${member.user.id}`)
      .set('cookie', admin.cookie)
      .set('origin', origin)
      .send({ status: 'INACTIVE' });
    expect(res.status, JSON.stringify(res.body)).to.equal(200);

    expect((await grantRow(grantId)).revokedAt).to.be.instanceOf(Date);
    expect((await leaseRow(viaGrant)).endReason).to.equal('grant_revoked');
    const ended = await leaseRow(viaKey);
    expect(ended.status).to.equal('released');
    expect(ended.endReason).to.equal('user_not_active');
  });

  it("deleting a user revokes their grants and ends their agents' leases", async () => {
    const gone = await seedUser('MEMBER', { name: 'Leaving' });
    const { grantId, token } = await signIn(gone);
    const viaGrant = await acquire(bearer(token), await phone());
    const key = await Container.get(ApiKeyService).create({
      name: 'agent key',
      scopes: ['devices', 'read'],
      userId: gone.user.id,
    });
    const viaKey = await acquire(
      { 'x-xenon-access-key': gone.user.accessKey, 'x-xenon-token': key.raw },
      await phone(),
    );

    const res = await request(origin)
      .delete(`/xenon/api/users/${gone.user.id}`)
      .set('cookie', admin.cookie)
      .set('origin', origin);
    expect(res.status, JSON.stringify(res.body)).to.equal(204);

    expect((await grantRow(grantId)).revokedAt).to.be.instanceOf(Date);
    expect((await leaseRow(viaGrant)).endReason).to.equal('grant_revoked');
    expect((await leaseRow(viaKey)).endReason).to.equal('user_not_active');
  });

  it("a user's deletion leaves the leases of no one's (auth disabled) alone", async () => {
    const udid = await phone();
    const out: any = await svc.create({
      filters: { platform: 'android', udid },
      durationMs: 600_000,
      heartbeatSeconds: 30,
      actorId: 'auth-disabled',
      teamId: null,
      heartbeatFree: true,
    });
    const leaseId: string = out.body.leaseId;
    expect((await leaseRow(leaseId)).status).to.equal('active');
    const gone = await seedUser('MEMBER', { name: 'Leaving Too' });

    const res = await request(origin)
      .delete(`/xenon/api/users/${gone.user.id}`)
      .set('cookie', admin.cookie)
      .set('origin', origin);
    expect(res.status).to.equal(204);

    expect((await leaseRow(leaseId)).status).to.equal('active');
    await svc.release(leaseId, out.body.leaseToken);
  });

  it('a change that leaves the user active (a rename, a role) keeps their grants', async () => {
    const { token, grantId } = await signIn(member);
    const res = await request(origin)
      .patch(`/xenon/api/users/${member.user.id}`)
      .set('cookie', admin.cookie)
      .set('origin', origin)
      .send({ name: 'Renamed Owner' });
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    // setRole tells identityChanged too (afterEach makes them a member again).
    await Container.get(UserService).setRole(member.user.id, 'ADMIN');

    expect((await grantRow(grantId)).revokedAt).to.equal(null);
    expect((await mcp(bearer(token))).status).to.equal(200);
  });

  it("a replayed authorization code refuses the first exchange's access token at once", async () => {
    const first = await signIn(member);
    expect(await statuses(bearer(first.token))).to.deep.equal([200, 200, 200]);

    let replay: unknown;
    await provider
      .exchangeAuthorizationCode(
        client,
        first.code,
        first.verifier,
        REDIRECT,
        new URL(`${origin}/xenon/mcp`),
      )
      .catch((err) => (replay = err));
    expect(replay, 'the second exchange fails').to.be.instanceOf(Error);

    expect(await statuses(bearer(first.token))).to.deep.equal([401, 401, 404]);
  });

  it('GrantStore.revoke is what revokes, whoever calls it', async () => {
    const { token, grantId } = await signIn(member);
    expect(await statuses(bearer(token))).to.deep.equal([200, 200, 200]);
    await Container.get(GrantStore).revoke(grantId, 'spec');
    expect(await statuses(bearer(token))).to.deep.equal([401, 401, 404]);
  });
});
