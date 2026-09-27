import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { LeaseService } from '../../../src/services/lease/LeaseService';
import { hashToken } from '../../../src/services/lease/leaseToken';

// A lease id is not a secret: it appears in capability bags, logs and the
// dashboard. Before this, knowing one was enough to take its phone, because
// the session-create path checked only that the lease was active. These
// cases pin who may use a lease, and that the token proving it is handed to
// the client once and never stored.

const TOKEN = 'f'.repeat(64);
const NOBODY = { isAdmin: false, apiKeyId: null, userId: null, leaseToken: null };

function leaseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lse_1',
    tokenHash: hashToken(TOKEN),
    deviceUdid: 'u1',
    deviceHost: 'h1',
    actorId: 'key_owner',
    teamId: null,
    status: 'active',
    expiresAt: Date.now() + 60_000,
    capabilityBag: JSON.stringify({ 'xenon:options': { leaseId: 'lse_1' } }),
    ...overrides,
  };
}

describe('LeaseService — who may use a lease for a session', () => {
  let db: any;
  let store: any;
  let svc: LeaseService;

  beforeEach(() => {
    db = {
      lease: {
        create: sinon.stub().callsFake(async ({ data }: any) => ({ ...data, id: 'lse_1' })),
        findUnique: sinon.stub().resolves(leaseRow()),
        update: sinon.stub().callsFake(async ({ data }: any) => ({ id: 'lse_1', ...data })),
        updateMany: sinon.stub().resolves({ count: 1 }),
        delete: sinon.stub().resolves({ id: 'lse_1' }),
      },
      portLease: {
        updateMany: sinon.stub().resolves({ count: 0 }),
        deleteMany: sinon.stub().resolves({ count: 0 }),
      },
    };
    store = {
      findAndLockDevice: sinon.stub().resolves({
        udid: 'u1',
        host: 'h1',
        platform: 'android',
        sdk: '14',
        name: 'Pixel 7',
        teamId: null,
      }),
      updateDevice: sinon.stub().resolves(),
      getDevices: sinon.stub().resolves([]),
    };
    const ports = { allocate: sinon.stub().resolves({ systemPort: 9001, mjpegServerPort: 9003 }) };
    svc = new LeaseService(db, store, ports, {
      nodePairAuth: async () => ({ accessKey: 'k', token: 't' }),
    });
  });

  afterEach(() => sinon.restore());

  describe('create', () => {
    it('returns the token in appiumCapabilities but never stores it in capabilityBag', async () => {
      const out = await svc.create({
        filters: { platform: 'android' },
        durationMs: 60_000,
        heartbeatSeconds: 30,
        actorId: 'key_owner',
        teamId: null,
      });

      expect(out.appiumCapabilities['xenon:options'].leaseId).to.equal('lse_1');
      expect(out.appiumCapabilities['xenon:options'].leaseToken).to.equal(out.leaseToken);

      const stored = db.lease.update.firstCall.args[0].data.capabilityBag as string;
      expect(JSON.parse(stored)['xenon:options']).to.deep.equal({ leaseId: 'lse_1' });
      expect(stored).to.not.include(out.leaseToken);
      // Only the hash is stored anywhere.
      const created = JSON.stringify(db.lease.create.firstCall.args[0].data);
      expect(created).to.not.include(out.leaseToken);
    });
  });

  describe('resolve', () => {
    it('returns null for a lease that is no longer active', async () => {
      db.lease.findUnique.resolves(leaseRow({ status: 'released' }));
      expect(await svc.resolve('lse_1')).to.equal(null);
    });
  });

  describe('authorizeSessionUse', () => {
    const device = { deviceUdid: 'u1', deviceHost: 'h1' };

    it('lets the creating API key use it without the token', async () => {
      const out = await svc.authorizeSessionUse('lse_1', { ...NOBODY, apiKeyId: 'key_owner' });
      expect(out).to.include(device);
    });

    it('lets the creating user use it without the token', async () => {
      // A bearer or cookie caller creates the lease as its user id.
      db.lease.findUnique.resolves(leaseRow({ actorId: 'usr_owner' }));
      const out = await svc.authorizeSessionUse('lse_1', { ...NOBODY, userId: 'usr_owner' });
      expect(out).to.include(device);
    });

    it('lets anyone holding the token use it', async () => {
      const out = await svc.authorizeSessionUse('lse_1', { ...NOBODY, leaseToken: TOKEN });
      expect(out).to.include(device);
    });

    it('lets an admin use any lease', async () => {
      const out = await svc.authorizeSessionUse('lse_1', { ...NOBODY, isAdmin: true });
      expect(out).to.include(device);
    });

    it('refuses a caller with no credentials and no token', async () => {
      expect(await svc.authorizeSessionUse('lse_1', NOBODY)).to.equal(null);
    });

    it('refuses a wrong token', async () => {
      const out = await svc.authorizeSessionUse('lse_1', { ...NOBODY, leaseToken: 'e'.repeat(64) });
      expect(out).to.equal(null);
    });

    it('refuses a different API key and its user', async () => {
      const out = await svc.authorizeSessionUse('lse_1', {
        ...NOBODY,
        apiKeyId: 'key_other',
        userId: 'usr_other',
      });
      expect(out).to.equal(null);
    });

    it('refuses an inactive or expired lease even to its owner, a token holder or an admin', async () => {
      const everyProof = { isAdmin: true, apiKeyId: 'key_owner', userId: null, leaseToken: TOKEN };
      db.lease.findUnique.resolves(leaseRow({ status: 'released' }));
      expect(await svc.authorizeSessionUse('lse_1', everyProof)).to.equal(null);
      db.lease.findUnique.resolves(leaseRow({ expiresAt: Date.now() - 1 }));
      expect(await svc.authorizeSessionUse('lse_1', everyProof)).to.equal(null);
      db.lease.findUnique.resolves(null);
      expect(await svc.authorizeSessionUse('lse_1', everyProof)).to.equal(null);
    });
  });
});
