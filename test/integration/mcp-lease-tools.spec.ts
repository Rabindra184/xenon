import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sinon from 'sinon';
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
import { drainLeaseQueues } from '../helpers/lease-queue';
import { createRouter } from '../../src/app/index';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { LeaseService, MCP_LEASE_DEFAULT_MS } from '../../src/services/lease/LeaseService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';

type ToolResult = { isError?: boolean; content: Array<{ type: string; text: string }> };

/**
 * The lease tools, through /xenon/mcp with a bearer token issued under a
 * grant (`gid`): an agent's lease needs no heartbeats, lasts 15 minutes
 * unless extended, and records the grant it was taken under.
 */
describe('MCP lease tools (integration)', function () {
  this.timeout(60_000);
  useScratchDatabase({ wholeSuite: true });
  useOwnNodeId();

  const servers = loopbackServers();
  const stamp = Date.now();
  const GRANT = `grant-${stamp}`;
  const PHONE = {
    acquire: `mlt-acquire-${stamp}`,
    shape: `mlt-shape-${stamp}`,
    extend: `mlt-extend-${stamp}`,
    release: `mlt-release-${stamp}`,
    list: `mlt-list-${stamp}`,
    others: `mlt-others-${stamp}`,
    hour: `mlt-hour-${stamp}`,
    capped: `mlt-capped-${stamp}`,
  };
  // Port 1 has nothing listening: the lease's ports go through a stubbed
  // port client, so nothing is sent to "the phone's server".
  const DEVICE_HOST = 'http://127.0.0.1:1';

  let app: express.Express;
  let member: SeededUser;
  let bearer: string;
  let keyDir: string;
  let store: any;
  let svc: LeaseService;
  let savedAuthDisabled: boolean;
  let restoreContainer: () => void;

  async function callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const server: Server = await servers.serve(app);
    const { port } = server.address() as AddressInfo;
    const client = new Client({ name: 'mcp-lease-tools-spec', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/xenon/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${bearer}` } },
      }),
    );
    try {
      return (await client.callTool({ name, arguments: args })) as ToolResult;
    } finally {
      await client.close();
    }
  }

  const answerOf = (result: ToolResult): any => JSON.parse(result.content[0].text);

  async function acquire(udid: string, extra: Record<string, unknown> = {}): Promise<any> {
    const result = await callTool('xenon_acquire_device', {
      udid,
      authToken: 'ignored',
      ...extra,
    });
    expect(result.isError, result.content[0].text).to.not.equal(true);
    return answerOf(result);
  }

  const leaseRow = (id: string): Promise<any> => prisma.lease.findUnique({ where: { id } });

  before(async () => {
    savedAuthDisabled = config.authDisabled;
    config.authDisabled = false;
    restoreContainer = saveRegistrations(JwtKeyService, LeaseService);
    keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-mcp-lease-tools-'));
    const keys = new JwtKeyService();
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

    app = express();
    app.use('/xenon', createRouter({ ...DefaultPluginArgs }));

    member = await seedUser('MEMBER', { name: 'Lease Tools Member' });
    bearer = await keys.sign(
      {
        sub: member.user.id,
        scopes: 'devices,read',
        scope: 'xenon:devices:read xenon:devices:lock',
        gid: GRANT,
      },
      { audience: 'xenon-mcp', ttlSeconds: 600 },
    );

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

  afterEach(async () => {
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

  it("xenon_acquire_device makes a heartbeat-free lease of 15 minutes under the caller's grant", async () => {
    const answer = await acquire(PHONE.acquire);

    const row = await leaseRow(answer.lockId);
    expect(row.status).to.equal('active');
    expect(row.heartbeatFree).to.equal(true);
    expect(row.grantId).to.equal(GRANT);
    expect(row.actorId).to.equal(member.user.id);
    expect(MCP_LEASE_DEFAULT_MS).to.equal(900_000);
    const createdAt = new Date(row.createdAt).getTime();
    expect(Math.abs(row.expiresAt - createdAt - 900_000)).to.be.below(1_000);
    expect((await store.findDevice({ udid: PHONE.acquire, host: DEVICE_HOST }))?.busy).to.equal(
      true,
    );
  });

  it('xenon_acquire_device takes a durationMs for another end', async () => {
    const answer = await acquire(PHONE.hour, { durationMs: 3_600_000 });

    const row = await leaseRow(answer.lockId);
    expect(row.heartbeatFree).to.equal(true);
    const createdAt = new Date(row.createdAt).getTime();
    expect(Math.abs(row.expiresAt - createdAt - 3_600_000)).to.be.below(1_000);
  });

  it('a durationMs past the lease limit is capped at 24 hours, as LeaseService caps it', async () => {
    const answer = await acquire(PHONE.capped, { durationMs: 100 * 60 * 60 * 1000 });

    const row = await leaseRow(answer.lockId);
    const createdAt = new Date(row.createdAt).getTime();
    expect(Math.abs(row.expiresAt - createdAt - 24 * 60 * 60 * 1000)).to.be.below(1_000);
  });

  it("the acquire answer keeps Studio's shape", async () => {
    const answer = await acquire(PHONE.shape);

    expect(Object.keys(answer).sort()).to.deep.equal(
      ['appiumCapabilities', 'host', 'leaseToken', 'lockId', 'udid'].sort(),
    );
    expect(answer.udid).to.equal(PHONE.shape);
    expect(answer.host).to.equal(DEVICE_HOST);
    expect(answer.appiumCapabilities['xe:options']).to.deep.include({
      leaseId: answer.lockId,
      leaseToken: answer.leaseToken,
    });
  });

  it('xenon_acquire_device refuses a phone the lab does not list', async () => {
    const result = await callTool('xenon_acquire_device', { udid: `mlt-unknown-${stamp}` });
    expect(result.isError).to.equal(true);
    expect(answerOf(result).error).to.equal('not_found');
  });

  it("xenon_extend_device moves expiresAt out by LeaseService.extend's rules", async () => {
    const answer = await acquire(PHONE.extend);
    const before = (await leaseRow(answer.lockId)).expiresAt;

    // Never shorter: a minute asked for keeps the 15 minutes left.
    const shorter = await callTool('xenon_extend_device', {
      lockId: answer.lockId,
      leaseToken: answer.leaseToken,
      durationMs: 60_000,
    });
    expect(shorter.isError, shorter.content[0].text).to.not.equal(true);
    expect(answerOf(shorter)).to.deep.equal({ lockId: answer.lockId, expiresAt: before });

    const asked = Date.now();
    const longer = answerOf(
      await callTool('xenon_extend_device', {
        lockId: answer.lockId,
        leaseToken: answer.leaseToken,
        durationMs: 3_600_000,
      }),
    );
    expect(longer.expiresAt).to.be.at.least(asked + 3_600_000);
    expect(longer.expiresAt).to.be.below(Date.now() + 3_600_000 + 1);
    expect((await leaseRow(answer.lockId)).expiresAt).to.equal(longer.expiresAt);

    // A wrong token is REST's refusal.
    const wrong = await callTool('xenon_extend_device', {
      lockId: answer.lockId,
      leaseToken: 'not-the-token',
    });
    expect(wrong.isError).to.equal(true);
    expect(answerOf(wrong).error).to.equal('token_mismatch');
  });

  it('xenon_release_device ends it', async () => {
    const answer = await acquire(PHONE.release);

    const result = await callTool('xenon_release_device', {
      udid: PHONE.release,
      lockId: answer.lockId,
      leaseToken: answer.leaseToken,
    });

    expect(result.isError, result.content[0].text).to.not.equal(true);
    expect(answerOf(result)).to.deep.equal({ released: true });
    expect(await leaseRow(answer.lockId)).to.deep.include({
      status: 'released',
      endReason: 'client_released',
    });
    expect((await store.findDevice({ udid: PHONE.release, host: DEVICE_HOST }))?.busy).to.equal(
      false,
    );
  });

  it("xenon_list_devices shows the caller's own leases with time left", async () => {
    const mine = await acquire(PHONE.list);
    // Another user's lease on another phone.
    const theirs = await prisma.lease.create({
      data: {
        tokenHash: 'h',
        deviceUdid: PHONE.others,
        deviceHost: DEVICE_HOST,
        actorId: 'usr_someone_else',
        status: 'active',
        expiresAt: Date.now() + 600_000,
        lastHeartbeatAt: Date.now(),
        allocatedPorts: '{}',
        capabilityBag: '',
        members: {
          create: [{ index: 0, udid: PHONE.others, host: DEVICE_HOST, heldAt: Date.now() }],
        },
      } as any,
    });

    const devices = answerOf(await callTool('xenon_list_devices')) as any[];

    const listed = devices.find((d) => d.udid === PHONE.list);
    expect(listed.myLease).to.deep.equal({
      lockId: mine.lockId,
      expiresAt: (await leaseRow(mine.lockId)).expiresAt,
    });
    expect(devices.find((d) => d.udid === PHONE.others)).to.not.have.property('myLease');
    // REST's own answer is as it was: myLease is the tool's alone.
    const rest = await request(app)
      .get('/xenon/api/devices')
      .set('authorization', `Bearer ${bearer}`);
    expect(rest.status).to.equal(200);
    const restRow = (rest.body as any[]).find((d) => d.udid === PHONE.list);
    expect(restRow).to.not.have.property('myLease');

    await prisma.lease.delete({ where: { id: theirs.id } });
  });
});
