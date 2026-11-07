import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import request from '../helpers/loopbackRequest';
import { makeRouter } from '../../src/app/routers/sdk-leases';
import { LeaseService } from '../../src/services/lease/LeaseService';
import { hashToken } from '../../src/services/lease/leaseToken';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { prisma } from '../../src/prisma';
import { useScratchDatabase } from '../helpers/scratch-database';
import { usePrismaStores } from '../helpers/loki-stores';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';

// POST /sdk/leases with `members` (a group) or `filters` (one phone), at once
// (`waitMs` 0) or in the queue. Every grant goes through the lease queue.

const HOST = 'http://127.0.0.1:4723';
const PORTS: Record<string, Record<string, number>> = {
  A: { systemPort: 8201, chromedriverPort: 9515, mjpegServerPort: 7811 },
  B: { systemPort: 8202, chromedriverPort: 9516, mjpegServerPort: 7812 },
};

const member = (udid: string) => ({ filters: { platform: 'android', udid } });

describe('Creating a group lease', () => {
  const scratch = useScratchDatabase();
  usePrismaStores();
  useOwnNodeId();

  let portClient: { allocate: sinon.SinonStub; release: sinon.SinonStub };
  let svc: LeaseService;
  let app: express.Express;

  const phone = (udid: string, over: Record<string, unknown> = {}) =>
    scratch.db.device.create({
      data: {
        udid,
        host: HOST,
        nodeId: OWN_NODE_ID,
        name: `Phone ${udid}`,
        platform: 'android',
        sdk: '13',
        busy: false,
        offline: false,
        userBlocked: false,
        deviceType: 'real',
        realDevice: true,
        screenWidth: '1080',
        screenHeight: '2400',
        ...over,
      } as any,
    });

  const busy = async (udid: string) =>
    (await scratch.db.device.findUnique({ where: { udid_host: { udid, host: HOST } } }))?.busy;

  const post = (body: Record<string, unknown>) =>
    request(app)
      .post('/sdk/leases')
      .send({ durationMs: 600_000, heartbeatSeconds: 30, ...body });

  beforeEach(async () => {
    // Nothing here reaches a process, but a stray kill must never signal one.
    sinon.stub(process, 'kill');
    await scratch.db.portLease.deleteMany({});
    await scratch.db.lease.deleteMany({});
    await scratch.db.device.deleteMany({});
    await phone('A');
    await phone('B');
    portClient = {
      allocate: sinon.stub().callsFake(async ({ udid }: any) => PORTS[udid]),
      release: sinon.stub().resolves({ released: 3 }),
    };
    svc = new LeaseService(prisma, DeviceStoreFactory.getStore(), portClient, {
      nodePairAuth: async () => ({ accessKey: '', token: '' }),
    });
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.apiKey = { id: 'key_owner', teamId: null };
      req.auth = { kind: 'apiKey', userId: 'usr_owner', role: 'ADMIN' };
      next();
    });
    app.use('/sdk/leases', makeRouter({ leaseService: svc }));
  });

  afterEach(() => sinon.restore());

  it("grants a two-member group at once with both members' capabilities", async () => {
    const res = await post({ members: [member('A'), member('B')] });

    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    expect(res.body.members).to.have.length(2);
    res.body.members.forEach((m: any, index: number) => {
      expect(m.index).to.equal(index);
      expect(m.device.udid).to.equal(['A', 'B'][index]);
      expect(m.allocatedPorts).to.deep.equal(PORTS[m.device.udid]);
      expect(m.appiumCapabilities['appium:udid']).to.equal(m.device.udid);
      expect(m.appiumCapabilities['xe:options']).to.deep.include({
        leaseId: res.body.leaseId,
        leaseToken: res.body.leaseToken,
        leaseMember: index,
      });
    });
    expect(res.body.device).to.deep.equal(res.body.members[0].device);

    const lease = await scratch.db.lease.findUnique({ where: { id: res.body.leaseId } });
    expect(lease?.status).to.equal('active');
    expect(lease?.tokenHash).to.equal(hashToken(res.body.leaseToken));
    expect(lease?.durationMs).to.equal(600_000);
    expect(JSON.parse(lease!.requestedMembers!)).to.deep.equal([
      member('A').filters,
      member('B').filters,
    ]);
    // The token is handed out, never stored.
    expect(lease?.capabilityBag).to.not.include(res.body.leaseToken);
    expect(await busy('A')).to.equal(true);
    expect(await busy('B')).to.equal(true);
  });

  it('answers 404 for a group no phones could ever fill', async () => {
    // Both members want phone A, and one phone fills one member.
    const res = await post({ members: [member('A'), member('A')], waitMs: 60_000 });

    expect(res.status).to.equal(404);
    expect(res.body).to.deep.equal({
      error: 'no_matching_device',
      message: 'No device matches the filters',
    });
    expect(await scratch.db.lease.count()).to.equal(0);
    expect(await scratch.db.leaseMember.count()).to.equal(0);
    expect(await busy('A')).to.equal(false);
    expect(portClient.allocate.called).to.equal(false);
  });

  it('answers 404 by the phones the caller can see, busy or not', async () => {
    await scratch.db.device.update({
      where: { udid_host: { udid: 'B', host: HOST } },
      data: { busy: true },
    });
    // B is busy but there: the group could be filled later, so it isn't 404.
    const res = await post({ members: [member('A'), member('B')] });
    expect(res.status).to.equal(409);
  });

  it("answers 409 with waitMs 0 when the group can't be granted now", async () => {
    await scratch.db.device.update({
      where: { udid_host: { udid: 'B', host: HOST } },
      data: { busy: true },
    });

    const res = await post({ members: [member('A'), member('B')] });

    expect(res.status).to.equal(409);
    expect(res.body).to.deep.equal({ error: 'all_matching_busy', retryAfterMs: 2_000 });
    expect(await scratch.db.lease.count()).to.equal(0);
    expect(await busy('A')).to.equal(false);
    expect(portClient.allocate.called).to.equal(false);
  });

  it("answers 503 with waitMs 0 when a member's ports could not be reserved", async () => {
    portClient.allocate.callsFake(async ({ udid }: any) => {
      if (udid === 'B') throw new Error('connect ECONNREFUSED');
      return PORTS[udid];
    });

    const res = await post({ members: [member('A'), member('B')] });

    expect(res.status).to.equal(503);
    expect(res.body.error).to.equal('device_unhealthy');
    expect(await scratch.db.lease.count()).to.equal(0);
    expect(await busy('A')).to.equal(false);
    expect(await busy('B')).to.equal(false);
  });

  it('joins the queue with waitMs and answers 202 with its position', async () => {
    const first = await post({ filters: { platform: 'android', udid: 'A' } });
    expect(first.status).to.equal(201);

    const before = Date.now();
    const res = await post({ members: [member('A'), member('B')], waitMs: 60_000 });

    expect(res.status, JSON.stringify(res.body)).to.equal(202);
    expect(Object.keys(res.body).sort()).to.deep.equal(
      ['heartbeatSeconds', 'leaseId', 'leaseToken', 'position', 'status', 'waitUntil'].sort(),
    );
    expect(res.body.status).to.equal('waiting');
    expect(res.body.position).to.equal(1);
    expect(res.body.heartbeatSeconds).to.equal(30);
    expect(res.body.waitUntil).to.be.within(before + 60_000, Date.now() + 60_000);
    expect(res.body.leaseToken).to.match(/^[0-9a-f]{64}$/);

    const lease = await scratch.db.lease.findUnique({
      where: { id: res.body.leaseId },
      include: { members: true },
    });
    expect(lease?.status).to.equal('waiting');
    expect(lease?.tokenHash).to.equal(hashToken(res.body.leaseToken));
    expect(lease?.durationMs).to.equal(600_000);
    expect(lease?.waitUntil).to.equal(res.body.waitUntil);
    expect(lease?.callerTeamIds).to.equal(null);
    expect(lease?.actorId).to.equal('key_owner');
    expect(lease?.deviceUdid).to.equal('');
    // The head holds what it can of a maximum matching: phone B.
    expect(lease?.members.map((m) => [m.index, m.udid])).to.deep.equal([[1, 'B']]);
    expect(await busy('B')).to.equal(true);

    // A second waiter queues behind it.
    const second = await post({ filters: { platform: 'android', udid: 'A' }, waitMs: 60_000 });
    expect(second.status).to.equal(202);
    expect(second.body.position).to.equal(2);
  });

  it('grants a request with waitMs at once when its phones are free', async () => {
    const res = await post({ members: [member('A'), member('B')], waitMs: 60_000 });

    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    expect(res.body.members.map((m: any) => m.device.udid)).to.deep.equal(['A', 'B']);
    const lease = await scratch.db.lease.findUnique({ where: { id: res.body.leaseId } });
    expect(lease?.status).to.equal('active');
    expect(lease?.tokenHash).to.equal(hashToken(res.body.leaseToken));
  });

  it('grants exactly one of two waitMs-0 requests racing for the last phone', async () => {
    await scratch.db.device.update({
      where: { udid_host: { udid: 'B', host: HOST } },
      data: { busy: true },
    });
    const one = { filters: { platform: 'android' } };

    const answers = await Promise.all([post(one), post(one)]);

    expect(answers.map((a) => a.status).sort()).to.deep.equal([201, 409]);
    expect(await scratch.db.lease.count()).to.equal(1);
    expect(portClient.allocate.callCount).to.equal(1);
  });

  it('answers a single lease exactly as before', async () => {
    const res = await post({ filters: { platform: 'android', udid: 'A' }, buildId: 'build-7' });

    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    expect(Object.keys(res.body)).to.deep.equal([
      'leaseId',
      'leaseToken',
      'device',
      'expiresAt',
      'heartbeatSeconds',
      'allocatedPorts',
      'appiumCapabilities',
      'members',
    ]);
    expect(res.body.device).to.deep.equal({
      udid: 'A',
      host: HOST,
      platform: 'android',
      sdk: '13',
      name: 'Phone A',
      screen: { width: '1080', height: '2400' },
      realDevice: true,
    });
    expect(res.body.heartbeatSeconds).to.equal(30);
    expect(res.body.expiresAt).to.be.closeTo(Date.now() + 600_000, 5_000);
    expect(res.body.allocatedPorts).to.deep.equal(PORTS.A);
    expect(res.body.appiumCapabilities).to.deep.equal({
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:udid': 'A',
      'appium:newCommandTimeout': 120,
      'appium:deviceName': 'Phone A',
      'appium:platformVersion': '13',
      'appium:systemPort': PORTS.A.systemPort,
      'appium:chromedriverPort': PORTS.A.chromedriverPort,
      'appium:mjpegServerPort': PORTS.A.mjpegServerPort,
      'xe:options': {
        leaseId: res.body.leaseId,
        buildId: 'build-7',
        leaseMember: 0,
        leaseToken: res.body.leaseToken,
      },
    });
    expect(res.body.members).to.deep.equal([
      {
        index: 0,
        device: res.body.device,
        allocatedPorts: res.body.allocatedPorts,
        appiumCapabilities: res.body.appiumCapabilities,
      },
    ]);

    // The lease row keeps member 0 in its own columns, as before.
    const lease = await scratch.db.lease.findUnique({ where: { id: res.body.leaseId } });
    expect(lease).to.deep.include({
      status: 'active',
      deviceUdid: 'A',
      deviceHost: HOST,
      actorId: 'key_owner',
      buildId: 'build-7',
      heartbeatSeconds: 30,
    });
    expect(JSON.parse(lease!.allocatedPorts)).to.deep.equal(PORTS.A);
    expect(JSON.parse(lease!.capabilityBag)['xe:options']).to.deep.equal({
      leaseId: res.body.leaseId,
      buildId: 'build-7',
      leaseMember: 0,
    });
    // Its port rows are found by the lease, not by port number alone.
    expect(portClient.allocate.firstCall.args[0]).to.deep.include({
      udid: 'A',
      leaseId: res.body.leaseId,
      once: true,
    });
  });

  it('answers 404 for a single lease no phone matches, as before', async () => {
    const res = await post({ filters: { platform: 'android', udid: 'NO-SUCH-PHONE' } });
    expect(res.status).to.equal(404);
    expect(res.body).to.deep.equal({
      error: 'no_matching_device',
      message: 'No device matches the filters',
    });
  });
});
