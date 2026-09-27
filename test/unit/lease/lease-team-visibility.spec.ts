import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { makeRouter } from '../../../src/app/routers/sdk-leases';
import { LeaseService } from '../../../src/services/lease/LeaseService';
import { DeviceStoreFactory } from '../../../src/data-service/device-store';
import { prisma } from '../../../src/prisma';

/**
 * An SDK lease is inside the team boundary: a member's lease lands only on a
 * phone they can see, whatever the filter names. Otherwise the lease's
 * `xenon:options.leaseId` would carry them past the team check Appium session
 * allocation makes.
 *
 * The router, LeaseService and the device store's match are all real here.
 * Only the port RPC and the lease rows are faked.
 */

const TEAM_A = 'team-a';
const TEAM_B = 'team-b';
// Unique, so the match below can be held to this suite's phones: other specs
// in the same process leave their own devices in the in-memory store.
const HOST = `lease-host-${Date.now()}`;

const SHARED = 'LEASE-SHARED';
const PHONE_A = 'LEASE-A';
const PHONE_B = 'LEASE-B';
const UNKNOWN = 'LEASE-UNKNOWN';
const PHONES: Array<[string, string | null]> = [
  [SHARED, null],
  [PHONE_A, TEAM_A],
  [PHONE_B, TEAM_B],
];

type Caller = { role: 'MEMBER' | 'ADMIN'; teamIds?: string[] };
const ALICE: Caller = { role: 'MEMBER', teamIds: [TEAM_A] };
const NO_TEAM: Caller = { role: 'MEMBER', teamIds: [] };
const ADMIN: Caller = { role: 'ADMIN' };

describe('SDK leases respect the team boundary', () => {
  let store: any;
  let previousStore: unknown;
  let previousEnv: string | undefined;
  let svc: LeaseService;

  before(() => {
    // The in-memory store, whatever NODE_ENV this file was started under:
    // the store reads NODE_ENV on every call, so hold it for the suite.
    previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    previousStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = undefined;
    store = DeviceStoreFactory.getStore();
    expect(store.constructor.name).to.equal('LokiDeviceStore');
  });

  after(async () => {
    for (const [udid] of PHONES) await store.removeDevices({ udid });
    (DeviceStoreFactory as any)._deviceStore = previousStore;
    process.env.NODE_ENV = previousEnv;
  });

  beforeEach(async () => {
    for (const [udid, teamId] of PHONES) {
      await store.removeDevices({ udid });
      await store.addDevices([
        {
          udid,
          host: HOST,
          name: udid,
          platform: 'android',
          sdk: '14',
          teamId,
          busy: false,
        } as any,
      ]);
    }
    // No other lease holds a phone.
    sinon.stub(prisma.lease as any, 'findMany').resolves([]);

    let n = 0;
    const db = {
      lease: {
        create: async ({ data }: any) => ({ ...data, id: `lse_${++n}` }),
        update: async () => ({}),
        delete: async () => ({}),
      },
      portLease: {
        updateMany: async () => ({ count: 0 }),
        deleteMany: async () => ({ count: 0 }),
      },
    };
    const ports = {
      allocate: async () => ({ systemPort: 9001, chromedriverPort: 9002, mjpegServerPort: 9003 }),
    };
    svc = new LeaseService(db, store, ports, {
      nodePairAuth: async () => ({ accessKey: 'k', token: 't' }),
    });
  });

  afterEach(() => sinon.restore());

  function lease(caller: Caller, filters: Record<string, unknown>) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).auth = {
        kind: 'bearer',
        userId: `usr_${caller.role.toLowerCase()}`,
        role: caller.role,
        scopes: 'devices,sessions,read',
        rateLimit: 100,
        teamIds: caller.teamIds,
      };
      next();
    });
    app.use('/sdk/leases', makeRouter({ leaseService: svc }));
    return request(app)
      .post('/sdk/leases')
      .send({ filters: { platform: 'android', filterByHost: HOST, ...filters } });
  }

  const busy = async (udid: string) => !!(await store.findDevice({ udid, host: HOST }))?.busy;

  it("never lands a team-A member's lease on team B's phone when the filter names it", async () => {
    const res = await lease(ALICE, { udid: PHONE_B });
    expect(res.status).to.not.equal(201);
    expect(res.body.device).to.equal(undefined);
    expect(await busy(PHONE_B)).to.equal(false);
  });

  it("never lands a team-A member's lease on team B's phone, even with every visible phone taken", async () => {
    const got: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await lease(ALICE, {});
      if (res.status === 201) got.push(res.body.device.udid);
    }
    expect(got.sort()).to.deep.equal([PHONE_A, SHARED].sort());
    expect(await busy(PHONE_B)).to.equal(false);
  });

  it('ignores a team list the client puts in the filter', async () => {
    const res = await lease(ALICE, { udid: PHONE_B, callerTeamIds: [TEAM_B] });
    expect(res.status).to.not.equal(201);
    expect(await busy(PHONE_B)).to.equal(false);
  });

  it('answers a hidden phone exactly as it answers an unknown udid', async () => {
    const hidden = await lease(ALICE, { udid: PHONE_B });
    const unknown = await lease(ALICE, { udid: UNKNOWN });
    expect(hidden.status).to.equal(unknown.status);
    expect(hidden.body).to.deep.equal(unknown.body);
  });

  it('lets a member in no team lease only the shared phone', async () => {
    const first = await lease(NO_TEAM, {});
    expect(first.status).to.equal(201);
    expect(first.body.device.udid).to.equal(SHARED);
    expect((await lease(NO_TEAM, {})).status).to.not.equal(201);
    expect(await busy(PHONE_A)).to.equal(false);
    expect(await busy(PHONE_B)).to.equal(false);
  });

  it("lets a team-A member lease team A's phone by udid", async () => {
    const res = await lease(ALICE, { udid: PHONE_A });
    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    expect(res.body.device.udid).to.equal(PHONE_A);
  });

  it("lets an admin lease team B's phone", async () => {
    const res = await lease(ADMIN, { udid: PHONE_B });
    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    expect(res.body.device.udid).to.equal(PHONE_B);
  });
});
