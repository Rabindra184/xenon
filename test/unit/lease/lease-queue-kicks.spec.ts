import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { onPhoneFreed } from '../../../src/services/lease/leaseQueueKick';
import { LeaseQueue } from '../../../src/services/lease/LeaseQueue';
import { DeviceStoreFactory } from '../../../src/data-service/device-store';
import {
  releasePendingClaim,
  releaseSessionDevice,
  unblockDevice,
} from '../../../src/data-service/device-service';
import { IDevice } from '../../../src/interfaces/IDevice';
import { prisma } from '../../../src/prisma';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { useLokiStores, usePrismaStores } from '../../helpers/loki-stores';
import { OWN_NODE_ID, useOwnNodeId } from '../../helpers/own-node-id';

// The writes that free or add a phone tell the lease queue (phoneFreed), so a
// waiting lease is served at once rather than at the next backstop pass. A
// pass also puts a lease's lock back on a phone that a live lease holds or
// leases but whose row says it is free (a hub's own rows, found again by
// discovery after a restart, start with `busy: false`).

const HOST = 'http://127.0.0.1:4723';
const NODE_HOST = 'http://10.0.0.9:4723';
const HOUR = 60 * 60 * 1000;

/** Counts phoneFreed() calls while subscribed. */
function countKicks() {
  const kicks = { count: 0, stop: () => {} };
  kicks.stop = onPhoneFreed(() => {
    kicks.count += 1;
  });
  return kicks;
}

const androidPhone = (udid: string, host: string, over: Partial<IDevice> = {}): IDevice =>
  ({
    udid,
    host,
    nodeId: OWN_NODE_ID,
    name: `Phone ${udid}`,
    platform: 'android',
    sdk: '13',
    busy: false,
    offline: false,
    userBlocked: false,
    deviceType: 'real',
    realDevice: true,
    ...over,
  }) as unknown as IDevice;

