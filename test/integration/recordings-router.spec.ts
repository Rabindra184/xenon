import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import RecordingsRouter from '../../src/app/routers/recordings';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import {
  RecordingOrchestrator,
  RecordingError,
} from '../../src/services/recording/RecordingOrchestrator';

interface Caller {
  userId?: string;
  role?: 'MEMBER' | 'ADMIN' | 'SUPER_ADMIN';
  apiKeyId?: string;
}

/**
 * The recordings router carries `roleGuard('MEMBER')` (recordings.ts:39), added
 * in 27fd825 — after this spec was written in 3430928. Mounting the router with
 * no `req.auth` therefore 401s at the guard before any handler runs, which left
 * these tests red. Stand in for authMiddleware the same way makeBearerApp below
 * does, so they exercise the handlers they were written to cover.
 *
 * Scopes come from the real `scopesForRole` map rather than a literal: a
 * hardcoded scope string in a test is how #217's gap stayed hidden — MEMBER was
 * granted `devices` only inside the test harness, never by the product.
 */
function makeApp(caller: Caller = {}) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    const role = caller.role ?? 'MEMBER';
    req.auth = {
      kind: caller.apiKeyId ? 'api-key' : 'user-session',
      userId: caller.userId ?? 'u1',
      role,
      scopes: scopesForRole(role),
      apiKeyId: caller.apiKeyId,
      rateLimit: 100,
    };
    if (caller.apiKeyId) {
      req.apiKey = { id: caller.apiKeyId, scopes: scopesForRole(role), rateLimit: 100 };
    }
    next();
  });
  const r = express.Router();
  RecordingsRouter.register(r);
  app.use('/xenon/api', r);
  return app;
}

