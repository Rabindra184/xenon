import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import { PrismaDeviceStore } from '../../src/data-service/prisma-store';
import { TeamService } from '../../src/services/TeamService';
import { prisma } from '../../src/prisma';
import { useScratchDatabase } from '../helpers/scratch-database';

/**
 * The team filter on the Prisma device store, run as a real query.
 *
 * `callerTeamIds` used to become `teamId: { in: [null, ...ids] }`, which Prisma
 * rejects ("Expected Null, provided (Null, String)"), so any caller in a team
 * threw instead of matching. test/unit/team-filter.test.ts stubs findMany and
 * so could only pin the shape it was given; this runs the query itself.
 */
describe('PrismaDeviceStore team filter (integration)', function () {
  this.timeout(60_000);
  useScratchDatabase({ wholeSuite: true });

  const store = new PrismaDeviceStore();
  let teamA: { id: string };
  let teamB: { id: string };

  const stamp = Date.now();
  // Unique, so every query here can be held to this suite's phones.
  const HOST = `http://team-filter-${stamp}:4723`;
  const SHARED = `tf-shared-${stamp}`;
  const PHONE_A = `tf-team-a-${stamp}`;
  const PHONE_B = `tf-team-b-${stamp}`;
  const UDIDS = [SHARED, PHONE_A, PHONE_B];

  before(async () => {
    teamA = await Container.get(TeamService).create(`tf-team-a-${stamp}`);
    teamB = await Container.get(TeamService).create(`tf-team-b-${stamp}`);
    for (const [udid, teamId] of [
      [SHARED, null],
      [PHONE_A, teamA.id],
      [PHONE_B, teamB.id],
    ] as Array<[string, string | null]>) {
      await prisma.device.create({
        data: { udid, host: HOST, name: udid, platform: 'android', teamId } as any,
      });
    }
  });

  beforeEach(async () => {
    await prisma.device.updateMany({ where: { udid: { in: UDIDS } }, data: { busy: false } });
  });

  const udidsOf = (rows: Array<{ udid: string }>) => rows.map((r) => r.udid).sort();
  const busy = async (udid: string) =>
    !!(await prisma.device.findFirst({ where: { udid, host: HOST } }))?.busy;

  it('getDevices with one team returns the shared phone and that team’s', async () => {
    const rows = await store.getDevices({ callerTeamIds: [teamA.id], filterByHost: HOST });
    expect(udidsOf(rows)).to.deep.equal([SHARED, PHONE_A].sort());
  });

  it('getDevices with two teams returns the shared phone and both teams’', async () => {
    const rows = await store.getDevices({
      callerTeamIds: [teamA.id, teamB.id],
      filterByHost: HOST,
    });
    expect(udidsOf(rows)).to.deep.equal([...UDIDS].sort());
  });

  it('getDevices with no team returns only the shared phone', async () => {
    const rows = await store.getDevices({ callerTeamIds: [], filterByHost: HOST });
    expect(udidsOf(rows)).to.deep.equal([SHARED]);
  });

  it('getDevices unscoped returns every phone', async () => {
    const rows = await store.getDevices({ filterByHost: HOST });
    expect(udidsOf(rows)).to.deep.equal([...UDIDS].sort());
  });

  it('findAndLockDevice with team A never locks team B’s phone', async () => {
    const locked: string[] = [];
    for (let i = 0; i < 3; i++) {
      const d = await store.findAndLockDevice({
        platform: 'android',
        callerTeamIds: [teamA.id],
        filterByHost: HOST,
      });
      if (d) locked.push(d.udid);
    }
    expect(locked.sort()).to.deep.equal([SHARED, PHONE_A].sort());
    expect(await busy(PHONE_B)).to.equal(false);
  });

  it('findAndLockDevice with team A returns nothing when the filter names team B’s phone', async () => {
    const d = await store.findAndLockDevice({
      platform: 'android',
      udid: PHONE_B,
      callerTeamIds: [teamA.id],
      filterByHost: HOST,
    });
    expect(d).to.equal(null);
    expect(await busy(PHONE_B)).to.equal(false);
  });
});
