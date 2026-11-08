import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { allocateDeviceForSession } from '../../../src/device-utils';
import { DeviceStoreFactory } from '../../../src/data-service/device-store';
import { LeaseService } from '../../../src/services/lease/LeaseService';
import { hashToken } from '../../../src/services/lease/leaseToken';
import { DefaultPluginArgs } from '../../../src/interfaces/IPluginArgs';
import { saveRegistrations } from '../../helpers/container-registration';
import { Container } from 'typedi';

// The lease branch of allocateDeviceForSession returns before the team
// filter every other allocation goes through, so it has to make the
// ownership and visibility decisions itself.

const TOKEN = 'f'.repeat(64);
// One answer for "not active", "not yours" and "hidden", so a caller can't
// tell them apart; it says how to prove you hold the lease without saying
// which case applied. A session-not-created error, as Appium words one: a
// client sees "session not created", not a server fault.
const NOT_CREATED = 'A new session could not be created. Details: ';
const REFUSED =
  NOT_CREATED +
  'lease lse_1 is not active, or this session did not prove it holds it — pass ' +
  'xe:options.leaseToken from the lease response, or create the session with the ' +
  'credentials that created the lease; and the phone must be one your teams can see';
const NOBODY = { canOverride: false, apiKeyId: null, userId: null, leaseToken: null };

const leaseCaps = () => ({
  alwaysMatch: { platformName: 'android', 'xe:options': { leaseId: 'lse_1' } },
  firstMatch: [{}],
});

