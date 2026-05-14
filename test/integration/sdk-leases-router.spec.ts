import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';

describe('POST /xenon/api/sdk/leases', () => {
  let app: express.Express;
  let leaseSvc: any;

  beforeEach(async () => {
    leaseSvc = {
      create: sinon.stub(),
      heartbeat: sinon.stub(),
      extend: sinon.stub(),
      release: sinon.stub(),
      resolve: sinon.stub(),
    };

    const router = await import('../../src/app/routers/sdk-leases');
    app = express();
    app.use(express.json());
    // Stub req.apiKey + req.auth that the auth middleware would normally set.
    app.use((req: any, _res, next) => {
      req.apiKey = { id: 'actor-1', teamId: 'team-1' };
      req.auth = { teamIds: ['team-1'] };
      next();
    });
    app.use('/xenon/api/sdk/leases', router.makeRouter({ leaseService: leaseSvc }));
  });

  it('returns 201 on happy path', async () => {
    leaseSvc.create.resolves({
      leaseId: 'lse_1',
      leaseToken: 't'.repeat(64),
      device: { udid: 'u1', host: 'h1', platform: 'android' },
      expiresAt: Date.now() + 60_000,
      heartbeatSeconds: 30,
      allocatedPorts: { systemPort: 9001 },
      appiumCapabilities: { 'appium:udid': 'u1', 'xenon:options': { leaseId: 'lse_1' } },
    });
    const res = await request(app)
      .post('/xenon/api/sdk/leases')
      .send({ filters: { platform: 'android' }, durationMs: 60_000, heartbeatSeconds: 30 });
    expect(res.status).to.equal(201);
    expect(res.body.leaseId).to.equal('lse_1');
    expect(res.body.leaseToken).to.match(/^t{64}$/);
  });

  it('returns 404 when no device matches', async () => {
    const { NoMatchingDevice } = await import('../../src/services/lease/LeaseService');
    leaseSvc.create.rejects(new NoMatchingDevice('no device'));
    const res = await request(app)
      .post('/xenon/api/sdk/leases')
      .send({ filters: { platform: 'android', udid: 'absent' }, durationMs: 60_000 });
    expect(res.status).to.equal(404);
    expect(res.body.error).to.equal('no_matching_device');
  });

  it('heartbeat: 200 with valid token; 403 without', async () => {
    leaseSvc.heartbeat.resolves({ heartbeatedAt: Date.now(), expiresAt: Date.now() + 60_000 });
    const res1 = await request(app)
      .post('/xenon/api/sdk/leases/lse_1/heartbeat')
      .set('x-xenon-lease-token', 'cleartext');
    expect(res1.status).to.equal(200);

    const res2 = await request(app).post('/xenon/api/sdk/leases/lse_1/heartbeat');
    expect(res2.status).to.equal(403);
  });

  it('heartbeat: 403 on token mismatch from service', async () => {
    const { LeaseTokenMismatch } = await import('../../src/services/lease/LeaseService');
    leaseSvc.heartbeat.rejects(new LeaseTokenMismatch());
    const res = await request(app)
      .post('/xenon/api/sdk/leases/lse_1/heartbeat')
      .set('x-xenon-lease-token', 'wrong');
    expect(res.status).to.equal(403);
  });

  it('heartbeat: 410 Gone on expired lease', async () => {
    const { LeaseGone } = await import('../../src/services/lease/LeaseService');
    leaseSvc.heartbeat.rejects(new LeaseGone('expired'));
    const res = await request(app)
      .post('/xenon/api/sdk/leases/lse_1/heartbeat')
      .set('x-xenon-lease-token', 'whatever');
    expect(res.status).to.equal(410);
  });
});
