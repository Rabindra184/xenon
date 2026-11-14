import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { LeaseQueue } from '../../../src/services/lease/LeaseQueue';
import { LeaseOrphanSweeper } from '../../../src/services/lease/LeaseOrphanSweeper';
import { LeaseGone, LeaseService } from '../../../src/services/lease/LeaseService';
import { LeaseGranter } from '../../../src/services/lease/LeaseGranter';
import { activeLeaseOn, activeLeasesByDevice } from '../../../src/services/lease/activeLeases';
import { generateToken, hashToken } from '../../../src/services/lease/leaseToken';
import { DeviceStoreFactory } from '../../../src/data-service/device-store';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { drainLeaseQueues } from '../../helpers/lease-queue';
import { usePrismaStores } from '../../helpers/loki-stores';
import { OWN_NODE_ID, useOwnNodeId } from '../../helpers/own-node-id';

// How a lease ends, and the reads and writes around it that must agree:
// every terminal transition says why (`endReason`), a waiting lease with no
// `waitUntil` waits for ever everywhere, a heartbeat or extend landing while
// the sweeper judges a lease wins over a stale judgement, a waiter whose
// client went away is never granted, a lock never takes a twin udid on
// another host, and a grant leaves no member outside 0..n-1.

const HOST = 'http://127.0.0.1:4723';
const HOUR = 60 * 60 * 1000;

