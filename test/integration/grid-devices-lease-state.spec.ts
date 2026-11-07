import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import request from '../helpers/loopbackRequest';
import GridRouter from '../../src/app/routers/grid';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { prisma } from '../../src/prisma';
import log from '../../src/logger';
import { useScratchDatabase } from '../helpers/scratch-database';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';

// GET /devices says which phones a lease holds: `held` for a member of a
// waiting lease, `leased` for one of an active lease, null otherwise. The
// dashboard's card reads it ("Held for a waiting lease", "Leased").

const HOST = 'http://127.0.0.1:4723';
/** A second server on this machine, with a phone of the same udid (an emulator's repeats). */
const OTHER_HOST = 'http://127.0.0.1:4724';
const HELD = 'lease-state-held';
const LEASED = 'lease-state-leased';
const FREE = 'lease-state-free';
const LAPSED = 'lease-state-lapsed';
const UDIDS = [HELD, LEASED, FREE, LAPSED];

describe('GET /devices lease state (integration)', function () {
  this.timeout(60_000);
  const scratch = useScratchDatabase();
  useOwnNodeId();

  // /devices lists the store grid.ts took when it was imported (Loki under
  // `test:all`, Prisma under `npx mocha <file>`), and usePrismaStores can't
  // change that one. The factory hands back that same store here.
  let store: any;

  const phone = (udid: string, host = HOST) => ({
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
  });

  const lease = async (
    udid: string,
    status: 'waiting' | 'active',
    { lapsed = false, host = HOST }: { lapsed?: boolean; host?: string } = {},
  ) => {
    const now = Date.now();
    const end = lapsed ? now - 60_000 : now + 600_000;
    await scratch.db.lease.create({
      data: {
        tokenHash: 'h',
        deviceUdid: udid,
        deviceHost: host,
        actorId: 'actor-1',
        status,
        expiresAt: end,
        waitUntil: status === 'waiting' ? end : null,
        lastHeartbeatAt: now,
        allocatedPorts: '{}',
        capabilityBag: '',
        members: { create: [{ index: 0, udid, host, heldAt: now }] },
      } as any,
    });
  };

  function buildApp() {
    const app = express();
    app.use(express.json());
    // An admin: every phone is visible, so the lease state is all that varies.
    app.use((req, _res, next) => {
      (req as any).auth = { kind: 'user-session', userId: 'u1', role: 'ADMIN', scopes: 'admin' };
      next();
    });
    GridRouter.register(app as any, {} as any);
    return app;
  }

  const stateOf = (
    rows: Array<{ udid: string; host: string; leaseState?: unknown }>,
    udid: string,
    host = HOST,
  ) => {
    const row = rows.find((r) => r.udid === udid && r.host === host);
    expect(row, `${udid}@${host} listed`).to.not.equal(undefined);
    return row?.leaseState;
  };

  beforeEach(async () => {
    sinon.stub(process, 'kill');
    store = DeviceStoreFactory.getStore();
    await scratch.db.lease.deleteMany({});
    await scratch.db.device.deleteMany({});
    for (const udid of UDIDS) await store.removeDevices({ udid });
    await store.addDevices([...UDIDS.map((udid) => phone(udid)), phone(LEASED, OTHER_HOST)] as any);
    await lease(HELD, 'waiting');
    await lease(LEASED, 'active');
    await lease(LAPSED, 'active', { lapsed: true });
  });

  afterEach(async () => {
    sinon.restore();
    // Loki is one collection for the whole process: take the phones back out.
    // A Prisma store's rows go with the scratch database.
    if (!(store instanceof PrismaDeviceStore)) {
      for (const udid of UDIDS) await store.removeDevices({ udid });
    }
  });

  it('says a waiting lease holds its phone and an active one leases its own', async () => {
    const r = await request(buildApp()).get('/devices');
    expect(r.status).to.equal(200);
    expect(stateOf(r.body, HELD)).to.equal('held');
    expect(stateOf(r.body, LEASED)).to.equal('leased');
  });

  it('gives a free phone, and one whose lease has lapsed, no lease state', async () => {
    const r = await request(buildApp()).get('/devices');
    expect(stateOf(r.body, FREE)).to.equal(null);
    expect(stateOf(r.body, LAPSED)).to.equal(null);
  });

  it('answers /device the same way', async () => {
    const r = await request(buildApp()).get('/device');
    expect(stateOf(r.body, HELD)).to.equal('held');
    expect(stateOf(r.body, LEASED)).to.equal('leased');
    expect(stateOf(r.body, FREE)).to.equal(null);
  });

  it('answers /device/:platform the same way', async () => {
    const r = await request(buildApp()).get('/device/android');
    expect(r.status).to.equal(200);
    expect(stateOf(r.body, HELD)).to.equal('held');
    expect(stateOf(r.body, LEASED)).to.equal('leased');
    expect(stateOf(r.body, FREE)).to.equal(null);
  });

  // A lease holds a phone by udid and host: the same udid on another server
  // is another phone.
  it('gives each of two phones sharing a udid its own lease state', async () => {
    const r = await request(buildApp()).get('/devices');
    expect(stateOf(r.body, LEASED, HOST)).to.equal('leased');
    expect(stateOf(r.body, LEASED, OTHER_HOST)).to.equal(null);
  });

  it('reads the leases once for the whole list', async () => {
    const findMany = prisma.leaseMember.findMany as unknown as sinon.SinonStub;
    findMany.resetHistory();
    await request(buildApp()).get('/devices');
    expect(findMany.callCount).to.equal(1);
  });

  it('lists every phone with no lease state when the leases cannot be read', async () => {
    (prisma.leaseMember.findMany as unknown as sinon.SinonStub).rejects(
      new Error('database is locked'),
    );
    const warn = sinon.stub(log, 'warn');
    const r = await request(buildApp()).get('/devices');
    expect(r.status).to.equal(200);
    for (const udid of UDIDS) expect(stateOf(r.body, udid)).to.equal(null);
    expect(warn.calledWithMatch(/lease state/)).to.equal(true);
  });
});
