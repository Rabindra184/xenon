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
 * A lease's `tags` filter asks for phones carrying every tag; there was no way
 * to keep a class of phones out. A lab had to give every phone exactly one
 * pool tag (`xt-pool:ci`, `xt-pool:authoring`) so CI and exploratory work
 * never took each other's phones (Xenon Test's ENH-10). `excludeTags` leaves
 * out phones carrying any of its tags, wherever a lease's phones are picked.
 */
describe('A lease that excludes tags', () => {
  const scratch = useScratchDatabase({ wholeSuite: true });
  usePrismaStores();
  useOwnNodeId();

  const HOST = 'http://127.0.0.1:4723';
  const noAuth = { nodePairAuth: async () => ({ accessKey: '', token: '' }) };
  let app: express.Express;

  const phone = (udid: string, tags: string[]) =>
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
        realDevice: true,
        tags: JSON.stringify(tags),
      } as any,
    });

  const post = (body: Record<string, unknown>) =>
    request(app)
      .post('/sdk/leases')
      .send({ durationMs: 600_000, heartbeatSeconds: 30, ...body });
  const udidOf = (res: any) => res.body.device?.udid ?? res.body.members?.[0]?.device?.udid;

  beforeEach(async () => {
    sinon.stub(process, 'kill');
    await scratch.db.portLease.deleteMany({});
    await scratch.db.lease.deleteMany({});
    await scratch.db.device.deleteMany({});
    await scratch.db.deviceSetting.deleteMany({});
    await phone('CI', ['ci']);
    await phone('AUTH', ['authoring']);
    await phone('FREE', []);
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

  it('never takes a phone carrying an excluded tag', async () => {
    const filters = { platform: 'android', excludeTags: ['authoring'] };
    const first = await post({ filters });
    const second = await post({ filters });
    const third = await post({ filters });

    expect([udidOf(first), udidOf(second)].sort()).to.deep.equal(['CI', 'FREE']);
    // The only phone left carries the excluded tag: busy for this request.
    expect(third.status).to.equal(409);
  });

  it('answers no_matching_device when every phone carries an excluded tag', async () => {
    const res = await post({
      filters: { platform: 'android', excludeTags: ['ci', 'authoring', 'x'], udid: 'CI' },
    });
    expect(res.status).to.equal(404);
    expect(res.body.error).to.equal('no_matching_device');
  });

  it('applies with tags, and per member of a group', async () => {
    const res = await post({
      members: [
        { filters: { platform: 'android', excludeTags: ['ci', 'authoring'] } },
        { filters: { platform: 'android', tags: ['ci'] } },
      ],
    });

    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    expect(res.body.members.map((m: any) => m.device.udid)).to.deep.equal(['FREE', 'CI']);
  });

  it('is kept by a waiting lease, which is never granted an excluded phone', async () => {
    const ci = await post({ filters: { platform: 'android', udid: 'CI' } });
    const free = await post({ filters: { platform: 'android', udid: 'FREE' } });
    const waiting = await post({
      filters: { platform: 'android', excludeTags: ['authoring'] },
      waitMs: 60_000,
    });
    expect(waiting.status, JSON.stringify(waiting.body)).to.equal(202);

    // AUTH is free the whole time, and isn't the waiter's.
    const auth = await scratch.db.device.findUnique({
      where: { udid_host: { udid: 'AUTH', host: HOST } },
    });
    expect(auth?.busy).to.equal(false);

    await request(app)
      .delete(`/sdk/leases/${free.body.leaseId}`)
      .set('x-xenon-lease-token', free.body.leaseToken);
    const granted = await request(app)
      .get(`/sdk/leases/${waiting.body.leaseId}?waitMs=5000`)
      .set('x-xenon-lease-token', waiting.body.leaseToken);

    expect(granted.status, JSON.stringify(granted.body)).to.equal(200);
    expect(udidOf(granted)).to.equal('FREE');
    void ci;
  });

  it('refuses an excludeTags that is not a list of tags', async () => {
    for (const excludeTags of ['ci', [''], [1], {}]) {
      const res = await post({ filters: { platform: 'android', excludeTags } });
      expect(res.status, JSON.stringify(excludeTags)).to.equal(400);
      expect(res.body.details ?? res.body.message ?? res.body.error).to.match(/excludeTags/);
    }
    const member = await post({
      members: [{ filters: { platform: 'android', excludeTags: [''] } }],
    });
    expect(member.status).to.equal(400);
  });
});
