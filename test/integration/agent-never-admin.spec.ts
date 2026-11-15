import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import { createHash } from 'crypto';
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
import { forbidRealAdb } from '../helpers/no-real-adb';
import { createRouter } from '../../src/app/index';
import { resetOAuthRateLimits } from '../../src/app/routers/oauth';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { ALL_GRANULAR_SCOPES } from '../../src/services/token/mcpScopes';
import { AuthCodes } from '../../src/services/oauth/authCodes';
import { ClientStore } from '../../src/services/oauth/clientStore';
import { XenonOAuthProvider } from '../../src/services/oauth/oauthProvider';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { LeaseService } from '../../src/services/lease/LeaseService';
import { SessionLifecycleService } from '../../src/services/SessionLifecycleService';
import { takeSessionCredentials } from '../../src/services/session/sessionCredentials';
import { allocateDeviceForSession } from '../../src/device-utils';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { XenonManager } from '../../src/device-managers';
import { DisplayStateService } from '../../src/services/DisplayStateService';
import { PluginContext } from '../../src/PluginContext';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import { resolveMcpCaller } from '../../src/mcp/mcpCredential';
import { invokeApi } from '../../src/mcp/invokeApi';
import { BugReportService } from '../../src/services/bug-report/BugReportService';

const REDIRECT = 'http://127.0.0.1:33420/callback';

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };

/** A PKCE pair: the verifier the agent keeps and its S256 challenge. */
function pkce() {
  const verifier =
    createHash('sha256').update(Math.random().toString(36)).digest('base64url') + 'abcdefghij';
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// Named like the real manager: /control picks one by constructor.name.
class AndroidDeviceManager {
  taps: string[] = [];
  tap = async (udid: string) => {
    this.taps.push(udid);
  };
}

/**
 * An agent signed in through the browser by an ADMIN or a SUPER_ADMIN (a
 * token carrying a grant id, `gid`) acts with member rights plus every
 * team's phones, never as an admin: neither where Xenon decides by the
 * `admin` scope (a grant never carries it) nor where it decides by the
 * user's role (roleGuard, superAdminGuard, resolveActor().isAdmin, the lease
 * override, the bug report's network capture). The same users' own
 * credentials (API keys, a POST /auth/token session token) keep every right.
 */
describe('an agent signed in by an admin is never an admin (integration)', function () {
  this.timeout(60_000);
  useScratchDatabase({ wholeSuite: true });
  useOwnNodeId();
  forbidRealAdb();

  const servers = loopbackServers();
  const stamp = Date.now();
  const made: string[] = [];
  // Port 1 has nothing listening: the lease's ports go through a stubbed port client.
  const DEVICE_HOST = 'http://127.0.0.1:1';
  const PHONE = {
    held: `ana-held-${stamp}`,
    leased: `ana-leased-${stamp}`,
    teamA: `ana-team-a-${stamp}`,
    teamB: `ana-team-b-${stamp}`,
  };

  let admin: SeededUser;
  let superAdmin: SeededUser;
  let other: SeededUser;
  let keys: JwtKeyService;
  let keyDir: string;
  let store: any;
  let svc: LeaseService;
  let manager: AndroidDeviceManager;
  let client: OAuthClientInformationFull;
  let provider: XenonOAuthProvider;
  let savedAuthDisabled: boolean;
  let savedBasePath: string;
  let restoreContainer: () => void;
  let origin: string;
  let teamA: string;
  let teamB: string;

  async function phone(udid: string, extra: Record<string, unknown> = {}): Promise<void> {
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
        ...extra,
      } as any,
    });
    await store.addDevices([row as any]);
  }

  before(async () => {
    savedAuthDisabled = config.authDisabled;
    config.authDisabled = false;
    restoreContainer = saveRegistrations(
      JwtKeyService,
      LeaseService,
      XenonManager,
      DisplayStateService,
    );
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-agent-never-admin-'));
    keys = new JwtKeyService();
    await keys.init(keyDir);
    Container.set(JwtKeyService, keys);

    // /control's tap reaches this manager, never adb.
    manager = new AndroidDeviceManager();
    Container.set(XenonManager, { deviceInstances: async () => [manager] } as any);
    Container.set(DisplayStateService, new DisplayStateService());

    // /devices lists the store grid.ts took when it was imported, and the
    // lease locks phones in that same store.
    store = DeviceStoreFactory.getStore();
    const portClient = {
      allocate: sinon.stub().resolves({ systemPort: 13100 }),
      release: sinon.stub().resolves({ released: 1 }),
      extend: sinon.stub().resolves({ extended: 1 }),
    };
    const noAuth = { nodePairAuth: async () => ({ accessKey: '', token: '' }) };
    svc = new LeaseService(prisma, store, portClient, noAuth);
    Container.set(LeaseService, svc);

    admin = await seedUser('ADMIN', { name: 'Lab Admin' });
    superAdmin = await seedUser('SUPER_ADMIN', { name: 'Lab Owner' });
    other = await seedUser('MEMBER', { name: 'Someone Else' });

    teamA = (await prisma.team.create({ data: { name: `ana-a-${stamp}` } })).id;
    teamB = (await prisma.team.create({ data: { name: `ana-b-${stamp}` } })).id;
    // Held by another user's live preview.
    await phone(PHONE.held, {
      busy: true,
      session_id: `manual_${other.user.id}_${PHONE.held}`,
    });
    await phone(PHONE.leased);
    await phone(PHONE.teamA, { teamId: teamA });
    await phone(PHONE.teamB, { teamId: teamB });

    client = await Container.get(ClientStore).registerClient({
      client_name: 'Claude Code',
      redirect_uris: [REDIRECT],
    } as OAuthClientInformationFull);
    provider = new XenonOAuthProvider();

    savedBasePath = Container.get(PluginContext).nodeBasePath;
    Container.get(PluginContext).nodeBasePath = '/wd/hub';
  });

  beforeEach(async () => {
    resetOAuthRateLimits();
    manager.taps = [];
    const app = express();
    app.use('/xenon', createRouter({ ...DefaultPluginArgs }));
    const server: http.Server = await servers.serve(app);
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await servers.closeAll();
    await drainLeaseQueues(svc);
    resetOAuthRateLimits();
  });

  // Loki is one collection for the whole process: take the phones back out.
  after(async () => {
    if (!(store instanceof PrismaDeviceStore)) {
      for (const udid of made) await store.removeDevices({ udid });
    }
    Container.get(PluginContext).nodeBasePath = savedBasePath;
    config.authDisabled = savedAuthDisabled;
    restoreContainer();
    fs.rmSync(keyDir, { recursive: true, force: true });
  });

  /**
   * An agent's browser sign-in, as the token route makes one: a code for
   * every MCP scope (an agent asks for all the hub lists), exchanged once.
   */
  async function agentOf(user: SeededUser): Promise<{ authorization: string }> {
    const pair = pkce();
    const code = Container.get(AuthCodes).issue({
      userId: user.user.id,
      clientId: client.client_id,
      redirectUri: REDIRECT,
      codeChallenge: pair.challenge,
      scopes: [...ALL_GRANULAR_SCOPES],
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
    expect(claims.gid, 'a browser sign-in names its grant').to.be.a('string');
    return { authorization: `Bearer ${tokens.access_token}` };
  }

  /** The user's own API key, without the `admin` scope: the role alone decides. */
  async function keyOf(user: SeededUser): Promise<Record<string, string>> {
    const { raw } = await Container.get(ApiKeyService).create({
      name: `ana-${user.user.role}-${Date.now()}`,
      scopes: ['devices', 'sessions', 'read'] as any,
      userId: user.user.id,
    });
    return { 'x-xenon-access-key': user.user.accessKey, 'x-xenon-token': raw };
  }

  async function callTool(
    headers: Record<string, string>,
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<ToolResult> {
    const mcp = new Client({ name: 'agent-never-admin-spec', version: '1.0.0' });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/xenon/mcp`), {
        requestInit: { headers },
      }),
    );
    try {
      return (await mcp.callTool({ name, arguments: args })) as ToolResult;
    } finally {
      await mcp.close();
    }
  }

  const ROLE_REFUSAL = { error: 'requires role >= ADMIN' };

  for (const role of ['ADMIN', 'SUPER_ADMIN'] as const) {
    const user = () => (role === 'ADMIN' ? admin : superAdmin);

    describe(`${role}`, () => {
      it("the agent can't read a session's captured traffic; the user's key can", async () => {
        const path = `/xenon/api/interceptor/sessions/ana-${stamp}/requests`;
        const agent = await request(origin)
          .get(path)
          .set(await agentOf(user()));
        expect(agent.status, JSON.stringify(agent.body)).to.equal(403);
        expect(agent.body).to.deep.equal(ROLE_REFUSAL);
        const own = await request(origin)
          .get(path)
          .set(await keyOf(user()));
        // Past the guard: no capture for that session.
        expect(own.status, JSON.stringify(own.body)).to.equal(404);
        expect(own.body.error).to.equal('interceptor inactive');
      });

      it("the agent can't write or remove phone rows (POST /register); the user's key can", async () => {
        const agent = await request(origin)
          .post('/xenon/api/register?type=remove')
          .set(await agentOf(user()))
          .send([]);
        expect(agent.status, JSON.stringify(agent.body)).to.equal(403);
        expect(agent.body).to.deep.equal(ROLE_REFUSAL);
        const own = await request(origin)
          .post('/xenon/api/register?type=remove')
          .set(await keyOf(user()))
          .send([]);
        expect(own.status, JSON.stringify(own.body)).to.equal(200);
      });

      it("the agent can't read the lab's settings (GET /config); the user's key can", async () => {
        const agent = await request(origin)
          .get('/xenon/api/config')
          .set(await agentOf(user()));
        expect(agent.status, JSON.stringify(agent.body)).to.equal(403);
        expect(agent.body).to.deep.equal(ROLE_REFUSAL);
        const own = await request(origin)
          .get('/xenon/api/config')
          .set(await keyOf(user()));
        expect(own.status, JSON.stringify(own.body)).to.equal(200);
      });

      it("the agent still lists every team's phones", async () => {
        const res = await request(origin)
          .get('/xenon/api/device')
          .set(await agentOf(user()));
        expect(res.status, JSON.stringify(res.body)).to.equal(200);
        const udids = (res.body as Array<{ udid: string }>).map((d) => d.udid);
        expect(udids).to.include.members([PHONE.teamA, PHONE.teamB]);
      });

      it("/auth/me names the role the agent acts as, beside its user's role", async () => {
        const agent = await request(origin)
          .get('/xenon/api/auth/me')
          .set(await agentOf(user()));
        expect(agent.status, JSON.stringify(agent.body)).to.equal(200);
        expect(agent.body.role).to.equal(role);
        expect(agent.body.actsAs).to.equal('MEMBER');
        const own = await request(origin)
          .get('/xenon/api/auth/me')
          .set(await keyOf(user()));
        expect(own.body.actsAs).to.equal(role);
      });

      it('xenon_lab_info names the role the agent acts as', async () => {
        const result = await callTool(await agentOf(user()), 'xenon_lab_info');
        const info = JSON.parse(result.content[0].text);
        expect(info.role).to.equal(role);
        expect(info.actsAs).to.equal('MEMBER');
      });

      it("the agent's bug report leaves out the network capture; the user's key gets it", async () => {
        const assemble = sinon
          .stub(Container.get(BugReportService), 'assemble')
          .rejects(new Error('Session not found'));
        try {
          const path = `/xenon/api/sessions/ana-bug-${stamp}/bug-report?mode=full`;
          const agent = await request(origin)
            .post(path)
            .set(await agentOf(user()));
          expect(agent.status, JSON.stringify(agent.body)).to.equal(404);
          const own = await request(origin)
            .post(path)
            .set(await keyOf(user()));
          expect(own.status, JSON.stringify(own.body)).to.equal(404);
          expect(assemble.callCount).to.equal(2);
          expect(assemble.firstCall.args[0].includeNetwork, 'agent').to.equal(false);
          expect(assemble.secondCall.args[0].includeNetwork, 'key').to.equal(true);
        } finally {
          assemble.restore();
        }
      });

      it("the agent can't make credentials that would outlive its sign-in", async () => {
        const headers = await agentOf(user());
        const usersBefore = await prisma.user.count();
        const keysBefore = await prisma.apiKey.count();
        const attempts: Array<[string, Record<string, unknown>]> = [
          ['/xenon/api/apikeys', { name: `ana-agent-key-${stamp}`, scopes: ['read'] }],
          [
            '/xenon/api/users',
            { email: `ana-agent-${stamp}@xenon.local`, name: 'Made by an agent', role: 'MEMBER' },
          ],
          [`/xenon/api/users/${other.user.id}/reset-link`, {}],
        ];
        for (const [path, body] of attempts) {
          const res = await request(origin).post(path).set(headers).send(body);
          expect(res.status, `${path}: ${JSON.stringify(res.body)}`).to.equal(403);
        }
        expect(await prisma.user.count()).to.equal(usersBefore);
        expect(await prisma.apiKey.count()).to.equal(keysBefore);
        expect(
          await prisma.passwordResetToken.count({ where: { userId: other.user.id } }),
        ).to.equal(0);
      });

      it("a tool's in-process call is judged the same: the caller /xenon/mcp holds names the grant", async () => {
        // What /xenon/mcp makes of the agent's token, and what a tool's REST
        // call (invokeApi) then runs as.
        const caller = await resolveMcpCaller({ headers: await agentOf(user()) } as any);
        if (typeof caller === 'string') throw new Error(`not a caller: ${caller}`);
        expect(caller.grantId).to.be.a('string');
        expect(caller.auth.grantId).to.equal(caller.grantId);
        const config = await invokeApi(caller, { method: 'GET', path: '/config' });
        expect(config.status, JSON.stringify(config.body)).to.equal(403);
        expect(config.body).to.deep.equal(ROLE_REFUSAL);
        const devices = await invokeApi(caller, { method: 'GET', path: '/device' });
        expect(devices.status).to.equal(200);
      });
    });
  }

  describe("a SUPER_ADMIN's agent", () => {
    it("can't act on a phone another user holds: the ownership 409; the user's key can", async () => {
      const path = `/xenon/api/control/${PHONE.held}/tap`;
      const agent = await request(origin)
        .post(path)
        .set(await agentOf(superAdmin))
        .send({ x: 1, y: 1 });
      expect(agent.status, JSON.stringify(agent.body)).to.equal(409);
      expect(agent.body.error).to.equal('device_held_by_another_user');
      expect(manager.taps).to.deep.equal([]);

      const own = await request(origin)
        .post(path)
        .set(await keyOf(superAdmin))
        .send({ x: 1, y: 1 });
      expect(own.status, JSON.stringify(own.body)).to.equal(200);
      expect(manager.taps).to.deep.equal([PHONE.held]);
    });

    it("can't start a session on another user's lease; the user's own session token can", async () => {
      const out: any = await svc.create({
        filters: { platform: 'android', udid: PHONE.leased },
        durationMs: 600_000,
        heartbeatSeconds: 30,
        actorId: other.user.id,
        teamId: null,
        heartbeatFree: true,
      });
      const leaseId: string = out.body.leaseId;
      try {
        // The session token the agent's xenon_session_capabilities gives.
        const tool = await callTool(await agentOf(superAdmin), 'xenon_session_capabilities');
        expect(tool.isError, tool.content[0].text).to.not.equal(true);
        const agentToken = JSON.parse(tool.content[0].text).capabilities.alwaysMatch['xe:options']
          .sessionToken as string;
        expect((await keys.verify(agentToken, { audience: 'xenon-session' })).gid).to.be.a(
          'string',
        );

        // The same SUPER_ADMIN's own session token, from POST /auth/token.
        const minted = await request(origin)
          .post('/xenon/api/auth/token')
          .set(await keyOf(superAdmin))
          .send({ audience: 'xenon-mcp' });
        expect(minted.status, JSON.stringify(minted.body)).to.equal(200);
        const ownToken = minted.body.sessionToken as string;
        expect(ownToken).to.be.a('string');

        const lifecycle: any = new SessionLifecycleService();
        const proofOf = async (sessionToken: string) => {
          const caps: any = {
            alwaysMatch: { platformName: 'android', 'xe:options': { sessionToken, leaseId } },
            firstMatch: [{}],
          };
          const credentials = takeSessionCredentials(caps);
          const authorized = await lifecycle.authorizeSessionRequest(caps, credentials);
          return {
            caps,
            teamIds: authorized.callerTeamIds,
            proof: {
              canOverride: (await authorized.leaseAccess()).canOverride,
              apiKeyId: authorized.apiKeyId,
              userId: authorized.userId,
              leaseToken: credentials.leaseToken,
            },
          };
        };

        const agent = await proofOf(agentToken);
        expect(agent.proof.canOverride).to.equal(false);
        let refusal = '';
        try {
          await allocateDeviceForSession(
            agent.caps,
            1_000,
            100,
            { ...DefaultPluginArgs } as any,
            agent.teamIds,
            agent.proof,
          );
        } catch (err: any) {
          refusal = String(err?.message ?? err);
        }
        expect(refusal).to.include(leaseId);

        const own = await proofOf(ownToken);
        expect(own.proof.canOverride).to.equal(true);
        expect(await svc.authorizeSessionUse(leaseId, own.proof)).to.include({
          deviceUdid: PHONE.leased,
        });
      } finally {
        await svc.release(leaseId, out.body.leaseToken);
      }
    });
  });
});