describe('allocateDeviceForSession — lease-bound session', () => {
  let device: any;
  let lease: any;
  let restore: () => void;
  let updateDevice: sinon.SinonStub;

  const allocate = (proof?: any, callerTeamIds?: string[]) =>
    allocateDeviceForSession(
      leaseCaps() as any,
      1000,
      100,
      DefaultPluginArgs as any,
      callerTeamIds,
      proof,
    );

  const refusedWith = async (proof?: any, callerTeamIds?: string[]): Promise<Error | null> => {
    try {
      await allocate(proof, callerTeamIds);
    } catch (err: any) {
      return err;
    }
    return null;
  };

  const refusal = async (proof?: any, callerTeamIds?: string[]) =>
    (await refusedWith(proof, callerTeamIds))?.message ?? 'allocated';

  // The frame the error was built in: file and line, without the column.
  const throwSite = (err: Error | null) =>
    String(err?.stack?.split('\n').find((l) => l.trim().startsWith('at '))).replace(/:\d+\)?$/, '');

  beforeEach(() => {
    device = { udid: 'u1', host: 'h1', platform: 'android', teamId: null };
    lease = {
      id: 'lse_1',
      tokenHash: hashToken(TOKEN),
      deviceUdid: 'u1',
      deviceHost: 'h1',
      actorId: 'key_owner',
      teamId: null,
      status: 'active',
      expiresAt: Date.now() + 60_000,
      capabilityBag: '{}',
    };
    const db = { lease: { findUnique: sinon.stub().callsFake(async () => lease) } };
    const noAuth = { nodePairAuth: async () => ({ accessKey: '', token: '' }) };
    restore = saveRegistrations(LeaseService);
    Container.set(LeaseService, new LeaseService(db, {}, {}, noAuth));
    updateDevice = sinon.stub().resolves();
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: sinon.stub().callsFake(async () => device),
      updateDevice,
    } as any);
  });

  afterEach(() => {
    sinon.restore();
    restore();
  });

  describe('the lease holder gets the device', () => {
    it('by the API key that created the lease, with no token', async () => {
      const got = await allocate({ ...NOBODY, apiKeyId: 'key_owner', userId: 'usr_owner' });
      expect(got.udid).to.equal('u1');
    });

    it('by the user who created the lease, through a session token, with no token', async () => {
      lease.actorId = 'usr_owner';
      const got = await allocate({ ...NOBODY, userId: 'usr_owner' });
      expect(got.udid).to.equal('u1');
    });

    it('by anyone presenting the lease token', async () => {
      const got = await allocate({ ...NOBODY, leaseToken: TOKEN });
      expect(got.udid).to.equal('u1');
    });
  });

  describe('the idle sweeper reads the session, not the lease', () => {
    // It used to read the server-wide newCommandTimeoutSec and the lease's
    // creation time, so a leased session was ended a minute after the lease
    // was taken, whatever the session asked for.
    it("records the session's newCommandTimeout and its start", async () => {
      const caps = leaseCaps() as any;
      caps.alwaysMatch['appium:newCommandTimeout'] = 120;
      const before = Date.now();
      await allocateDeviceForSession(caps, 1000, 100, DefaultPluginArgs as any, undefined, {
        ...NOBODY,
        leaseToken: TOKEN,
      });
      const [udid, host, written] = updateDevice.firstCall.args;
      expect([udid, host]).to.deep.equal(['u1', 'h1']);
      expect(written.newCommandTimeout).to.equal(120);
      expect(written.lastCmdExecutedAt).to.be.at.least(before);
    });

    it("falls back to the server's newCommandTimeoutSec", async () => {
      await allocate({ ...NOBODY, leaseToken: TOKEN });
      expect(updateDevice.firstCall.args[2].newCommandTimeout).to.equal(
        DefaultPluginArgs.newCommandTimeoutSec,
      );
    });
  });

  describe("someone else's lease id is refused, as if it were not active", () => {
    it('with no credentials and no token', async () => {
      expect(await refusal(NOBODY)).to.equal(REFUSED);
    });

    it('when the caller passes no proof at all', async () => {
      expect(await refusal(undefined)).to.equal(REFUSED);
    });

    it('with a wrong token', async () => {
      expect(await refusal({ ...NOBODY, leaseToken: 'e'.repeat(64) })).to.equal(REFUSED);
    });

    it('with a different API key', async () => {
      expect(await refusal({ ...NOBODY, apiKeyId: 'key_other', userId: 'usr_other' })).to.equal(
        REFUSED,
      );
    });

    it('with the same words an inactive lease gets', async () => {
      lease.status = 'released';
      expect(await refusal({ ...NOBODY, apiKeyId: 'key_owner' })).to.equal(REFUSED);
    });
  });

  describe('a scoped caller must still be able to see the device', () => {
    it('refuses the right token when the device now belongs to another team', async () => {
      device.teamId = 'team_b';
      expect(await refusal({ ...NOBODY, leaseToken: TOKEN }, ['team_a'])).to.equal(REFUSED);
    });

    it('refuses the owner too when the device now belongs to another team', async () => {
      device.teamId = 'team_b';
      expect(await refusal({ ...NOBODY, apiKeyId: 'key_owner' }, ['team_a'])).to.equal(REFUSED);
    });

    it("allows a device in the caller's team", async () => {
      device.teamId = 'team_a';
      const got = await allocate({ ...NOBODY, leaseToken: TOKEN }, ['team_a']);
      expect(got.udid).to.equal('u1');
    });

    it('allows a shared-pool device to a caller with no team', async () => {
      const got = await allocate({ ...NOBODY, leaseToken: TOKEN }, []);
      expect(got.udid).to.equal('u1');
    });
  });

  describe('a caller who may override', () => {
    it('gets any lease without the token or the identity', async () => {
      const got = await allocate({ ...NOBODY, canOverride: true, apiKeyId: 'key_admin' });
      expect(got.udid).to.equal('u1');
    });

    it('is still held to its teams: visibility has no admin exception', async () => {
      // An unscoped caller (teams undefined) sees everything; the override
      // itself grants no visibility.
      device.teamId = 'team_b';
      expect(await refusal({ ...NOBODY, canOverride: true }, ['team_a'])).to.equal(REFUSED);
      const got = await allocate({ ...NOBODY, canOverride: true }, undefined);
      expect(got.udid).to.equal('u1');
    });
  });

  describe('a group lease: the session names its member', () => {
    // Each member's capabilities carry xe:options.leaseMember, its index.
    const NAME_THE_MEMBER = NOT_CREATED + 'name the lease member: xe:options.leaseMember';
    const phones: Record<string, any> = {
      'u1@h1': { udid: 'u1', host: 'h1', platform: 'android', teamId: null },
      'u2@h2': { udid: 'u2', host: 'h2', platform: 'android', teamId: null },
    };
    const memberRow = (index: number, udid: string, host: string) => ({
      index,
      udid,
      host,
      allocatedPorts: '{}',
      capabilityBag: JSON.stringify({ 'appium:udid': udid }),
    });
    const onMember = (leaseMember?: unknown, proof: any = { ...NOBODY, leaseToken: TOKEN }) => {
      const caps: any = leaseCaps();
      if (leaseMember !== undefined) caps.alwaysMatch['xe:options'].leaseMember = leaseMember;
      return allocateDeviceForSession(caps, 1000, 100, DefaultPluginArgs as any, undefined, proof);
    };
    const refusalOn = async (leaseMember?: unknown, proof?: any) => {
      try {
        await onMember(leaseMember, proof);
      } catch (err: any) {
        return err.message as string;
      }
      return 'allocated';
    };

    beforeEach(() => {
      lease.members = [memberRow(0, 'u1', 'h1'), memberRow(1, 'u2', 'h2')];
      (DeviceStoreFactory.getStore as sinon.SinonStub).returns({
        findDevice: sinon.stub().callsFake(async (q: any) => phones[`${q.udid}@${q.host}`] ?? null),
        updateDevice,
      } as any);
    });

    it("allocates the named member's phone", async () => {
      expect((await onMember(1)).udid).to.equal('u2');
      expect((await onMember(0)).udid).to.equal('u1');
      // The idle sweeper's fields go on the member's own row.
      expect(updateDevice.firstCall.args.slice(0, 2)).to.deep.equal(['u2', 'h2']);
    });

    it('reads the member from the xenon:options alias too', async () => {
      const caps: any = {
        alwaysMatch: {
          platformName: 'android',
          'xenon:options': { leaseId: 'lse_1', leaseMember: 1 },
        },
        firstMatch: [{}],
      };
      const got = await allocateDeviceForSession(
        caps,
        1000,
        100,
        DefaultPluginArgs as any,
        undefined,
        {
          ...NOBODY,
          leaseToken: TOKEN,
        },
      );
      expect(got.udid).to.equal('u2');
    });

    it('refuses a group session that names no member, with that message', async () => {
      expect(await refusalOn(undefined)).to.equal(NAME_THE_MEMBER);
      // A member that isn't a non-negative whole number names none.
      expect(await refusalOn('1')).to.equal(NAME_THE_MEMBER);
      expect(await refusalOn(-1)).to.equal(NAME_THE_MEMBER);
    });

    it('gives a caller without proof the plain refusal, never the member count', async () => {
      expect(await refusalOn(undefined, NOBODY)).to.equal(REFUSED);
      expect(await refusalOn(undefined, { ...NOBODY, apiKeyId: 'key_other' })).to.equal(REFUSED);
    });

    it('refuses a member the lease does not have with the plain refusal', async () => {
      expect(await refusalOn(2)).to.equal(REFUSED);
      expect(await refusalOn(7)).to.equal(REFUSED);
    });

    it('refuses an inactive group with the plain refusal, member named or not', async () => {
      lease.status = 'waiting';
      expect(await refusalOn(1)).to.equal(REFUSED);
      expect(await refusalOn(undefined)).to.equal(REFUSED);
    });

    it("holds the member's phone to the caller's teams", async () => {
      phones['u2@h2'].teamId = 'team_b';
      try {
        const caps: any = leaseCaps();
        caps.alwaysMatch['xe:options'].leaseMember = 1;
        const err = await allocateDeviceForSession(
          caps,
          1000,
          100,
          DefaultPluginArgs as any,
          ['team_a'],
          {
            ...NOBODY,
            leaseToken: TOKEN,
          },
        ).then(
          () => null,
          (e: Error) => e,
        );
        expect(err?.message).to.equal(REFUSED);
      } finally {
        phones['u2@h2'].teamId = null;
      }
    });
  });

  describe('a single lease needs no member', () => {
    it('needs no member for a single lease', async () => {
      // A lease from before groups (no member rows) is member 0 of its own columns.
      expect((await allocate({ ...NOBODY, leaseToken: TOKEN })).udid).to.equal('u1');
      // And one with its member row.
      lease.members = [
        { index: 0, udid: 'u1', host: 'h1', allocatedPorts: '{}', capabilityBag: '{}' },
      ];
      expect((await allocate({ ...NOBODY, leaseToken: TOKEN })).udid).to.equal('u1');
    });

    it('takes member 0 when named, and refuses any other with the plain refusal', async () => {
      const on = (leaseMember: number) => {
        const caps: any = leaseCaps();
        caps.alwaysMatch['xe:options'].leaseMember = leaseMember;
        return allocateDeviceForSession(caps, 1000, 100, DefaultPluginArgs as any, undefined, {
          ...NOBODY,
          leaseToken: TOKEN,
        });
      };
      expect((await on(0)).udid).to.equal('u1');
      const err = await on(1).then(
        () => null,
        (e: Error) => e,
      );
      expect(err?.message).to.equal(REFUSED);
    });
  });

  describe('every refusal', () => {
    it('reads exactly the same and is thrown from the same place', async () => {
      const notYours = await refusedWith({ ...NOBODY, apiKeyId: 'key_other' });
      device.teamId = 'team_b';
      const hidden = await refusedWith({ ...NOBODY, leaseToken: TOKEN }, ['team_a']);
      lease.status = 'released';
      const notActive = await refusedWith({ ...NOBODY, leaseToken: TOKEN });
      lease = null;
      const missing = await refusedWith({ ...NOBODY, canOverride: true });

      const all = [notYours, hidden, notActive, missing];
      for (const err of all) expect(err?.message).to.equal(REFUSED);
      for (const err of all) expect((err as any)?.error).to.equal('session not created');
      expect(new Set(all.map(throwSite)).size, all.map(throwSite).join('\n')).to.equal(1);
      expect(throwSite(notYours)).to.include('device-utils');
    });
  });
});
