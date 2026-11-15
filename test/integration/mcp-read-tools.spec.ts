import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { Container } from 'typedi';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { useScratchDatabase } from '../helpers/scratch-database';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';
import { seedUser, SeededUser } from '../helpers/seedUser';
import { loopbackServers } from '../helpers/loopbackServer';
import request from '../helpers/loopbackRequest';
import { saveRegistrations } from '../helpers/container-registration';
import { createRouter } from '../../src/app/index';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { TeamService } from '../../src/services/TeamService';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };

/**
 * The read tools against REST's own answer for the same member: each runs
 * its route in process (invokeApi), so the team rule and its answers are
 * REST's, a hidden session's refusal included.
 */
describe('MCP read tools (integration)', function () {
  this.timeout(60_000);
  useScratchDatabase({ wholeSuite: true });
  useOwnNodeId();

  const servers = loopbackServers();
  const stamp = Date.now();
  const PHONE = {
    sharedAndroid: `mrt-shared-android-${stamp}`,
    sharedOffline: `mrt-shared-offline-${stamp}`,
    teamAIos: `mrt-team-a-ios-${stamp}`,
    teamB: `mrt-team-b-${stamp}`,
  };
  const SESSION = { a: `mrt-session-a-${stamp}`, b: `mrt-session-b-${stamp}` };
  // Port 1 has nothing listening: a request sent on to "the phone's server"
  // by mistake fails at once.
  const DEVICE_HOST = 'http://127.0.0.1:1';

  let app: express.Express;
  let member: SeededUser;
  let keyPair: Record<string, string>;
  let keyDir: string;
  let keys: JwtKeyService;
  let store: any;
  let savedAuthDisabled: boolean;
  let restoreContainer: () => void;

  async function connect(headers: Record<string, string> = keyPair): Promise<Client> {
    const server: Server = await servers.serve(app);
    const { port } = server.address() as AddressInfo;
    const client = new Client({ name: 'mcp-read-tools-spec', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/xenon/mcp`), {
        requestInit: { headers },
      }),
    );
    return client;
  }

  async function callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const client = await connect();
    try {
      return (await client.callTool({ name, arguments: args })) as ToolResult;
    } finally {
      await client.close();
    }
  }

  function answerOf(result: ToolResult): any {
    return JSON.parse(result.content[0].text);
  }

  async function rest(pathAndQuery: string) {
    return request(app).get(`/xenon/api${pathAndQuery}`).set(keyPair);
  }

  before(async () => {
    savedAuthDisabled = config.authDisabled;
    config.authDisabled = false;
    restoreContainer = saveRegistrations(JwtKeyService);
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-mcp-read-tools-'));
    keys = new JwtKeyService();
    await keys.init(keyDir);
    Container.set(JwtKeyService, keys);

    app = express();
    app.use('/xenon', createRouter({ ...DefaultPluginArgs }));

    member = await seedUser('MEMBER', { name: 'Read Tools Member' });
    const teamA = await Container.get(TeamService).create(`mrt-team-a-${stamp}`);
    const teamB = await Container.get(TeamService).create(`mrt-team-b-${stamp}`);
    await Container.get(TeamService).addMember(teamA.id, member.user.id);
    const key = await Container.get(ApiKeyService).create({
      name: 'agent',
      scopes: ['read', 'devices'],
      userId: member.user.id,
    });
    keyPair = { 'x-xenon-access-key': member.user.accessKey, 'x-xenon-token': key.raw };

    // /devices lists the store grid.ts took when it was imported: Prisma
    // under `npx mocha <file>`, Loki under `test:all`. Each phone is a Device
    // row (the session rule reads those) and is added to that store.
    store = DeviceStoreFactory.getStore();
    const phones: Array<{
      udid: string;
      name: string;
      platform: string;
      teamId: string | null;
      busy?: boolean;
      offline?: boolean;
    }> = [
      { udid: PHONE.sharedAndroid, name: 'Pixel Shared', platform: 'android', teamId: null },
      {
        udid: PHONE.sharedOffline,
        name: 'Galaxy Offline',
        platform: 'android',
        teamId: null,
        offline: true,
      },
      {
        udid: PHONE.teamAIos,
        name: 'iPhone Team A',
        platform: 'ios',
        teamId: teamA.id,
        busy: true,
      },
      { udid: PHONE.teamB, name: 'Pixel Team B', platform: 'android', teamId: teamB.id },
    ];
    for (const phone of phones) {
      const row = await prisma.device.create({
        data: {
          udid: phone.udid,
          host: DEVICE_HOST,
          name: phone.name,
          platform: phone.platform,
          sdk: phone.platform === 'ios' ? '18.0' : '14',
          teamId: phone.teamId,
          busy: phone.busy ?? false,
          offline: phone.offline ?? false,
          nodeId: OWN_NODE_ID,
        } as any,
      });
      await store.addDevices([row as any]);
    }

    for (const [id, udid, platform] of [
      [SESSION.a, PHONE.teamAIos, 'ios'],
      [SESSION.b, PHONE.teamB, 'android'],
    ]) {
      await prisma.session.create({
        data: {
          id,
          desired_capabilities: '{}',
          session_capabilities: '{}',
          node_id: OWN_NODE_ID,
          has_live_video: false,
          device_udid: udid,
          device_platform: platform,
          device_version: '1',
          status: 'passed',
        },
      });
      await prisma.sessionLog.create({
        data: {
          session_id: id,
          command_name: 'findElement',
          url: '/element',
          method: 'POST',
          title: 'findElement',
          response: '{}',
          is_healed: true,
          is_success: true,
          original_strategy: 'xpath',
          original_selector: `//healed/in/${id}`,
          healed_selector: `//healed/to/${id}`,
          healing_confidence: 0.9,
          healing_tier: 'Fuzzy XML',
        },
      });
    }
  });

  afterEach(async () => {
    await servers.closeAll();
  });

  // Loki is one collection for the whole process: take the phones back out.
  // A Prisma store's rows went with the scratch database.
  after(async () => {
    if (!(store instanceof PrismaDeviceStore)) {
      for (const udid of Object.values(PHONE)) await store.removeDevices({ udid });
    }
    config.authDisabled = savedAuthDisabled;
    restoreContainer();
    fs.rmSync(keyDir, { recursive: true, force: true });
  });

  it('xenon_list_devices matches GET /devices for a member', async () => {
    const restAnswer = await rest('/devices');
    expect(restAnswer.status).to.equal(200);
    const result = await callTool('xenon_list_devices');
    expect(result.isError).to.not.equal(true);
    const tool = answerOf(result) as Array<{ udid: string }>;
    expect(tool.map((d) => d.udid).sort()).to.deep.equal(
      (restAnswer.body as Array<{ udid: string }>).map((d) => d.udid).sort(),
    );
    expect(tool.map((d) => d.udid)).to.include.members([
      PHONE.sharedAndroid,
      PHONE.sharedOffline,
      PHONE.teamAIos,
    ]);
    expect(tool.map((d) => d.udid)).to.not.include(PHONE.teamB);
    const iphone = tool.find((d) => d.udid === PHONE.teamAIos);
    expect(iphone).to.deep.include({
      udid: PHONE.teamAIos,
      name: 'iPhone Team A',
      platform: 'ios',
      os: '18.0',
      busy: true,
      host: DEVICE_HOST,
    });
  });

  it('xenon_list_devices filters by platform, status and name', async () => {
    const udidsFor = async (args: Record<string, unknown>) =>
      (answerOf(await callTool('xenon_list_devices', args)) as Array<{ udid: string }>)
        .map((d) => d.udid)
        .filter((u) => Object.values(PHONE).includes(u))
        .sort();

    expect(await udidsFor({ platform: 'android' })).to.deep.equal(
      [PHONE.sharedAndroid, PHONE.sharedOffline].sort(),
    );
    expect(await udidsFor({ platform: 'ios' })).to.deep.equal([PHONE.teamAIos]);
    expect(await udidsFor({ status: 'busy' })).to.deep.equal([PHONE.teamAIos]);
    expect(await udidsFor({ status: 'offline' })).to.deep.equal([PHONE.sharedOffline]);
    expect(await udidsFor({ status: 'free' })).to.deep.equal([PHONE.sharedAndroid]);
    expect(await udidsFor({ name: 'PIXEL' })).to.deep.equal([PHONE.sharedAndroid]);
    // Studio's argument, accepted and ignored.
    expect(await udidsFor({ authToken: 'ignored', platform: 'ios' })).to.deep.equal([
      PHONE.teamAIos,
    ]);
  });

  it('xenon_selector_health matches GET /healing/selector-health', async () => {
    const restAnswer = await rest('/healing/selector-health?limit=10');
    expect(restAnswer.status).to.equal(200);
    const result = await callTool('xenon_selector_health', { limit: 10 });
    expect(result.isError).to.not.equal(true);
    expect(answerOf(result)).to.deep.equal(restAnswer.body);
    const selectors = (restAnswer.body as Array<{ selector: string }>).map((r) => r.selector);
    expect(selectors).to.include(`//healed/in/${SESSION.a}`);
    expect(selectors).to.not.include(`//healed/in/${SESSION.b}`);

    const one = await callTool('xenon_selector_health', { selector: `//healed/in/${SESSION.a}` });
    expect((answerOf(one) as Array<{ selector: string }>).map((r) => r.selector)).to.deep.equal([
      `//healed/in/${SESSION.a}`,
    ]);
  });

  it("xenon_healing_events answers a visible session's heals", async () => {
    const result = await callTool('xenon_healing_events', { sessionId: SESSION.a });
    expect(result.isError).to.not.equal(true);
    const events = answerOf(result);
    expect(events).to.have.length(1);
    expect(events[0]).to.deep.include({
      selector: `//healed/in/${SESSION.a}`,
      healedSelector: `//healed/to/${SESSION.a}`,
      tier: 'Fuzzy XML',
      confidence: 0.9,
      isSuccess: true,
    });
  });

  it("xenon_healing_events refuses another team's session as REST does", async () => {
    const restAnswer = await rest(`/session/${SESSION.b}`);
    expect(restAnswer.status).to.equal(404);
    const result = await callTool('xenon_healing_events', { sessionId: SESSION.b });
    expect(result.isError).to.equal(true);
    expect(answerOf(result)).to.deep.equal(restAnswer.body);

    const unknown = await rest('/session/mrt-no-such-session');
    const unknownResult = await callTool('xenon_healing_events', {
      sessionId: 'mrt-no-such-session',
    });
    expect(answerOf(unknownResult)).to.deep.equal(unknown.body);
  });

  it("a token without xenon:analytics:read doesn't list the analytics tools", async () => {
    const token = await keys.sign(
      { sub: member.user.id, scopes: '', scope: 'xenon:devices:read' },
      { audience: 'xenon-mcp', ttlSeconds: 60 },
    );
    const client = await connect({ authorization: `Bearer ${token}` });
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).to.include('xenon_list_devices');
      expect(names).to.not.include('xenon_selector_health');
      expect(names).to.not.include('xenon_healing_events');
      const refused = await client
        .callTool({ name: 'xenon_selector_health', arguments: {} })
        .then((r) => (r as ToolResult).isError === true)
        .catch(() => true);
      expect(refused).to.equal(true);
    } finally {
      await client.close();
    }
  });

  it('writes one mcp_tool_call event with no arguments', async () => {
    // Let the earlier tests' events land first: each is written in the background.
    await new Promise((r) => setTimeout(r, 200));
    const before = new Date();
    await callTool('xenon_list_devices', { name: 'secret-typed-text' });
    let rows: Array<{ payload: string }> = [];
    for (let i = 0; i < 50 && rows.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
      rows = await prisma.eventLog.findMany({
        where: { type: 'mcp_tool_call', occurredAt: { gte: before } },
      });
    }
    expect(rows).to.have.length(1);
    const payload = JSON.parse(rows[0].payload);
    expect(Object.keys(payload).sort()).to.deep.equal(['durationMs', 'outcome', 'tool', 'userId']);
    expect(payload.userId).to.equal(member.user.id);
    expect(payload.tool).to.equal('xenon_list_devices');
    expect(payload.outcome).to.equal('ok');
    expect(payload.durationMs).to.be.a('number');
    expect(rows[0].payload).to.not.include('secret-typed-text');
  });
});