describe('Lease terminal states and liveness', () => {
  const scratch = useScratchDatabase({ wholeSuite: true });
  usePrismaStores();
  useOwnNodeId();

  const auth = { nodePairAuth: async () => ({ accessKey: '', token: '' }) };
  let portClient: { allocate: sinon.SinonStub; release: sinon.SinonStub };
  let queue: LeaseQueue;
  let sweeper: LeaseOrphanSweeper;
  let service: LeaseService;
  let token: string;

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
        ...over,
      } as any,
    });

  async function active(id: string, udids: string[], over: Record<string, unknown> = {}) {
    const now = Date.now();
    await scratch.db.lease.create({
      data: {
        id,
        tokenHash: hashToken(token),
        deviceUdid: udids[0],
        deviceHost: HOST,
        actorId: 'key_owner',
        status: 'active',
        expiresAt: now + HOUR,
        heartbeatSeconds: 30,
        lastHeartbeatAt: now,
        allocatedPorts: '{}',
        capabilityBag: '',
        createdAt: new Date(now),
        ...over,
        members: {
          create: udids.map((udid, index) => ({ index, udid, host: HOST, heldAt: now })),
        },
      },
    });
    for (const udid of udids) {
      await scratch.db.device.updateMany({ where: { udid }, data: { busy: true } });
    }
  }

  async function waiter(
    id: string,
    wants: string[],
    holds: string[] = [],
    over: Record<string, unknown> = {},
  ) {
    const now = Date.now();
    await scratch.db.lease.create({
      data: {
        id,
        tokenHash: hashToken(token),
        deviceUdid: '',
        deviceHost: '',
        actorId: 'key_owner',
        status: 'waiting',
        waitUntil: now + HOUR,
        expiresAt: 0,
        heartbeatSeconds: 30,
        lastHeartbeatAt: now,
        allocatedPorts: '{}',
        capabilityBag: '',
        requestedMembers: JSON.stringify(wants.map((udid) => ({ platform: 'android', udid }))),
        durationMs: 600_000,
        ...over,
        members: {
          create: holds.map((udid, index) => ({ index, udid, host: HOST, heldAt: now })),
        },
      },
    });
    for (const udid of holds) {
      await scratch.db.device.updateMany({ where: { udid }, data: { busy: true } });
    }
  }

  const lease = (id: string) => scratch.db.lease.findUnique({ where: { id } });
  const busy = async (udid: string, host = HOST) =>
    (await scratch.db.device.findUnique({ where: { udid_host: { udid, host } } }))?.busy;

  /** `db` with `lease.<method>` replaced; everything else is the scratch database. */
  function withLease(method: string, fn: (args: any) => Promise<any>): any {
    const leaseModel = new Proxy(scratch.db.lease as any, {
      get: (target, prop) => (prop === method ? fn : target[prop]),
    });
    return new Proxy(scratch.db as any, {
      get: (target, prop) => (prop === 'lease' ? leaseModel : target[prop]),
    });
  }

  beforeEach(async () => {
    await scratch.db.portLease.deleteMany({});
    await scratch.db.lease.deleteMany({});
    await scratch.db.device.deleteMany({});
    for (const udid of ['u1', 'u2', 'u3']) await phone(udid);
    token = generateToken();
    portClient = {
      allocate: sinon.stub().resolves({ systemPort: 8201 }),
      release: sinon.stub().resolves({ released: 1 }),
    };
    const store = DeviceStoreFactory.getStore();
    queue = new LeaseQueue(scratch.db, store, portClient, auth);
    sweeper = new LeaseOrphanSweeper(scratch.db, store, portClient, auth, queue);
    service = new LeaseService(scratch.db, store, portClient, auth, queue);
  });

  afterEach(async () => {
    await drainLeaseQueues(queue);
    await sweeper.phoneServerCallsSettled();
    await service.phoneServerCallsSettled();
    sinon.restore();
  });

  describe('every terminal transition says why', () => {
    it('a client release of an active lease: released, client_released', async () => {
      await active('lse_a', ['u1']);
      await service.release('lse_a', token);
      const row = await lease('lse_a');
      expect(row?.status).to.equal('released');
      expect(row?.endReason).to.equal('client_released');
    });

    it('a client giving up a waiting lease: expired, client_released', async () => {
      await waiter('lse_w', ['u1', 'u2'], ['u1'], { createdAt: new Date(Date.now() - HOUR) });
      await scratch.db.device.updateMany({ where: { udid: 'u2' }, data: { busy: true } });
      await service.release('lse_w', token);
      const row = await lease('lse_w');
      expect(row?.status).to.equal('expired');
      expect(row?.endReason).to.equal('client_released');
    });

    it('a waiter whose wait ran out: expired, wait_ran_out (sweeper and a queue pass)', async () => {
      await waiter('lse_swept', ['u1'], [], { waitUntil: Date.now() - 1_000 });
      await sweeper.sweep();
      expect((await lease('lse_swept'))?.endReason).to.equal('wait_ran_out');

      await waiter('lse_passed', ['u1'], [], { waitUntil: Date.now() - 1_000 });
      await queue.pass();
      const row = await lease('lse_passed');
      expect(row?.status).to.equal('expired');
      expect(row?.endReason).to.equal('wait_ran_out');
    });

    it('a waiter whose client missed three heartbeats: expired, missed_heartbeats', async () => {
      await waiter('lse_w', ['u1'], [], { lastHeartbeatAt: Date.now() - 120_000 });
      await sweeper.sweep();
      const row = await lease('lse_w');
      expect(row?.status).to.equal('expired');
      expect(row?.endReason).to.equal('missed_heartbeats');
    });

    it('an active lease: missed_heartbeats, or past_end', async () => {
      await active('lse_quiet', ['u1'], { lastHeartbeatAt: Date.now() - 120_000 });
      await active('lse_over', ['u2'], { expiresAt: Date.now() - 1_000 });
      await sweeper.sweep();
      const quiet = await lease('lse_quiet');
      expect(quiet?.status).to.equal('expired');
      expect(quiet?.endReason).to.equal('missed_heartbeats');
      const over = await lease('lse_over');
      expect(over?.status).to.equal('expired');
      expect(over?.endReason).to.equal('past_end');
    });

    it('a group that lost a member: ended, member_lost, and its 410 reason is unchanged', async () => {
      await active('lse_g', ['u1', 'u2']);
      await scratch.db.device.updateMany({ where: { udid: 'u2' }, data: { userBlocked: true } });
      await sweeper.sweep();
      const row = await lease('lse_g');
      expect(row?.status).to.equal('ended');
      expect(row?.endReason).to.equal('member_lost: member 1 (u2) was blocked by an admin');

      const err = await service.heartbeat('lse_g', token).catch((e) => e);
      expect(err).to.be.instanceOf(LeaseGone);
      expect(err.reason).to.equal('member 1 (u2) was blocked by an admin');
    });

    it('an expired lease answers as before: gone, with no reason', async () => {
      await active('lse_over', ['u1'], { expiresAt: Date.now() - 1_000 });
      await sweeper.sweep();
      const err = await service.heartbeat('lse_over', token).catch((e) => e);
      expect(err).to.be.instanceOf(LeaseGone);
      expect(err.message).to.equal('lease lse_over is expired');
      expect(err.reason).to.equal(undefined);
    });
  });

  describe('a waiting lease with no waitUntil waits for ever', () => {
    it('is live for the readers that ask the lease table', async () => {
      await waiter('lse_forever', ['u1', 'u2'], ['u1'], { waitUntil: null });

      const on = await activeLeaseOn('u1', HOST, scratch.db);
      expect(on?.id).to.equal('lse_forever');
      expect(on?.status).to.equal('waiting');
      expect((await activeLeasesByDevice(scratch.db)).has(`u1@${HOST}`)).to.equal(true);
      expect(await queue.positionOf('lse_forever')).to.equal(1);
    });
  });

  describe('a heartbeat or extend landing during a terminal judgement', () => {
    it("the sweeper doesn't expire an active lease whose heartbeat came after it read", async () => {
      await active('lse_a', ['u1'], { lastHeartbeatAt: Date.now() - 120_000 });
      // The client's heartbeat lands between the sweep's read and its write.
      const db = withLease('findMany', async (args: any) => {
        const rows = await scratch.db.lease.findMany(args);
        await service.heartbeat('lse_a', token);
        return rows;
      });
      const racing = new LeaseOrphanSweeper(
        db,
        DeviceStoreFactory.getStore(),
        portClient,
        auth,
        queue,
      );

      await racing.sweep();

      expect((await lease('lse_a'))?.status).to.equal('active');
      expect(await busy('u1')).to.equal(true);
      // The client heartbeated successfully, so the lease is still its own.
      await service.heartbeat('lse_a', token);
    });

    it("the sweeper doesn't give up a waiter whose heartbeat came after it read", async () => {
      await waiter('lse_w', ['u1', 'u2'], ['u1'], { lastHeartbeatAt: Date.now() - 120_000 });
      await scratch.db.device.updateMany({ where: { udid: 'u2' }, data: { busy: true } });
      const db = withLease('findMany', async (args: any) => {
        const rows = await scratch.db.lease.findMany(args);
        if (args?.where?.status?.in) {
          await scratch.db.lease.update({
            where: { id: 'lse_w' },
            data: { lastHeartbeatAt: Date.now() },
          });
        }
        return rows;
      });
      const racing = new LeaseOrphanSweeper(
        db,
        DeviceStoreFactory.getStore(),
        portClient,
        auth,
        queue,
      );

      await racing.sweep();

      expect((await lease('lse_w'))?.status).to.equal('waiting');
      expect(await busy('u1')).to.equal(true);
    });

    it('extend does not revive a lease that lapsed after it read it', async () => {
      await active('lse_a', ['u1'], { expiresAt: Date.now() + 60_000 });
      // Between extend's read and its write the lease passes its end (as
      // time would have it).
      let lapsed = false;
      const db = withLease('findUnique', async (args: any) => {
        const row = await scratch.db.lease.findUnique(args);
        if (!lapsed) {
          lapsed = true;
          await scratch.db.lease.update({
            where: { id: 'lse_a' },
            data: { expiresAt: Date.now() - 1 },
          });
        }
        return row;
      });
      const racing = new LeaseService(db, DeviceStoreFactory.getStore(), portClient, auth, queue);

      const err = await racing.extend('lse_a', token, 600_000).catch((e) => e);

      expect(err).to.be.instanceOf(LeaseGone);
      expect((await lease('lse_a'))?.expiresAt).to.be.below(Date.now());
    });

    it('extend never shortens a lease another extend moved meanwhile', async () => {
      const start = Date.now();
      await active('lse_a', ['u1'], { expiresAt: start + 60_000 });
      let raced = false;
      const db = withLease('findUnique', async (args: any) => {
        const row = await scratch.db.lease.findUnique(args);
        if (!raced) {
          raced = true;
          await scratch.db.lease.update({
            where: { id: 'lse_a' },
            data: { expiresAt: start + 2 * HOUR },
          });
        }
        return row;
      });
      const racing = new LeaseService(db, DeviceStoreFactory.getStore(), portClient, auth, queue);

      const out = await racing.extend('lse_a', token, 120_000);

      expect(out.expiresAt).to.equal(start + 2 * HOUR);
      expect((await lease('lse_a'))?.expiresAt).to.equal(start + 2 * HOUR);
    });
  });

  describe('a waiter whose client went away', () => {
    it('is given up by a pass, not granted', async () => {
      await waiter('lse_dead', ['u1'], [], { lastHeartbeatAt: Date.now() - 120_000 });

      await queue.pass();

      const row = await lease('lse_dead');
      expect(row?.status).to.equal('expired');
      expect(row?.endReason).to.equal('missed_heartbeats');
      expect(await busy('u1')).to.equal(false);
      expect(portClient.allocate.called).to.equal(false);
    });

    it('a grant refreshes lastHeartbeatAt, so the next sweep keeps the new lease', async () => {
      await waiter('lse_w', ['u1'], [], { lastHeartbeatAt: Date.now() - 80_000 });
      const before = Date.now();

      await queue.pass();

      const row = await lease('lse_w');
      expect(row?.status).to.equal('active');
      expect(row?.lastHeartbeatAt).to.be.at.least(before);
      // 30 s on, it hasn't missed three heartbeats.
      const clock = sinon.useFakeTimers({ now: Date.now() + 30_000, toFake: ['Date'] });
      try {
        await sweeper.sweep();
      } finally {
        clock.restore();
      }
      expect((await lease('lse_w'))?.status).to.equal('active');
    });
  });

  describe('a lock takes the exact phone', () => {
    const TWIN = 'http://127.0.0.1:47230';
    const twinRow = () =>
      scratch.db.device.findUnique({ where: { udid_host: { udid: 't1', host: TWIN } } });
    let lockedAtBefore: number | null | undefined;

    beforeEach(async () => {
      // The phone named is busy; a twin udid on another host that contains
      // its host as a substring is free.
      await phone('t1', { busy: true });
      await phone('t1', { host: TWIN });
      lockedAtBefore = (await twinRow())?.sessionStartTime;
    });

    it("the granter's lock never touches the twin", async () => {
      const store = DeviceStoreFactory.getStore();
      const update = sinon.spy(store, 'updateDevice');
      const lock = sinon.spy(store, 'findAndLockDevice');
      const granter = new LeaseGranter(scratch.db, store, portClient as any, auth);

      const out = await granter.grant(
        { id: 'lse_t', status: 'waiting', durationMs: 600_000, heldKeys: new Set() },
        [{ udid: 't1', host: HOST, platform: 'android' } as any],
      );

      expect(out).to.equal('failed');
      expect(lock.firstCall.args[1]?.only).to.deep.equal(new Set([`t1@${HOST}`]));
      const twin = await twinRow();
      expect(twin?.busy).to.equal(false);
      expect(twin?.sessionStartTime, 'never locked').to.equal(lockedAtBefore);
      expect(update.called, 'no unconditional undo').to.equal(false);
    });

    it("the queue's lock never touches the twin", async () => {
      const store = DeviceStoreFactory.getStore();
      const update = sinon.spy(store, 'updateDevice');

      const locked = await (queue as any).lockPhone(`t1@${HOST}`);

      expect(locked).to.equal(null);
      const twin = await twinRow();
      expect(twin?.busy).to.equal(false);
      expect(twin?.sessionStartTime, 'never locked').to.equal(lockedAtBefore);
      expect(update.called, 'no unconditional undo').to.equal(false);
    });
  });

  describe('a grant', () => {
    it('leaves no member row outside 0..n-1, a negative leftover included', async () => {
      // A move cut short left a row under a temporary negative index.
      await waiter('lse_w', ['u1', 'u2']);
      await scratch.db.leaseMember.create({
        data: { leaseId: 'lse_w', index: -3, udid: 'u3', host: HOST, heldAt: Date.now() },
      });
      const granter = new LeaseGranter(
        scratch.db,
        DeviceStoreFactory.getStore(),
        portClient as any,
        auth,
      );

      const out = await granter.grant(
        { id: 'lse_w', status: 'waiting', durationMs: 600_000, heldKeys: new Set() },
        [
          { udid: 'u1', host: HOST, platform: 'android' } as any,
          { udid: 'u2', host: HOST, platform: 'android' } as any,
        ],
      );

      expect(out).to.equal('granted');
      const rows = await scratch.db.leaseMember.findMany({
        where: { leaseId: 'lse_w' },
        orderBy: { index: 'asc' },
      });
      expect(rows.map((r) => [r.index, r.udid])).to.deep.equal([
        [0, 'u1'],
        [1, 'u2'],
      ]);
    });
  });
});
