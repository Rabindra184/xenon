import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  LeaseOrphanSweeper,
  memberLossReason,
} from '../../../src/services/lease/LeaseOrphanSweeper';
import { LeaseQueue } from '../../../src/services/lease/LeaseQueue';
import { onPhoneFreed } from '../../../src/services/lease/leaseQueueKick';
import { DeviceStoreFactory } from '../../../src/data-service/device-store';
import { prisma } from '../../../src/prisma';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { usePrismaStores } from '../../helpers/loki-stores';
import { OWN_NODE_ID, useOwnNodeId } from '../../helpers/own-node-id';

// Every 30 s the sweeper ends a waiting lease whose wait ran out or whose
// client went quiet, ends an active group that lost a phone (gone, unhealthy
// or blocked), and lets a waiting lease drop a held phone that is gone. A
// phone whose row is missing counts as gone only on the second sweep in a
// row: a hub clears its own rows at boot and finds the phones again.

const HOST = 'http://127.0.0.1:4723';
const HOUR = 60 * 60 * 1000;
const PORTS: Record<string, number> = { u1: 8301, u2: 8302, u3: 8303, u4: 8304 };

describe('LeaseOrphanSweeper: waiters and groups', () => {
  const scratch = useScratchDatabase();
  usePrismaStores();
  useOwnNodeId();

  let portClient: { allocate: sinon.SinonStub; release: sinon.SinonStub };
  const auth = { nodePairAuth: async () => ({ accessKey: '', token: '' }) };
  let queue: LeaseQueue;
  let sweeper: LeaseOrphanSweeper;
  let kicks: number;
  let unsubscribe: () => void;

  const phone = (udid: string, over: Record<string, unknown> = {}) =>
    scratch.db.device.create({
      data: {
        udid,
        host: HOST,
        nodeId: OWN_NODE_ID,
        name: `Phone ${udid}`,
        platform: 'android',
        sdk: '13',
        busy: true,
        offline: false,
        userBlocked: false,
        deviceType: 'real',
        ...over,
      } as any,
    });

  const dropRow = (udid: string) => scratch.db.device.deleteMany({ where: { udid, host: HOST } });

  /** An active lease of these phones, member i on udids[i], each with one port row. */
  async function group(id: string, udids: string[], over: Record<string, unknown> = {}) {
    const now = Date.now();
    await scratch.db.lease.create({
      data: {
        id,
        tokenHash: 'h',
        deviceUdid: udids[0],
        deviceHost: HOST,
        actorId: 'key_owner',
        status: 'active',
        expiresAt: now + HOUR,
        heartbeatSeconds: 30,
        lastHeartbeatAt: now,
        allocatedPorts: JSON.stringify({ systemPort: PORTS[udids[0]] }),
        capabilityBag: '',
        ...over,
        members: {
          create: udids.map((udid, index) => ({
            index,
            udid,
            host: HOST,
            heldAt: now,
            allocatedPorts: JSON.stringify({ systemPort: PORTS[udid] }),
          })),
        },
      },
    });
    for (const udid of udids) {
      await scratch.db.portLease.create({
        data: {
          port: PORTS[udid],
          purpose: 'systemPort',
          leasedToUdid: udid,
          leasedToHost: HOST,
          leaseId: id,
          leasedAt: now,
          expiresAt: now + HOUR,
        },
      });
    }
  }

  /** A waiting lease of `members` phones, holding `holds[i]` for member i. */
  async function waiter(
    id: string,
    members: number,
    holds: string[],
    over: Record<string, unknown> = {},
  ) {
    const now = Date.now();
    await scratch.db.lease.create({
      data: {
        id,
        tokenHash: 'h',
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
        requestedMembers: JSON.stringify(
          Array.from({ length: members }, () => ({ platform: 'android', udid: 'nobody' })),
        ),
        durationMs: 600_000,
        ...over,
        members: {
          create: holds.map((udid, index) => ({ index, udid, host: HOST, heldAt: now })),
        },
      },
    });
  }

  const lease = (id: string) => scratch.db.lease.findUnique({ where: { id } });
  const memberUdids = async (leaseId: string) =>
    (await scratch.db.leaseMember.findMany({ where: { leaseId }, orderBy: { index: 'asc' } })).map(
      (m) => m.udid,
    );
  const busy = async (udid: string) =>
    (await scratch.db.device.findUnique({ where: { udid_host: { udid, host: HOST } } }))?.busy;
  const ports = async (leaseId: string) =>
    (await scratch.db.portLease.findMany({ where: { leaseId } })).map((p) => p.port);

  beforeEach(async () => {
    await scratch.db.portLease.deleteMany({});
    await scratch.db.lease.deleteMany({});
    await scratch.db.device.deleteMany({});
    for (const udid of ['u1', 'u2', 'u3', 'u4']) await phone(udid);
    portClient = {
      allocate: sinon.stub().rejects(new Error('no grant in these tests')),
      release: sinon.stub().resolves({ released: 1 }),
    };
    const store = DeviceStoreFactory.getStore();
    queue = new LeaseQueue(prisma, store, portClient, auth);
    sweeper = new LeaseOrphanSweeper(prisma, store, portClient, auth, queue);
    kicks = 0;
    unsubscribe = onPhoneFreed(() => {
      kicks += 1;
    });
  });

  afterEach(async () => {
    unsubscribe();
    await queue.idle();
    queue.stop();
    await sweeper.phoneServerCallsSettled();
    sinon.restore();
  });

  describe('a waiting lease', () => {
    it('expires a waiter past its waitUntil and releases its held phones', async () => {
      await waiter('lse_w', 2, ['u1', 'u2'], { waitUntil: Date.now() - 1_000 });

      await sweeper.sweep();

      expect((await lease('lse_w'))?.status).to.equal('expired');
      expect(await memberUdids('lse_w')).to.deep.equal([]);
      expect(await busy('u1')).to.equal(false);
      expect(await busy('u2')).to.equal(false);
    });

    it('expires a waiter that missed three heartbeats', async () => {
      await waiter('lse_w', 1, ['u1'], { lastHeartbeatAt: Date.now() - 120_000 });

      await sweeper.sweep();

      expect((await lease('lse_w'))?.status).to.equal('expired');
      expect(await busy('u1')).to.equal(false);
    });

    it('leaves a waiter inside its wait whose client heartbeats alone', async () => {
      await waiter('lse_w', 1, ['u1'], { lastHeartbeatAt: Date.now() - 60_000 });

      await sweeper.sweep();

      expect((await lease('lse_w'))?.status).to.equal('waiting');
      expect(await memberUdids('lse_w')).to.deep.equal(['u1']);
      expect(await busy('u1')).to.equal(true);
    });

    it('drops a lost held phone and keeps the waiter waiting', async () => {
      await waiter('lse_w', 2, ['u1', 'u2']);
      await dropRow('u2');

      await sweeper.sweep();
      expect(await memberUdids('lse_w'), 'one sweep: the row may come back').to.deep.equal([
        'u1',
        'u2',
      ]);

      await sweeper.sweep();
      expect((await lease('lse_w'))?.status).to.equal('waiting');
      expect(await memberUdids('lse_w')).to.deep.equal(['u1']);
      expect(await busy('u1'), 'the other hold is kept').to.equal(true);
    });

    it('drops a blocked held phone at once, an unhealthy one on the second sweep in a row', async () => {
      await waiter('lse_w', 3, ['u1', 'u2', 'u3']);
      await scratch.db.device.updateMany({
        where: { udid: 'u2' },
        data: { healthStatus: 'Unhealthy' },
      });
      await scratch.db.device.updateMany({ where: { udid: 'u3' }, data: { userBlocked: true } });

      await sweeper.sweep();

      expect((await lease('lse_w'))?.status).to.equal('waiting');
      expect(await memberUdids('lse_w'), 'one sweep: the check may be wrong').to.deep.equal([
        'u1',
        'u2',
      ]);
      expect(await busy('u2')).to.equal(true);
      expect(await busy('u3')).to.equal(false);

      await sweeper.sweep();

      expect((await lease('lse_w'))?.status).to.equal('waiting');
      expect(await memberUdids('lse_w')).to.deep.equal(['u1']);
      expect(await busy('u2')).to.equal(false);
    });
  });

  describe('an active group', () => {
    it("ends a group whose member's phone is gone, with that reason, and releases the rest", async () => {
      await group('lse_g', ['u1', 'u2']);
      await dropRow('u2');

      await sweeper.sweep();
      await sweeper.sweep();

      const row = await lease('lse_g');
      expect(row?.status).to.equal('ended');
      expect(row?.endReason).to.equal('member 1 (u2) disconnected');
      expect(await busy('u1'), "member 0's lock is released").to.equal(false);
      expect(await ports('lse_g'), 'its ports are freed').to.deep.equal([]);
    });

    it('ends a group whose member is blocked at once, or unhealthy on two sweeps in a row', async () => {
      await group('lse_sick', ['u1', 'u2']);
      await group('lse_blocked', ['u3', 'u4']);
      await scratch.db.device.updateMany({
        where: { udid: 'u2' },
        data: { healthStatus: 'Unhealthy' },
      });
      await scratch.db.device.updateMany({ where: { udid: 'u4' }, data: { userBlocked: true } });

      await sweeper.sweep();

      expect((await lease('lse_blocked'))?.status, 'blocked: at once').to.equal('ended');
      expect((await lease('lse_sick'))?.status, 'unhealthy once: not yet').to.equal('active');
      expect(await busy('u1')).to.equal(true);

      await sweeper.sweep();

      const sick = await lease('lse_sick');
      expect(sick?.status).to.equal('ended');
      expect(sick?.endReason).to.equal('member 1 (u2) is unhealthy');
      const blocked = await lease('lse_blocked');
      expect(blocked?.status).to.equal('ended');
      expect(blocked?.endReason).to.equal('member 1 (u4) was blocked by an admin');
      for (const udid of ['u1', 'u2', 'u3', 'u4']) expect(await busy(udid), udid).to.equal(false);
      expect(await ports('lse_sick')).to.deep.equal([]);
      expect(await ports('lse_blocked')).to.deep.equal([]);
    });

    it('expires a group past expiresAt, as a single lease', async () => {
      await group('lse_g', ['u1', 'u2'], { expiresAt: Date.now() - 1_000 });

      await sweeper.sweep();

      const row = await lease('lse_g');
      expect(row?.status).to.equal('expired');
      expect(row?.endReason).to.equal(null);
      expect(await busy('u1')).to.equal(false);
      expect(await busy('u2')).to.equal(false);
    });

    it('releases a group once when two sweeps race to end it', async () => {
      await group('lse_g', ['u1', 'u2']);
      await scratch.db.device.updateMany({ where: { udid: 'u2' }, data: { userBlocked: true } });
      const store = DeviceStoreFactory.getStore();
      const release = sinon.spy(store, 'releaseLeaseLock');
      // Both sweeps have read the lease as active before either ends it: the
      // first lookup of each waits until the other's has arrived too.
      const lookUp = store.findDevice.bind(store);
      let arrived = 0;
      let meet!: () => void;
      const together = new Promise<void>((resolve) => {
        meet = resolve;
      });
      sinon.stub(store, 'findDevice').callsFake(async (filter: any) => {
        arrived += 1;
        if (arrived === 2) meet();
        await together;
        return lookUp(filter);
      });
      const other = new LeaseOrphanSweeper(prisma, store, portClient, auth, queue);

      await Promise.all([sweeper.sweep(), other.sweep()]);

      expect(arrived, 'both sweeps looked at the members').to.equal(4);
      expect((await lease('lse_g'))?.status).to.equal('ended');
      expect(release.callCount, 'one release per member').to.equal(2);
    });

    it('a sweep called while one runs waits for that one', async () => {
      await group('lse_g', ['u1', 'u2']);
      const lookups = sinon.spy(DeviceStoreFactory.getStore(), 'findDevice');

      await Promise.all([sweeper.sweep(), sweeper.sweep()]);

      expect(lookups.callCount, 'one sweep: one lookup per member').to.equal(2);
    });
  });

  describe('a missing row counts only on the second sweep in a row', () => {
    it('a missing row on one sweep ends nothing', async () => {
      await group('lse_g', ['u1', 'u2']);
      await dropRow('u2');

      await sweeper.sweep();

      expect((await lease('lse_g'))?.status).to.equal('active');
      expect(await busy('u1')).to.equal(true);
      expect(await ports('lse_g')).to.have.members([PORTS.u1, PORTS.u2]);
    });

    it('a row that comes back in between starts the count again', async () => {
      await group('lse_g', ['u1', 'u2']);
      await dropRow('u2');
      await sweeper.sweep();
      await phone('u2');
      await sweeper.sweep();
      await dropRow('u2');
      await sweeper.sweep();

      expect((await lease('lse_g'))?.status, 'missing once since it came back').to.equal('active');

      await sweeper.sweep();
      const row = await lease('lse_g');
      expect(row?.status).to.equal('ended');
      expect(row?.endReason).to.equal('member 1 (u2) disconnected');
    });

    it('a lookup that fails keeps the count a missing row had', async () => {
      await group('lse_g', ['u1', 'u2', 'u3']);
      await dropRow('u3');
      await sweeper.sweep();
      const store = DeviceStoreFactory.getStore();
      const lookUp = store.findDevice.bind(store);
      const failing = sinon.stub(store, 'findDevice').callsFake(async (filter: any) => {
        if (filter.udid === 'u3') throw new Error('database is locked');
        return lookUp(filter);
      });

      await sweeper.sweep();
      expect((await lease('lse_g'))?.status, 'a failed lookup ends nothing').to.equal('active');

      failing.restore();
      await sweeper.sweep();
      const row = await lease('lse_g');
      expect(row?.status, 'missing on the sweeps either side of the failure').to.equal('ended');
      expect(row?.endReason).to.equal('member 2 (u3) disconnected');
    });

    it("a member's failed lookup doesn't stop the others' being looked at", async () => {
      await group('lse_g', ['u1', 'u2', 'u3']);
      await dropRow('u3');
      await sweeper.sweep();
      const store = DeviceStoreFactory.getStore();
      const lookUp = store.findDevice.bind(store);
      sinon.stub(store, 'findDevice').callsFake(async (filter: any) => {
        if (filter.udid === 'u1') throw new Error('database is locked');
        return lookUp(filter);
      });

      await sweeper.sweep();

      const row = await lease('lse_g');
      expect(row?.status).to.equal('ended');
      expect(row?.endReason).to.equal('member 2 (u3) disconnected');
    });

    it("a restarted server's first sweep ends nothing for a missing row", async () => {
      await group('lse_g', ['u1', 'u2']);
      await dropRow('u2');
      await sweeper.sweep();

      const restarted = new LeaseOrphanSweeper(
        prisma,
        DeviceStoreFactory.getStore(),
        portClient,
        auth,
        queue,
      );
      await restarted.sweep();

      expect((await lease('lse_g'))?.status).to.equal('active');
    });
  });

  describe('an unhealthy phone counts only on the second sweep in a row', () => {
    it("a member unhealthy on one sweep doesn't end the group; on the second in a row it does", async () => {
      await group('lse_g', ['u1', 'u2']);
      await scratch.db.device.updateMany({
        where: { udid: 'u2' },
        data: { healthStatus: 'Unhealthy' },
      });

      await sweeper.sweep();
      expect((await lease('lse_g'))?.status).to.equal('active');
      expect(await busy('u1')).to.equal(true);
      expect(await ports('lse_g')).to.have.members([PORTS.u1, PORTS.u2]);

      await sweeper.sweep();
      const row = await lease('lse_g');
      expect(row?.status).to.equal('ended');
      expect(row?.endReason).to.equal('member 1 (u2) is unhealthy');
    });

    it('a phone healthy again in between starts the count again', async () => {
      await group('lse_g', ['u1', 'u2']);
      const health = (healthStatus: string) =>
        scratch.db.device.updateMany({ where: { udid: 'u2' }, data: { healthStatus } });
      await health('Unhealthy');
      await sweeper.sweep();
      await health('Healthy');
      await sweeper.sweep();
      await health('Unhealthy');
      await sweeper.sweep();

      expect((await lease('lse_g'))?.status, 'unhealthy once since it was well').to.equal('active');

      await sweeper.sweep();
      expect((await lease('lse_g'))?.status).to.equal('ended');
    });

    it("a restarted server's first sweep ends nothing for an unhealthy phone", async () => {
      await group('lse_g', ['u1', 'u2']);
      await scratch.db.device.updateMany({
        where: { udid: 'u2' },
        data: { healthStatus: 'Unhealthy' },
      });
      await sweeper.sweep();

      const restarted = new LeaseOrphanSweeper(
        prisma,
        DeviceStoreFactory.getStore(),
        portClient,
        auth,
        queue,
      );
      await restarted.sweep();

      expect((await lease('lse_g'))?.status).to.equal('active');
    });
  });

  describe('a single lease', () => {
    it('keeps its phone through a disconnect, an unhealthy phone or a block, as before', async () => {
      await group('lse_gone', ['u1']);
      await group('lse_sick', ['u2']);
      await group('lse_blocked', ['u3']);
      await dropRow('u1');
      await scratch.db.device.updateMany({
        where: { udid: 'u2' },
        data: { healthStatus: 'Unhealthy' },
      });
      await scratch.db.device.updateMany({ where: { udid: 'u3' }, data: { userBlocked: true } });
      const lookups = sinon.spy(DeviceStoreFactory.getStore(), 'findDevice');

      await sweeper.sweep();
      await sweeper.sweep();

      for (const id of ['lse_gone', 'lse_sick', 'lse_blocked']) {
        const row = await lease(id);
        expect(row?.status, id).to.equal('active');
        expect(row?.endReason, id).to.equal(null);
      }
      expect(await busy('u2')).to.equal(true);
      expect(await busy('u3')).to.equal(true);
      expect(await ports('lse_sick')).to.deep.equal([PORTS.u2]);
      expect(lookups.called, "a single lease's phone isn't looked up").to.equal(false);
    });
  });

  describe('the queue', () => {
    it('kicks the queue after it frees phones', async () => {
      await sweeper.sweep();
      expect(kicks, 'a sweep that frees nothing').to.equal(0);

      await group('lse_a', ['u1', 'u4']);
      await group('lse_b', ['u2'], { expiresAt: Date.now() - 1_000 });
      await waiter('lse_w', 1, ['u3'], { waitUntil: Date.now() - 1_000 });
      await scratch.db.device.updateMany({ where: { udid: 'u1' }, data: { userBlocked: true } });

      await sweeper.sweep();

      expect((await lease('lse_a'))?.status).to.equal('ended');
      expect((await lease('lse_b'))?.status).to.equal('expired');
      expect((await lease('lse_w'))?.status).to.equal('expired');
      expect(kicks, 'once for the sweep').to.equal(1);

      await waiter('lse_w2', 2, ['u3', 'u4']);
      await scratch.db.device.updateMany({
        where: { udid: 'u4' },
        data: { healthStatus: 'Unhealthy' },
      });
      await sweeper.sweep();
      expect(kicks, 'unhealthy once: nothing dropped').to.equal(1);
      await sweeper.sweep();
      expect(await memberUdids('lse_w2')).to.deep.equal(['u3']);
      expect(kicks, 'a dropped hold kicks too').to.equal(2);
    });
  });
});

describe('memberLossReason', () => {
  const member = { index: 1, udid: 'u2', host: HOST };
  const device = (over: Record<string, unknown> = {}) =>
    ({ udid: 'u2', host: HOST, userBlocked: false, healthStatus: 'Healthy', ...over }) as any;

  it('names a phone whose row is gone', () => {
    expect(memberLossReason(member, null)).to.equal('member 1 (u2) disconnected');
  });

  it('names an unhealthy phone', () => {
    expect(memberLossReason(member, device({ healthStatus: 'Unhealthy' }))).to.equal(
      'member 1 (u2) is unhealthy',
    );
  });

  it('names a phone an admin blocked', () => {
    expect(memberLossReason(member, device({ userBlocked: true }))).to.equal(
      'member 1 (u2) was blocked by an admin',
    );
  });

  it('names the block of a phone that is blocked and unhealthy: a block ends a group at once', () => {
    expect(
      memberLossReason(member, device({ userBlocked: true, healthStatus: 'Unhealthy' })),
    ).to.equal('member 1 (u2) was blocked by an admin');
  });

  it('is null for a phone that is still there and well', () => {
    expect(memberLossReason(member, device())).to.equal(null);
  });
});
