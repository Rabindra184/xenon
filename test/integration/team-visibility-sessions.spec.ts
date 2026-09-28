import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { Container } from 'typedi';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import DashboardRouter from '../../src/app/routers/dashboard';
import bugReportRouter from '../../src/app/routers/bug-report';
import { TeamService } from '../../src/services/TeamService';
import { prisma } from '../../src/prisma';
import { seedUser, SeededUser } from '../helpers/seedUser';

/**
 * A session's data follows its phone's team, run as real queries (the session
 * list, builds and healing reads build Prisma filters that a stub would only
 * echo). A member in team A sees shared phones' and team A's sessions, and their
 * own sessions on phones that are gone; another team's session answers every
 * route exactly as an unknown one does.
 */
describe('team visibility on session data (integration)', function () {
  this.timeout(60_000);
  let sa: SeededUser;
  let alice: SeededUser;
  let teamA: { id: string };
  let teamB: { id: string };

  const stamp = Date.now();
  const U = {
    shared: `ts-shared-${stamp}`,
    a: `ts-a-${stamp}`,
    b: `ts-b-${stamp}`,
    gone: `ts-gone-${stamp}`,
  };
  const S = {
    shared: `ts-s-shared-${stamp}`,
    a: `ts-s-a-${stamp}`,
    b: `ts-s-b-${stamp}`,
    ownGone: `ts-s-own-gone-${stamp}`,
    otherGone: `ts-s-other-gone-${stamp}`,
  };
  const SELECTOR = `//ts-selector-${stamp}`;
  // Selector Health: HOT is healed on the shared, team-A and team-B phones and
  // on both sessions whose phone is gone; HOT_B only on team B's phone.
  const HOT = `//ts-hot-${stamp}`;
  const HOT_B = `//ts-hot-b-${stamp}`;
  // Muted selectors: MUTED is healed on team A two hours ago and on team B one
  // hour ago; MUTED_B only on team B.
  const MUTED = `//ts-muted-${stamp}`;
  const MUTED_B = `//ts-muted-b-${stamp}`;
  const HOUR = 60 * 60 * 1000;
  const twoHoursAgo = new Date(stamp - 2 * HOUR);
  const oneHourAgo = new Date(stamp - HOUR);
  let mixedBuild: { id: string };
  let teamBBuild: { id: string };

  before(async () => {
    sa = await seedUser('SUPER_ADMIN', { name: 'TS SA' });
    alice = await seedUser('MEMBER', { name: 'TS Alice (team A)' });
    teamA = await Container.get(TeamService).create(`ts-a-${stamp}`);
    teamB = await Container.get(TeamService).create(`ts-b-${stamp}`);
    await Container.get(TeamService).addMember(teamA.id, alice.user.id);

    for (const [udid, teamId] of [
      [U.shared, null],
      [U.a, teamA.id],
      [U.b, teamB.id],
    ] as Array<[string, string | null]>) {
      await prisma.device.create({
        data: { udid, host: 'localhost', name: udid, platform: 'android', teamId } as any,
      });
    }

    // One build shared by name across teams, and one with team B's session only.
    mixedBuild = await prisma.build.create({ data: { name: `ts-mixed-${stamp}` } });
    teamBBuild = await prisma.build.create({ data: { name: `ts-b-${stamp}` } });
    const base = {
      desired_capabilities: '{}',
      session_capabilities: '{}',
      node_id: 'localhost',
      has_live_video: false,
      device_platform: 'android',
      device_version: '14',
      status: 'passed',
    };
    const session = (id: string, device_udid: string, build_id: string | null, user_id: string) =>
      prisma.session.create({ data: { id, device_udid, build_id, user_id, ...base } as any });
    await session(S.shared, U.shared, null, sa.user.id);
    await session(S.a, U.a, mixedBuild.id, sa.user.id);
    await session(S.b, U.b, mixedBuild.id, sa.user.id);
    await prisma.session.create({
      data: {
        id: `${S.b}-2`,
        device_udid: U.b,
        build_id: teamBBuild.id,
        user_id: sa.user.id,
        ...base,
      } as any,
    });
    await session(S.ownGone, U.gone, null, alice.user.id);
    await session(S.otherGone, U.gone, null, sa.user.id);

    const heal = (session_id: string, selector = SELECTOR, createdAt?: Date) =>
      prisma.sessionLog.create({
        data: {
          session_id,
          url: '/element',
          method: 'POST',
          title: 'findElement',
          response: '{}',
          command_name: 'findElement',
          is_healed: true,
          original_strategy: 'xpath',
          original_selector: selector,
          healed_selector: `${selector}-healed`,
          healing_tier: 'Fuzzy XML',
          ...(createdAt ? { createdAt } : {}),
        },
      });
    await heal(S.a);
    await heal(S.b);
    for (const id of [S.shared, S.a, `${S.b}-2`, S.ownGone, S.otherGone]) await heal(id, HOT);
    await heal(`${S.b}-2`, HOT_B);

    await heal(S.a, MUTED, twoHoursAgo);
    await heal(`${S.b}-2`, MUTED, oneHourAgo);
    await heal(`${S.b}-2`, MUTED_B, oneHourAgo);
    for (const original_selector of [MUTED, MUTED_B]) {
      await prisma.selectorState.create({
        data: {
          original_strategy: 'xpath',
          original_selector,
          status: 'muted',
          muted_at: new Date(),
          muted_by_api_key: '',
        },
      });
    }
  });

  after(async () => {
    const ids = [...Object.values(S), `${S.b}-2`];
    await prisma.sessionLog.deleteMany({ where: { session_id: { in: ids } } });
    await prisma.selectorState.deleteMany({
      where: { original_selector: { in: [MUTED, MUTED_B] } },
    });
    await prisma.session.deleteMany({ where: { id: { in: ids } } });
    await prisma.build.deleteMany({ where: { id: { in: [mixedBuild.id, teamBBuild.id] } } });
    await prisma.device.deleteMany({ where: { udid: { in: Object.values(U) } } });
    await prisma.teamMember.deleteMany({ where: { teamId: { in: [teamA.id, teamB.id] } } });
    await prisma.team.delete({ where: { id: teamA.id } }).catch(() => undefined);
    await prisma.team.delete({ where: { id: teamB.id } }).catch(() => undefined);
    await sa.cleanup();
    await alice.cleanup();
  });

  function app() {
    const a = express();
    a.use(express.json());
    a.use(authMiddleware);
    DashboardRouter.register(a as any);
    bugReportRouter.register(a as any);
    return a;
  }
  const asAlice = (url: string) => request(app()).get(url).set('Cookie', alice.cookie);
  const asSa = (url: string) => request(app()).get(url).set('Cookie', sa.cookie);
  const unknownBody = (id: string) => ({ error: true, message: `Session with id ${id} not found` });

  it("lists a member's sessions: shared, their team's, and their own on a phone that is gone", async () => {
    const ids = (await asAlice('/session')).body.map((s: any) => s.id);
    expect(ids).to.include.members([S.shared, S.a, S.ownGone]);
    expect(ids).to.not.include.members([S.b, S.otherGone]);
    const all = (await asSa('/session')).body.map((s: any) => s.id);
    expect(all).to.include.members(Object.values(S));
  });

  it("answers every session route for another team's session exactly as for an unknown one", async () => {
    for (const suffix of [
      '',
      '/live_video',
      '/session_log',
      '/logs/device',
      '/logs/debug',
      '/profiling',
      '/asset/video/x.mp4',
    ]) {
      const hidden = await asAlice(`/session/${S.b}${suffix}`);
      expect(hidden.status, suffix).to.equal(404);
      expect(hidden.body, suffix).to.deep.equal(unknownBody(S.b));
      const unknown = await asAlice(`/session/nope-${stamp}${suffix}`);
      expect(unknown.body, suffix).to.deep.equal(unknownBody(`nope-${stamp}`));
    }
  });

  it('lets a member open their own session on a phone that is gone, not anyone else’s', async () => {
    expect((await asAlice(`/session/${S.ownGone}`)).status).to.equal(200);
    expect((await asAlice(`/session/${S.otherGone}`)).status).to.equal(404);
    expect((await asSa(`/session/${S.otherGone}`)).status).to.equal(200);
  });

  it("counts a shared build over the member's sessions, and hides a build they can't see", async () => {
    const builds = (await asAlice('/build')).body;
    const mixed = builds.find((b: any) => b.id === mixedBuild.id);
    expect(mixed).to.include({ sessionCount: 1, passedCount: 1 });
    expect(mixed._count).to.deep.equal({ sessions: 1 });
    expect(builds.map((b: any) => b.id)).to.not.include(teamBBuild.id);
    const saMixed = (await asSa('/build')).body.find((b: any) => b.id === mixedBuild.id);
    expect(saMixed).to.include({ sessionCount: 2 });
  });

  it('healing events: only the member’s sessions, even by ?sessionId=', async () => {
    const events = (await asAlice('/healing/events?limit=200')).body.events.map(
      (e: any) => e.sessionId,
    );
    expect(events).to.include(S.a);
    expect(events).to.not.include(S.b);
    expect((await asAlice(`/healing/events?sessionId=${S.b}`)).body.events).to.deep.equal([]);
    expect((await asSa(`/healing/events?sessionId=${S.b}`)).body.events).to.have.length(1);
  });

  it('healing selector timeline and summary: only the member’s sessions', async () => {
    const detail = (await asAlice(`/healing/selector?value=${encodeURIComponent(SELECTOR)}`)).body;
    expect(detail.healCount).to.equal(1);
    expect(detail.timeline.map((t: any) => t.sessionId)).to.deep.equal([S.a]);
    const saDetail = (await asSa(`/healing/selector?value=${encodeURIComponent(SELECTOR)}`)).body;
    expect(saDetail.healCount).to.equal(2);

    const mine = (await asAlice('/healing/summary')).body.current.totalHeals;
    const all = (await asSa('/healing/summary')).body.current.totalHeals;
    expect(all - mine).to.be.at.least(1);
  });

  describe('Selector Health: heals from the caller’s sessions only', () => {
    const find = (rows: any[], selector: string) =>
      rows.find((r: any) => (r.originalSelector ?? r.selector) === selector);

    it('hotspots', async () => {
      const mine = (await asAlice('/healing/hotspots?limit=100')).body;
      expect(find(mine.hotspots, HOT)).to.include({ healCount: 3, sessionCount: 3 });
      expect(find(mine.hotspots, HOT_B)).to.equal(undefined);

      const all = (await asSa('/healing/hotspots?limit=100')).body;
      expect(find(all.hotspots, HOT)).to.include({ healCount: 5, sessionCount: 5 });
      expect(find(all.hotspots, HOT_B)).to.include({ healCount: 1 });
      expect(all.totalScanned - mine.totalScanned).to.be.at.least(4);
    });

    it('violations, with and without a build filter', async () => {
      const v = async (as: typeof asAlice, query = '') =>
        (await as(`/healing/hotspots/violations?minHealCount=1${query}`)).body.violations;

      expect(find(await v(asAlice), HOT)).to.include({ healCount: 3 });
      expect(find(await v(asAlice), HOT_B)).to.equal(undefined);
      expect(find(await v(asSa), HOT)).to.include({ healCount: 5 });
      expect(find(await v(asSa), HOT_B)).to.include({ healCount: 1 });

      // Team B's build: none of it for the member, both heals for an admin.
      const bBuild = `&build=${teamBBuild.id}`;
      expect(find(await v(asAlice, bBuild), HOT)).to.equal(undefined);
      expect(find(await v(asAlice, bBuild), HOT_B)).to.equal(undefined);
      expect(find(await v(asSa, bBuild), HOT)).to.include({ healCount: 1 });
      expect(find(await v(asSa, bBuild), HOT_B)).to.include({ healCount: 1 });

      // The build shared by both teams: the build and platform filters still
      // hold for the member alongside the team rule.
      const mixed = `&build=${mixedBuild.id}&platform=android`;
      expect(find(await v(asAlice, mixed), HOT)).to.include({ healCount: 1 });
      expect(find(await v(asAlice, mixed), SELECTOR)).to.include({ healCount: 1 });
      expect(find(await v(asSa, mixed), SELECTOR)).to.include({ healCount: 2 });
    });

    it('selector list', async () => {
      const q = (s: string) => `/healing/selector-health?selector=${encodeURIComponent(s)}`;
      const hot = (await asAlice(q(HOT))).body;
      expect(hot).to.have.length(1);
      expect(hot[0]).to.include({ healCount: 3 });
      expect((await asAlice(q(HOT_B))).body).to.deep.equal([]);
      expect((await asSa(q(HOT))).body[0]).to.include({ healCount: 5 });
      expect((await asSa(q(HOT_B))).body[0]).to.include({ healCount: 1 });

      const list = (await asAlice('/healing/selector-health?limit=200')).body;
      const selectors = list.map((r: any) => r.selector);
      expect(selectors).to.include(HOT);
      expect(selectors).to.not.include(HOT_B);
    });

    it('muted selectors: the mute is shared, the last heal is the caller’s', async () => {
      const muted = async (as: typeof asAlice) =>
        (await as('/healing/state/muted?limit=200')).body.muted;
      const row = (rows: any[], s: string) => rows.find((r: any) => r.original_selector === s);

      const mine = await muted(asAlice);
      expect(row(mine, MUTED)).to.include({ last_healed_at: twoHoursAgo.toISOString() });
      expect(row(mine, MUTED_B)).to.include({ last_healed_at: null });

      const all = await muted(asSa);
      expect(row(all, MUTED)).to.include({ last_healed_at: oneHourAgo.toISOString() });
      expect(row(all, MUTED_B)).to.include({ last_healed_at: oneHourAgo.toISOString() });

      // The state row itself answers the same for everyone.
      const tuple = `/healing/state/xpath/${encodeURIComponent(MUTED_B)}`;
      const memberState = (await asAlice(tuple)).body.state;
      expect(memberState).to.include({ status: 'muted', original_selector: MUTED_B });
      expect(memberState).to.deep.equal((await asSa(tuple)).body.state);
    });
  });

  it("refuses a bug report for another team's session as for an unknown one", async () => {
    const r = await request(app())
      .post(`/sessions/${S.b}/bug-report?mode=full`)
      .set('Cookie', alice.cookie)
      .set('Origin', 'http://127.0.0.1');
    expect(r.status).to.equal(404);
    expect(r.body).to.deep.equal({ error: `Session ${S.b} not found` });
  });
});
