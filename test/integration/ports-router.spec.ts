import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import sinon from 'sinon';

describe('POST /xenon/api/ports/allocate and /extend', () => {
  let app: express.Express;
  let allocateStub: sinon.SinonStub;
  let extendStub: sinon.SinonStub;

  beforeEach(async () => {
    allocateStub = sinon.stub().resolves({ systemPort: 9001, chromedriverPort: 9002 });
    extendStub = sinon.stub().resolves({ extended: 2 });

    const router = await import('../../src/app/routers/ports');
    app = express();
    app.use(express.json());

    // Skip auth in this isolation: register only the route handler.
    app.use(
      '/xenon/api/ports',
      router.makeRouter({ allocator: { allocate: allocateStub, extend: extendStub } as any }),
    );
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
  it('extend answers 200 with how many ports it moved', async () => {
    const expiresAt = Date.now() + 60 * 60_000;
    const res = await request(app)
      .post('/xenon/api/ports/extend')
      .send({ udid: 'u1', ports: [9001, 9002], expiresAt });
    expect(res.status).to.equal(200);
    expect(res.body).to.deep.equal({ extended: 2 });
    expect(extendStub.firstCall.args[0]).to.deep.equal({
      udid: 'u1',
      ports: [9001, 9002],
      expiresAt,
    });
  });

  for (const [what, body] of [
    ['no udid', { ports: [9001], expiresAt: 1 }],
    ['no ports', { udid: 'u1', expiresAt: 1 }],
    ['an empty port list', { udid: 'u1', ports: [], expiresAt: 1 }],
    ['a port that is not a number', { udid: 'u1', ports: ['9001'], expiresAt: 1 }],
    ['no expiresAt', { udid: 'u1', ports: [9001] }],
  ] as const) {
    it(`extend answers 400 for ${what}`, async () => {
      const res = await request(app).post('/xenon/api/ports/extend').send(body);
      expect(res.status).to.equal(400);
      expect(extendStub.called).to.equal(false);
    });
  }
});