describe('kicks to the lease queue', () => {
  const scratch = useScratchDatabase();
  useOwnNodeId();

  let kicks: ReturnType<typeof countKicks>;

  beforeEach(() => {
    kicks = countKicks();
  });

  afterEach(() => {
    kicks.stop();
    sinon.restore();
  });

  describe('releases (Prisma store)', () => {
    usePrismaStores();

    const row = (udid: string, over: Record<string, unknown> = {}) =>
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
    const busy = async (udid: string) =>
      (await scratch.db.device.findUnique({ where: { udid_host: { udid, host: HOST } } }))?.busy;

    beforeEach(async () => {
      await scratch.db.lease.deleteMany({});
      await scratch.db.device.deleteMany({});
    });

    it('a session release that frees a phone kicks the queue', async () => {
      await row('A', { busy: true, claimedAt: 1, claimSessionId: 's1' });

      expect(await releaseSessionDevice('A', HOST, 's1')).to.equal(true);

      expect(await busy('A')).to.equal(false);
      expect(kicks.count).to.equal(1);
    });

    it("a release of a claim the phone no longer holds doesn't kick", async () => {
      await row('A', { busy: true, claimedAt: 1, claimSessionId: 's2' });

      expect(await releaseSessionDevice('A', HOST, 's1')).to.equal(false);

      expect(await busy('A')).to.equal(true);
      expect(kicks.count).to.equal(0);
    });

    it('a pending claim given back kicks the queue', async () => {
      await row('A', { busy: true, claimedAt: 5, claimSessionId: null });

      expect(await releasePendingClaim({ udid: 'A', host: HOST, claimedAt: 5 })).to.equal(true);

      expect(await busy('A')).to.equal(false);
      expect(kicks.count).to.equal(1);
    });

    it('a forced release kicks the queue', async () => {
      await row('A', { busy: true, session_id: 'manual_u1_A' });

      await unblockDevice('A', HOST);

      expect(await busy('A')).to.equal(false);
      expect(kicks.count).to.equal(1);
    });

    it("a forced release of no phone doesn't kick", async () => {
      await unblockDevice('missing', HOST);

      expect(kicks.count).to.equal(0);
    });
  });

  for (const [kind, useStores] of [
    ['Prisma', usePrismaStores],
    ['Loki', useLokiStores],
  ] as const) {
    describe(`a node's report and a phone added (${kind} store)`, () => {
      useStores();

      const store = () => DeviceStoreFactory.getStore();
      const udids = ['N1', 'N2', 'L1', 'L2'];

      const clear = async () => {
        for (const udid of udids) {
          await store().removeDevices({ udid } as Partial<IDevice>, { exactHost: true });
        }
      };

      beforeEach(clear);
      after(clear);

      const read = async (udid: string, host: string) =>
        (await store().findDevice({ udid, host } as Partial<IDevice>)) as IDevice;

      it('a phone added kicks the queue', async () => {
        const added = await store().addDevices([androidPhone('L1', HOST)]);

        expect(added.map((d) => d.udid)).to.deep.equal(['L1']);
        expect(kicks.count).to.equal(1);
      });

      it("a phone already here doesn't kick", async () => {
        await store().addDevices([androidPhone('L1', HOST)]);
        kicks.count = 0;

        expect(await store().addDevices([androidPhone('L1', HOST)])).to.deep.equal([]);

        expect(kicks.count).to.equal(0);
      });

      it('a node report that clears busy kicks the queue', async () => {
        await store().addDevices([androidPhone('N1', NODE_HOST, { nodeId: 'node-2' } as any)], {
          nodeReport: true,
        });
        await store().updateDevice('N1', NODE_HOST, { busy: true } as Partial<IDevice>);
        kicks.count = 0;

        await store().addDevices(
          [androidPhone('N1', NODE_HOST, { nodeId: 'node-2', busy: false } as any)],
          { nodeReport: true },
        );

        expect((await read('N1', NODE_HOST)).busy).to.equal(false);
        expect(kicks.count).to.equal(1);
      });

      it("a node report that frees nothing doesn't kick", async () => {
        for (const udid of ['N1', 'N2']) {
          await store().addDevices([androidPhone(udid, NODE_HOST, { nodeId: 'node-2' } as any)], {
            nodeReport: true,
          });
        }
        // N1: a claim of the hub's keeps it busy whatever the node says. N2:
        // free already.
        await store().updateDevice('N1', NODE_HOST, {
          busy: true,
          claimedAt: 7,
        } as Partial<IDevice>);
        kicks.count = 0;

        for (const udid of ['N1', 'N2']) {
          await store().addDevices(
            [androidPhone(udid, NODE_HOST, { nodeId: 'node-2', busy: false } as any)],
            { nodeReport: true },
          );
        }

        expect((await read('N1', NODE_HOST)).busy).to.equal(true);
        expect((await read('N2', NODE_HOST)).busy).to.equal(false);
        expect(kicks.count).to.equal(0);
      });

      it('a node report of a new phone kicks the queue', async () => {
        await store().addDevices([androidPhone('N1', NODE_HOST, { nodeId: 'node-2' } as any)], {
          nodeReport: true,
        });

        expect(kicks.count).to.equal(1);
      });
    });
  }

  describe('a pass puts back the lease lock on a rediscovered phone', () => {
    usePrismaStores();

    let queue: LeaseQueue;

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

    async function lease(
      id: string,
      status: string,
      memberUdids: string[],
      over: Record<string, unknown> = {},
    ): Promise<void> {
      await scratch.db.lease.create({
        data: {
          id,
          tokenHash: 'h',
          deviceUdid: status === 'active' ? memberUdids[0] : '',
          deviceHost: status === 'active' ? HOST : '',
          actorId: 'key_owner',
          status,
          waitUntil: status === 'waiting' ? Date.now() + HOUR : null,
          expiresAt: status === 'active' ? Date.now() + HOUR : 0,
          heartbeatSeconds: 30,
          lastHeartbeatAt: Date.now(),
          allocatedPorts: '{}',
          capabilityBag: '',
          requestedMembers: JSON.stringify(
            memberUdids.map((udid) => ({ platform: 'android', udid })),
          ),
          durationMs: 600_000,
          createdAt: new Date(Date.now() - HOUR),
          members: {
            create: memberUdids.map((udid, index) => ({
              index,
              udid,
              host: HOST,
              heldAt: Date.now(),
              ...(status === 'active' ? { allocatedPorts: '{}' } : {}),
            })),
          },
          ...over,
        } as any,
      });
    }

    const device = (udid: string) =>
      scratch.db.device.findUnique({ where: { udid_host: { udid, host: HOST } } });
    const memberUdids = async (leaseId: string) =>
      (
        await scratch.db.leaseMember.findMany({ where: { leaseId }, orderBy: { index: 'asc' } })
      ).map((m: any) => m.udid);

    beforeEach(async () => {
      await scratch.db.portLease.deleteMany({});
      await scratch.db.lease.deleteMany({});
      await scratch.db.device.deleteMany({});
      queue = new LeaseQueue(
        prisma,
        DeviceStoreFactory.getStore(),
        { allocate: sinon.stub().rejects(new Error('no grant here')), release: sinon.stub() },
        { nodePairAuth: async () => ({ accessKey: '', token: '' }) },
      );
    });

    afterEach(() => queue.stop());

    it("re-locks a waiter's held phone whose row was recreated free, and keeps the hold", async () => {
      // B is busy with a session: the waiter holds A and waits for B.
      await phone('A');
      await phone('B', { busy: true, claimedAt: 1, claimSessionId: 's1' });
      await lease('lse_wait', 'waiting', ['A']);
      await scratch.db.lease.update({
        where: { id: 'lse_wait' },
        data: {
          requestedMembers: JSON.stringify([
            { platform: 'android', udid: 'A' },
            { platform: 'android', udid: 'B' },
          ]),
        },
      });

      await queue.pass();

      expect((await device('A'))?.busy).to.equal(true);
      expect(await memberUdids('lse_wait')).to.deep.equal(['A']);
      expect((await scratch.db.lease.findUnique({ where: { id: 'lse_wait' } }))?.status).to.equal(
        'waiting',
      );
      // The session's phone is left as it was.
      const b = await device('B');
      expect(b?.busy).to.equal(true);
      expect(b?.claimSessionId).to.equal('s1');
    });

    it("re-locks an active lease's member whose row was recreated free", async () => {
      await phone('A');
      await phone('B');
      await lease('lse_active', 'active', ['A', 'B']);

      await queue.pass();

      expect((await device('A'))?.busy).to.equal(true);
      expect((await device('B'))?.busy).to.equal(true);
      expect(await memberUdids('lse_active')).to.deep.equal(['A', 'B']);
      expect((await scratch.db.lease.findUnique({ where: { id: 'lse_active' } }))?.status).to.equal(
        'active',
      );
    });

    it("leaves a phone a session or hold has, and an ended lease's phone, as they are", async () => {
      await phone('A', { session_id: 'manual_u1_A' });
      await phone('B');
      await lease('lse_active', 'active', ['A']);
      await lease('lse_done', 'released', ['B']);

      await queue.pass();

      expect((await device('A'))?.busy).to.equal(false);
      expect((await device('B'))?.busy).to.equal(false);
    });

    it('undoes the lock when the lease ended while it was written', async () => {
      await phone('A');
      await lease('lse_active', 'active', ['A']);
      const real = DeviceStoreFactory.getStore();
      // The holder's release lands between the pass's read and its write.
      const racing = Object.create(real);
      let lockedOnce: boolean | null | undefined;
      racing.updateDevice = async (...args: Parameters<typeof real.updateDevice>) => {
        await scratch.db.lease.update({
          where: { id: 'lse_active' },
          data: { status: 'released' },
        });
        const written = await real.updateDevice(...args);
        lockedOnce = (await device('A'))?.busy;
        return written;
      };
      const raced = new LeaseQueue(
        prisma,
        racing,
        { allocate: sinon.stub().rejects(new Error('no grant here')), release: sinon.stub() },
        { nodePairAuth: async () => ({ accessKey: '', token: '' }) },
      );

      await raced.pass();

      expect(lockedOnce, 'the lock was written, then undone').to.equal(true);
      expect((await device('A'))?.busy).to.equal(false);
    });

    it("locks the other phones again when one phone's write fails", async () => {
      await phone('A');
      await phone('B');
      await lease('lse_active', 'active', ['A', 'B']);
      const real = DeviceStoreFactory.getStore();
      const failing = Object.create(real);
      failing.updateDevice = async (...args: Parameters<typeof real.updateDevice>) => {
        if (args[0] === 'A') throw new Error('database is locked');
        return real.updateDevice(...args);
      };
      const partly = new LeaseQueue(
        prisma,
        failing,
        { allocate: sinon.stub().rejects(new Error('no grant here')), release: sinon.stub() },
        { nodePairAuth: async () => ({ accessKey: '', token: '' }) },
      );

      await partly.pass();

      expect((await device('A'))?.busy).to.equal(false);
      expect((await device('B'))?.busy, 'not kept free by A').to.equal(true);
    });

    it("leaves a lapsed lease's phone free", async () => {
      await phone('A');
      await lease('lse_lapsed', 'active', ['A'], { expiresAt: Date.now() - 1_000 });

      await queue.pass();

      expect((await device('A'))?.busy).to.equal(false);
    });
  });
});
