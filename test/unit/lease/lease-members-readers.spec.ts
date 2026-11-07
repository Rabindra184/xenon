import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../../helpers/loopbackRequest';
import ControlRouter from '../../../src/app/routers/control';
import { DeviceStoreFactory } from '../../../src/data-service/device-store';
import { IDevice } from '../../../src/interfaces/IDevice';
import {
  activeLeaseOn,
  activeLeasesByDevice,
  leaseKey,
  leasedDeviceKeys,
} from '../../../src/services/lease/activeLeases';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { useLokiStores, usePrismaStores } from '../../helpers/loki-stores';
import { OWN_NODE_ID, useOwnNodeId } from '../../helpers/own-node-id';
import { seedUser } from '../../helpers/seedUser';

// A lease's phones are its member rows. A member of a waiting lease is a
// phone held for it, and every reader that asks whether a phone is leased
// treats it as one: allocation skips it, and the ownership guard refuses it
// to anyone but the lease's holder.

const HOST = 'http://127.0.0.1:4723';
const A = 'held-a';
const B = 'free-b';

describe('a lease holds its phones through its member rows', () => {
  const scratch = useScratchDatabase();
  useOwnNodeId();

  const HOUR = 60 * 60 * 1000;

  /** A lease with a member row on each of `udids`, in order. */
  const seedLease = (udids: string[], over: Record<string, unknown> = {}) =>
    scratch.db.lease.create({
      data: {
        tokenHash: 'h',
        deviceUdid: '',
        deviceHost: '',
        actorId: 'key_owner',
        status: 'waiting',
        waitUntil: Date.now() + HOUR,
        expiresAt: 0,
        lastHeartbeatAt: Date.now(),
        allocatedPorts: '{}',
        capabilityBag: '',
        ...over,
        members: {
          create: udids.map((udid, index) => ({ index, udid, host: HOST, heldAt: Date.now() })),
        },
      },
    });

  const phone = (udid: string) =>
    ({
      udid,
      name: udid,
      platform: 'android',
      sdk: '13',
      host: HOST,
      nodeId: OWN_NODE_ID,
      busy: false,
      offline: false,
      userBlocked: false,
      state: 'device',
      deviceType: 'real',
      realDevice: true,
      totalUtilizationTimeMilliSec: 0,
      sessionStartTime: 0,
    }) as unknown as IDevice;

  beforeEach(async () => {
    // Deleting a lease deletes its members.
    await scratch.db.lease.deleteMany({});
  });

  describe('the lease readers', () => {
    it("a waiting lease's held phone reads as leased, with status waiting", async () => {
      const lease = await seedLease([A]);

      const on = await activeLeaseOn(A, HOST);
      expect(on).to.deep.equal({
        id: lease.id,
        deviceUdid: A,
        deviceHost: HOST,
        actorId: 'key_owner',
        status: 'waiting',
      });
      expect((await activeLeasesByDevice()).has(leaseKey(A, HOST))).to.equal(true);
      expect((await leasedDeviceKeys()).has(leaseKey(A, HOST))).to.equal(true);
    });

    it('a waiting lease past its waitUntil holds nothing', async () => {
      await seedLease([A], { waitUntil: Date.now() - 1_000 });

      expect(await activeLeaseOn(A, HOST)).to.equal(null);
      expect((await activeLeasesByDevice()).has(leaseKey(A, HOST))).to.equal(false);
    });

    it("an active lease's members read as leased, with status active", async () => {
      const lease = await seedLease([A, B], {
        status: 'active',
        waitUntil: null,
        expiresAt: Date.now() + HOUR,
      });

      expect((await activeLeaseOn(B, HOST))?.status).to.equal('active');
      const byDevice = await activeLeasesByDevice();
      expect(byDevice.get(leaseKey(A, HOST))?.id).to.equal(lease.id);
      expect(byDevice.get(leaseKey(B, HOST))?.id).to.equal(lease.id);
    });

    it('an active lease past its expiresAt holds nothing', async () => {
      await seedLease([A], { status: 'active', waitUntil: null, expiresAt: Date.now() - 1_000 });

      expect(await activeLeaseOn(A, HOST)).to.equal(null);
    });

    it('a lease that has ended holds nothing, whatever its member rows say', async () => {
      for (const status of ['released', 'expired', 'ended']) {
        await seedLease([A], { status, expiresAt: Date.now() + HOUR });
      }

      expect(await activeLeaseOn(A, HOST)).to.equal(null);
      expect((await activeLeasesByDevice()).size).to.equal(0);
      expect((await leasedDeviceKeys()).size).to.equal(0);
    });

    it("an active lease's own device columns hold nothing without a member row", async () => {
      // Member rows are the one source: the backfill at boot writes member 0
      // for a lease from before group leases.
      await scratch.db.lease.create({
        data: {
          tokenHash: 'h',
          deviceUdid: A,
          deviceHost: HOST,
          actorId: 'key_owner',
          status: 'active',
          expiresAt: Date.now() + HOUR,
          lastHeartbeatAt: Date.now(),
          allocatedPorts: '{}',
          capabilityBag: '',
        },
      });

      expect(await activeLeaseOn(A, HOST)).to.equal(null);
    });

    it('leasedDeviceKeys keeps a lapsed lease, as the stores always have', async () => {
      // Allocation leaves a lapsed lease's phone alone until the sweeper ends
      // the lease: the stores' rule has never checked the time.
      await seedLease([A], { waitUntil: Date.now() - 1_000 });
      await seedLease([B], { status: 'active', waitUntil: null, expiresAt: Date.now() - 1_000 });

      const keys = await leasedDeviceKeys();
      expect([...keys].sort()).to.deep.equal([leaseKey(A, HOST), leaseKey(B, HOST)].sort());
    });
  });

  for (const [name, useStores] of [
    ['Prisma', usePrismaStores],
    ['Loki', useLokiStores],
  ] as const) {
    describe(`allocation (${name} store)`, () => {
      useStores();

      beforeEach(async () => {
        const store = DeviceStoreFactory.getStore();
        await store.removeDevices({ udid: A });
        await store.removeDevices({ udid: B });
        await store.addDevices([phone(A), phone(B)]);
      });

      after(async () => {
        // Loki is one collection for the whole process.
        const store = DeviceStoreFactory.getStore();
        await store.removeDevices({ udid: A });
        await store.removeDevices({ udid: B });
      });

      it('findAndLockDevice skips a held phone it would otherwise lock', async () => {
        const store = DeviceStoreFactory.getStore();
        const filter = { platform: 'android', udid: [A, B] } as any;
        // The control: with no lease, the phone the store locks first. The
        // stores don't promise an order, so that phone is the one held below.
        const first = (await store.findAndLockDevice(filter))?.udid as string;
        expect([A, B]).to.include(first);
        await store.updateDevice(first, HOST, { busy: false });
        const other = first === A ? B : A;

        await seedLease([first]);
        const locked = await store.findAndLockDevice(filter);

        expect(locked?.udid).to.equal(other);
        const held = await store.findDevice({ udid: first });
        expect(held?.busy).to.equal(false);
      });
    });
  }

  describe('the ownership guard on /control', () => {
    usePrismaStores();

    const app = (userId: string) => {
      const out = express();
      out.use(express.json());
      const api = express.Router();
      api.use((req, _res, next) => {
        (req as any).auth = {
          kind: 'user-session',
          userId,
          role: 'MEMBER',
          scopes: 'devices,sessions,read',
          teamIds: [],
          rateLimit: 100,
        };
        next();
      });
      ControlRouter.register(api);
      out.use('/xenon/api', api);
      return out;
    };

    beforeEach(async () => {
      const store = DeviceStoreFactory.getStore();
      await store.removeDevices({ udid: A });
      await store.addDevices([phone(A)]);
    });

    it("someone else's stream/start on a held phone is refused, saying it is held for a waiting lease", async () => {
      const alice = await seedUser('MEMBER', { name: 'Alice' });
      await seedLease([A], { actorId: alice.user.id });

      const res = await request(app('usr_bob')).post(`/xenon/api/control/${A}/stream/start`);

      expect(res.status, JSON.stringify(res.body)).to.equal(409);
      expect(res.body.error).to.equal('device_held_by_another_user');
      expect(res.body.message).to.contain('held for a waiting lease');
      expect(res.body.message).to.contain(alice.user.email);
      expect(res.body.holder.userId).to.equal(alice.user.id);
    });

    it("someone else's tap on a held phone is refused the same way", async () => {
      const alice = await seedUser('MEMBER', { name: 'Alice' });
      await seedLease([A], { actorId: alice.user.id });

      const res = await request(app('usr_bob')).post(`/xenon/api/control/${A}/tap`).send({});

      expect(res.status, JSON.stringify(res.body)).to.equal(409);
      expect(res.body.error).to.equal('device_held_by_another_user');
      expect(res.body.message).to.contain('held for a waiting lease');
    });
  });
});
