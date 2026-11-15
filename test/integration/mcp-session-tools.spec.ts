import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
import type { AddressInfo } from 'net';
import { Container } from 'typedi';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { useScratchDatabase } from '../helpers/scratch-database';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';
import { seedUser, SeededUser } from '../helpers/seedUser';
import { loopbackServers } from '../helpers/loopbackServer';
import { saveRegistrations } from '../helpers/container-registration';
import { drainLeaseQueues } from '../helpers/lease-queue';
import { forbidRealAdb } from '../helpers/no-real-adb';
import { NODE_ID, useHubAndNode } from '../helpers/hub-node-pair';
import { appiumBaseDriver, umbrellaWith } from '../helpers/appium-umbrella';
import { createRouter } from '../../src/app/index';
import { commandAuthDeps, registerSessionGateway } from '../../src/app/registerCommandAuth';
import { hubGatewayOptions } from '../../src/gateway/defaultGateway';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { LeaseService } from '../../src/services/lease/LeaseService';
import { RecordingOrchestrator } from '../../src/services/recording/RecordingOrchestrator';
import { SessionDeviceLogs } from '../../src/services/logcat/SessionDeviceLogs';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { SESSION_MANAGER } from '../../src/sessions/SessionManager';
import { PluginContext } from '../../src/PluginContext';
import { runTool } from '../../src/mcp/toolCall';
import { executeScriptTool } from '../../src/mcp/tools/execute';
import { invokeWebDriver } from '../../src/mcp/invokeWebDriver';
import { UNKNOWN_SESSION_BODY } from '../../src/middleware/commandAuth';
import type { McpCaller } from '../../src/mcp/mcpCredential';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };
const answerOf = (result: ToolResult): any => JSON.parse(result.content[0].text);
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

/**
 * The tools an agent uses beside appium-mcp, through /xenon/mcp:
 * xenon_session_capabilities (the WebDriver URL and capabilities for
 * appium-mcp's create), and the recording tools.
 */
