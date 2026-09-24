import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';
import { BugReportService } from '../../../src/services/bug-report/BugReportService';
import bugReportRouter from '../../../src/app/routers/bug-report';

// The router is behind roleGuard('MEMBER'), which reads the req.auth that
// authMiddleware sets in the real app. Stand in for it with a signed-in member.
function makeApp({ signedIn = true } = {}) {
  const app = express();
  if (signedIn) {
    app.use((req: any, _res, next) => {
      req.auth = { kind: 'user-session', userId: 'u1', role: 'MEMBER', scopes: ['devices', 'sessions', 'read'], teamIds: [] };
      next();
    });
  }
  bugReportRouter.register(app as any);
  return app;
}

describe('bug-report route', () => {
  afterEach(() => sinon.restore());

  it('401 when the caller is not signed in', async () => {
    const res = await request(makeApp({ signedIn: false })).post('/sessions/sess-1/bug-report?mode=full');
    expect(res.status).to.equal(401);
  });

  it('400 on invalid mode', async () => {
    const res = await request(makeApp()).post('/sessions/sess-1/bug-report?mode=bogus');
    expect(res.status).to.equal(400);
  });

  it('400 on out-of-range windowSec', async () => {
    const res = await request(makeApp()).post(
      '/sessions/sess-1/bug-report?mode=slice&windowSec=9999',
    );
    expect(res.status).to.equal(400);
  });

  it('404 when service throws not-found', async () => {
    sinon
      .stub(BugReportService.prototype, 'assemble')
      .rejects(new Error('Session sess-1 not found'));
    const res = await request(makeApp()).post('/sessions/sess-1/bug-report?mode=full');
    expect(res.status).to.equal(404);
  });

  it('200 streams zip on success', async () => {
    sinon.stub(BugReportService.prototype, 'assemble').resolves({
      filename: 'bugreport-sess-1.zip',
      manifest: { warnings: [] } as any,
      entries: [{ name: 'a.txt', source: { kind: 'buffer', data: Buffer.from('hi') } }],
      cleanup: async () => {},
    });
    const res = await request(makeApp())
      .post('/sessions/sess-1/bug-report?mode=full')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c as Buffer));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).to.equal(200);
    expect(res.headers['content-type']).to.equal('application/zip');
    expect(res.headers['content-disposition']).to.include('bugreport-sess-1.zip');
  });
});
