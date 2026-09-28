import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';
import DashboardRouter from '../../src/app/routers/dashboard';
import { createRouter } from '../../src/app/index';

/**
 * Session files (screenshots, video, performance traces) are stored under
 * `sessionAssetsPath/<sessionId>/<kind>/<file>`. They used to be served by an
 * express.static mount at /xenon/session-recordings, outside the API's login,
 * so anyone who had a session id could fetch them, along with every
 * recording and interceptor capture under the same folder. They are now
 * served by GET /xenon/api/session/:sessionId/asset/:kind/:file, behind the
 * login and the same team check as the session itself.
 */

const SESSIONS: Record<string, { id: string; device_udid: string; user_id: string | null }> = {
  'sess-shared': { id: 'sess-shared', device_udid: 'shared', user_id: 'someone' },
  'sess-b': { id: 'sess-b', device_udid: 'phone-b', user_id: 'someone' },
};
const DEVICES = [
  { udid: 'shared', teamId: null },
  { udid: 'phone-b', teamId: 'team-b' },
];

describe('session files', () => {
  let dir: string;
  let savedPath: string;

  function app(auth: Record<string, unknown>) {
    const a = express();
    a.use((req: any, _res, next) => {
      req.auth = auth;
      next();
    });
    DashboardRouter.register(a as any);
    return a;
  }
  const member = {
    kind: 'user-session',
    userId: 'u-a',
    role: 'MEMBER',
    scopes: ['read'],
    teamIds: ['team-a'],
  };
  const admin = {
    kind: 'user-session',
    userId: 'adm',
    role: 'ADMIN',
    scopes: ['admin'],
    teamIds: undefined,
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-session-assets-'));
    savedPath = config.sessionAssetsPath;
    config.sessionAssetsPath = dir;
    for (const id of Object.keys(SESSIONS)) {
      for (const kind of ['screenshots', 'video', 'performance', 'interceptor']) {
        fs.mkdirSync(path.join(dir, id, kind), { recursive: true });
      }
      fs.writeFileSync(path.join(dir, id, 'screenshots', 'shot.png'), `png of ${id}`);
      fs.writeFileSync(path.join(dir, id, 'video', `${id}.mp4`), '0123456789');
      fs.writeFileSync(path.join(dir, id, 'interceptor', 'session.har'), 'HAR-SECRET');
    }
    fs.mkdirSync(path.join(dir, 'recordings', 'grp'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'recordings', 'grp', 'composite.mp4'), 'COMPOSITE-SECRET');
    sinon
      .stub(prisma.session, 'findFirst')
      .callsFake((async (args: any) => SESSIONS[args.where.id] ?? null) as any);
    sinon
      .stub(prisma.session, 'findUnique')
      .callsFake((async (args: any) => SESSIONS[args.where.id] ?? null) as any);
    sinon.stub(prisma.device, 'findMany').callsFake((async (args: any) => {
      const udid = args?.where?.udid;
      return DEVICES.filter((d) => udid === undefined || d.udid === udid).map((d) => ({ ...d }));
    }) as any);
  });

  afterEach(() => {
    sinon.restore();
    config.sessionAssetsPath = savedPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("serves a visible session's screenshot to a member", async () => {
    const r = await request(app(member)).get('/session/sess-shared/asset/screenshots/shot.png');
    expect(r.status).to.equal(200);
    expect(String(r.body)).to.equal('png of sess-shared');
  });

  it('serves a video with Range, for seeking', async () => {
    const r = await request(app(member))
      .get('/session/sess-shared/asset/video/sess-shared.mp4')
      .set('Range', 'bytes=2-4');
    expect(r.status).to.equal(206);
    expect(String(r.body)).to.equal('234');
  });

  it("answers another team's session exactly as an unknown one", async () => {
    // The unknown-id answer names the id it was asked for.
    const unknownBody = (id: string) => ({
      error: true,
      message: `Session with id ${id} not found`,
    });
    const hidden = await request(app(member)).get('/session/sess-b/asset/screenshots/shot.png');
    const unknown = await request(app(member)).get('/session/sess-nope/asset/screenshots/shot.png');
    expect(unknown.status).to.equal(404);
    expect(unknown.body).to.deep.equal(unknownBody('sess-nope'));
    expect(hidden.status).to.equal(404);
    expect(hidden.body).to.deep.equal(unknownBody('sess-b'));
  });

  it("an admin gets another team's session file", async () => {
    const r = await request(app(admin)).get('/session/sess-b/asset/screenshots/shot.png');
    expect(r.status).to.equal(200);
    expect(String(r.body)).to.equal('png of sess-b');
  });

  it('never serves interceptor captures, or anything outside the three folders', async () => {
    for (const url of [
      '/session/sess-shared/asset/interceptor/session.har',
      '/session/sess-shared/asset/screenshots/..',
      '/session/sess-shared/asset/screenshots/.hidden',
      '/session/sess-shared/asset/screenshots/%2e%2e%2finterceptor%2fsession.har',
      '/session/sess-shared/asset/video/..%2f..%2frecordings%2fgrp%2fcomposite.mp4',
    ]) {
      const r = await request(app(admin)).get(url);
      expect(r.status, url).to.equal(404);
      expect(r.text, url).to.not.include('HAR-SECRET');
      expect(r.text, url).to.not.include('COMPOSITE-SECRET');
    }
  });

  it('a missing file in a visible session is a JSON 404', async () => {
    const r = await request(app(member)).get('/session/sess-shared/asset/screenshots/none.png');
    expect(r.status).to.equal(404);
    expect(r.body).to.have.property('error');
  });

  describe('the old /xenon/session-recordings mount', () => {
    let probeDir: string;
    const secret = `probe-${Date.now()}`;

    beforeEach(() => {
      // The mount captured the real path when src/app/index was loaded.
      probeDir = path.join(savedPath, `__probe-${process.pid}-${Date.now()}`);
      fs.mkdirSync(probeDir, { recursive: true });
      fs.writeFileSync(path.join(probeDir, 'secret.txt'), secret);
    });

    afterEach(() => fs.rmSync(probeDir, { recursive: true, force: true }));

    it('no longer serves session files to a caller with no login', async () => {
      const a = express();
      a.use('/xenon', createRouter({ bindHostOrIp: '127.0.0.1', enableDashboard: true } as any));
      const r = await request(a).get(
        `/xenon/session-recordings/${path.basename(probeDir)}/secret.txt`,
      );
      expect(r.text).to.not.include(secret);
    });
  });
});
