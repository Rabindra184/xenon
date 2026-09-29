import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';

describe('LeaseService', () => {
  let prismaStub: any;
  let storeStub: any;
  let portClientStub: any;
  let svc: any;

  beforeEach(async () => {
    prismaStub = {
      lease: {
        create: sinon.stub().callsFake(async ({ data }: any) => ({ ...data, id: 'lse_test' })),
        findUnique: sinon.stub(),
        update: sinon.stub().callsFake(async ({ data }: any) => ({ id: 'lse_test', ...data })),
        updateMany: sinon.stub().resolves({ count: 1 }),
        delete: sinon.stub().resolves({ id: 'lse_test' }),
      },
      portLease: {
        updateMany: sinon.stub().resolves({ count: 0 }),
        deleteMany: sinon.stub().resolves({ count: 0 }),
      },
    };
    storeStub = {
      findAndLockDevice: sinon.stub().resolves({
        udid: 'u1', host: 'h1', platform: 'android', sdk: '14', name: 'Pixel 7', teamId: null,
      }),
      updateDevice: sinon.stub().resolves(),
      releaseLeaseLock: sinon.stub().resolves(true),
      getDevices: sinon.stub().resolves([]),
    };
    portClientStub = {
      allocate: sinon.stub().resolves({ systemPort: 9001, chromedriverPort: 9002, mjpegServerPort: 9003 }),
    };

    const { LeaseService } = await import('../../../src/services/lease/LeaseService');
    svc = new LeaseService(prismaStub, storeStub, portClientStub, {
      nodePairAuth: async () => ({ accessKey: 'k', token: 't' }),
    });
  });

  it('create returns a lease with token, ports, and capability bag', async () => {
    const out = await svc.create({
      filters: { platform: 'android' },
      durationMs: 60_000,
      heartbeatSeconds: 30,
      actorId: 'actor-1',
      teamId: null,
    });
    expect(out.leaseId).to.equal('lse_test');
    expect(out.leaseToken).to.match(/^[0-9a-f]{64}$/);
    expect(out.allocatedPorts).to.deep.equal({ systemPort: 9001, chromedriverPort: 9002, mjpegServerPort: 9003 });
    expect(out.appiumCapabilities['appium:udid']).to.equal('u1');
    expect(out.appiumCapabilities['xe:options'].leaseId).to.equal('lse_test');
    // Only the namespace Xenon documents.
    expect(out.appiumCapabilities).to.not.have.property('xenon:options');
    expect(storeStub.findAndLockDevice.calledOnce).to.equal(true);
    expect(portClientStub.allocate.calledOnce).to.equal(true);
    expect(prismaStub.lease.create.calledOnce).to.equal(true);
  });

  it('create rolls back the device lock when port RPC fails', async () => {
    portClientStub.allocate.rejects(new Error('node unreachable'));
    const { DeviceUnhealthy } = await import('../../../src/services/lease/LeaseService');
    let thrown: any = null;
    try {
      await svc.create({
        filters: { platform: 'android' },
        durationMs: 60_000,
        heartbeatSeconds: 30,
        actorId: 'actor-1',
        teamId: null,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.be.instanceOf(DeviceUnhealthy);
    expect(storeStub.updateDevice.calledWith('u1', 'h1', { busy: false })).to.equal(true);
    expect(prismaStub.lease.create.notCalled).to.equal(true);
  });

  it('create throws NoMatchingDevice when no device matches (empty pool)', async () => {
    storeStub.findAndLockDevice.resolves(null);
    storeStub.getDevices.resolves([]);
    const { NoMatchingDevice } = await import('../../../src/services/lease/LeaseService');
    let thrown: any = null;
    try {
      await svc.create({
        filters: { platform: 'android', udid: 'absent' },
        durationMs: 60_000,
        heartbeatSeconds: 30,
        actorId: 'actor-1',
        teamId: null,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.be.instanceOf(NoMatchingDevice);
  });

  it('create throws AllMatchingBusy when pool exists but every match is busy', async () => {
    storeStub.findAndLockDevice.resolves(null);
    storeStub.getDevices.resolves([{ udid: 'u1', host: 'h1', busy: true, platform: 'android' }]);
    const { AllMatchingBusy } = await import('../../../src/services/lease/LeaseService');
    let thrown: any = null;
    try {
      await svc.create({
        filters: { platform: 'android' },
        durationMs: 60_000,
        heartbeatSeconds: 30,
        actorId: 'actor-1',
        teamId: null,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.be.instanceOf(AllMatchingBusy);
  });

  it('create rolls back lease + ports + lock when capabilityBag update fails', async () => {
    prismaStub.lease.update.rejects(new Error('db transient error'));
    let thrown: any = null;
    try {
      await svc.create({
        filters: { platform: 'android' },
        durationMs: 60_000,
        heartbeatSeconds: 30,
        actorId: 'actor-1',
        teamId: null,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.be.an('Error');
    expect((thrown as Error).message).to.include('db transient error');
    expect(prismaStub.lease.delete.calledWith({ where: { id: 'lse_test' } })).to.equal(true);
    expect(prismaStub.portLease.deleteMany.called).to.equal(true);
    expect(storeStub.updateDevice.calledWith('u1', 'h1', { busy: false })).to.equal(true);
  });

  it('heartbeat bumps lastHeartbeatAt; does not bump expiresAt', async () => {
    const { hashToken } = await import('../../../src/services/lease/leaseToken');
    const before = Date.now();
    const tok = 'a'.repeat(64);
    prismaStub.lease.findUnique.resolves({
      id: 'lse_test', tokenHash: hashToken(tok), status: 'active', expiresAt: before + 60_000,
    });
    const out = await svc.heartbeat('lse_test', tok);
    expect(out.expiresAt).to.equal(before + 60_000);
    const call = prismaStub.lease.updateMany.firstCall.args[0];
    expect(call.where.status).to.equal('active');
    expect(call.data.lastHeartbeatAt).to.be.at.least(before);
  });

  it('heartbeat throws LeaseGone if updateMany affects zero rows', async () => {
    const { hashToken } = await import('../../../src/services/lease/leaseToken');
    const { LeaseGone } = await import('../../../src/services/lease/LeaseService');
    const tok = 'a'.repeat(64);
    prismaStub.lease.findUnique.resolves({
      id: 'lse_test', tokenHash: hashToken(tok), status: 'active', expiresAt: Date.now() + 60_000,
    });
    prismaStub.lease.updateMany.resolves({ count: 0 });
    let thrown: any = null;
    try { await svc.heartbeat('lse_test', tok); } catch (e) { thrown = e; }
    expect(thrown).to.be.instanceOf(LeaseGone);
  });

  it('extend bumps expiresAt up to MAX_LEASE_MS from createdAt', async () => {
    const { hashToken } = await import('../../../src/services/lease/leaseToken');
    const tok = 'b'.repeat(64);
    const createdAt = Date.now() - 10_000;
    prismaStub.lease.findUnique.resolves({
      id: 'lse_test', tokenHash: hashToken(tok), status: 'active',
      expiresAt: Date.now() + 10_000, createdAt: new Date(createdAt),
    });
    const out = await svc.extend('lse_test', tok, 60_000);
    expect(out.expiresAt).to.be.at.least(Date.now() + 50_000);
    expect(prismaStub.lease.updateMany.firstCall.args[0].where.status).to.equal('active');
  });

  // The sweeper marks a lease by missed heartbeats, not by expiresAt, so a
  // lease can be past expiresAt and still 'active'. Heartbeat already
  // refuses it; extend must too, or it hands the holder the lease back.
  for (const op of ['heartbeat', 'extend'] as const) {
    it(`${op} refuses a lease past its expiresAt that the sweeper hasn't marked, and writes nothing`, async () => {
      const { hashToken } = await import('../../../src/services/lease/leaseToken');
      const { LeaseGone } = await import('../../../src/services/lease/LeaseService');
      const tok = 'd'.repeat(64);
      const expiresAt = Date.now() - 1_000;
      prismaStub.lease.findUnique.resolves({
        id: 'lse_test',
        tokenHash: hashToken(tok),
        status: 'active',
        expiresAt,
        createdAt: new Date(Date.now() - 60_000),
      });
      const call =
        op === 'extend' ? svc.extend('lse_test', tok, 60_000) : svc.heartbeat('lse_test', tok);
      let thrown: any = null;
      await call.catch((e: unknown) => (thrown = e));
      expect(thrown).to.be.instanceOf(LeaseGone);
      expect(thrown.message).to.equal(`lease lse_test expired at ${expiresAt}`);
      expect(prismaStub.lease.updateMany.called).to.equal(false);
    });
  }

  it('release sets status=released and cascades PortLease delete', async () => {
    const { hashToken } = await import('../../../src/services/lease/leaseToken');
    const tok = 'c'.repeat(64);
    prismaStub.lease.findUnique.resolves({
      id: 'lse_test', tokenHash: hashToken(tok), status: 'active',
      deviceUdid: 'u1', deviceHost: 'h1',
    });
    await svc.release('lse_test', tok);
    expect(prismaStub.lease.updateMany.firstCall.args[0].data.status).to.equal('released');
    expect(prismaStub.lease.updateMany.firstCall.args[0].where.status).to.equal('active');
    expect(prismaStub.portLease.deleteMany.firstCall.args[0].where.leaseId).to.equal('lse_test');
    // Only the lease's lock (a session on the phone keeps it busy).
    expect(storeStub.releaseLeaseLock.calledWith('u1', 'h1')).to.equal(true);
    expect(storeStub.updateDevice.called).to.equal(false);
  });

  it('rejects operations with mismatched token', async () => {
    const { hashToken } = await import('../../../src/services/lease/leaseToken');
    prismaStub.lease.findUnique.resolves({
      id: 'lse_test', tokenHash: hashToken('right'), status: 'active',
    });
    const { LeaseTokenMismatch } = await import('../../../src/services/lease/LeaseService');
    let thrown: any = null;
    try { await svc.heartbeat('lse_test', 'wrong'); } catch (e) { thrown = e; }
    expect(thrown).to.be.instanceOf(LeaseTokenMismatch);
  });

  it('authorizeSessionUse returns null when lease has aged past expiresAt', async () => {
    prismaStub.lease.findUnique.resolves({
      id: 'lse_test', status: 'active',
      deviceUdid: 'u1', deviceHost: 'h1',
      expiresAt: Date.now() - 1_000,  // already expired wall-clock
      capabilityBag: '{}',
    });
    const anyone = { canOverride: true, apiKeyId: null, userId: null, leaseToken: null };
    const out = await svc.authorizeSessionUse('lse_test', anyone);
    expect(out).to.equal(null);
  });
});
