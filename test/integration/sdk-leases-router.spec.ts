import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import sinon from 'sinon';
// Static imports (recordings-router.spec idiom): the previous extensionless
// dynamic `await import(...)` fails to resolve when Node's native ESM loader
// picks the spec up, breaking the whole file under bare `npx mocha`.
import { makeRouter } from '../../src/app/routers/sdk-leases';
import {
  NoMatchingDevice,
  AllMatchingBusy,
  DeviceUnhealthy,
  LeaseTokenMismatch,
  LeaseGone,
} from '../../src/services/lease/LeaseService';

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

    app = express();
    app.use(express.json());
    // Stub req.apiKey + req.auth that the auth middleware would normally set.
    app.use((req: any, _res, next) => {
      req.apiKey = { id: 'actor-1', teamId: 'team-1' };
      req.auth = { teamIds: ['team-1'] };
      next();
    });
    app.use('/xenon/api/sdk/leases', makeRouter({ leaseService: leaseSvc }));
  });

  const grantedBody = () => {
    const device = { udid: 'u1', host: 'h1', platform: 'android' };
    const allocatedPorts = { systemPort: 9001 };
    const appiumCapabilities = {
      'appium:udid': 'u1',
      'xe:options': { leaseId: 'lse_1', leaseToken: 't'.repeat(64), leaseMember: 0 },
    };
    return {
      leaseId: 'lse_1',
      leaseToken: 't'.repeat(64),
      device,
      expiresAt: Date.now() + 60_000,
      heartbeatSeconds: 30,
      allocatedPorts,
      appiumCapabilities,
      members: [{ index: 0, device, allocatedPorts, appiumCapabilities }],
    };
  };

  it('returns 201 on happy path', async () => {
    leaseSvc.create.resolves({ status: 'granted', body: grantedBody() });
    const res = await request(app)
      .post('/xenon/api/sdk/leases')
      .send({ filters: { platform: 'android' }, durationMs: 60_000, heartbeatSeconds: 30 });
    expect(res.status).to.equal(201);
    expect(res.body.leaseId).to.equal('lse_1');
    expect(res.body.leaseToken).to.match(/^t{64}$/);
  });

  it('answers 201 with member 0 as the top-level device when the service grants', async () => {
    leaseSvc.create.resolves({ status: 'granted', body: grantedBody() });
    const res = await request(app)
      .post('/xenon/api/sdk/leases')
      .send({ members: [{ filters: { platform: 'android' } }] });
    expect(res.status).to.equal(201);
    expect(res.body.members).to.have.length(1);
    expect(res.body.members[0].device).to.deep.equal(res.body.device);
    expect(res.body.members[0].appiumCapabilities).to.deep.equal(res.body.appiumCapabilities);
  });

  it('answers 202 with the waiting body when the service queues the request', async () => {
    const waiting = {
      leaseId: 'lse_w',
      leaseToken: 'w'.repeat(64),
      status: 'waiting',
      position: 2,
      waitUntil: Date.now() + 60_000,
      heartbeatSeconds: 30,
    };
    leaseSvc.create.resolves({ status: 'waiting', body: waiting });
    const res = await request(app)
      .post('/xenon/api/sdk/leases')
      .send({
        members: [{ filters: { platform: 'android' } }, { filters: { platform: 'ios' } }],
        waitMs: 60_000,
      });
    expect(res.status).to.equal(202);
    expect(res.body).to.deep.equal(waiting);
    const args = leaseSvc.create.firstCall.args[0];
    expect(args.waitMs).to.equal(60_000);
    expect(args.members).to.deep.equal([
      { filters: { platform: 'android' } },
      { filters: { platform: 'ios' } },
    ]);
  });

  it('passes waitMs 0 when the request sends none', async () => {
    leaseSvc.create.resolves({ status: 'granted', body: grantedBody() });
    await request(app)
      .post('/xenon/api/sdk/leases')
      .send({ filters: { platform: 'android' } });
    expect(leaseSvc.create.firstCall.args[0].waitMs).to.equal(0);
  });

  const nineMembers = Array.from({ length: 9 }, () => ({ filters: { platform: 'android' } }));
  for (const [what, body] of [
    [
      'both filters and members',
      { filters: { platform: 'android' }, members: [{ filters: { platform: 'android' } }] },
    ],
    ['no members', { members: [] }],
    ['nine members', { members: nineMembers }],
    ['members that is not a list', { members: { filters: { platform: 'android' } } }],
    [
      'a member without filters.platform',
      { members: [{ filters: { platform: 'android' } }, { filters: {} }] },
    ],
    ['a member without filters', { members: [{ platform: 'android' }] }],
    ['neither filters nor members', {}],
    ['waitMs -1', { filters: { platform: 'android' }, waitMs: -1 }],
    ['waitMs 3,600,001', { filters: { platform: 'android' }, waitMs: 3_600_001 }],
    ['waitMs that is not an integer', { filters: { platform: 'android' }, waitMs: 1.5 }],
    ['waitMs as text', { filters: { platform: 'android' }, waitMs: '1000' }],
  ] as const) {
    it(`answers 400 bad_request for ${what}`, async () => {
      const res = await request(app).post('/xenon/api/sdk/leases').send(body);
      expect(res.status).to.equal(400);
      expect(res.body.error).to.equal('bad_request');
      expect(leaseSvc.create.called).to.equal(false);
    });
  }

  it('accepts 8 members and waitMs 3,600,000', async () => {
    leaseSvc.create.resolves({ status: 'granted', body: grantedBody() });
    const res = await request(app)
      .post('/xenon/api/sdk/leases')
      .send({ members: nineMembers.slice(0, 8), waitMs: 3_600_000 });
    expect(res.status).to.equal(201);
  });

  it('answers 409 all_matching_busy with retryAfterMs', async () => {
    leaseSvc.create.rejects(new AllMatchingBusy('busy'));
    const res = await request(app)
      .post('/xenon/api/sdk/leases')
      .send({ filters: { platform: 'android' } });
    expect(res.status).to.equal(409);
    expect(res.body).to.deep.equal({ error: 'all_matching_busy', retryAfterMs: 2_000 });
  });

  it('answers 503 device_unhealthy', async () => {
    leaseSvc.create.rejects(new DeviceUnhealthy('port allocation failed'));
    const res = await request(app)
      .post('/xenon/api/sdk/leases')
      .send({ filters: { platform: 'android' } });
    expect(res.status).to.equal(503);
    expect(res.body.error).to.equal('device_unhealthy');
  });

  it('records the api-key principal as actor/team on create', async () => {
    leaseSvc.create.resolves({ status: 'granted', body: grantedBody() });
    await request(app)
      .post('/xenon/api/sdk/leases')
      .send({ filters: { platform: 'android' } });
    expect(leaseSvc.create.calledOnce).to.equal(true);
    expect(leaseSvc.create.firstCall.args[0]).to.include({
      actorId: 'actor-1',
      teamId: 'team-1',
    });
  });

  // IMPORTANT 4 (Phase 2a review): the bearer-auth path sets req.auth (with
  // userId/teamId) but never req.apiKey — the pre-fix handler read req.apiKey
  // only, so a bearer-authed xenon_acquire_device recorded actorId:'anonymous',
  // teamId:null. Prove a bearer principal's identity is recorded on the lease.
  it('records the bearer principal (req.auth, no req.apiKey) as actor/team on create', async () => {
    const bearerApp = express();
    bearerApp.use(express.json());
    bearerApp.use((req: any, _res, next) => {
      req.auth = {
        kind: 'bearer',
        userId: 'bearer-user-1',
        role: 'MEMBER',
        scopes: 'devices',
        teamId: 'team-9',
        rateLimit: 100,
      };
      next();
    });
    bearerApp.use('/xenon/api/sdk/leases', makeRouter({ leaseService: leaseSvc }));

    leaseSvc.create.resolves({ status: 'granted', body: grantedBody() });
    const res = await request(bearerApp)
      .post('/xenon/api/sdk/leases')
      .send({ filters: { platform: 'android' } });
    expect(res.status).to.equal(201);
    expect(leaseSvc.create.calledOnce).to.equal(true);
    expect(leaseSvc.create.firstCall.args[0]).to.include({
      actorId: 'bearer-user-1',
      teamId: 'team-9',
    });
  });

  it('returns 404 when no device matches', async () => {
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
    leaseSvc.heartbeat.rejects(new LeaseTokenMismatch());
    const res = await request(app)
      .post('/xenon/api/sdk/leases/lse_1/heartbeat')
      .set('x-xenon-lease-token', 'wrong');
    expect(res.status).to.equal(403);
  });

  it('heartbeat: 410 Gone on expired lease', async () => {
    leaseSvc.heartbeat.rejects(new LeaseGone('expired'));
    const res = await request(app)
      .post('/xenon/api/sdk/leases/lse_1/heartbeat')
      .set('x-xenon-lease-token', 'whatever');
    expect(res.status).to.equal(410);
  });
});
