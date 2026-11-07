import 'reflect-metadata';
import http from 'http';
import type { AddressInfo } from 'net';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import request from '../helpers/loopbackRequest';
import { makeRouter } from '../../src/app/routers/sdk-leases';
import { LeaseService } from '../../src/services/lease/LeaseService';
import { LeaseQueue } from '../../src/services/lease/LeaseQueue';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { prisma } from '../../src/prisma';
import { useScratchDatabase } from '../helpers/scratch-database';
import { usePrismaStores } from '../helpers/loki-stores';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';

// A lease after its create: GET /sdk/leases/:id (long-polling while it
// waits), heartbeat, extend and DELETE, for a waiting lease and for a group.

const HOST = 'http://127.0.0.1:4723';
const PORTS: Record<string, Record<string, number>> = {
  A: { systemPort: 8201, chromedriverPort: 9515, mjpegServerPort: 7811 },
  B: { systemPort: 8202, chromedriverPort: 9516, mjpegServerPort: 7812 },
};

const member = (udid: string) => ({ filters: { platform: 'android', udid } });
const noAuth = { nodePairAuth: async () => ({ accessKey: '', token: '' }) };

describe('A group lease after its create', () => {
  const scratch = useScratchDatabase();
  usePrismaStores();
  useOwnNodeId();

  let portClient: {
    allocate: sinon.SinonStub;
    release: sinon.SinonStub;
    extend: sinon.SinonStub;
  };
  let queue: LeaseQueue;
  let svc: LeaseService;
  let app: express.Express;

  const phone = (udid: string) =>
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
      } as any,
    });

  const busy = async (udid: string) =>
    (await scratch.db.device.findUnique({ where: { udid_host: { udid, host: HOST } } }))?.busy;
  const leaseRow = (id: string) =>
    scratch.db.lease.findUnique({ where: { id }, include: { members: true } });

  const post = (body: Record<string, unknown>) =>
    request(app)
      .post('/sdk/leases')
      .send({ durationMs: 600_000, heartbeatSeconds: 30, ...body });
  const get = (lease: any, query = '') =>
    request(app)
      .get(`/sdk/leases/${lease.leaseId}${query}`)
      .set('x-xenon-lease-token', lease.leaseToken);
  const heartbeat = (lease: any) =>
    request(app)
      .post(`/sdk/leases/${lease.leaseId}/heartbeat`)
      .set('x-xenon-lease-token', lease.leaseToken);
  const extend = (lease: any, durationMs: number) =>
    request(app)
      .post(`/sdk/leases/${lease.leaseId}/extend`)
      .set('x-xenon-lease-token', lease.leaseToken)
      .send({ durationMs });
  const release = (lease: any) =>
    request(app)
      .delete(`/sdk/leases/${lease.leaseId}`)
      .set('x-xenon-lease-token', lease.leaseToken);

  /** A granted single lease of phone `udid`. */
  const leaseOf = async (udid: string) => {
    const res = await post({ filters: member(udid).filters });
    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    return res.body;
  };
  /** A request that waits in the queue. */
  const waiter = async (members: Array<{ filters: Record<string, unknown> }>) => {
    const res = await post({ members, waitMs: 60_000 });
    expect(res.status, JSON.stringify(res.body)).to.equal(202);
    return res.body;
  };
  const listening = (leaseId: string) =>
    ((queue as any).listeners as Map<string, Set<unknown>>).has(leaseId);
  const until = async (what: () => boolean, withinMs: number) => {
    const end = Date.now() + withinMs;
    while (!what()) {
      if (Date.now() > end) throw new Error(`not within ${withinMs} ms`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  beforeEach(async () => {
    // Nothing here reaches a process, but a stray kill must never signal one.
    sinon.stub(process, 'kill');
    await scratch.db.portLease.deleteMany({});
    await scratch.db.lease.deleteMany({});
    await scratch.db.device.deleteMany({});
    await scratch.db.deviceSetting.deleteMany({});
    await phone('A');
    await phone('B');
    portClient = {
      allocate: sinon.stub().callsFake(async ({ udid }: any) => PORTS[udid]),
      release: sinon.stub().resolves({ released: 3 }),
      extend: sinon.stub().resolves({ extended: 3 }),
    };
    const store = DeviceStoreFactory.getStore();
    queue = new LeaseQueue(prisma, store, portClient, noAuth);
    svc = new LeaseService(prisma, store, portClient, noAuth, queue);
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.apiKey = { id: 'key_owner', teamId: null };
      req.auth = { kind: 'apiKey', userId: 'usr_owner', role: 'ADMIN' };
      next();
    });
    app.use('/sdk/leases', makeRouter({ leaseService: svc }));
  });

  afterEach(async () => {
    queue.stop();
    await svc.phoneServerCallsSettled();
    sinon.restore();
  });

  it('GET answers waiting with its position, then the granted body once granted', async () => {
    const first = await leaseOf('A');
    const waiting = await waiter([member('A'), member('B')]);

    const before = await get(waiting);
    expect(before.status, JSON.stringify(before.body)).to.equal(202);
    expect(before.body).to.deep.equal({
      leaseId: waiting.leaseId,
      leaseToken: waiting.leaseToken,
      status: 'waiting',
      position: 1,
      waitUntil: waiting.waitUntil,
      heartbeatSeconds: 30,
    });

    expect((await release(first)).status).to.equal(204);
    await queue.pass();

    const after = await get(waiting);
    expect(after.status, JSON.stringify(after.body)).to.equal(200);
    expect(after.body.leaseId).to.equal(waiting.leaseId);
    expect(after.body.leaseToken).to.equal(waiting.leaseToken);
    expect(after.body.members.map((m: any) => m.device.udid)).to.deep.equal(['A', 'B']);
    expect(after.body.members[1].appiumCapabilities['xe:options']).to.deep.include({
      leaseId: waiting.leaseId,
      leaseToken: waiting.leaseToken,
      leaseMember: 1,
    });
    expect(after.body.device.udid).to.equal('A');
  });

  it('GET with waitMs answers as soon as the lease is granted', async () => {
    const first = await leaseOf('A');
    const waiting = await waiter([member('A')]);

    const started = Date.now();
    setTimeout(() => void svc.release(first.leaseId, first.leaseToken), 200);
    const res = await get(waiting, '?waitMs=5000');
    const took = Date.now() - started;

    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect(res.body.members.map((m: any) => m.device.udid)).to.deep.equal(['A']);
    expect(took).to.be.within(150, 3_000);
    expect(listening(waiting.leaseId)).to.equal(false);
  });

  it('GET with waitMs answers waiting at the limit', async () => {
    await leaseOf('A');
    const waiting = await waiter([member('A')]);

    const started = Date.now();
    const res = await get(waiting, '?waitMs=300');
    const took = Date.now() - started;

    expect(res.status, JSON.stringify(res.body)).to.equal(202);
    expect(res.body).to.deep.include({ status: 'waiting', position: 1 });
    expect(took).to.be.within(250, 2_000);
    expect(listening(waiting.leaseId)).to.equal(false);
  });

  it('GET counts as a heartbeat', async () => {
    const active = await leaseOf('A');
    const waiting = await waiter([member('A')]);
    const old = Date.now() - 60_000;
    await scratch.db.lease.updateMany({ data: { lastHeartbeatAt: old } });

    const before = Date.now();
    expect((await get(waiting)).status).to.equal(202);
    expect((await get(active)).status).to.equal(200);

    for (const id of [waiting.leaseId, active.leaseId]) {
      expect((await leaseRow(id))?.lastHeartbeatAt, id).to.be.within(before, Date.now());
    }
  });

  it('heartbeat keeps a waiter in the queue', async () => {
    await leaseOf('A');
    const waiting = await waiter([member('A')]);
    await scratch.db.lease.update({
      where: { id: waiting.leaseId },
      data: { lastHeartbeatAt: Date.now() - 60_000 },
    });

    const before = Date.now();
    const res = await heartbeat(waiting);

    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect(res.body).to.deep.include({ status: 'waiting', position: 1 });
    expect(res.body.heartbeatedAt).to.be.within(before, Date.now());
    const row = await leaseRow(waiting.leaseId);
    expect(row?.status).to.equal('waiting');
    expect(row?.lastHeartbeatAt).to.equal(res.body.heartbeatedAt);
    expect(await queue.positionOf(waiting.leaseId)).to.equal(1);
  });

  it('extend on a waiting lease answers 409 lease_waiting', async () => {
    await leaseOf('A');
    const waiting = await waiter([member('A')]);

    const res = await extend(waiting, 60 * 60_000);

    expect(res.status, JSON.stringify(res.body)).to.equal(409);
    expect(res.body.error).to.equal('lease_waiting');
    expect(res.body.message).to.be.a('string');
    const row = await leaseRow(waiting.leaseId);
    expect(row?.status).to.equal('waiting');
    expect(row?.expiresAt).to.equal(0);
  });

  it("extend on a group holds every member's ports", async () => {
    const group = await post({ members: [member('A'), member('B')] });
    expect(group.status).to.equal(201);

    const res = await extend(group.body, 2 * 60 * 60_000);
    await svc.phoneServerCallsSettled();

    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect(res.body.expiresAt).to.be.greaterThan(group.body.expiresAt);
    expect(portClient.extend.callCount).to.equal(2);
    const held = portClient.extend.getCalls().map((c) => c.args[0]);
    for (const udid of ['A', 'B']) {
      const call = held.find((h) => h.udid === udid);
      expect(call, udid).to.not.equal(undefined);
      expect(call.nodeHost).to.equal(HOST);
      expect(call.ports).to.have.members(Object.values(PORTS[udid]));
      expect(call.expiresAt).to.equal(res.body.expiresAt);
    }
  });

  it('DELETE gives up a wait and releases its held phones', async () => {
    await leaseOf('A');
    const waiting = await waiter([member('A'), member('B')]);
    // The head holds phone B for member 1.
    expect((await leaseRow(waiting.leaseId))?.members.map((m) => m.udid)).to.deep.equal(['B']);
    expect(await busy('B')).to.equal(true);

    const res = await release(waiting);

    expect(res.status).to.equal(204);
    const row = await leaseRow(waiting.leaseId);
    expect(row?.status).to.equal('expired');
    expect(row?.members).to.have.length(0);
    expect(await busy('B')).to.equal(false);
    // The lease that has A keeps it.
    expect(await busy('A')).to.equal(true);
    // A second DELETE answers as for any lease that has ended.
    expect((await release(waiting)).status).to.equal(404);
  });

  it('DELETE releases every member of a group, and a later waiter is then granted', async () => {
    const group = await post({ members: [member('A'), member('B')] });
    expect(group.status).to.equal(201);
    const waiting = await waiter([member('B')]);
    // Member 0's ports are rows in this server's database; member 1's are on
    // its phone's server only.
    const now = Date.now();
    for (const port of Object.values(PORTS.A)) {
      await scratch.db.portLease.create({
        data: {
          port,
          purpose: 'lease',
          leasedToUdid: 'A',
          leasedToHost: HOST,
          leaseId: group.body.leaseId,
          leasedAt: now,
          expiresAt: now + 600_000,
        },
      });
    }

    const res = await release(group.body);
    expect(res.status).to.equal(204);
    expect((await leaseRow(group.body.leaseId))?.status).to.equal('released');

    // The release runs a pass, which grants the waiter.
    const granted = await get(waiting, '?waitMs=5000');
    expect(granted.status, JSON.stringify(granted.body)).to.equal(200);
    expect(granted.body.members.map((m: any) => m.device.udid)).to.deep.equal(['B']);
    expect(await busy('A')).to.equal(false);
    expect(await busy('B')).to.equal(true);

    // A's ports were all deleted here; B's server is asked to free B's.
    expect(await scratch.db.portLease.count()).to.equal(0);
    await svc.phoneServerCallsSettled();
    const freed = portClient.release.getCalls().map((c) => c.args[0]);
    expect(freed.map((f) => f.udid)).to.deep.equal(['B']);
    expect(freed[0].ports).to.have.members(Object.values(PORTS.B));
    expect(freed[0].nodeHost).to.equal(HOST);
  });

  it('answers 410 with the reason for an ended group', async () => {
    const group = await post({ members: [member('A'), member('B')] });
    expect(group.status).to.equal(201);
    const reason = 'member 1 (B) disconnected';
    await scratch.db.lease.update({
      where: { id: group.body.leaseId },
      data: { status: 'ended', endReason: reason },
    });

    const got = await get(group.body);
    expect(got.status).to.equal(410);
    expect(got.body).to.deep.include({ error: 'gone', reason });
    const beat = await heartbeat(group.body);
    expect(beat.status).to.equal(410);
    expect(beat.body).to.deep.include({ error: 'gone', reason });
    const extended = await extend(group.body, 60_000);
    expect(extended.status).to.equal(410);
    expect(extended.body).to.deep.equal({ error: 'gone', reason });
    // DELETE of a lease that has ended answers as it always did.
    expect((await release(group.body)).status).to.equal(404);
  });

  it('answers a released single lease with no reason', async () => {
    const one = await leaseOf('A');
    expect((await release(one)).status).to.equal(204);

    const beat = await heartbeat(one);
    expect(beat.status).to.equal(410);
    expect(beat.body).to.deep.equal({
      error: 'gone',
      message: `lease ${one.leaseId} is released`,
    });
    const got = await get(one);
    expect(got.status).to.equal(410);
    expect(got.body).to.not.have.property('reason');
    expect((await extend(one, 60_000)).body).to.deep.equal({ error: 'gone' });
  });

  it('GET with a wrong token answers 403', async () => {
    const one = await leaseOf('A');

    const wrong = await get({ ...one, leaseToken: 'w'.repeat(64) });
    expect(wrong.status).to.equal(403);
    expect(wrong.body).to.deep.equal({ error: 'token_mismatch' });
    // An unknown id answers the same.
    const unknown = await get({ ...one, leaseId: 'lse_nope' });
    expect(unknown.status).to.equal(403);
    expect(unknown.body).to.deep.equal({ error: 'token_mismatch' });
    // And no token at all, as on the other routes.
    const none = await request(app).get(`/sdk/leases/${one.leaseId}`);
    expect(none.status).to.equal(403);
  });

  it('GET refuses a waitMs outside 0 to 25000', async () => {
    const one = await leaseOf('A');

    for (const waitMs of ['25001', '-1', '1.5', 'soon']) {
      const res = await get(one, `?waitMs=${waitMs}`);
      expect(res.status, waitMs).to.equal(400);
      expect(res.body.error, waitMs).to.equal('bad_request');
    }
    expect((await get(one, '?waitMs=25000')).status).to.equal(200);
    expect((await get(one, '?waitMs=0')).status).to.equal(200);
  });

  it('a long-poll whose client leaves leaves no listener', async () => {
    await leaseOf('A');
    const waiting = await waiter([member('A')]);
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const { port } = server.address() as AddressInfo;
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: `/sdk/leases/${waiting.leaseId}?waitMs=5000`,
        headers: { 'x-xenon-lease-token': waiting.leaseToken },
      });
      req.on('error', () => undefined);
      req.end();

      await until(() => listening(waiting.leaseId), 2_000);
      req.destroy();
      // Gone long before the 5 s wait would have ended.
      await until(() => !listening(waiting.leaseId), 1_000);
    } finally {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