describe('MCP session capabilities and recording tools (integration)', function () {
  this.timeout(60_000);
  useScratchDatabase({ wholeSuite: true });
  useOwnNodeId();

  const servers = loopbackServers();
  const stamp = Date.now();
  const PHONE = { lease: `mst-lease-${stamp}`, record: `mst-record-${stamp}` };
  // Port 1 has nothing listening: the lease's ports go through a stubbed port client.
  const DEVICE_HOST = 'http://127.0.0.1:1';

  let app: express.Express;
  let member: SeededUser;
  let admin: SeededUser;
  let keyDir: string;
  let keys: JwtKeyService;
  let store: any;
  let svc: LeaseService;
  let orchestrator: { start: sinon.SinonStub; stop: sinon.SinonStub; observerGroupStarter: any };
  let savedAuthDisabled: boolean;
  let savedCommandAuth: string | undefined;
  let savedBasePath: string;
  let restoreContainer: () => void;

  async function callTool(
    bearer: string,
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<{ result: ToolResult; origin: string }> {
    const server: http.Server = await servers.serve(app);
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const client = new Client({ name: 'mcp-session-tools-spec', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${origin}/xenon/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${bearer}` } },
      }),
    );
    try {
      return { result: (await client.callTool({ name, arguments: args })) as ToolResult, origin };
    } finally {
      await client.close();
    }
  }

  const bearerFor = (user: SeededUser, scopes: string, scope: string) =>
    keys.sign(
      { sub: user.user.id, scopes, scope, gid: `grant-${stamp}` },
      { audience: 'xenon-mcp', ttlSeconds: 600 },
    );
  const memberBearer = () =>
    bearerFor(member, 'sessions,devices', 'appium:use xenon:devices:read xenon:devices:lock');

  before(async () => {
    savedAuthDisabled = config.authDisabled;
    config.authDisabled = false;
    restoreContainer = saveRegistrations(JwtKeyService, LeaseService, RecordingOrchestrator);
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-mcp-session-tools-'));
    keys = new JwtKeyService();
    await keys.init(keyDir);
    Container.set(JwtKeyService, keys);

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

    // No ffmpeg: the orchestrator answers as it does for a started group.
    orchestrator = {
      start: sinon.stub().callsFake(async ({ phones }: any) => ({
        groupId: `group-${stamp}`,
        recordings: phones.map((p: any) => ({ deviceUdid: p.udid, status: 'RECORDING' })),
        startedAt: new Date().toISOString(),
      })),
      stop: sinon.stub().callsFake(async (groupId: string) => ({ groupId, recordings: [] })),
      observerGroupStarter: () => undefined,
    };
    Container.set(RecordingOrchestrator, orchestrator as any);

    app = express();
    app.use('/xenon', createRouter({ ...DefaultPluginArgs }));

    member = await seedUser('MEMBER', { name: 'Session Tools Member' });
    admin = await seedUser('ADMIN', { name: 'Session Tools Admin' });

    for (const udid of Object.values(PHONE)) {
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
    }
  });

  beforeEach(() => {
    savedCommandAuth = process.env.XENON_REQUIRE_COMMAND_AUTH;
    delete process.env.XENON_REQUIRE_COMMAND_AUTH;
    savedBasePath = Container.get(PluginContext).nodeBasePath;
    Container.get(PluginContext).nodeBasePath = '/wd/hub';
  });

  afterEach(async () => {
    if (savedCommandAuth === undefined) delete process.env.XENON_REQUIRE_COMMAND_AUTH;
    else process.env.XENON_REQUIRE_COMMAND_AUTH = savedCommandAuth;
    Container.get(PluginContext).nodeBasePath = savedBasePath;
    await servers.closeAll();
    await drainLeaseQueues(svc);
  });

  // Loki is one collection for the whole process: take the phones back out.
  after(async () => {
    if (!(store instanceof PrismaDeviceStore)) {
      for (const udid of Object.values(PHONE)) await store.removeDevices({ udid });
    }
    config.authDisabled = savedAuthDisabled;
    restoreContainer();
    fs.rmSync(keyDir, { recursive: true, force: true });
  });

  async function capabilities(args: Record<string, unknown> = {}) {
    const { result, origin } = await callTool(
      await memberBearer(),
      'xenon_session_capabilities',
      args,
    );
    expect(result.isError, result.content[0].text).to.not.equal(true);
    return { answer: answerOf(result), origin };
  }

  it('xenon_session_capabilities returns the WebDriver URL with the base path and a session token', async () => {
    const { answer, origin } = await capabilities({ authToken: 'ignored' });

    expect(answer.remoteServerUrl).to.equal(`${origin}/wd/hub`);
    expect(answer.remoteServerUrl.endsWith('/wd/hub')).to.equal(true);
    expect(answer.capabilities.firstMatch).to.deep.equal([{}]);
    const token = answer.capabilities.alwaysMatch['xe:options'].sessionToken;
    const claims = await keys.verify(token, { audience: 'xenon-session' });
    expect(claims.sub).to.equal(member.user.id);
    expect(claims.scopes).to.equal('sessions');
  });

  it('with a lease it adds leaseId, leaseToken and leaseMember', async () => {
    const acquired = await callTool(await memberBearer(), 'xenon_acquire_device', {
      udid: PHONE.lease,
    });
    expect(acquired.result.isError, acquired.result.content[0].text).to.not.equal(true);
    const { lockId, leaseToken } = answerOf(acquired.result);

    const { answer } = await capabilities({ lockId, leaseToken });
    const always = answer.capabilities.alwaysMatch;
    expect(always['xe:options']).to.include({ leaseId: lockId, leaseToken, leaseMember: 0 });
    expect(always['xe:options'].sessionToken).to.be.a('string');
    // The lease's own capabilities: its phone.
    expect(always['appium:udid']).to.equal(PHONE.lease);
    expect(always.platformName).to.equal('Android');

    const wrong = await callTool(await memberBearer(), 'xenon_session_capabilities', {
      lockId,
      leaseToken: 'not-the-token',
    });
    expect(wrong.result.isError).to.equal(true);
    expect(answerOf(wrong.result).error).to.equal('token_mismatch');
  });

  it('with per-command auth on, the URL carries xenon-session:<token> as Basic', async () => {
    process.env.XENON_REQUIRE_COMMAND_AUTH = '1';
    const { answer, origin } = await capabilities();
    const url = new URL(answer.remoteServerUrl);
    const token = answer.capabilities.alwaysMatch['xe:options'].sessionToken;
    expect(url.username).to.equal('xenon-session');
    expect(decodeURIComponent(url.password)).to.equal(token);
    expect(`${url.protocol}//${url.host}${url.pathname}`).to.equal(`${origin}/wd/hub`);

    delete process.env.XENON_REQUIRE_COMMAND_AUTH;
    const off = new URL((await capabilities()).answer.remoteServerUrl);
    expect(off.username).to.equal('');
    expect(off.password).to.equal('');
  });

  it("recording tools start and stop a group, in Studio's answer shape", async () => {
    const bearer = await bearerFor(admin, 'devices', 'xenon:recordings');
    const started = await callTool(bearer, 'xenon_start_recording', {
      authToken: 'ignored',
      udids: [PHONE.record],
    });
    expect(started.result.isError, started.result.content[0].text).to.not.equal(true);
    expect(answerOf(started.result)).to.deep.equal({ groupId: `group-${stamp}` });
    expect(orchestrator.start.firstCall.args[0].phones).to.deep.equal([
      { udid: PHONE.record, host: DEVICE_HOST },
    ]);
    expect(orchestrator.start.firstCall.args[0].actorId).to.equal(admin.user.id);

    const stopped = await callTool(bearer, 'xenon_stop_recording', { groupId: `group-${stamp}` });
    expect(stopped.result.isError, stopped.result.content[0].text).to.not.equal(true);
    expect(answerOf(stopped.result)).to.deep.equal({
      proofBundleUrl: `${stopped.origin}/xenon/api/recordings/group-${stamp}/bundle.zip`,
    });
    expect(orchestrator.stop.calledWith(`group-${stamp}`)).to.equal(true);
  });

  it('xenon_start_recording refuses a phone the caller cannot see as REST does', async () => {
    const bearer = await bearerFor(admin, 'devices', 'xenon:recordings');
    const { result } = await callTool(bearer, 'xenon_start_recording', {
      udids: ['no-such-phone'],
    });
    expect(result.isError).to.equal(true);
    expect(answerOf(result).error).to.equal('not_found');
  });
});

/**
 * xenon_execute_script runs an `xe:` script as the session's own
 * executeScript, in process, through Appium's own server: the session gateway
 * (per-command auth taking the tool's caller), and on a hub the forward to
 * the node that runs the session. The sessions run on a node in Appium 3's
 * own server() (Appium's umbrella with Xenon's plugin, per-command auth on),
 * created as its hub creates them, for `alice`.
 */
describe('MCP xenon_execute_script (integration)', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  forbidRealAdb();
  const pair = useHubAndNode(scratch, [SessionDeviceLogs]);
  const hubServers: http.Server[] = [];

  beforeEach(() => {
    // The node records the session's device log through this machine's adb; not here.
    Container.set(SessionDeviceLogs, {
      start: async () => undefined,
      stop: async () => undefined,
    } as any);
  });
  afterEach(async () => {
    for (const s of hubServers.splice(0)) {
      s.closeAllConnections();
      await new Promise<void>((resolve) => http.Server.prototype.close.call(s, () => resolve()));
    }
  });

  const caller = (userId: string): McpCaller => ({
    auth: {
      kind: 'bearer',
      userId,
      role: 'MEMBER',
      scopes: 'sessions',
      rateLimit: 300,
      teamIds: [],
    },
  });
  const run = async (who: McpCaller, args: Record<string, unknown>): Promise<ToolResult> =>
    (await runTool(executeScriptTool.name, who, () =>
      executeScriptTool.run(args as any, who),
    )) as ToolResult;

  /** The node, with a session of alice's on its phone; tools run through the node's own server. */
  async function nodeWithSession(): Promise<string> {
    await pair.boot({ sessionMetrics: false });
    const sessionId = await pair.nodeSession();
    Container.get(PluginContext).expressApp = pair.nodeApp;
    return sessionId;
  }

  it("xenon_execute_script runs xe:getAutowaitProperties on the caller's session, as the session's own command", async () => {
    const sessionId = await nodeWithSession();
    await scratch.db.device.updateMany({
      where: { udid: 'phone-1' },
      data: { lastCmdExecutedAt: 1 },
    });

    const result = await run(caller('alice'), {
      script: 'xe:getAutowaitProperties',
      sessionId,
      authToken: 'ignored',
    });

    expect(result.isError, result.content[0].text).to.not.equal(true);
    const answer = answerOf(result);
    expect(answer.script).to.equal('xe:getAutowaitProperties');
    expect(answer.value).to.include.keys('enabled', 'timeoutMs', 'intervalBetweenAttemptsMs');
    // The session's own command touched its idle clock, as a client's does and
    // Xenon's own /wd-internal calls never do.
    const phone = await scratch.db.device.findFirst({ where: { udid: 'phone-1' } });
    expect(Number(phone?.lastCmdExecutedAt)).to.be.above(1);
  });

  it("xenon_execute_script on another user's session answers REST's unknown-session not_found", async () => {
    const sessionId = await nodeWithSession();
    const result = await run(caller('bob'), { script: 'xe:getAutowaitProperties', sessionId });
    expect(result.isError).to.equal(true);
    expect(answerOf(result)).to.deep.equal({
      error: 'not_found',
      message: `Session with id ${sessionId} not found`,
    });

    const unknown = await run(caller('alice'), {
      script: 'xe:getAutowaitProperties',
      sessionId: 'no-such-session',
    });
    expect(answerOf(unknown)).to.deep.equal({
      error: 'not_found',
      message: 'Session with id no-such-session not found',
    });
  });

  it("per-command auth takes the tool's caller as verified, and still requires the owner", async () => {
    const sessionId = await nodeWithSession();
    const body = { script: 'xe:getAutowaitProperties', args: [] };
    // Past the tool's own check: the node's gateway decides alone.
    const asBob = await invokeWebDriver(caller('bob'), sessionId, {
      method: 'POST',
      path: 'execute/sync',
      body,
    });
    expect(asBob.status).to.equal(404);
    expect(asBob.body).to.deep.equal(UNKNOWN_SESSION_BODY);
    const asAlice = await invokeWebDriver(caller('alice'), sessionId, {
      method: 'POST',
      path: 'execute/sync',
      body,
    });
    expect(asAlice.status).to.equal(200);
  });

  it('xenon_execute_script refuses a script without the xe: prefix', async () => {
    const sessionId = await nodeWithSession();
    const result = await run(caller('alice'), { script: 'mobile: shell', sessionId });
    expect(result.isError).to.equal(true);
    expect(answerOf(result).error).to.equal('bad_request');
  });

  it("xenon_execute_script on a node's session is forwarded and answers, in the hub's command log", async () => {
    const sessionId = await nodeWithSession();

    // The hub: Appium 3's own server with the production hub gateway, its
    // dashboard on, its driver none (a node's session never reaches it).
    const baseDriver = appiumBaseDriver();
    let hubApp: any;
    const hubServer: http.Server = await baseDriver.server({
      routeConfiguringFunction: baseDriver.routeConfiguringFunction(umbrellaWith([])),
      port: 0,
      hostname: '127.0.0.1',
      basePath: '/wd/hub',
      cliArgs: { basePath: '/wd/hub' },
      serverUpdaters: [
        (a: any) => {
          hubApp = a;
          registerSessionGateway(
            a,
            { basePath: '/wd/hub' },
            commandAuthDeps({ enabled: () => true, authDisabled: () => false, logger: quiet }),
            hubGatewayOptions({
              basePath: '/wd/hub',
              isLocalHost: () => false,
              nodeId: () => 'hub-1',
              dashboard: () => true,
            }),
          );
        },
      ],
    });
    hubServers.push(hubServer);
    // The hub's own record of the session: its row and its RemoteSession.
    await scratch.db.session.create({
      data: {
        id: sessionId,
        device_udid: 'phone-1',
        device_platform: 'android',
        device_version: '14',
        desired_capabilities: '{}',
        session_capabilities: '{}',
        node_id: NODE_ID,
        has_live_video: false,
        status: 'running',
        user_id: 'alice',
      },
    });
    SESSION_MANAGER.addSession(sessionId, pair.hubSide(sessionId));
    const context = Container.get(PluginContext);
    context.expressApp = hubApp;
    context.nodeBasePath = '/wd/hub';

    const result = await run(caller('alice'), {
      script: 'xe:getAutowaitProperties',
      sessionId,
    });

    expect(result.isError, result.content[0].text).to.not.equal(true);
    expect(answerOf(result).value).to.include.keys('enabled', 'timeoutMs');
    // The hub records it once the node's answer is relayed.
    let logged: string[] = [];
    for (const end = Date.now() + 5_000; Date.now() < end; ) {
      const rows = await scratch.db.sessionLog.findMany({ where: { session_id: sessionId } });
      logged = rows.map((l: any) => l.command_name);
      if (logged.length > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(logged).to.deep.equal(['execute']);
  });
});
