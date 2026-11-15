import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import request from '../../helpers/loopbackRequest';
import { makeRouter } from '../../../src/app/routers/sdk-leases';
import { LeaseService } from '../../../src/services/lease/LeaseService';
import { LeaseOrphanSweeper } from '../../../src/services/lease/LeaseOrphanSweeper';
import {
  activeLeaseEnd,
  missedHeartbeats,
  waiterEnd,
} from '../../../src/services/lease/leaseStatus';
import { DeviceStoreFactory } from '../../../src/data-service/device-store';
import { IDevice } from '../../../src/interfaces/IDevice';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { useLokiStores, usePrismaStores } from '../../helpers/loki-stores';
import { OWN_NODE_ID, useOwnNodeId } from '../../helpers/own-node-id';
import { drainLeaseQueues } from '../../helpers/lease-queue';

/**
 * An agent's lease (one taken through /xenon/mcp) needs no heartbeats: an
 * agent doesn't send them, and a stateless hub can't send them for it. It
 * ends when it is released, at its expiresAt, or when the grant it was taken
 * under is revoked (endLeasesOfGrant). Every other lease is as it was.
 */
const HOST = 'http://127.0.0.1:4723';
const HOUR = 60 * 60 * 1000;

describe('a heartbeat-free lease', () => {
  describe('leaseStatus', () => {
    it('missedHeartbeats is false for a heartbeat-free lease', () => {
      const now = Date.now();
      const quiet = {
        heartbeatFree: true,
        heartbeatSeconds: 30,
        lastHeartbeatAt: now - HOUR,
        expiresAt: now + 60_000,
      };
      expect(missedHeartbeats(quiet, now)).to.equal(false);
      expect(activeLeaseEnd(quiet, now)).to.equal(null);
      expect(waiterEnd({ ...quiet, waitUntil: now + 60_000 }, now)).to.equal(null);
      // The same lease with heartbeats has missed them.
      expect(missedHeartbeats({ ...quiet, heartbeatFree: null }, now)).to.equal(true);
      expect(activeLeaseEnd({ ...quiet, heartbeatFree: false }, now)?.reason).to.equal(
        'missed_heartbeats',
      );
    });

    it('a heartbeat-free lease still ends at expiresAt', () => {
      const now = Date.now();
      const end = activeLeaseEnd(
        {
          heartbeatFree: true,
          heartbeatSeconds: 30,
          lastHeartbeatAt: now - HOUR,
          expiresAt: now - 1,
        },
        now,
      );
      expect(end?.reason).to.equal('past_end');
    });
  });

  describe('the sweeper', () => {
    const scratch = useScratchDatabase();
    let releaseLeaseLock: sinon.SinonStub;
    let sweeper: LeaseOrphanSweeper;

    const seed = (id: string, over: Record<string, unknown>) =>
      scratch.db.lease.create({
        data: {
          id,
          tokenHash: `hash-${id}`,
          deviceUdid: `udid-${id}`,
          deviceHost: HOST,
          actorId: 'usr_agent',
          status: 'active',
          heartbeatSeconds: 30,
          allocatedPorts: '{}',
          capabilityBag: '{}',
          ...over,
          members: { create: [{ index: 0, udid: `udid-${id}`, host: HOST, heldAt: Date.now() }] },
        } as any,
      });

    const leaseRow = (id: string) => scratch.db.lease.findUnique({ where: { id } }) as any;

    beforeEach(async () => {
      await scratch.db.lease.deleteMany({});
      releaseLeaseLock = sinon.stub().resolves(true);
      const findDevice = sinon.stub().resolves({ healthStatus: 'Healthy', userBlocked: false });
      sweeper = new LeaseOrphanSweeper(scratch.db, { releaseLeaseLock, findDevice });
    });

    afterEach(() => sinon.restore());

    it('the sweeper keeps a quiet heartbeat-free lease and ends it at expiresAt', async () => {
      const now = Date.now();
      await seed('quiet', {
        heartbeatFree: true,
        lastHeartbeatAt: now - HOUR,
        expiresAt: now + HOUR,
      });
      await seed('lapsed', {
        heartbeatFree: true,
        lastHeartbeatAt: now - HOUR,
        expiresAt: now - 1_000,
      });
      // A lease with heartbeats, as quiet, is reaped as before.
      await seed('plain', { lastHeartbeatAt: now - HOUR, expiresAt: now + HOUR });

      await sweeper.sweep();

      expect((await leaseRow('quiet')).status).to.equal('active');
      const lapsed = await leaseRow('lapsed');
      expect(lapsed.status).to.equal('expired');
      expect(lapsed.endReason).to.equal('past_end');
      const plain = await leaseRow('plain');
      expect(plain.status).to.equal('expired');
      expect(plain.endReason).to.equal('missed_heartbeats');
      expect(releaseLeaseLock.calledWith('udid-quiet', HOST)).to.equal(false);
      expect(releaseLeaseLock.calledWith('udid-lapsed', HOST)).to.equal(true);
    });
  });

  for (const kind of ['Prisma', 'Loki'] as const) {
    describe(`endLeasesOfGrant (${kind} store)`, () => {
      const scratch = useScratchDatabase({ wholeSuite: true });
      if (kind === 'Prisma') usePrismaStores();
      else useLokiStores();
      useOwnNodeId();

      const stamp = `${kind}-${Date.now()}`;
      const PHONE = {
        a: `grant-a-${stamp}`,
        held: `grant-held-${stamp}`,
        waitHold: `grant-wait-${stamp}`,
        other: `grant-other-${stamp}`,
      };
      let store: any;
      let svc: LeaseService;

      const phone = (udid: string, over: Partial<IDevice> = {}) =>
        ({
          udid,
          name: udid,
          platform: 'android',
          sdk: '13',
          host: HOST,
          nodeId: OWN_NODE_ID,
          busy: true,
          offline: false,
          userBlocked: false,
          state: 'device',
          deviceType: 'real',
          realDevice: true,
          totalUtilizationTimeMilliSec: 0,
          sessionStartTime: 0,
          ...over,
        }) as unknown as IDevice;

      const seedLease = (udid: string, over: Record<string, unknown>) =>
        scratch.db.lease.create({
          data: {
            tokenHash: 'h',
            deviceUdid: udid,
            deviceHost: HOST,
            actorId: 'usr_agent',
            status: 'active',
            heartbeatFree: true,
            expiresAt: Date.now() + HOUR,
            lastHeartbeatAt: Date.now(),
            allocatedPorts: '{}',
            capabilityBag: '',
            ...over,
            members: { create: [{ index: 0, udid, host: HOST, heldAt: Date.now() }] },
          } as any,
        });

      const busyOf = async (udid: string) =>
        Boolean((await store.findDevice({ udid, host: HOST }))?.busy);

      before(async () => {
        store = DeviceStoreFactory.getStore();
        await store.addDevices([
          phone(PHONE.a),
          // A session runs on this one: its lease ending leaves it the session's.
          phone(PHONE.held, {
            session_id: `sess-${stamp}`,
            claimSessionId: `sess-${stamp}`,
          } as any),
          phone(PHONE.waitHold),
          phone(PHONE.other),
        ]);
        const portClient = {
          allocate: sinon.stub().resolves({}),
          release: sinon.stub().resolves({ released: 0 }),
          extend: sinon.stub().resolves({ extended: 0 }),
        };
        const noAuth = { nodePairAuth: async () => ({ accessKey: '', token: '' }) };
        svc = new LeaseService(scratch.db, store, portClient, noAuth);
      });

      afterEach(() => drainLeaseQueues(svc));

      // Loki is one collection for the whole process.
      after(async () => {
        if (kind === 'Loki') {
          for (const udid of Object.values(PHONE)) await store.removeDevices({ udid });
        }
      });

      it("endLeasesOfGrant ends only that grant's leases, with reason grant_revoked", async () => {
        const active = await seedLease(PHONE.a, { grantId: 'grant-1' });
        const onSession = await seedLease(PHONE.held, { grantId: 'grant-1' });
        const waiting = await seedLease(PHONE.waitHold, {
          grantId: 'grant-1',
          status: 'waiting',
          expiresAt: 0,
          waitUntil: Date.now() + HOUR,
          requestedMembers: JSON.stringify([{ platform: 'android', udid: PHONE.waitHold }]),
          durationMs: 900_000,
        });
        const other = await seedLease(PHONE.other, { grantId: 'grant-2' });

        const ended = await svc.endLeasesOfGrant('grant-1', 'grant_revoked');

        expect(ended).to.equal(3);
        const row = (id: string) => scratch.db.lease.findUnique({ where: { id } }) as any;
        for (const lease of [active, onSession]) {
          expect(await row(lease.id)).to.deep.include({
            status: 'released',
            endReason: 'grant_revoked',
          });
        }
        expect(await row(waiting.id)).to.deep.include({
          status: 'expired',
          endReason: 'grant_revoked',
        });
        expect((await row(other.id)).status).to.equal('active');

        // The lease rule: the lock goes only where nothing else holds the phone.
        expect(await busyOf(PHONE.a)).to.equal(false);
        expect(await busyOf(PHONE.held)).to.equal(true);
        expect(await busyOf(PHONE.waitHold)).to.equal(false);
        expect(await busyOf(PHONE.other)).to.equal(true);

        // Again: nothing left to end.
        expect(await svc.endLeasesOfGrant('grant-1', 'grant_revoked')).to.equal(0);
      });
    });
  }

  describe('POST /sdk/leases', () => {
    const scratch = useScratchDatabase({ wholeSuite: true });
    usePrismaStores();
    useOwnNodeId();

    const UDID = `plain-${Date.now()}`;
    let app: express.Express;
    let svc: LeaseService;

    before(async () => {
      await scratch.db.device.create({
        data: {
          udid: UDID,
          host: HOST,
          nodeId: OWN_NODE_ID,
          name: 'Plain phone',
          platform: 'android',
          sdk: '13',
          busy: false,
          offline: false,
          userBlocked: false,
          deviceType: 'real',
          realDevice: true,
        } as any,
      });
      const portClient = {
        allocate: sinon.stub().resolves({ systemPort: 13100 }),
        release: sinon.stub().resolves({ released: 1 }),
        extend: sinon.stub().resolves({ extended: 1 }),
      };
      const noAuth = { nodePairAuth: async () => ({ accessKey: '', token: '' }) };
      svc = new LeaseService(scratch.db, DeviceStoreFactory.getStore(), portClient, noAuth);
      app = express();
      app.use(express.json());
      app.use((req: any, _res, next) => {
        req.auth = { kind: 'apiKey', userId: 'usr_owner', role: 'ADMIN' };
        next();
      });
      app.use('/sdk/leases', makeRouter({ leaseService: svc }));
    });

    beforeEach(() => sinon.stub(process, 'kill'));

    afterEach(async () => {
      await drainLeaseQueues(svc);
      sinon.restore();
    });

    it('POST /sdk/leases from a plain client ignores heartbeatFree', async () => {
      const res = await request(app)
        .post('/sdk/leases')
        .send({
          filters: { platform: 'android', udid: UDID },
          heartbeatFree: true,
          grantId: 'grant-from-a-body',
        });

      expect(res.status, JSON.stringify(res.body)).to.equal(201);
      const row: any = await scratch.db.lease.findUnique({ where: { id: res.body.leaseId } });
      expect(row.heartbeatFree ?? false).to.equal(false);
      expect(row.grantId).to.equal(null);
      // A plain client's default, as before: 30 minutes.
      const createdAt = new Date(row.createdAt).getTime();
      expect(Math.abs(row.expiresAt - createdAt - 30 * 60 * 1000)).to.be.below(1_000);
    });
  });
});
