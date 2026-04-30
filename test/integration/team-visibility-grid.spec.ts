import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import GridRouter from '../../src/app/routers/grid';
import { Container } from 'typedi';
import { TeamService } from '../../src/services/TeamService';
import { prisma } from '../../src/prisma';
import { seedUser, SeededUser } from '../helpers/seedUser';
import { DeviceStoreFactory } from '../../src/data-service/device-store';

describe('team visibility on /grid/devices (integration)', function () {
  this.timeout(60_000);
  let sa: SeededUser;
  let aliceMember: SeededUser;
  let bobUnaffiliated: SeededUser;
  let teamA: { id: string; name: string };
  let teamB: { id: string; name: string };
  let store: any;

  const stamp = Date.now();
  const SHARED_UDID = `phase4a-shared-${stamp}`;
  const TEAM_A_UDID = `phase4a-team-a-${stamp}`;
  const TEAM_B_UDID = `phase4a-team-b-${stamp}`;

  before(async () => {
    sa = await seedUser('SUPER_ADMIN', { name: 'P4A SA' });
    aliceMember = await seedUser('MEMBER', { name: 'Alice (team A)' });
    bobUnaffiliated = await seedUser('MEMBER', { name: 'Bob (no team)' });

    teamA = await Container.get(TeamService).create(`p4a-team-a-${stamp}`);
    teamB = await Container.get(TeamService).create(`p4a-team-b-${stamp}`);

    // Alice on team A only.
    await Container.get(TeamService).addMember(teamA.id, aliceMember.user.id);

    store = DeviceStoreFactory.getStore();

    // Three test devices. Use minimal field set; the schema may have
    // additional optional fields we don't need to populate for this test.
    const shared = await prisma.device.create({
      data: {
        udid: SHARED_UDID,
        host: 'localhost:1',
        name: 'shared',
        platform: 'ios',
        teamId: null,
      } as any,
    });
    await store.addDevices([shared as any]);

    const teamADev = await prisma.device.create({
      data: {
        udid: TEAM_A_UDID,
        host: 'localhost:2',
        name: 'team-a',
        platform: 'ios',
        teamId: teamA.id,
      } as any,
    });
    await store.addDevices([teamADev as any]);

    const teamBDev = await prisma.device.create({
      data: {
        udid: TEAM_B_UDID,
        host: 'localhost:3',
        name: 'team-b',
        platform: 'ios',
        teamId: teamB.id,
      } as any,
    });
    await store.addDevices([teamBDev as any]);
  });

  after(async () => {
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
    await bobUnaffiliated.cleanup();
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(authMiddleware);
    GridRouter.register(app as any, {} as any);
    return app;
  }

  function udids(rows: Array<{ udid: string }>): string[] {
    return rows.map((r) => r.udid);
  }

  it('SUPER_ADMIN sees all three test devices', async () => {
    const r = await request(buildApp()).get('/devices').set('Cookie', sa.cookie);
    expect(r.status).to.equal(200);
    const got = udids(r.body);
    expect(got).to.include(SHARED_UDID);
    expect(got).to.include(TEAM_A_UDID);
    expect(got).to.include(TEAM_B_UDID);
  });

  it('Alice (team A member) sees shared + team A; not team B', async () => {
    const r = await request(buildApp()).get('/devices').set('Cookie', aliceMember.cookie);
    expect(r.status).to.equal(200);
    const got = udids(r.body);
    expect(got).to.include(SHARED_UDID);
    expect(got).to.include(TEAM_A_UDID);
    expect(got).to.not.include(TEAM_B_UDID);
  });

  it('Bob (no team) sees only the shared device', async () => {
    const r = await request(buildApp()).get('/devices').set('Cookie', bobUnaffiliated.cookie);
    expect(r.status).to.equal(200);
    const got = udids(r.body);
    expect(got).to.include(SHARED_UDID);
    expect(got).to.not.include(TEAM_A_UDID);
    expect(got).to.not.include(TEAM_B_UDID);
  });
});
