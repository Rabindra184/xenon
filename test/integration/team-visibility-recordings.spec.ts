import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import RecordingsRouter from '../../src/app/routers/recordings';
import { Container } from 'typedi';
import { TeamService } from '../../src/services/TeamService';
import { prisma } from '../../src/prisma';
import { seedUser, SeededUser } from '../helpers/seedUser';

describe('team visibility on /recordings reads (integration)', function () {
  this.timeout(60_000);
  let sa: SeededUser;
  let aliceMember: SeededUser;
  let teamA: { id: string };
  let teamB: { id: string };

  const stamp = Date.now();
  const SHARED_UDID = `p4a-rec-shared-${stamp}`;
  const TEAM_A_UDID = `p4a-rec-a-${stamp}`;
  const TEAM_B_UDID = `p4a-rec-b-${stamp}`;
  const GROUP_SHARED = `grp-shared-${stamp}`;
  const GROUP_TEAM_A = `grp-a-${stamp}`;
  const GROUP_TEAM_B = `grp-b-${stamp}`;

  before(async () => {
    sa = await seedUser('SUPER_ADMIN', { name: 'P4A-Rec SA' });
    aliceMember = await seedUser('MEMBER', { name: 'Alice (team A)' });

    teamA = await Container.get(TeamService).create(`p4a-rec-a-${stamp}`);
    teamB = await Container.get(TeamService).create(`p4a-rec-b-${stamp}`);
    await Container.get(TeamService).addMember(teamA.id, aliceMember.user.id);

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

    // One Recording per device. Required fields per prisma/schema.prisma:
    // id, group_id, device_udid, started_at, status, file_path. (device_host
    // has a default.)
    const baseRecording = {
      started_at: new Date(),
      status: 'STOPPED',
      file_path: '/tmp/test.mp4',
    };
    await prisma.recording.create({
      data: {
        id: `rec-shared-${stamp}`,
        group_id: GROUP_SHARED,
        device_udid: SHARED_UDID,
        ...baseRecording,
      } as any,
    });
    await prisma.recording.create({
      data: {
        id: `rec-a-${stamp}`,
        group_id: GROUP_TEAM_A,
        device_udid: TEAM_A_UDID,
        ...baseRecording,
      } as any,
    });
    await prisma.recording.create({
      data: {
        id: `rec-b-${stamp}`,
        group_id: GROUP_TEAM_B,
        device_udid: TEAM_B_UDID,
        ...baseRecording,
      } as any,
    });
  });

  after(async () => {
    await prisma.recording.deleteMany({
      where: { group_id: { in: [GROUP_SHARED, GROUP_TEAM_A, GROUP_TEAM_B] } },
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
    RecordingsRouter.register(app as any);
    return app;
  }

  it('Alice GET /recordings/:teamBGroup → 404', async () => {
    const r = await request(buildApp())
      .get(`/recordings/${GROUP_TEAM_B}`)
      .set('Cookie', aliceMember.cookie);
    expect(r.status).to.equal(404);
  });

  it('SA GET /recordings/:teamBGroup → 200 (admin sees all)', async () => {
    const r = await request(buildApp())
      .get(`/recordings/${GROUP_TEAM_B}`)
      .set('Cookie', sa.cookie);
    expect(r.status).to.equal(200);
  });

  it('Alice GET /recordings/:teamAGroup → 200 (member of team A)', async () => {
    const r = await request(buildApp())
      .get(`/recordings/${GROUP_TEAM_A}`)
      .set('Cookie', aliceMember.cookie);
    expect(r.status).to.equal(200);
  });
});
