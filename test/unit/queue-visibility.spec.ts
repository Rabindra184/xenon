import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { prisma } from '../../src/prisma';
import {
  partitionPendingForCaller,
  REQUESTER_KEY,
  withoutRequester,
} from '../../src/services/device-access/queueVisibility';

/**
 * Which waiting requests a caller sees in detail. A member sees one when
 * (a) it names (`appium:udid`) a phone they can see, or
 * (b) they made it, or its requester's teams overlap theirs.
 * Everything else is counted, never shown. An admin sees all of them.
 */

const DEVICES = [
  { udid: 'shared', teamId: null },
  { udid: 'phone-a', teamId: 'team-a' },
  { udid: 'phone-b', teamId: 'team-b' },
  // One udid on two hosts, only one of them team A's.
  { udid: 'split', teamId: 'team-b' },
  { udid: 'split', teamId: 'team-a' },
];

const MEMBERSHIPS = [
  { userId: 'alice', teamId: 'team-a' },
  { userId: 'amy', teamId: 'team-a' },
  { userId: 'amy', teamId: 'team-c' },
  { userId: 'bob', teamId: 'team-b' },
];

const alice = { userId: 'alice', teamIds: ['team-a'] };
const loner = { userId: 'lou', teamIds: [] as string[] };

let n = 0;
const req = (requester: unknown, extra: Record<string, unknown> = {}) => ({
  capability_id: `req-${++n}`,
  createdAt: n,
  platformName: 'Android',
  ...(requester === undefined ? {} : { [REQUESTER_KEY]: requester }),
  ...extra,
});

const seen = async (
  rows: any[],
  caller: { userId?: string; teamIds?: string[] } | undefined,
): Promise<boolean[]> => {
  const { visible } = await partitionPendingForCaller(rows, caller);
  return rows.map((r) => visible.some((v) => v.capability_id === r.capability_id));
};

