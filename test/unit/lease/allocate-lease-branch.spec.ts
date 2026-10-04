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
// which case applied.
const REFUSED =
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
      expect(new Set(all.map(throwSite)).size, all.map(throwSite).join('\n')).to.equal(1);
      expect(throwSite(notYours)).to.include('device-utils');
    });
  });
});
