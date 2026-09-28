import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Container } from 'typedi';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import AppsRouter from '../../src/app/routers/apps';
import { TeamService } from '../../src/services/TeamService';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { AppDownloadTicketService } from '../../src/services/token/AppDownloadTicketService';
import { APP_SERVICE } from '../../src/dashboard/services/app-service';
import { prisma } from '../../src/prisma';
import { seedUser, SeededUser } from '../helpers/seedUser';
import { saveRegistrations } from '../helpers/container-registration';

/**
 * Uploaded apps follow the device team rule, run as real queries: the list
 * builds a Prisma filter (`OR: [{ teamId: null }, { teamId: { in } }]`, with an
 * empty `in` for a member in no team) that a stub would only echo back.
 *
 * Run on a migrated database:
 *   DATABASE_URL=file:/tmp/x.db npx prisma migrate deploy
 *   DATABASE_URL=file:/tmp/x.db npx mocha test/integration/team-visibility-apps.spec.ts
 */
describe('team visibility on uploaded apps (integration)', function () {
  this.timeout(60_000);
  let sa: SeededUser;
  let alice: SeededUser;
  let loner: SeededUser;
  let teamA: { id: string; name: string };
  let teamB: { id: string; name: string };
  let dir: string;
  let restore: () => void;

  const stamp = Date.now();
  const A = { shared: `ta-shared-${stamp}`, a: `ta-a-${stamp}`, b: `ta-b-${stamp}` };
  const bytesOf = (id: string) => Buffer.from(`the bytes of ${id}`);

  before(async () => {
    restore = saveRegistrations(JwtKeyService, AppDownloadTicketService);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-apps-int-'));
    const keys = new JwtKeyService();
    await keys.init(dir);
    Container.set(JwtKeyService, keys);
    Container.set(AppDownloadTicketService, new AppDownloadTicketService());

    sa = await seedUser('SUPER_ADMIN', { name: 'TA SA' });
    alice = await seedUser('MEMBER', { name: 'TA Alice (team A)' });
    loner = await seedUser('MEMBER', { name: 'TA Loner (no team)' });
    teamA = await Container.get(TeamService).create(`ta-a-${stamp}`);
    teamB = await Container.get(TeamService).create(`ta-b-${stamp}`);
    await Container.get(TeamService).addMember(teamA.id, alice.user.id);

    const files = path.join(dir, '.cache', 'xenon', 'apps');
    fs.mkdirSync(files, { recursive: true });
    for (const [id, teamId] of [
      [A.shared, null],
      [A.a, teamA.id],
      [A.b, teamB.id],
    ] as Array<[string, string | null]>) {
      const filepath = path.join(files, `${id}.apk`);
      fs.writeFileSync(filepath, bytesOf(id));
      await prisma.app.create({
        data: {
          id,
          name: `${id}.apk`,
          filename: `${id}.apk`,
          filepath,
          mimetype: 'application/vnd.android.package-archive',
          size: bytesOf(id).length,
          platform: 'android',
          md5: `md5-${id}`,
          teamId,
        },
      });
    }
  });

  after(async () => {
    await prisma.app.deleteMany({ where: { id: { in: Object.values(A) } } });
    await prisma.teamMember.deleteMany({ where: { teamId: { in: [teamA.id, teamB.id] } } });
    await prisma.team.delete({ where: { id: teamA.id } }).catch(() => undefined);
    await prisma.team.delete({ where: { id: teamB.id } }).catch(() => undefined);
    await sa.cleanup();
    await alice.cleanup();
    await loner.cleanup();
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function app() {
    const a = express();
    a.use(express.json());
    a.use(authMiddleware);
    AppsRouter.register(a as any);
    return a;
  }
  const ids = async (cookie: string) =>
    (await request(app()).get('/apps').set('Cookie', cookie)).body
      .map((r: any) => r.id)
      .filter((id: string) => Object.values(A).includes(id));
  const UNKNOWN = { error: 'App not found' };

  it("lists a member's shared and own-team apps, with the team's name", async () => {
    const res = await request(app()).get('/apps').set('Cookie', alice.cookie);
    expect(res.status).to.equal(200);
    const mine = res.body.filter((r: any) => Object.values(A).includes(r.id));
    expect(mine.map((r: any) => r.id)).to.have.members([A.shared, A.a]);
    const a = mine.find((r: any) => r.id === A.a);
    expect(a.team).to.deep.equal({ id: teamA.id, name: teamA.name });
    expect(mine.find((r: any) => r.id === A.shared).team).to.equal(null);
  });

  it('a member in no team gets the shared apps only (an empty `in` is a valid filter)', async () => {
    expect(await ids(loner.cookie)).to.have.members([A.shared]);
  });

  it('an admin lists every team’s app', async () => {
    expect(await ids(sa.cookie)).to.have.members(Object.values(A));
  });

  it("answers another team's app exactly as an unknown id", async () => {
    const hidden = await request(app()).get(`/apps/${A.b}/download`).set('Cookie', alice.cookie);
    const unknown = await request(app())
      .get(`/apps/nope-${stamp}/download`)
      .set('Cookie', alice.cookie);
    expect(hidden.status).to.equal(404);
    expect(hidden.body).to.deep.equal(UNKNOWN);
    expect(unknown.status).to.equal(404);
    expect(unknown.body).to.deep.equal(UNKNOWN);
    const own = await request(app()).get(`/apps/${A.a}/download`).set('Cookie', alice.cookie);
    expect(own.status).to.equal(200);
  });

  it('a download ticket serves its app once, with no login', async () => {
    const t = await Container.get(AppDownloadTicketService).mint(A.b);
    const first = await request(app())
      .get(`/apps/${A.b}/download`)
      .query({ ticket: t })
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(first.status).to.equal(200);
    expect(Buffer.compare(first.body, bytesOf(A.b))).to.equal(0);
    const again = await request(app()).get(`/apps/${A.b}/download`).query({ ticket: t });
    expect(again.status).to.equal(401);
  });

  it('moving an app to a team changes who sees it', async () => {
    const put = (teamId: string | null) =>
      request(app()).put(`/apps/${A.b}/team`).set('Cookie', sa.cookie).send({ teamId });
    expect((await put(teamA.id)).body).to.deep.equal({ ok: true, updated: 1 });
    expect(await ids(alice.cookie)).to.include(A.b);
    expect((await put(teamB.id)).status).to.equal(200);
    expect(await ids(alice.cookie)).to.not.include(A.b);
    const member = await request(app())
      .put(`/apps/${A.b}/team`)
      .set('Cookie', alice.cookie)
      .send({ teamId: teamA.id });
    expect(member.status).to.equal(403);
  });

  it('a team that still owns apps cannot be deleted', async () => {
    let err: Error | undefined;
    try {
      await Container.get(TeamService).delete(teamB.id);
    } catch (e: any) {
      err = e;
    }
    expect(String(err?.message)).to.match(/1 app\(s\)/);
    expect((await APP_SERVICE.getAppById(A.b))?.teamId).to.equal(teamB.id);
  });
});