describe('queue visibility', () => {
  let devices: sinon.SinonStub;
  let members: sinon.SinonStub;

  beforeEach(() => {
    devices = sinon.stub(prisma.device, 'findMany').callsFake((async (args: any) => {
      const udid = args?.where?.udid;
      return DEVICES.filter((d) => udid.in.includes(d.udid)).map((d) => ({ ...d }));
    }) as any);
    members = sinon.stub(prisma.teamMember, 'findMany').callsFake((async (args: any) => {
      const userId = args?.where?.userId;
      return MEMBERSHIPS.filter((m) => userId.in.includes(m.userId)).map((m) => ({ ...m }));
    }) as any);
  });

  afterEach(() => sinon.restore());

  describe('(a) a request naming a phone', () => {
    it("is seen by a member of the phone's team, whoever asked", async () => {
      const r = req({ userId: 'bob', teamId: null }, { 'appium:udid': 'phone-a' });
      expect(await seen([r], alice)).to.deep.equal([true]);
    });

    it('is seen by everyone when the phone is shared, even a member in no team', async () => {
      const r = req({ userId: 'bob', teamId: null }, { 'appium:udid': 'shared' });
      expect(await seen([r], loner)).to.deep.equal([true]);
    });

    it("is not seen through another team's phone", async () => {
      const r = req({ userId: 'bob', teamId: null }, { 'appium:udid': 'phone-b' });
      expect(await seen([r], alice)).to.deep.equal([false]);
    });

    it('counts a udid on several hosts when any of its rows is visible', async () => {
      const r = req({ userId: 'bob', teamId: null }, { 'appium:udid': 'split' });
      expect(await seen([r], alice)).to.deep.equal([true]);
    });

    it('is not seen through a phone with no Device row', async () => {
      const r = req({ userId: 'bob', teamId: null }, { 'appium:udid': 'unplugged' });
      expect(await seen([r], alice)).to.deep.equal([false]);
    });

    it('still counts from a session that presented no credentials', async () => {
      const r = req({ userId: null, teamId: null }, { 'appium:udid': 'phone-a' });
      expect(await seen([r], alice)).to.deep.equal([true]);
    });
  });

  describe('(b) who asked', () => {
    it("the member's own request, targeted or not, even in no team", async () => {
      const own = req({ userId: 'lou', teamId: null });
      const ownElsewhere = req({ userId: 'lou', teamId: null }, { 'appium:udid': 'phone-b' });
      expect(await seen([own, ownElsewhere], loner)).to.deep.equal([true, true]);
    });

    it("a teammate's request, by their team membership", async () => {
      expect(await seen([req({ userId: 'amy', teamId: null })], alice)).to.deep.equal([true]);
    });

    it("another team's request, untargeted or naming their own phone", async () => {
      const untargeted = req({ userId: 'bob', teamId: null });
      const targeted = req({ userId: 'bob', teamId: null }, { 'appium:udid': 'phone-b' });
      expect(await seen([untargeted, targeted], alice)).to.deep.equal([false, false]);
    });

    it('a credential narrowed to her team, whatever teams its user is in', async () => {
      // A team-bound key, a session token's teamId claim, or xenon:team.
      expect(await seen([req({ userId: 'bob', teamId: 'team-a' })], alice)).to.deep.equal([true]);
    });

    it("not a teammate's request narrowed to another team", async () => {
      // The narrow wins over membership, as computeTeamIds has it for REST.
      expect(await seen([req({ userId: 'amy', teamId: 'team-c' })], alice)).to.deep.equal([false]);
    });

    it('never between two members in no team', async () => {
      expect(await seen([req({ userId: 'other-loner', teamId: null })], loner)).to.deep.equal([
        false,
      ]);
      expect(members.called, 'no team to overlap, so nothing to look up').to.equal(false);
    });

    it('never from a session that presented no credentials', async () => {
      expect(await seen([req({ userId: null, teamId: null })], alice)).to.deep.equal([false]);
    });
  });

  describe('a request queued before requesters were recorded', () => {
    it('is only counted for a member, even when it names her phone', async () => {
      const legacy = req(undefined, { 'appium:udid': 'phone-a' });
      const { visible, otherCount } = await partitionPendingForCaller([legacy], alice);
      expect(visible).to.deep.equal([]);
      expect(otherCount).to.equal(1);
    });

    it('is shown to an admin', async () => {
      expect(await seen([req(undefined)], { userId: 'root' })).to.deep.equal([true]);
    });
  });

  it('a malformed requester counts as none', async () => {
    for (const bad of [null, 'alice', { userId: 7 }, []]) {
      const r = req(bad, { 'appium:udid': 'phone-a' });
      expect(await seen([r], alice), JSON.stringify(bad)).to.deep.equal([false]);
    }
  });

  it('keeps the queue order and counts the rest', async () => {
    const rows = [
      req({ userId: 'bob', teamId: null }),
      req({ userId: 'amy', teamId: null }),
      req({ userId: 'bob', teamId: null }, { 'appium:udid': 'phone-a' }),
      req(undefined),
    ];
    const { visible, otherCount } = await partitionPendingForCaller(rows, alice);
    expect(visible.map((v) => v.capability_id)).to.deep.equal([
      rows[1].capability_id,
      rows[2].capability_id,
    ]);
    expect(otherCount).to.equal(2);
  });

  it('an admin sees everything with no lookup', async () => {
    const rows = [req({ userId: 'bob', teamId: null }, { 'appium:udid': 'phone-b' })];
    const { visible, otherCount } = await partitionPendingForCaller(rows, { userId: 'root' });
    expect(visible).to.have.length(1);
    expect(otherCount).to.equal(0);
    expect(devices.called).to.equal(false);
    expect(members.called).to.equal(false);
  });

  it('looks up phones and memberships once each, for the whole queue', async () => {
    const rows = [
      req({ userId: 'bob', teamId: null }, { 'appium:udid': 'phone-b' }),
      req({ userId: 'bob', teamId: null }, { 'appium:udid': 'phone-a' }),
      req({ userId: 'amy', teamId: null }),
      req({ userId: 'bob', teamId: null }),
    ];
    await partitionPendingForCaller(rows, alice);
    expect(devices.callCount).to.equal(1);
    expect(members.callCount).to.equal(1);
  });

  it('withoutRequester returns a copy, leaving the stored row alone', () => {
    const stored = req({ userId: 'amy', teamId: null });
    const shown = withoutRequester(stored);
    expect(shown).to.not.have.property(REQUESTER_KEY);
    expect(shown.capability_id).to.equal(stored.capability_id);
    expect(stored).to.have.property(REQUESTER_KEY);
  });
});
