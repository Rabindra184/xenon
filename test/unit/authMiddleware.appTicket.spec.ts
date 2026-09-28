import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { StreamTicketService } from '../../src/services/token/StreamTicketService';
import { AppDownloadTicketService } from '../../src/services/token/AppDownloadTicketService';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import AppsRouter from '../../src/app/routers/apps';
import ControlRouter from '../../src/app/routers/control';
import { APP_SERVICE } from '../../src/dashboard/services/app-service';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { UserService } from '../../src/services/UserService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserSessionService } from '../../src/services/UserSessionService';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * An Appium driver downloads a session's app from
 * /xenon/api/apps/<id>/download?ticket=<t> with no credentials. The ticket is
 * accepted in place of a login on that one route, for the app it names, once.
 *
 * Every failure is the same 401 `invalid ticket`, whichever app the URL names,
 * so a ticket can't be used to learn whether some other app exists.
 */
const BYTES = Buffer.from('PK\u0003\u0004 not really an apk, but bytes all the same');

describe('authMiddleware — app download ticket', () => {
  let dir: string;
  let files: string;
  let app: express.Express;
  let tickets: AppDownloadTicketService;
  let streams: StreamTicketService;
  let restore: () => void;

  beforeEach(async () => {
    restore = saveRegistrations(
      JwtKeyService,
      StreamTicketService,
      AppDownloadTicketService,
      UserService,
      ApiKeyService,
      UserSessionService,
    );
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-app-ticket-mw-'));
    const keys = new JwtKeyService();
    await keys.init(dir);
    Container.set(JwtKeyService, keys);
    tickets = new AppDownloadTicketService();
    Container.set(AppDownloadTicketService, tickets);
    streams = new StreamTicketService();
    Container.set(StreamTicketService, streams);
    Container.set(UserService, { findById: sinon.stub().resolves(null) } as any);
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().resolves(null),
      verify: sinon.stub().resolves(null),
    } as any);
    Container.set(UserSessionService, { resolve: sinon.stub().resolves(null) } as any);

    // Under a dot-segment, like ~/.cache/xenon/apps: DOWNLOAD_OPTIONS must
    // reach res.download on the ticket path too.
    files = path.join(dir, '.cache', 'xenon', 'apps');
    fs.mkdirSync(files, { recursive: true });
    const rows: Record<string, any> = {
      'app-A': {
        id: 'app-A',
        filename: 'a.apk',
        filepath: path.join(files, 'app-A.apk'),
        teamId: 'team-b',
      },
      'app-B': {
        id: 'app-B',
        filename: 'b.apk',
        filepath: path.join(files, 'app-B.apk'),
        teamId: null,
      },
    };
    fs.writeFileSync(rows['app-A'].filepath, BYTES);
    fs.writeFileSync(rows['app-B'].filepath, Buffer.from('the other app'));
    sinon.stub(APP_SERVICE, 'getAppById').callsFake(async (id: string) => rows[id] ?? null);
    sinon
      .stub(DeviceStoreFactory, 'getStore')
      .returns({ findDevice: sinon.stub().resolves(undefined) } as any);

    // Mounted as src/app/index.ts mounts them: authMiddleware on the api
    // router, then each router registers its own prefix on it.
    const apiRouter = express.Router();
    apiRouter.use(authMiddleware);
    AppsRouter.register(apiRouter);
    ControlRouter.register(apiRouter);
    app = express();
    app.use('/xenon/api', apiRouter);
  });

  afterEach(() => {
    sinon.restore();
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Collects the body as bytes, whatever the content type.
  const bytes = (res: any, done: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  };
  const download = (id: string, ticket?: string) => {
    const r = request(app).get(`/xenon/api/apps/${id}/download`);
    return ticket === undefined ? r : r.query({ ticket });
  };
  const INVALID = { error: 'invalid ticket' };

  it('serves the app it names, with no login', async () => {
    const t = await tickets.mint('app-A');
    const r = await download('app-A', t).buffer(true).parse(bytes);
    expect(r.status).to.equal(200);
    expect(Buffer.compare(r.body as Buffer, BYTES)).to.equal(0);
  });

  it('serves a Range of it as 206', async () => {
    const t = await tickets.mint('app-A');
    const r = await download('app-A', t).set('Range', 'bytes=0-3').buffer(true).parse(bytes);
    expect(r.status).to.equal(206);
    expect((r.body as Buffer).toString('latin1')).to.equal('PK\u0003\u0004');
  });

  it('refuses a second use', async () => {
    const t = await tickets.mint('app-A');
    expect((await download('app-A', t)).status).to.equal(200);
    const again = await download('app-A', t);
    expect(again.status).to.equal(401);
    expect(again.body).to.deep.equal(INVALID);
  });

  it("refuses app A's ticket for app B, and for an unknown id, alike", async () => {
    const t = await tickets.mint('app-A');
    for (const id of ['app-B', 'no-such-app']) {
      const r = await download(id, t);
      expect(r.status, id).to.equal(401);
      expect(r.body, id).to.deep.equal(INVALID);
    }
  });

  it('refuses an expired ticket', async () => {
    const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
    const t = await tickets.mint('app-A');
    clock.tick(11 * 60 * 1000 + 1000);
    const r = await download('app-A', t);
    clock.restore();
    expect(r.status).to.equal(401);
    expect(r.body).to.deep.equal(INVALID);
  });

  it('refuses a stream ticket, even one minted for the app id as a udid', async () => {
    const t = await streams.mint('app-A', 'actor-1', { isAdmin: true });
    const r = await download('app-A', t);
    expect(r.status).to.equal(401);
    expect(r.body).to.deep.equal(INVALID);
  });

  it('an app ticket is refused on the stream route', async () => {
    const t = await tickets.mint('UDID-1');
    const r = await request(app).get('/xenon/api/control/UDID-1/stream').query({ ticket: t });
    expect(r.status).to.equal(401);
    expect(r.body).to.deep.equal(INVALID);
  });

  it('opens nothing but the download: not the list, nor another method', async () => {
    const t = await tickets.mint('app-A');
    const list = await request(app).get('/xenon/api/apps').query({ ticket: t });
    expect(list.status).to.equal(401);
    expect(list.body).to.deep.equal({ error: 'unauthenticated' });
    const del = await request(app).delete('/xenon/api/apps/app-A/download').query({ ticket: t });
    expect(del.status).to.equal(401);
    expect(del.body).to.deep.equal({ error: 'unauthenticated' });
    // Neither attempt spent it.
    expect((await download('app-A', t)).status).to.equal(200);
  });

  it('without a ticket the download needs a login, as before', async () => {
    const r = await download('app-A');
    expect(r.status).to.equal(401);
    expect(r.body).to.deep.equal({ error: 'unauthenticated' });
  });

  it('carries no identity or privilege into the request', async () => {
    const t = await tickets.mint('app-A');
    const req: any = {
      method: 'GET',
      path: '/apps/app-A/download',
      query: { ticket: t },
      headers: {},
    };
    const res: any = { status: () => res, json: () => res, cookie: () => res };
    const next = sinon.spy();
    await authMiddleware(req, res, next);
    expect(next.calledOnce).to.equal(true);
    expect(req.auth).to.include({
      kind: 'app-ticket',
      role: 'MEMBER',
      scopes: 'read',
      appId: 'app-A',
    });
    expect(req.apiKey).to.equal(undefined);
  });
});
