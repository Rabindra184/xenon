import 'reflect-metadata';
import { expect } from 'chai';
import loki from 'lokijs';
import sinon from 'sinon';
import { LeaseOrphanSweeper } from '../../../src/services/lease/LeaseOrphanSweeper';
import { LeaseService } from '../../../src/services/lease/LeaseService';
import { hashToken } from '../../../src/services/lease/leaseToken';
import { DeviceStoreFactory } from '../../../src/data-service/device-store';
import { PrismaDeviceStore } from '../../../src/data-service/prisma-store';
import { XenonDatabase } from '../../../src/data-service/db';
import { IDeviceStore } from '../../../src/data-service/device-store.interface';
import { useScratchDatabase } from '../../helpers/scratch-database';

/**
 * A lease locks its phone with `busy` alone. A session created on the lease
 * claims the phone too (claimForSession). Ending the lease (a reap at
 * expiresAt or on missed heartbeats, or its holder's release) wrote
 * `busy: false` unconditionally, so a session that outlived its lease had
 * its phone handed to another session mid-run.
 *
 * #375's rule (deviceClaims.ts, UNHELD) applies: clear `busy` only where
 * nothing else holds the phone. The session's own release frees it later.
 *
 * Both stores run for real: Prisma on a scratch SQLite file, Loki on an
 * in-memory collection.
 */

const UDID = 'leased-phone-1';
const HOST = 'http://127.0.0.1:4723';
const TOKEN = 'd'.repeat(64);

function lokiStore(): IDeviceStore {
  // The factory only makes a Loki store under NODE_ENV=test; take it without
  // keeping it as the process's store.
  const factory = DeviceStoreFactory as any;
  const saved = factory._deviceStore;
  const savedEnv = process.env.NODE_ENV;
  factory._deviceStore = undefined;
  process.env.NODE_ENV = 'test';
  try {
    return DeviceStoreFactory.getStore();
  } finally {
    process.env.NODE_ENV = savedEnv;
    factory._deviceStore = saved;
  }
}

describe('ending a lease frees only a phone nothing else holds', () => {
  const scratch = useScratchDatabase();
  let now: number;

  async function lease(over: { expiresAt: number; lastHeartbeatAt: number }) {
    await scratch.db.lease.create({
      data: {
        id: 'lse_held',
        tokenHash: hashToken(TOKEN),
        deviceUdid: UDID,
        deviceHost: HOST,
        actorId: 'usr_alice',
        status: 'active',
        heartbeatSeconds: 30,
        allocatedPorts: '{}',
        capabilityBag: '{}',
        ...over,
      },
    });
  }

  const cases: Array<{
    name: string;
    make: () => Promise<{ store: IDeviceStore; busy: () => Promise<boolean | undefined> }>;
  }> = [
    {
      name: 'PrismaDeviceStore (scratch SQLite)',
      make: async () => {
        await scratch.db.device.create({ data: { udid: UDID, host: HOST, busy: true } });
        return {
          store: new PrismaDeviceStore(),
          busy: async () => {
            const where = { udid_host: { udid: UDID, host: HOST } };
            return (await scratch.db.device.findUnique({ where }))?.busy;
          },
        };
      },
    },
    {
      name: 'LokiDeviceStore (in memory)',
      make: async () => {
        const devices = new loki('lease-reap-held-phone.json').addCollection<any>('devices');
        sinon.stub(XenonDatabase, 'DeviceModel').get(() => Promise.resolve(devices));
        devices.insert({ udid: UDID, host: HOST, busy: true });
        return {
          store: lokiStore(),
          busy: async () => devices.findOne({ udid: UDID, host: HOST })?.busy,
        };
      },
    },
  ];

  for (const { name, make } of cases) {
    describe(name, () => {
      let store: IDeviceStore;
      let busy: () => Promise<boolean | undefined>;

      beforeEach(async () => {
        await scratch.db.portLease.deleteMany({});
        await scratch.db.lease.deleteMany({});
        await scratch.db.device.deleteMany({});
        now = Date.now();
        ({ store, busy } = await make());
      });

      afterEach(() => sinon.restore());

      /** A session created on the lease: it claims the leased phone. */
      async function sessionOnLease() {
        expect(await store.claimForSession(UDID, HOST, null, 'sess-1', {})).to.equal(true);
      }

      const reap = () => new LeaseOrphanSweeper(scratch.db, store).sweep();
      const ended = async () =>
        (await scratch.db.lease.findUnique({ where: { id: 'lse_held' } }))?.status;

      it('a reap at expiresAt leaves the phone busy while a session holds it', async () => {
        await lease({ expiresAt: now - 500, lastHeartbeatAt: now - 1_000 });
        await sessionOnLease();

        await reap();

        expect(await ended()).to.equal('expired');
        expect(await busy(), "the session's phone").to.equal(true);
      });

      it('a missed-heartbeat reap leaves the phone busy while a session holds it', async () => {
        await lease({ expiresAt: now + 60_000, lastHeartbeatAt: now - 120_000 });
        await sessionOnLease();

        await reap();

        expect(await ended()).to.equal('expired');
        expect(await busy()).to.equal(true);
      });

      it('a reap frees the phone when nothing else holds it, as before', async () => {
        await lease({ expiresAt: now - 500, lastHeartbeatAt: now - 1_000 });

        await reap();

        expect(await ended()).to.equal('expired');
        expect(await busy()).to.equal(false);
      });

      it("once the session ends after the reap, the session's release frees the phone", async () => {
        await lease({ expiresAt: now - 500, lastHeartbeatAt: now - 1_000 });
        await sessionOnLease();
        await reap();

        expect(await store.releaseClaim(UDID, HOST, { sessionId: 'sess-1' }, {})).to.equal(true);

        expect(await busy()).to.equal(false);
      });

      it("the holder's release leaves the phone busy while a session holds it", async () => {
        await lease({ expiresAt: now + 60_000, lastHeartbeatAt: now });
        await sessionOnLease();
        const noAuth = { nodePairAuth: async () => ({}) } as any;
        const leases = new LeaseService(scratch.db, store, {}, noAuth);

        await leases.release('lse_held', TOKEN);

        expect(await ended()).to.equal('released');
        expect(await busy()).to.equal(true);
      });
    });
  }
});
