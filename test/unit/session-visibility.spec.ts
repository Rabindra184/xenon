import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { prisma } from '../../src/prisma';
import {
  canSeeSession,
  visibleSessionWhere,
} from '../../src/services/device-access/sessionVisibility';
import { filterRowsByVisibleDevice } from '../../src/data-service/device-service';

/**
 * Which sessions a caller may see. The team rule is REST's: an admin (teamIds
 * undefined) sees every session; anyone else sees a session whose phone is
 * shared or on one of their teams. A session whose phone has no Device row
 * (unplugged and reaped) is seen by its owner only, as recordings do.
 */

const DEVICES = [
  { udid: 'shared', teamId: null },
  { udid: 'phone-a', teamId: 'team-a' },
  { udid: 'phone-b', teamId: 'team-b' },
  // One udid on two hosts, only one of them visible to team A.
  { udid: 'split', teamId: 'team-b' },
  { udid: 'split', teamId: 'team-a' },
];

describe('session visibility', () => {
  beforeEach(() => {
    sinon.stub(prisma.device, 'findMany').callsFake((async (args: any) => {
      const udid = args?.where?.udid;
      const rows = DEVICES.filter((d) =>
        udid === undefined
          ? true
          : typeof udid === 'string'
            ? d.udid === udid
            : udid.in.includes(d.udid),
      );
      return rows.map((d) => ({ ...d }));
    }) as any);
  });

  afterEach(() => sinon.restore());

  const member = { userId: 'u-a', teamIds: ['team-a'] };

  describe('canSeeSession', () => {
    it('an admin sees every session, with no lookup', async () => {
      expect(
        await canSeeSession({ device_udid: 'phone-b', user_id: 'x' }, { userId: 'adm' }),
      ).to.equal(true);
      expect((prisma.device.findMany as sinon.SinonStub).called).to.equal(false);
    });

    it("a member sees a shared phone's and their team's sessions", async () => {
      expect(await canSeeSession({ device_udid: 'shared', user_id: 'x' }, member)).to.equal(true);
      expect(await canSeeSession({ device_udid: 'phone-a', user_id: 'x' }, member)).to.equal(true);
    });

    it("a member doesn't see another team's session, even their own", async () => {
      expect(await canSeeSession({ device_udid: 'phone-b', user_id: 'x' }, member)).to.equal(false);
      expect(await canSeeSession({ device_udid: 'phone-b', user_id: 'u-a' }, member)).to.equal(
        false,
      );
    });

    it('a udid on two hosts is visible when any of its rows is', async () => {
      expect(await canSeeSession({ device_udid: 'split', user_id: 'x' }, member)).to.equal(true);
    });

    it('a session on a phone that is gone: its owner sees it, nobody else does', async () => {
      expect(await canSeeSession({ device_udid: 'gone', user_id: 'u-a' }, member)).to.equal(true);
      expect(await canSeeSession({ device_udid: 'gone', user_id: 'someone' }, member)).to.equal(
        false,
      );
      expect(await canSeeSession({ device_udid: 'gone', user_id: null }, member)).to.equal(false);
    });

    it('a session with no udid is its owner’s only', async () => {
      expect(await canSeeSession({ device_udid: '', user_id: 'someone' }, member)).to.equal(false);
      expect(await canSeeSession({ device_udid: '', user_id: 'u-a' }, member)).to.equal(true);
    });

    it('a member in no team sees only shared phones', async () => {
      const lonely = { userId: 'u-x', teamIds: [] as string[] };
      expect(await canSeeSession({ device_udid: 'shared', user_id: 'x' }, lonely)).to.equal(true);
      expect(await canSeeSession({ device_udid: 'phone-a', user_id: 'x' }, lonely)).to.equal(false);
    });
  });

  describe('visibleSessionWhere', () => {
    it('is undefined for an admin', async () => {
      expect(await visibleSessionWhere({ userId: 'adm' })).to.equal(undefined);
    });

    it("a member: visible phones' sessions, or their own on a phone that is gone", async () => {
      const where = await visibleSessionWhere(member);
      expect(where).to.deep.equal({
        OR: [
          { device_udid: { in: ['shared', 'phone-a', 'split'] } },
          { user_id: 'u-a', device_udid: { notIn: ['shared', 'phone-a', 'phone-b', 'split'] } },
        ],
      });
    });

    it('a caller with no user id gets no owner branch', async () => {
      const where = await visibleSessionWhere({ teamIds: [] });
      expect(where).to.deep.equal({ OR: [{ device_udid: { in: ['shared'] } }] });
    });
  });

  describe('filterRowsByVisibleDevice', () => {
    it('fails closed on rows with no udid, rather than returning them all', async () => {
      const rows = [{ id: 's1', device_udid: '' }];
      expect(await filterRowsByVisibleDevice(rows, ['team-a'], 'device_udid')).to.deep.equal([]);
    });

    it('still returns everything to an admin', async () => {
      const rows = [{ id: 's1', device_udid: '' }];
      expect(await filterRowsByVisibleDevice(rows, undefined, 'device_udid')).to.deep.equal(rows);
    });
  });
});
