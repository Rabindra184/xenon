import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import request from '../helpers/loopbackRequest';
import { makeRouter } from '../../src/app/routers/sdk-leases';
import { LeaseService } from '../../src/services/lease/LeaseService';
import { LeaseQueue } from '../../src/services/lease/LeaseQueue';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { releaseSessionDevice } from '../../src/data-service/device-service';
import * as DeviceUtils from '../../src/device-utils';
import AndroidDeviceManager from '../../src/device-managers/AndroidDeviceManager';
import { DefaultPluginArgs } from '../../src/interfaces/IPluginArgs';
import type { IDevice } from '../../src/interfaces/IDevice';
import { prisma } from '../../src/prisma';
import { useScratchDatabase } from '../helpers/scratch-database';
import { useLokiStores, usePrismaStores } from '../helpers/loki-stores';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';
import { createTestXenonManager, resetTestContainer } from '../helpers/test-container';

// Group leases end to end: the lease API (router and LeaseService), the lease
// queue's grant passes as production runs them (a release kicks the queue, a
// freed phone tells it through phoneFreed), and a plain session's allocation,
// over a scratch database, with each device store.

const HOST = 'http://127.0.0.1:4723';
const UDIDS = ['A', 'B', 'C', 'D'];
const PORTS: Record<string, Record<string, number>> = {
  A: { systemPort: 8201, chromedriverPort: 9515, mjpegServerPort: 7811 },
  B: { systemPort: 8202, chromedriverPort: 9516, mjpegServerPort: 7812 },
  C: { systemPort: 8203, chromedriverPort: 9517, mjpegServerPort: 7813 },
  D: { systemPort: 8204, chromedriverPort: 9518, mjpegServerPort: 7814 },
};

const ANY_ANDROID = { filters: { platform: 'android' } };
const only = (udid: string) => ({ filters: { platform: 'android', udid } });
const noAuth = { nodePairAuth: async () => ({ accessKey: '', token: '' }) };

const pluginArgs = Object.assign({}, DefaultPluginArgs, {
  platform: 'android',
  androidDeviceType: 'both',
  iosDeviceType: 'both',
  maxSessions: 10,
});

const androidPhone = (udid: string): IDevice =>
  ({
    udid,
    host: HOST,
    nodeId: OWN_NODE_ID,
    name: `Phone ${udid}`,
    platform: 'android',
    sdk: '13',
    busy: false,
    offline: false,
    userBlocked: false,
    state: 'device',
    deviceType: 'real',
    realDevice: true,
    totalUtilizationTimeMilliSec: 0,
    sessionStartTime: 0,
  }) as unknown as IDevice;

