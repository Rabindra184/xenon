import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';

describe('POST /xenon/api/ports/allocate', () => {
  let app: express.Express;
  let allocateStub: sinon.SinonStub;

  beforeEach(async () => {
    allocateStub = sinon.stub().resolves({ systemPort: 9001, chromedriverPort: 9002 });

    const router = await import('../../src/app/routers/ports');
    app = express();
    app.use(express.json());

    // Skip auth in this isolation: register only the route handler.
    app.use('/xenon/api/ports', router.makeRouter({ allocator: { allocate: allocateStub } as any }));
  });

  it('returns 200 with the allocated ports', async () => {
    const res = await request(app)
      .post('/xenon/api/ports/allocate')
      .send({ udid: 'u1', host: 'h1', purposes: ['systemPort', 'chromedriverPort'], durationMs: 60_000 });
    expect(res.status).to.equal(200);
    expect(res.body.ports).to.deep.equal({ systemPort: 9001, chromedriverPort: 9002 });
    expect(allocateStub.calledOnce).to.equal(true);
  });

  it('returns 400 when purposes is missing or empty', async () => {
    const res = await request(app)
      .post('/xenon/api/ports/allocate')
      .send({ udid: 'u1', host: 'h1', durationMs: 60_000 });
    expect(res.status).to.equal(400);
  });

  it('returns 500 on allocator failure', async () => {
    allocateStub.rejects(new Error('boom'));
    const res = await request(app)
      .post('/xenon/api/ports/allocate')
      .send({ udid: 'u1', host: 'h1', purposes: ['systemPort'], durationMs: 60_000 });
    expect(res.status).to.equal(500);
  });
});
