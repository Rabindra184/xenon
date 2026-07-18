import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import RecordingsRouter from '../../src/app/routers/recordings';
import {
  RecordingOrchestrator,
  RecordingError,
} from '../../src/services/recording/RecordingOrchestrator';

function makeApp() {
  const app = express();
  app.use(express.json());
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