function scenarios(kind: 'Prisma' | 'Loki', useStores: () => void) {
  describe(`group lease scenarios (${kind} store)`, () => {
    // For the whole suite, so the database stays behind \`prisma\` until the
    // afterEach below has waited for a pass still running. Tables are emptied
    // before each test.
    const scratch = useScratchDatabase({ wholeSuite: true });
    useStores();
    useOwnNodeId();

    /** The store under test, taken per test: the factory's is put back after the suite. */
    let store: any;
    let portClient: {
      allocate: sinon.SinonStub;
      release: sinon.SinonStub;
      extend: sinon.SinonStub;
    };
    let queue: LeaseQueue;
    let app: express.Express;
    /** Every queue and service a test built, stopped and settled after it. */
    let built: Array<{ queue: LeaseQueue; svc: LeaseService }>;

    /** A server's lease queue and service over the scratch database, started as ServerManager starts it. */
    const server = () => {
      const q = new LeaseQueue(prisma, store, portClient, noAuth);
      const s = new LeaseService(prisma, store, portClient, noAuth, q);
      // A long backstop: the passes these tests see are the ones production
      // kicks (a release, phoneFreed).
      q.start(60_000);
      built.push({ queue: q, svc: s });
      const a = express();
      a.use(express.json());
      a.use((req: any, _res, next) => {
        req.apiKey = { id: 'key_owner', teamId: null };
        req.auth = { kind: 'apiKey', userId: 'usr_owner', role: 'ADMIN' };
        next();
      });
      a.use('/sdk/leases', makeRouter({ leaseService: s }));
      return { queue: q, svc: s, app: a };
    };

    const post = (body: Record<string, unknown>, on = app) =>
      request(on)
        .post('/sdk/leases')
        .send({ durationMs: 600_000, heartbeatSeconds: 30, ...body });
    const get = (lease: any, query = '', on = app) =>
      request(on)
        .get(`/sdk/leases/${lease.leaseId}${query}`)
        .set('x-xenon-lease-token', lease.leaseToken);
    const release = (lease: any, on = app) =>
      request(on)
        .delete(`/sdk/leases/${lease.leaseId}`)
        .set('x-xenon-lease-token', lease.leaseToken);

    /** A granted single lease of one phone: in use by another pipeline. */
    const leaseOf = async (udid: string) => {
      const res = await post({ filters: only(udid).filters });
      expect(res.status, JSON.stringify(res.body)).to.equal(201);
      return res.body;
    };
    /** A `waitMs: 0` single lease of any Android phone, as a pipeline sends it. */
    const single = () => post({ filters: ANY_ANDROID.filters });

    const busy = async (udid: string) => (await store.findDevice({ udid, host: HOST }))?.busy;
    const members = async (leaseId: string) =>
      (
        await scratch.db.leaseMember.findMany({ where: { leaseId }, orderBy: { index: 'asc' } })
      ).map((m: any) => m.udid);
    const status = async (leaseId: string) =>
      (await scratch.db.lease.findUnique({ where: { id: leaseId } }))?.status;

    /** A plain session's allocation (no lease), as the session gateway asks for one. */
    const allocate = (udid?: string, timeoutMs = 2_000) =>
      DeviceUtils.allocateDeviceForSession(
        {
          alwaysMatch: { platformName: 'android', ...(udid ? { 'appium:udid': udid } : {}) },
          firstMatch: [{}],
        } as any,
        timeoutMs,
        50,
        pluginArgs,
      );
    /** A plain session running on `udid`: allocated, then its claim given the session's id. */
    const sessionOn = async (udid: string, sessionId: string) => {
      const device = await allocate(udid);
      expect(device.udid).to.equal(udid);
      // The claim's time as the row has it: the Loki store answers the phone
      // as it read it before the lock (as on main), so `device.claimedAt` is
      // empty there.
      const { claimedAt } = await store.findDevice({ udid, host: HOST });
      expect(await store.claimForSession(udid, HOST, claimedAt, sessionId, {})).to.equal(true);
    };

    const removePhones = async (on: any) => {
      for (const udid of UDIDS) {
        await on.removeDevices({ udid, host: HOST } as Partial<IDevice>, { exactHost: true });
      }
    };

    before(() => {
      createTestXenonManager(pluginArgs);
    });

    after(async () => {
      // Loki is one collection for the whole process; the Prisma rows go
      // with the scratch file.
      if (kind === 'Loki' && store) await removePhones(store);
      await resetTestContainer();
    });

    beforeEach(async () => {
      // Nothing here reaches a process, but a stray kill must never signal one.
      sinon.stub(process, 'kill');
      // The lazy look-up of a phone's screen and Chrome reaches adb.
      sinon.stub(AndroidDeviceManager.prototype, 'getAdditionalDeviceInfo').resolves({});
      store = DeviceStoreFactory.getStore();
      await scratch.db.portLease.deleteMany({});
      await scratch.db.lease.deleteMany({});
      await scratch.db.deviceSetting.deleteMany({});
      await removePhones(store);
      await store.addDevices(UDIDS.map(androidPhone));
      portClient = {
        allocate: sinon.stub().callsFake(async ({ udid }: any) => PORTS[udid]),
        release: sinon.stub().resolves({ released: 3 }),
        extend: sinon.stub().resolves({ extended: 3 }),
      };
      built = [];
      ({ queue, app } = server());
    });

    afterEach(async () => {
      for (const b of built) b.queue.stop();
      // A pass a release or phoneFreed kicked may still be running.
      for (const b of built) {
        await b.queue.idle();
        await b.svc.phoneServerCallsSettled();
      }
      sinon.restore();
    });

    it('two 2-phone groups and two free phones: one is granted, the other when it is released', async () => {
      // Only A and B are in the lab for this one.
      await store.removeDevices({ udid: 'C', host: HOST } as Partial<IDevice>, { exactHost: true });
      await store.removeDevices({ udid: 'D', host: HOST } as Partial<IDevice>, { exactHost: true });

      // Two runs ask at the same moment. Asking phone by phone, each could end
      // up with one and wait for the other's.
      const [one, two] = await Promise.all([
        post({ members: [ANY_ANDROID, ANY_ANDROID], waitMs: 60_000 }),
        post({ members: [ANY_ANDROID, ANY_ANDROID], waitMs: 60_000 }),
      ]);
      const statuses = [one.status, two.status].sort();
      expect(statuses, JSON.stringify([one.body, two.body])).to.deep.equal([201, 202]);
      const granted = one.status === 201 ? one.body : two.body;
      const waiting = one.status === 202 ? one.body : two.body;

      expect(granted.members.map((m: any) => m.device.udid).sort()).to.deep.equal(['A', 'B']);
      expect(waiting).to.deep.include({ status: 'waiting', position: 1 });
      // The waiter holds nothing: both phones are the other run's.
      expect(await members(waiting.leaseId)).to.deep.equal([]);
      expect(await busy('A')).to.equal(true);
      expect(await busy('B')).to.equal(true);

      // The waiter long-polls while the first run finishes and releases.
      const polled = get(waiting, '?waitMs=5000');
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect((await release(granted)).status).to.equal(204);
      const answer = await polled;
      await queue.idle();

      expect(answer.status, JSON.stringify(answer.body)).to.equal(200);
      expect(answer.body.members.map((m: any) => m.device.udid).sort()).to.deep.equal(['A', 'B']);
      expect(await status(waiting.leaseId)).to.equal('active');
      expect(await status(granted.leaseId)).to.equal('released');
      expect(await busy('A')).to.equal(true);
      expect(await busy('B')).to.equal(true);
    });

    it('a 4-phone group at the head is granted although single leases keep arriving', async () => {
      // All four phones in use: A and B by other pipelines' leases, C and D
      // by plain sessions.
      const onA = await leaseOf('A');
      const onB = await leaseOf('B');
      await sessionOn('C', 'sess-c');
      await sessionOn('D', 'sess-d');

      const group = await post({ members: [1, 2, 3, 4].map(() => ANY_ANDROID), waitMs: 60_000 });
      expect(group.status, JSON.stringify(group.body)).to.equal(202);
      expect(group.body.position).to.equal(1);

      const singles: number[] = [];
      const arrive = async () => {
        const res = await single();
        singles.push(res.status);
        if (res.status === 409) {
          expect(res.body).to.deep.equal({ error: 'all_matching_busy', retryAfterMs: 2_000 });
        }
      };
      const frees: Array<[string, () => Promise<unknown>]> = [
        ['A', () => release(onA)],
        ['C', () => releaseSessionDevice('C', HOST, 'sess-c')],
        ['B', () => release(onB)],
        ['D', () => releaseSessionDevice('D', HOST, 'sess-d')],
      ];

      const held: string[] = [];
      for (const [udid, free] of frees) {
        await arrive();
        await free();
        // A single lease that arrives before the pass the release kicked is
        // served after the queue (tryNow), so it can't take the phone either.
        await arrive();
        await queue.idle();
        await arrive();
        held.push(udid);
        if (held.length < 4) {
          expect(await status(group.body.leaseId)).to.equal('waiting');
          expect((await members(group.body.leaseId)).sort()).to.deep.equal([...held].sort());
          expect(await busy(udid), udid).to.equal(true);
        }
      }

      expect(await status(group.body.leaseId)).to.equal('active');
      const got = await get(group.body);
      expect(got.status, JSON.stringify(got.body)).to.equal(200);
      expect(got.body.members.map((m: any) => m.device.udid).sort()).to.deep.equal(UDIDS);
      expect(singles).to.have.length(12);
      expect(
        singles.every((s) => s === 409),
        JSON.stringify(singles),
      ).to.equal(true);
    });

    it('a plain session skips a held phone', async () => {
      // A is in use; the group waits for it and holds B meanwhile. C and D
      // are free, and D is taken by another session first.
      const onA = await leaseOf('A');
      await sessionOn('D', 'sess-d');
      const group = await post({ members: [only('A'), only('B')], waitMs: 60_000 });
      expect(group.status, JSON.stringify(group.body)).to.equal(202);
      expect(await members(group.body.leaseId)).to.deep.equal(['B']);
      expect(await busy('B')).to.equal(true);

      // The hold is the member row, whatever B's busy flag says (an admin's
      // unblock, a node's report).
      await store.updateDevice('B', HOST, { busy: false } as Partial<IDevice>);
      expect(await busy('B')).to.equal(false);

      const got = await allocate();
      expect(got.udid).to.equal('C');
      // Asked for B by name, the session finds it taken.
      let refused: Error | undefined;
      try {
        await allocate('B', 300);
      } catch (err) {
        refused = err as Error;
      }
      // B lists as free, so the refusal is the one for no phone to be had.
      expect(refused?.message).to.equal(
        'No device matching request. Device request: {"platform":"android","udid":["B"]}',
      );
      expect(await members(group.body.leaseId)).to.deep.equal(['B']);

      // A frees up: the group gets A and B, the session keeps C.
      expect((await release(onA)).status).to.equal(204);
      await queue.idle();
      expect(await status(group.body.leaseId)).to.equal('active');
      expect(await members(group.body.leaseId)).to.deep.equal(['A', 'B']);
      expect(await busy('C')).to.equal(true);
    });

    it('a restart keeps the queue and its holds', async () => {
      // Three phones here. A and B are in use; the group (any two phones)
      // holds C and waits for one more, and a single lease waits behind it.
      await store.removeDevices({ udid: 'D', host: HOST } as Partial<IDevice>, { exactHost: true });
      const onA = await leaseOf('A');
      const onB = await leaseOf('B');
      const group = await post({ members: [ANY_ANDROID, ANY_ANDROID], waitMs: 60_000 });
      expect(group.status, JSON.stringify(group.body)).to.equal(202);
      const behind = await post({ members: [ANY_ANDROID], waitMs: 60_000 });
      expect(behind.status, JSON.stringify(behind.body)).to.equal(202);
      expect(behind.body.position).to.equal(2);
      expect(await members(group.body.leaseId)).to.deep.equal(['C']);

      // The server stops. At boot a hub clears its own phones' rows and
      // discovery writes them again, free.
      queue.stop();
      await queue.idle();
      await removePhones(store);
      const next = server();

      // A pass before the phones are found again keeps the hold as it is.
      await next.queue.pass();
      expect(await members(group.body.leaseId)).to.deep.equal(['C']);
      expect(await next.queue.positionOf(group.body.leaseId)).to.equal(1);
      expect(await next.queue.positionOf(behind.body.leaseId)).to.equal(2);

      // Discovery finds A, B and C, free on record; the pass it kicks locks
      // them again for their leases, and nobody else gets them.
      await store.addDevices(['A', 'B', 'C'].map(androidPhone));
      await next.queue.idle();
      for (const udid of ['A', 'B', 'C']) expect(await busy(udid), udid).to.equal(true);
      expect(await members(group.body.leaseId)).to.deep.equal(['C']);
      const waitingAnswer = await get(group.body, '', next.app);
      expect(waitingAnswer.status).to.equal(202);
      expect(waitingAnswer.body).to.deep.include({ status: 'waiting', position: 1 });
      expect((await single()).status).to.equal(409);

      // The rest frees up: the group is granted, the one behind it waits.
      expect((await release(onA, next.app)).status).to.equal(204);
      await next.queue.idle();
      const granted = await get(group.body, '', next.app);
      expect(granted.status, JSON.stringify(granted.body)).to.equal(200);
      expect(granted.body.members.map((m: any) => m.device.udid).sort()).to.deep.equal(['A', 'C']);
      expect(await status(behind.body.leaseId)).to.equal('waiting');
      expect(await next.queue.positionOf(behind.body.leaseId)).to.equal(1);

      expect((await release(onB, next.app)).status).to.equal(204);
      await next.queue.idle();
      expect(await status(behind.body.leaseId)).to.equal('active');
      expect(await members(behind.body.leaseId)).to.deep.equal(['B']);
    });
  });
}

describe('group leases end to end', () => {
  scenarios('Prisma', usePrismaStores);
  scenarios('Loki', useLokiStores);
});
