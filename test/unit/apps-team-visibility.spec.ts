import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from '../helpers/loopbackRequest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AppsRouter from '../../src/app/routers/apps';
import { APP_SERVICE } from '../../src/dashboard/services/app-service';
import { scopesForRole } from '../../src/middleware/authMiddleware';
import { prisma } from '../../src/prisma';
import { config } from '../../src/config';

/**
 * Uploaded apps follow the device team rule (isDeviceVisible on the app's
 * team): admins see every app, a member sees shared apps and their teams'.
 * Another team's app answers every route exactly as an unknown id does.
 * Uploading and moving an app between teams stay admin-only.
 */
type Caller =
  | 'member-a'
  | 'member-none'
  | 'admin'
  | 'admin-key-without-admin-scope'
  | 'team-scoped-admin'
  | 'ticket-for-app-a';

function authFor(caller: Caller): any {
  switch (caller) {
    case 'member-a':
      return { role: 'MEMBER', scopes: scopesForRole('MEMBER'), teamIds: ['team-a'] };
    case 'member-none':
      return { role: 'MEMBER', scopes: scopesForRole('MEMBER'), teamIds: [] };
    case 'admin':
      return { role: 'ADMIN', scopes: scopesForRole('ADMIN'), teamIds: undefined };
    case 'admin-key-without-admin-scope':
      return { role: 'ADMIN', scopes: 'devices,sessions,read', teamIds: undefined };
    case 'team-scoped-admin':
      // Not something computeTeamIds produces today; the handlers must still
      // apply the rule rather than trust the role.
      return { role: 'ADMIN', scopes: scopesForRole('ADMIN'), teamIds: ['team-a'] };
    case 'ticket-for-app-a':
      // What authMiddleware's app-ticket path sets after redeeming a ticket.
      return {
        kind: 'app-ticket',
        role: 'MEMBER',
        scopes: 'read',
        teamIds: undefined,
        appId: 'app-a',
      };
  }
}

function server(caller: Caller) {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.auth = { kind: 'user-session', userId: `u-${caller}`, rateLimit: 300, ...authFor(caller) };
    next();
  });
  AppsRouter.register(a as any);
  return a;
}

const UNKNOWN = { error: 'App not found' };

