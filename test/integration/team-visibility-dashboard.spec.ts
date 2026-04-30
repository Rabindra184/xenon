import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import DashboardRouter from '../../src/app/routers/dashboard';
import { Container } from 'typedi';
import { TeamService } from '../../src/services/TeamService';
import { prisma } from '../../src/prisma';
import { seedUser, SeededUser } from '../helpers/seedUser';

describe('team visibility on /dashboard reads (integration)', function () {
  this.timeout(60_000);
  let sa: SeededUser;
  let aliceMember: SeededUser;
  let teamA: { id: string; name: string };
  let teamB: { id: string; name: string };

  const stamp = Date.now();
  const SHARED_UDID = `p4a-dash-shared-${stamp}`;
  const TEAM_A_UDID = `p4a-dash-team-a-${stamp}`;
  const TEAM_B_UDID = `p4a-dash-team-b-${stamp}`;
  let buildShared: { id: string };
  let buildTeamA: { id: string };
  let buildTeamB: { id: string };
  let sessionShared: { id: string };
  let sessionTeamA: { id: string };
  let sessionTeamB: { id: string };

  before(async () => {
    sa = await seedUser('SUPER_ADMIN', { name: 'P4A-Dash SA' });
    aliceMember = await seedUser('MEMBER', { name: 'Alice (team A)' });

    teamA = await Container.get(TeamService).create(`p4a-dash-a-${stamp}`);
    teamB = await Container.get(TeamService).create(`p4a-dash-b-${stamp}`);
    await Container.get(TeamService).addMember(teamA.id, aliceMember.user.id);

    // Three devices.
    await prisma.device.create({
      data: {
        udid: SHARED_UDID,
        host: 'localhost',
        name: 'shared',
        platform: 'ios',
        teamId: null,
      } as any,
    });
    await prisma.device.create({
      data: {
        udid: TEAM_A_UDID,
        host: 'localhost',
        name: 'team-a',
        platform: 'ios',
        teamId: teamA.id,
      } as any,
    });
    await prisma.device.create({
      data: {
        udid: TEAM_B_UDID,
        host: 'localhost',
        name: 'team-b',
        platform: 'ios',
        teamId: teamB.id,
      } as any,
    });

    // Three builds + three sessions, one per device.
    buildShared = await prisma.build.create({ data: { name: `bld-shared-${stamp}` } });
    buildTeamA = await prisma.build.create({ data: { name: `bld-a-${stamp}` } });
    buildTeamB = await prisma.build.create({ data: { name: `bld-b-${stamp}` } });

    const baseSession = {
      desired_capabilities: '{}',
      session_capabilities: '{}',
      node_id: 'localhost',
      has_live_video: false,
      device_platform: 'ios',
      device_version: '17',
    };
    sessionShared = await prisma.session.create({
      data: {
        id: `sess-shared-${stamp}`,
        device_udid: SHARED_UDID,
        build_id: buildShared.id,
        ...baseSession,
      } as any,
    });
    sessionTeamA = await prisma.session.create({
      data: {
        id: `sess-a-${stamp}`,
        device_udid: TEAM_A_UDID,
        build_id: buildTeamA.id,
        ...baseSession,
      } as any,
    });
    sessionTeamB = await prisma.session.create({
      data: {
        id: `sess-b-${stamp}`,
        device_udid: TEAM_B_UDID,
        build_id: buildTeamB.id,
        ...baseSession,
      } as any,
    });
  });

  after(async () => {
    await prisma.session.deleteMany({
      where: { id: { in: [sessionShared.id, sessionTeamA.id, sessionTeamB.id] } },
    });
    await prisma.build.deleteMany({
      where: { id: { in: [buildShared.id, buildTeamA.id, buildTeamB.id] } },
    });
    await prisma.device.deleteMany({
      where: { udid: { in: [SHARED_UDID, TEAM_A_UDID, TEAM_B_UDID] } },
    });
    await prisma.teamMember.deleteMany({
      where: { teamId: { in: [teamA.id, teamB.id] } },
    });
    await prisma.team.delete({ where: { id: teamA.id } }).catch(() => undefined);
    await prisma.team.delete({ where: { id: teamB.id } }).catch(() => undefined);
    await sa.cleanup();
    await aliceMember.cleanup();
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(authMiddleware);
    DashboardRouter.register(app as any);
    return app;
  }

  it('SA sees all three sessions; Alice sees only shared + team-A', async () => {
    const app = buildApp();
    const saList = await request(app).get('/session').set('Cookie', sa.cookie);
    expect(saList.status).to.equal(200);
    const saIds = saList.body.map((s: any) => s.id);
    expect(saIds).to.include(sessionShared.id);
    expect(saIds).to.include(sessionTeamA.id);
    expect(saIds).to.include(sessionTeamB.id);

    const aliceList = await request(app).get('/session').set('Cookie', aliceMember.cookie);
    expect(aliceList.status).to.equal(200);
    const aliceIds = aliceList.body.map((s: any) => s.id);
    expect(aliceIds).to.include(sessionShared.id);
    expect(aliceIds).to.include(sessionTeamA.id);
    expect(aliceIds).to.not.include(sessionTeamB.id);
  });

  it('Alice GET /session/:teamB-id → 404', async () => {
    const r = await request(buildApp())
      .get(`/session/${sessionTeamB.id}`)
      .set('Cookie', aliceMember.cookie);
    expect(r.status).to.equal(404);
  });

  it('Alice GET /build → does not include team-B-only build', async () => {
    const r = await request(buildApp()).get('/build').set('Cookie', aliceMember.cookie);
    expect(r.status).to.equal(200);
    const ids = r.body.map((b: any) => b.id);
    expect(ids).to.include(buildShared.id);
    expect(ids).to.include(buildTeamA.id);
    expect(ids).to.not.include(buildTeamB.id);
  });
});
