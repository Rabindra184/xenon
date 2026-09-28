import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import sinon from 'sinon';
import { BugReportService } from '../../../src/services/bug-report/BugReportService';
import bugReportRouter from '../../../src/app/routers/bug-report';
import { prisma } from '../../../src/prisma';

// The router is behind roleGuard('MEMBER'), which reads the req.auth that
// authMiddleware sets in the real app. Stand in for it with a signed-in member.
function makeApp({ signedIn = true, admin = false } = {}) {
  const teamIds = admin ? undefined : [];
  const app = express();
  if (signedIn) {
    app.use((req: any, _res, next) => {
      req.auth = { kind: 'user-session', userId: 'u1', role: 'MEMBER', scopes: ['devices', 'sessions', 'read'], teamIds };
      next();
    });
  }
  bugReportRouter.register(app as any);
  return app;
}

// sess-1 runs on a shared phone, sess-b on team B's phone.
const SESSIONS: Record<string, { device_udid: string; user_id: string | null }> = {
  'sess-1': { device_udid: 'shared', user_id: 'someone' },
  'sess-b': { device_udid: 'phone-b', user_id: 'someone' },
};
const DEVICES = [
  { udid: 'shared', teamId: null },
  { udid: 'phone-b', teamId: 'team-b' },
];

describe('bug-report route', () => {
  beforeEach(() => {
    sinon
      .stub(prisma.session, 'findUnique')
      .callsFake((async (args: any) => SESSIONS[args.where.id] ?? null) as any);
    sinon.stub(prisma.device, 'findMany').callsFake((async (args: any) => {
      const udid = args?.where?.udid;
      return DEVICES.filter((d) => udid === undefined || d.udid === udid).map((d) => ({ ...d }));
    }) as any);
  });
  afterEach(() => sinon.restore());

  it("answers another team's session exactly as an unknown one, and builds nothing", async () => {
    const assemble = sinon
      .stub(BugReportService.prototype, 'assemble')
      .callsFake(async (opts: any) => {
        if (opts.sessionId === 'sess-nope') throw new Error(`Session ${opts.sessionId} not found`);
        throw new Error('built a report');
      });
    const hidden = await request(makeApp()).post('/sessions/sess-b/bug-report?mode=full');
    const unknown = await request(makeApp()).post('/sessions/sess-nope/bug-report?mode=full');
    expect(hidden.status).to.equal(404);
    expect(unknown.status).to.equal(404);
    expect(hidden.body).to.deep.equal({ error: 'Session sess-b not found' });
    expect(unknown.body).to.deep.equal({ error: 'Session sess-nope not found' });
    expect(assemble.calledWithMatch({ sessionId: 'sess-b' })).to.equal(false);
  });

  it("an admin still gets another team's session", async () => {
    sinon.stub(BugReportService.prototype, 'assemble').resolves({
      filename: 'bugreport-sess-b.zip',
      manifest: { warnings: [] } as any,
      entries: [{ name: 'a.txt', source: { kind: 'buffer', data: Buffer.from('hi') } }],
      cleanup: async () => {},
    });
    const res = await request(makeApp({ admin: true })).post(
      '/sessions/sess-b/bug-report?mode=full',
    );
    expect(res.status).to.equal(200);
  });

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
