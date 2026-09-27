import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { allocateDeviceForSession } from '../../../src/device-utils';
import { DeviceStoreFactory } from '../../../src/data-service/device-store';
import { LeaseService } from '../../../src/services/lease/LeaseService';
import { hashToken } from '../../../src/services/lease/leaseToken';
import { DefaultPluginArgs } from '../../../src/interfaces/IPluginArgs';
import { overrideService, restoreServices } from '../../helpers/service-override';

// The lease branch of allocateDeviceForSession returns before the team
// filter every other allocation goes through, so it has to make the
// ownership and visibility decisions itself.

const TOKEN = 'f'.repeat(64);
const NOT_ACTIVE = 'lease lse_1 is not active';
const NOBODY = { isAdmin: false, apiKeyId: null, userId: null, leaseToken: null };

const leaseCaps = () => ({
  alwaysMatch: { platformName: 'android', 'xenon:options': { leaseId: 'lse_1' } },
  firstMatch: [{}],
});

describe('allocateDeviceForSession — lease-bound session', () => {
  let device: any;
  let lease: any;

  const allocate = (proof?: any, callerTeamIds?: string[]) =>
    allocateDeviceForSession(
      leaseCaps() as any,
      1000,
      100,
      DefaultPluginArgs as any,
      callerTeamIds,
      proof,
    );

  const refusal = async (proof?: any, callerTeamIds?: string[]) => {
    try {
      await allocate(proof, callerTeamIds);
    } catch (err: any) {
      return err.message as string;
    }
    return 'allocated';
  };

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
    overrideService(LeaseService, new LeaseService(db, {}, {}, noAuth));
    sinon.stub(DeviceStoreFactory, 'getStore').returns({
      findDevice: sinon.stub().callsFake(async () => device),
    } as any);
  });

  afterEach(() => {
    sinon.restore();
    restoreServices();
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

  describe("someone else's lease id is refused, as if it were not active", () => {
    it('with no credentials and no token', async () => {
      expect(await refusal(NOBODY)).to.equal(NOT_ACTIVE);
    });

    it('when the caller passes no proof at all', async () => {
      expect(await refusal(undefined)).to.equal(NOT_ACTIVE);
    });

    it('with a wrong token', async () => {
      expect(await refusal({ ...NOBODY, leaseToken: 'e'.repeat(64) })).to.equal(NOT_ACTIVE);
    });

    it('with a different API key', async () => {
      expect(await refusal({ ...NOBODY, apiKeyId: 'key_other', userId: 'usr_other' })).to.equal(
        NOT_ACTIVE,
      );
    });

    it('with the same words an inactive lease gets', async () => {
      lease.status = 'released';
      expect(await refusal({ ...NOBODY, apiKeyId: 'key_owner' })).to.equal(NOT_ACTIVE);
    });
  });

  describe('a scoped caller must still be able to see the device', () => {
    it('refuses the right token when the device now belongs to another team', async () => {
      device.teamId = 'team_b';
      expect(await refusal({ ...NOBODY, leaseToken: TOKEN }, ['team_a'])).to.equal(NOT_ACTIVE);
    });

    it('refuses the owner too when the device now belongs to another team', async () => {
      device.teamId = 'team_b';
      expect(await refusal({ ...NOBODY, apiKeyId: 'key_owner' }, ['team_a'])).to.equal(NOT_ACTIVE);
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

  describe('an admin', () => {
    it('gets any lease without the token or the identity', async () => {
      const got = await allocate({ ...NOBODY, isAdmin: true, apiKeyId: 'key_admin' });
      expect(got.udid).to.equal('u1');
    });

    it('is not held to a team, even when a team is passed', async () => {
      device.teamId = 'team_b';
      const got = await allocate({ ...NOBODY, isAdmin: true }, ['team_a']);
      expect(got.udid).to.equal('u1');
    });
  });
});