describe('Recordings router (integration)', () => {
  afterEach(() => sinon.restore());

  it('POST /recordings: 202 happy path', async () => {
    sinon.stub(Container.get(RecordingOrchestrator), 'start').resolves({
      groupId: 'g-1',
      recordings: [{ id: 'r-1', udid: 'U1', status: 'RECORDING' }],
      startedAt: new Date(),
      compositeEnabled: false,
    });
    const r = await request(makeApp())
      .post('/xenon/api/recordings')
      .send({ udids: ['U1'] });
    expect(r.status).to.equal(202);
    expect(r.body.groupId).to.equal('g-1');
  });

  it('POST /recordings: 409 device_busy carries busyDevices payload', async () => {
    sinon
      .stub(Container.get(RecordingOrchestrator), 'start')
      .rejects(
        new RecordingError('device_busy', [
          { udid: 'U2', reason: 'automation', sessionId: 'sess-x' },
        ]),
      );
    const r = await request(makeApp())
      .post('/xenon/api/recordings')
      .send({ udids: ['U1', 'U2'] });
    expect(r.status).to.equal(409);
    expect(r.body.error).to.equal('device_busy');
    expect(r.body.busyDevices).to.have.length(1);
    expect(r.body.busyDevices[0]).to.deep.include({ udid: 'U2', reason: 'automation' });
    expect(r.body.message).to.contain('Recording was not started');
  });

  it('POST /recordings: 409 concurrency_cap with limit/active', async () => {
    sinon
      .stub(Container.get(RecordingOrchestrator), 'start')
      .rejects(new RecordingError('concurrency_cap', undefined, 4, 4));
    const r = await request(makeApp())
      .post('/xenon/api/recordings')
      .send({ udids: ['U1'] });
    expect(r.status).to.equal(409);
    expect(r.body).to.deep.include({ error: 'concurrency_cap', limit: 4, active: 4 });
  });

  it('POST /recordings: 400 when udids missing or empty', async () => {
    const app = makeApp();
    await request(app).post('/xenon/api/recordings').send({}).expect(400);
    await request(app).post('/xenon/api/recordings').send({ udids: [] }).expect(400);
    await request(app).post('/xenon/api/recordings').send({ udids: [123] }).expect(400);
  });

  it('POST /recordings/:groupId/stop: 200', async () => {
    sinon.stub(Container.get(RecordingOrchestrator), 'stop').resolves({
      groupId: 'g-1',
      recordings: [{ id: 'r-1', udid: 'U1', status: 'STOPPED', durationMs: 5000, sizeBytes: 1024 }],
    });
    const r = await request(makeApp()).post('/xenon/api/recordings/g-1/stop');
    expect(r.status).to.equal(200);
    expect(r.body.recordings[0].status).to.equal('STOPPED');
  });

  it('POST /recordings/:groupId/bookmark: 201 + 400 validation', async () => {
    sinon
      .stub(Container.get(RecordingOrchestrator), 'addBookmark')
      .resolves({ id: 'bm-1', label: 'bug here' } as any);
    const ok = await request(makeApp())
      .post('/xenon/api/recordings/g-1/bookmark')
      .send({ recordingId: 'r-1', timecodeMs: 1000, label: 'bug here' });
    expect(ok.status).to.equal(201);
    const bad = await request(makeApp())
      .post('/xenon/api/recordings/g-1/bookmark')
      .send({ timecodeMs: 1000 });
    expect(bad.status).to.equal(400);
  });

  // CRITICAL 1 (Phase 2a review): the bearer-auth path sets req.auth (with
  // req.auth.userId) but never req.apiKey, so the pre-fix actorId derivation
  // (`req.apiKey?.id` only) 401s every bearer-authed caller. These specs set
  // up req.auth exactly like the bearer middleware would, WITHOUT req.apiKey,
  // to prove bearer principals can reach the handler (no 401).
  function makeBearerApp() {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.auth = {
        kind: 'bearer',
        userId: 'u1',
        role: 'MEMBER',
        scopes: 'devices',
        rateLimit: 100,
      };
      next();
    });
    const r = express.Router();
    RecordingsRouter.register(r);
    app.use('/xenon/api', r);
    return app;
  }

  it('POST /recordings: bearer principal (req.auth.userId, no req.apiKey) is not 401', async () => {
    sinon.stub(Container.get(RecordingOrchestrator), 'start').resolves({
      groupId: 'g-1',
      recordings: [{ id: 'r-1', udid: 'U1', status: 'RECORDING' }],
      startedAt: new Date(),
      compositeEnabled: false,
    });
    const r = await request(makeBearerApp())
      .post('/xenon/api/recordings')
      .send({ udids: ['U1'] });
    expect(r.status).to.equal(202);
  });

  it('POST /recordings/:groupId/add-device: bearer principal (req.auth.userId, no req.apiKey) is not 401', async () => {
    sinon.stub(Container.get(RecordingOrchestrator), 'addDevice').resolves({
      groupId: 'g-1',
      recordings: [{ id: 'r-2', udid: 'U2', status: 'RECORDING' }],
    } as any);
    const r = await request(makeBearerApp())
      .post('/xenon/api/recordings/g-1/add-device')
      .send({ udid: 'U2' });
    expect(r.status).to.equal(201);
  });

  // Manual locks are keyed on the USER (see deviceAccessPolicy.ts). This path
  // used to key them on req.apiKey.id, so a recording started from the SDK
  // wrote manual_<keyId>_<udid> and the SAME human on the dashboard — who
  // arrives with a cookie session and no req.apiKey — got 409
  // device_held_by_another_user naming a key id they'd never seen.
  function makeHeaderPairApp() {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      // authMiddleware's api-key header-pair branch sets BOTH, in different
      // id spaces. The old `req.apiKey?.id ?? auth.userId` picked the key id.
      req.auth = {
        kind: 'api-key',
        userId: 'usr_alice',
        role: 'MEMBER',
        scopes: 'devices',
        apiKeyId: 'key_abc',
        rateLimit: 100,
      };
      req.apiKey = { id: 'key_abc', scopes: 'devices', rateLimit: 100 };
      next();
    });
    const r = express.Router();
    RecordingsRouter.register(r);
    app.use('/xenon/api', r);
    return app;
  }

  it('POST /recordings: locks on the userId, not the api-key id', async () => {
    const start = sinon.stub(Container.get(RecordingOrchestrator), 'start').resolves({
      groupId: 'g-1',
      recordings: [{ id: 'r-1', udid: 'U1', status: 'RECORDING' }],
      startedAt: new Date(),
      compositeEnabled: false,
    });
    const r = await request(makeHeaderPairApp())
      .post('/xenon/api/recordings')
      .send({ udids: ['U1'] });
    expect(r.status).to.equal(202);
    expect(start.calledOnce).to.equal(true);
    expect(start.firstCall.args[0].actorId).to.equal('usr_alice');
  });

  it('POST /recordings/:groupId/add-device: locks on the userId, not the api-key id', async () => {
    const addDevice = sinon.stub(Container.get(RecordingOrchestrator), 'addDevice').resolves({
      groupId: 'g-1',
      recordings: [{ id: 'r-2', udid: 'U2', status: 'RECORDING' }],
    } as any);
    const r = await request(makeHeaderPairApp())
      .post('/xenon/api/recordings/g-1/add-device')
      .send({ udid: 'U2' });
    expect(r.status).to.equal(201);
    expect(addDevice.calledOnce).to.equal(true);
    expect(addDevice.firstCall.args[2]).to.equal('usr_alice');
  });

  it('POST /recordings/:groupId/annotation: 201 + 400 validation', async () => {
    sinon
      .stub(Container.get(RecordingOrchestrator), 'addAnnotation')
      .resolves({ id: 'an-1' } as any);
    const ok = await request(makeApp())
      .post('/xenon/api/recordings/g-1/annotation')
      .send({
        recordingId: 'r-1',
        timecodeMs: 1000,
        shape: 'RECT',
        geometry: '{"x":0.1,"y":0.1,"w":0.2,"h":0.2}',
        color: '#ff0000',
      });
    expect(ok.status).to.equal(201);
    const bad = await request(makeApp())
      .post('/xenon/api/recordings/g-1/annotation')
      .send({ shape: 'RECT' });
    expect(bad.status).to.equal(400);
  });
});