describe('apps follow the device team rule', () => {
  let dir: string;
  let rows: Record<string, any>;
  let configAppsPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-apps-team-'));
    const files = path.join(dir, '.cache', 'xenon', 'apps');
    fs.mkdirSync(files, { recursive: true });
    const row = (id: string, teamId: string | null) => {
      const filepath = path.join(files, `${id}.apk`);
      fs.writeFileSync(filepath, `bytes of ${id}`);
      return {
        id,
        name: `${id}.apk`,
        filename: `${id}.apk`,
        filepath,
        teamId,
        team: teamId ? { id: teamId, name: `Team ${teamId}` } : null,
      };
    };
    rows = {
      'app-shared': row('app-shared', null),
      'app-a': row('app-a', 'team-a'),
      'app-b': row('app-b', 'team-b'),
    };
    sinon.stub(APP_SERVICE, 'getAppById').callsFake(async (id: string) => rows[id] ?? null);
    configAppsPath = config.appsPath;
    config.appsPath = files;
  });

  afterEach(() => {
    sinon.restore();
    config.appsPath = configAppsPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('GET /apps', () => {
    let findMany: sinon.SinonStub;
    beforeEach(() => {
      findMany = sinon.stub(prisma.app, 'findMany').resolves([rows['app-shared']] as any);
    });

    it("asks the database for a member's shared and own-team apps only", async () => {
      const r = await request(server('member-a')).get('/apps');
      expect(r.status).to.equal(200);
      const args = findMany.firstCall.args[0];
      expect(args.where).to.deep.equal({ OR: [{ teamId: null }, { teamId: { in: ['team-a'] } }] });
      expect(args.include).to.deep.equal({ team: { select: { id: true, name: true } } });
    });

    it('a member in no team gets the shared apps only', async () => {
      await request(server('member-none')).get('/apps');
      expect(findMany.firstCall.args[0].where).to.deep.equal({
        OR: [{ teamId: null }, { teamId: { in: [] } }],
      });
    });

    it('an admin is not filtered, and still gets team names', async () => {
      await request(server('admin')).get('/apps');
      const args = findMany.firstCall.args[0];
      expect(args.where).to.equal(undefined);
      expect(args.include).to.deep.equal({ team: { select: { id: true, name: true } } });
    });
  });

  describe('GET /apps/:id/download', () => {
    it("serves a member their team's app and a shared one", async () => {
      for (const id of ['app-a', 'app-shared']) {
        const r = await request(server('member-a')).get(`/apps/${id}/download`);
        expect(r.status, id).to.equal(200);
      }
    });

    it("answers another team's app exactly as an unknown id", async () => {
      const hidden = await request(server('member-a')).get('/apps/app-b/download');
      const unknown = await request(server('member-a')).get('/apps/no-such-app/download');
      expect(hidden.status).to.equal(404);
      expect(hidden.body).to.deep.equal(UNKNOWN);
      expect(unknown.status).to.equal(hidden.status);
      expect(unknown.body).to.deep.equal(hidden.body);
    });

    it('serves an admin any team’s app', async () => {
      const r = await request(server('admin')).get('/apps/app-b/download');
      expect(r.status).to.equal(200);
    });

    it("a download ticket's request sees its own app only, though it carries no teams", async () => {
      expect(
        (await request(server('ticket-for-app-a')).get('/apps/app-a/download')).status,
      ).to.equal(200);
      for (const id of ['app-b', 'app-shared']) {
        const r = await request(server('ticket-for-app-a')).get(`/apps/${id}/download`);
        expect(r.status, id).to.equal(404);
        expect(r.body, id).to.deep.equal(UNKNOWN);
      }
    });
  });

  describe('DELETE /apps/:id', () => {
    let deleteApp: sinon.SinonStub;
    beforeEach(() => {
      deleteApp = sinon.stub(APP_SERVICE, 'deleteApp').resolves(undefined as any);
    });

    it('is refused to a member', async () => {
      const r = await request(server('member-a'))
        .delete('/apps/app-a')
        .set('Origin', 'http://127.0.0.1');
      expect(r.status).to.equal(403);
      expect(deleteApp.called).to.equal(false);
    });

    it('lets an admin delete any team’s app', async () => {
      const r = await request(server('admin')).delete('/apps/app-b');
      expect(r.status).to.equal(204);
      expect(deleteApp.calledOnceWith('app-b')).to.equal(true);
    });

    it('answers an unknown id 404, and a hidden app the same way, deleting nothing', async () => {
      const unknown = await request(server('admin')).delete('/apps/no-such-app');
      const hidden = await request(server('team-scoped-admin')).delete('/apps/app-b');
      expect(unknown.status).to.equal(404);
      expect(unknown.body).to.deep.equal(UNKNOWN);
      expect(hidden.status).to.equal(unknown.status);
      expect(hidden.body).to.deep.equal(unknown.body);
      expect(deleteApp.called).to.equal(false);
    });
  });

  describe('POST /apps/upload teamId', () => {
    let upload: sinon.SinonStub;
    let findTeam: sinon.SinonStub;
    beforeEach(() => {
      upload = sinon
        .stub(APP_SERVICE, 'uploadApp')
        .callsFake(async (_file: any, teamId?: string | null) => ({ id: 'new', teamId }) as any);
      findTeam = sinon
        .stub(prisma.team, 'findUnique')
        .callsFake((async (args: any) =>
          args.where.id === 'team-a' ? { id: 'team-a' } : null) as any);
    });
    const post = (caller: Caller, teamId?: string) => {
      const r = request(server(caller))
        .post('/apps/upload')
        .attach('app', Buffer.from('ipa bytes'), 'app.ipa');
      return teamId === undefined ? r : r.field('teamId', teamId);
    };

    it('puts the app in the team named', async () => {
      const r = await post('admin', 'team-a');
      expect(r.status).to.equal(200);
      expect(upload.firstCall.args[0].name).to.equal('app.ipa');
      expect(upload.firstCall.args[1]).to.equal('team-a');
    });

    it('shares the app when no team is named, or an empty one', async () => {
      for (const teamId of [undefined, '']) {
        upload.resetHistory();
        const r = await post('admin', teamId);
        expect(r.status, String(teamId)).to.equal(200);
        expect(upload.firstCall.args[1], String(teamId)).to.equal(null);
      }
    });

    it('refuses an unknown team with 400, and stores nothing', async () => {
      const r = await post('admin', 'ghost');
      expect(r.status).to.equal(400);
      expect(r.body).to.deep.equal({ error: 'team not found' });
      expect(findTeam.calledOnce).to.equal(true);
      expect(upload.called).to.equal(false);
    });

    it('stays admin-only', async () => {
      const r = await post('member-a', 'team-a');
      expect(r.status).to.equal(403);
      expect(upload.called).to.equal(false);
    });
  });

  describe('PUT /apps/:id/team', () => {
    let update: sinon.SinonStub;
    beforeEach(() => {
      update = sinon
        .stub(prisma.app, 'updateMany')
        .callsFake((async (args: any) => ({ count: rows[args.where.id] ? 1 : 0 })) as any);
      sinon
        .stub(prisma.team, 'findUnique')
        .callsFake((async (args: any) =>
          ['team-a', 'team-b'].includes(args.where.id) ? { id: args.where.id } : null) as any);
    });
    const put = (caller: Caller, id: string, body: unknown) =>
      request(server(caller))
        .put(`/apps/${id}/team`)
        .send(body as object);

    it('moves an app to a team, as PUT /device/:udid/team does a phone', async () => {
      const r = await put('admin', 'app-a', { teamId: 'team-b' });
      expect(r.status).to.equal(200);
      expect(r.body).to.deep.equal({ ok: true, updated: 1 });
      expect(update.firstCall.args[0]).to.deep.equal({
        where: { id: 'app-a' },
        data: { teamId: 'team-b' },
      });
    });

    it('returns an app to the shared pool with null', async () => {
      const r = await put('admin', 'app-a', { teamId: null });
      expect(r.status).to.equal(200);
      expect(update.firstCall.args[0].data).to.deep.equal({ teamId: null });
    });

    it('404s an unknown team or app', async () => {
      const team = await put('admin', 'app-a', { teamId: 'ghost' });
      expect(team.status).to.equal(404);
      expect(team.body).to.deep.equal({ error: 'team not found' });
      const app = await put('admin', 'no-such-app', { teamId: 'team-a' });
      expect(app.status).to.equal(404);
      expect(app.body).to.deep.equal(UNKNOWN);
    });

    it('400s a teamId that is neither a string nor null', async () => {
      const r = await put('admin', 'app-a', { teamId: 42 });
      expect(r.status).to.equal(400);
      expect(update.called).to.equal(false);
    });

    it('is admin-only: refused to a member, and to an admin key without the admin scope', async () => {
      expect((await put('member-a', 'app-a', { teamId: 'team-a' })).status).to.equal(403);
      expect(
        (await put('admin-key-without-admin-scope', 'app-a', { teamId: 'team-a' })).status,
      ).to.equal(403);
      expect(update.called).to.equal(false);
    });
  });
});

