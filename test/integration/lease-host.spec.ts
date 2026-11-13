import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import sinon from 'sinon';
import request from '../helpers/loopbackRequest';
import { makeRouter } from '../../src/app/routers/sdk-leases';
import { LeaseService } from '../../src/services/lease/LeaseService';
import { LeaseQueue } from '../../src/services/lease/LeaseQueue';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { prisma } from '../../src/prisma';
import { useScratchDatabase } from '../helpers/scratch-database';
import { drainLeaseQueues } from '../helpers/lease-queue';
import { usePrismaStores } from '../helpers/loki-stores';
import { OWN_NODE_ID, useOwnNodeId } from '../helpers/own-node-id';

/**
 * A hub and its node can each report a phone with the same udid (an
 * emulator's `emulator-5554`). A lease that asked by udid alone could take
 * the other server's phone. `filters.host` takes only the phone filed under
 * that host, string for string, as `/control` matches it.
 *
 * The lease's ports go through a stubbed port client and the auth provider
 * has no `reaches`, as in lease-exclude-tags.spec.ts, so neither host needs
 * to be one this server's discovery files phones under.
 */
describe('A lease that asks for a host', () => {
  const scratch = useScratchDatabase({ wholeSuite: true });
  usePrismaStores();
  useOwnNodeId();

  const UDID = 'emulator-5554';
  const FIRST = 'http://127.0.0.1:4723';
  const SECOND = 'http://192.168.1.20:4723';
  const noAuth = { nodePairAuth: async () => ({ accessKey: '', token: '' }) };
  let app: express.Express;

  const phone = (host: string) =>
    scratch.db.device.create({
      data: {
        udid: UDID,
        host,
        nodeId: OWN_NODE_ID,
        name: `Emulator on ${host}`,
        platform: 'android',
        sdk: '13',
        busy: false,
        offline: false,
        userBlocked: false,
        deviceType: 'emulator',
        realDevice: false,
      } as any,
    });

  const post = (body: Record<string, unknown>) =>
    request(app)
      .post('/sdk/leases')
      .send({ durationMs: 600_000, heartbeatSeconds: 30, ...body });

  beforeEach(async () => {
    sinon.stub(process, 'kill');
    await scratch.db.portLease.deleteMany({});
    await scratch.db.lease.deleteMany({});
    await scratch.db.device.deleteMany({});
    await scratch.db.deviceSetting.deleteMany({});
    // The other host's row first, so a lease by udid alone would take it.
    await phone(SECOND);
    await phone(FIRST);
    const portClient = {
      allocate: sinon.stub().resolves({ systemPort: 13100 }),
      release: sinon.stub().resolves({ released: 1 }),
      extend: sinon.stub().resolves({ extended: 1 }),
    };
    const store = DeviceStoreFactory.getStore();
    const queue = new LeaseQueue(prisma, store, portClient, noAuth);
    const svc = new LeaseService(prisma, store, portClient, noAuth, queue);
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.apiKey = { id: 'key_owner', teamId: null };
      req.auth = { kind: 'apiKey', userId: 'usr_owner', role: 'ADMIN' };
      next();
    });
    app.use('/sdk/leases', makeRouter({ leaseService: svc }));
  });

  afterEach(async () => {
    await drainLeaseQueues();
    sinon.restore();
  });

  it('takes only the phone on the host asked for', async () => {
    const res = await post({ filters: { platform: 'android', udid: UDID, host: FIRST } });

    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    expect(res.body.device.udid).to.equal(UDID);
    expect(res.body.device.host).to.equal(FIRST);
  });

  it('answers no_matching_device for a host no phone of the udid has', async () => {
    const res = await post({
      filters: { platform: 'android', udid: UDID, host: 'http://nowhere:4723' },
    });

    expect(res.status).to.equal(404);
    expect(res.body.error).to.equal('no_matching_device');
  });

  it('is kept by a waiting lease', async () => {
    const filters = { platform: 'android', udid: UDID, host: FIRST };
    const holder = await post({ filters });
    expect(holder.status, JSON.stringify(holder.body)).to.equal(201);

    const waiting = await post({ filters, waitMs: 60_000 });
    expect(waiting.status, JSON.stringify(waiting.body)).to.equal(202);

    // The other host's phone is free the whole time, and isn't the waiter's.
    const other = await scratch.db.device.findUnique({
      where: { udid_host: { udid: UDID, host: SECOND } },
    });
    expect(other?.busy).to.equal(false);

    await request(app)
      .delete(`/sdk/leases/${holder.body.leaseId}`)
      .set('x-xenon-lease-token', holder.body.leaseToken);
    const granted = await request(app)
      .get(`/sdk/leases/${waiting.body.leaseId}?waitMs=5000`)
      .set('x-xenon-lease-token', waiting.body.leaseToken);

    expect(granted.status, JSON.stringify(granted.body)).to.equal(200);
    expect(granted.body.device.host).to.equal(FIRST);
  });

  it('refuses a host that is not a string', async () => {
    const single = await post({ filters: { platform: 'android', host: '' } });
    expect(single.status).to.equal(400);
    expect(single.body).to.deep.equal({
      error: 'bad_request',
      details: "filters.host must be a server's host",
    });

    const member = await post({ members: [{ filters: { platform: 'android', host: 5 } }] });
    expect(member.status).to.equal(400);
    expect(member.body).to.deep.equal({
      error: 'bad_request',
      details: "members[0].filters.host must be a server's host",
    });
  });
});
