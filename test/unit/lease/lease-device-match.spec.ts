import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../../helpers/loopbackRequest';
import { makeRouter } from '../../../src/app/routers/sdk-leases';
import { LeaseService } from '../../../src/services/lease/LeaseService';
import { DeviceStoreFactory } from '../../../src/data-service/device-store';
import { prisma } from '../../../src/prisma';

/**
 * Which device a lease takes. Through 2.12 the lease took the first free
 * device of the platform: one an admin had blocked, one reserved for someone
 * else, or one failing its health check, and it dropped the `sdk` and
 * `deviceName` filters. An unknown udid answered 409 "all busy" whenever any
 * device of the platform existed.
 *
 * The router, LeaseService and the in-memory device store are real here.
 * Only the port RPC and the lease rows are faked.
 */

// Unique, so the match is held to this suite's phones: other specs in the
// same process leave their own devices in the in-memory store.
const HOST = `lease-match-${Date.now()}`;

const FREE = 'MATCH-FREE';
const BLOCKED = 'MATCH-BLOCKED';
const RESERVED = 'MATCH-RESERVED';
const UNHEALTHY = 'MATCH-UNHEALTHY';
const OLD = 'MATCH-OLD';
const ALL = [FREE, BLOCKED, RESERVED, UNHEALTHY, OLD];

describe('SDK leases take only a device that is free to use', () => {
  let store: any;
  let previousStore: unknown;
  let previousEnv: string | undefined;
  let svc: LeaseService;

  before(() => {
    previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    previousStore = (DeviceStoreFactory as any)._deviceStore;
    (DeviceStoreFactory as any)._deviceStore = undefined;
    store = DeviceStoreFactory.getStore();
    expect(store.constructor.name).to.equal('LokiDeviceStore');
  });

  after(async () => {
    for (const udid of ALL) await store.removeDevices({ udid });
    (DeviceStoreFactory as any)._deviceStore = previousStore;
    process.env.NODE_ENV = previousEnv;
  });

  beforeEach(async () => {
    const phone = (udid: string, extra: Record<string, unknown> = {}) => ({
      udid,
      host: HOST,
      name: 'Pixel 7',
      platform: 'android',
      sdk: '14',
      teamId: null,
      busy: false,
      offline: false,
      userBlocked: false,
      healthStatus: 'Healthy',
      ...extra,
    });
    for (const udid of ALL) await store.removeDevices({ udid });
    await store.addDevices([
      phone(BLOCKED, { userBlocked: true }),
      phone(RESERVED, { reservedBy: 'Dana', reservedUntil: Date.now() + 60 * 60 * 1000 }),
      phone(UNHEALTHY, { healthStatus: 'Unhealthy' }),
      phone(OLD, { sdk: '12', name: 'Galaxy S9+' }),
      phone(FREE),
    ] as any);
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

  function lease(filters: Record<string, unknown>) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).auth = {
        kind: 'bearer',
        userId: 'usr_admin',
        role: 'ADMIN',
        scopes: 'admin,devices,sessions,read',
        rateLimit: 100,
      };
      next();
    });
    app.use('/sdk/leases', makeRouter({ leaseService: svc }));
    return request(app)
      .post('/sdk/leases')
      .send({ filters: { platform: 'android', filterByHost: HOST, ...filters } });
  }

  const busy = async (udid: string) => !!(await store.findDevice({ udid, host: HOST }))?.busy;

  it('skips blocked, reserved and unhealthy devices', async () => {
    const got: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await lease({ sdk: '14' });
      if (res.status === 201) got.push(res.body.device.udid);
    }
    expect(got).to.deep.equal([FREE]);
    for (const udid of [BLOCKED, RESERVED, UNHEALTHY]) expect(await busy(udid)).to.equal(false);
  });

  for (const [what, udid] of [
    ['blocked', BLOCKED],
    ['reserved', RESERVED],
    ['unhealthy', UNHEALTHY],
  ] as const) {
    it(`answers 409 for a device named by udid that is ${what}, and leaves it free`, async () => {
      const res = await lease({ udid });
      expect(res.status).to.equal(409);
      expect(res.body.error).to.equal('all_matching_busy');
      expect(await busy(udid)).to.equal(false);
    });
  }

  it('answers 404 for an unknown udid, though other devices of the platform exist', async () => {
    const res = await lease({ udid: 'MATCH-NO-SUCH-PHONE' });
    expect(res.status).to.equal(404);
    expect(res.body).to.deep.equal({
      error: 'no_matching_device',
      message: 'No device matches the filters',
    });
  });

  it('applies the sdk filter', async () => {
    const res = await lease({ sdk: '12' });
    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    expect(res.body.device.udid).to.equal(OLD);
    expect((await lease({ sdk: '9' })).status).to.equal(404);
  });

  it('applies the deviceName filter, ignoring case', async () => {
    const res = await lease({ deviceName: 'galaxy s9+' });
    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    expect(res.body.device.udid).to.equal(OLD);
    expect((await lease({ deviceName: 'Pixel 9' })).status).to.equal(404);
  });

  it('ignores availability fields the client puts in the filter', async () => {
    const res = await lease({ udid: BLOCKED, userBlocked: true, busy: true });
    expect(res.status).to.equal(409);
    expect(await busy(BLOCKED)).to.equal(false);
  });
});