describe('AppService.uploadApp and the team', () => {
  let dir: string;
  let configAppsPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-apps-upload-'));
    configAppsPath = config.appsPath;
    config.appsPath = dir;
  });
  afterEach(() => {
    sinon.restore();
    config.appsPath = configAppsPath;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const file = { name: 'app.ipa', data: Buffer.from('same bytes'), mimetype: 'x', size: 10 };

  it('stores a new app with the team it was uploaded to', async () => {
    sinon.stub(prisma.app, 'findUnique').resolves(null);
    const create = sinon.stub(prisma.app, 'create').callsFake((async (a: any) => a.data) as any);
    await APP_SERVICE.uploadApp(file, 'team-b');
    expect(create.firstCall.args[0].data.teamId).to.equal('team-b');
  });

  it('stores a new app shared when no team is given', async () => {
    sinon.stub(prisma.app, 'findUnique').resolves(null);
    const create = sinon.stub(prisma.app, 'create').callsFake((async (a: any) => a.data) as any);
    await APP_SERVICE.uploadApp(file);
    expect(create.firstCall.args[0].data.teamId).to.equal(null);
  });

  it('dedupes by md5 and leaves the existing app in its own team', async () => {
    const existing = { id: 'old', md5: 'x', teamId: 'team-a' };
    sinon.stub(prisma.app, 'findUnique').resolves(existing as any);
    const create = sinon.stub(prisma.app, 'create');
    const updateMany = sinon.stub(prisma.app, 'updateMany');
    const update = sinon.stub(prisma.app, 'update');
    const out = await APP_SERVICE.uploadApp(file, 'team-b');
    expect(out).to.equal(existing);
    expect(create.called || update.called || updateMany.called).to.equal(false);
  });
});
