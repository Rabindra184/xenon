import 'reflect-metadata';
import { expect } from 'chai';
import express from 'express';
import request from '../helpers/loopbackRequest';
import { Container } from 'typedi';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { makeRouter } from '../../src/app/routers/sdk-leases';
import { LeaseService } from '../../src/services/lease/LeaseService';
import { TeamService } from '../../src/services/TeamService';
import { DeviceStoreFactory } from '../../src/data-service/device-store';
import { prisma } from '../../src/prisma';
import { seedUser, SeededUser } from '../helpers/seedUser';
import { useScratchDatabase } from '../helpers/scratch-database';
import { usePrismaStores } from '../helpers/loki-stores';

/**
 * SDK leases against the production store: the real auth middleware computes
 * the member's teams, and the Prisma store's match (a SQL where clause, not
 * the in-memory filter the unit suite exercises) decides which phone a lease
 * lands on. Only the port RPC is faked.
 */
describe('team boundary on SDK leases (integration)', function () {
  this.timeout(60_000);
  useScratchDatabase({ wholeSuite: true });
  // The Prisma store this suite is about, under `test:all` too, whose
  // NODE_ENV would hand the factory a Loki one.
  usePrismaStores();

  let sa: SeededUser;
  let alice: SeededUser;
  let teamA: { id: string };
  let teamB: { id: string };

  const stamp = Date.now();
  const HOST = `http://lease-it-${stamp}:4723`;
  const SHARED_UDID = `tbl-shared-${stamp}`;
  const TEAM_A_UDID = `tbl-team-a-${stamp}`;
  const TEAM_B_UDID = `tbl-team-b-${stamp}`;
  const UDIDS = [SHARED_UDID, TEAM_A_UDID, TEAM_B_UDID];

  before(async () => {
    sa = await seedUser('SUPER_ADMIN', { name: 'TBL SA' });
    alice = await seedUser('MEMBER', { name: 'Alice (team A)' });
    teamA = await Container.get(TeamService).create(`tbl-team-a-${stamp}`);
    teamB = await Container.get(TeamService).create(`tbl-team-b-${stamp}`);
    await Container.get(TeamService).addMember(teamA.id, alice.user.id);
    for (const [udid, teamId] of [
      [SHARED_UDID, null],
      [TEAM_A_UDID, teamA.id],
      [TEAM_B_UDID, teamB.id],
    ] as Array<[string, string | null]>) {
      await prisma.device.create({
        data: { udid, host: HOST, name: udid, platform: 'android', sdk: '14', teamId } as any,
      });
    }
  });

  // Each case starts with every phone free and no lease held.
  beforeEach(async () => {
    await prisma.lease.deleteMany({ where: { deviceUdid: { in: UDIDS } } });
    await prisma.device.updateMany({ where: { udid: { in: UDIDS } }, data: { busy: false } });
  });

  function lease(who: SeededUser, filters: Record<string, unknown>) {
    const svc = new LeaseService(
      prisma,
      DeviceStoreFactory.getStore(),
      {
        allocate: async () => ({ systemPort: 9001, chromedriverPort: 9002, mjpegServerPort: 9003 }),
      },
      { nodePairAuth: async () => ({ accessKey: 'k', token: 't' }) },
    );
    const app = express();
    app.use(express.json());
    app.use(authMiddleware);
    app.use('/sdk/leases', makeRouter({ leaseService: svc }));
    return request(app)
      .post('/sdk/leases')
      .set('Cookie', who.cookie)
      .send({ filters: { platform: 'android', filterByHost: HOST, ...filters } });
  }

  const busy = async (udid: string) =>
    !!(await prisma.device.findFirst({ where: { udid, host: HOST } }))?.busy;

  it("never lands a team-A member's lease on team B's phone when the filter names it", async () => {
    const res = await lease(alice, { udid: TEAM_B_UDID });
    expect(res.status).to.not.equal(201);
    expect(res.body.device).to.equal(undefined);
    expect(await busy(TEAM_B_UDID)).to.equal(false);
    expect(await prisma.lease.count({ where: { deviceUdid: TEAM_B_UDID } })).to.equal(0);
  });

  it("never lands a team-A member's lease on team B's phone, even with every visible phone taken", async () => {
    const got: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await lease(alice, {});
      if (res.status === 201) got.push(res.body.device.udid);
    }
    expect(got.sort()).to.deep.equal([SHARED_UDID, TEAM_A_UDID].sort());
    expect(await busy(TEAM_B_UDID)).to.equal(false);
  });

  it("lets a team-A member lease team A's phone", async () => {
    const res = await lease(alice, { udid: TEAM_A_UDID });
    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    expect(res.body.device.udid).to.equal(TEAM_A_UDID);
  });

  it("lets an admin lease team B's phone", async () => {
    const res = await lease(sa, { udid: TEAM_B_UDID });
    expect(res.status, JSON.stringify(res.body)).to.equal(201);
    expect(res.body.device.udid).to.equal(TEAM_B_UDID);
  });
});
