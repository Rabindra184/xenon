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
    const phone = {
      udid: 'u1', host: 'h1', platform: 'android', sdk: '14', name: 'Pixel 7', teamId: null,
    };
    storeStub = {
      findAndLockDevice: sinon.stub().resolves(phone),
      updateDevice: sinon.stub().resolves(),
      releaseLeaseLock: sinon.stub().resolves(true),
      getDevices: sinon.stub().resolves([phone]),
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

  it('create writes member 0 with the lease', async () => {
    const before = Date.now();
    await svc.create({
      filters: { platform: 'android' },
      durationMs: 60_000,
      heartbeatSeconds: 30,
      actorId: 'actor-1',
      teamId: null,
    });

    const data = prismaStub.lease.create.firstCall.args[0].data;
    expect(data.members.create).to.have.length(1);
    const member = data.members.create[0];
    expect(member).to.deep.include({ index: 0, udid: 'u1', host: 'h1' });
    expect(member.allocatedPorts).to.equal(data.allocatedPorts);
    expect(member.heldAt).to.be.at.least(before);
    // The capability bag is written to the lease and member 0 in one update.
    const update = prismaStub.lease.update.firstCall.args[0].data;
    expect(update.members).to.deep.equal({
      updateMany: { where: { index: 0 }, data: { capabilityBag: update.capabilityBag } },
    });
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

  // Through 2.18 extend set the end to now + durationMs, so asking for less
  // than the time left cut the lease short: a 5-minute extend 30 minutes
  // before the end ended it 25 minutes early.
  it('extend never shortens a lease: less than the time left keeps its end', async () => {
    const { hashToken } = await import('../../../src/services/lease/leaseToken');
    const tok = 'e'.repeat(64);
    const expiresAt = Date.now() + 30 * 60_000;
    prismaStub.lease.findUnique.resolves({
      id: 'lse_test',
      tokenHash: hashToken(tok),
      status: 'active',
      expiresAt,
      createdAt: new Date(Date.now() - 60_000),
    });
    const out = await svc.extend('lse_test', tok, 5 * 60_000);
    expect(out.expiresAt).to.equal(expiresAt);
    expect(prismaStub.lease.updateMany.firstCall.args[0].data.expiresAt).to.equal(expiresAt);
  });

  it('extend stops at 24 hours after the lease was created', async () => {
    const { hashToken } = await import('../../../src/services/lease/leaseToken');
    const tok = 'f'.repeat(64);
    const createdAt = Date.now() - 23 * 60 * 60_000;
    prismaStub.lease.findUnique.resolves({
      id: 'lse_test',
      tokenHash: hashToken(tok),
      status: 'active',
      expiresAt: Date.now() + 60_000,
      createdAt: new Date(createdAt),
    });
    const out = await svc.extend('lse_test', tok, 2 * 60 * 60_000);
    expect(out.expiresAt).to.equal(createdAt + 24 * 60 * 60_000);
  });

  describe("extend moves the lease's ports with it", () => {
    const ports = { systemPort: 9001, chromedriverPort: 9002, mjpegServerPort: 9003 };

    async function leaseOnHost(tok: string) {
      const { hashToken } = await import('../../../src/services/lease/leaseToken');
      prismaStub.lease.findUnique.resolves({
        id: 'lse_test',
        tokenHash: hashToken(tok),
        status: 'active',
        deviceUdid: 'u1',
        deviceHost: 'http://node:4723',
        allocatedPorts: JSON.stringify(ports),
        expiresAt: Date.now() + 60_000,
        createdAt: new Date(Date.now() - 60_000),
      });
    }

    // The ports were reserved on the phone's server for the lease's first
    // duration (plus 5 minutes). Past that the server forgets them, while the
    // extended lease still counts on them.
    it("asks the phone's server to hold its ports until the new end", async () => {
      portClientStub.extend = sinon.stub().resolves({ extended: 3 });
      const tok = '1'.repeat(64);
      await leaseOnHost(tok);
      const out = await svc.extend('lse_test', tok, 60 * 60_000);
      await svc.phoneServerCallsSettled();
      expect(portClientStub.extend.calledOnce).to.equal(true);
      const args = portClientStub.extend.firstCall.args[0];
      expect(args.nodeHost).to.equal('http://node:4723');
      expect(args.udid).to.equal('u1');
      expect(args.ports).to.have.members([9001, 9002, 9003]);
      expect(args.expiresAt).to.equal(out.expiresAt);
      expect(args.nodePairAuth).to.deep.equal({ accessKey: 'k', token: 't' });
    });

    it("answers the extend whatever the phone's server says", async () => {
      portClientStub.extend = sinon.stub().rejects(new Error('404 Not Found'));
      const tok = '2'.repeat(64);
      await leaseOnHost(tok);
      const out = await svc.extend('lse_test', tok, 60 * 60_000);
      await svc.phoneServerCallsSettled();
      expect(out.expiresAt).to.be.at.least(Date.now() + 59 * 60_000);
    });

    it('asks nothing when the end does not move', async () => {
      portClientStub.extend = sinon.stub().resolves({ extended: 3 });
      const tok = '3'.repeat(64);
      await leaseOnHost(tok);
      await svc.extend('lse_test', tok, 60_000 - 5_000);
      await svc.phoneServerCallsSettled();
      expect(portClientStub.extend.called).to.equal(false);
    });
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

  // A lease's ports are rows in the database of the phone's server. For a
  // node's phone that is the node's, where they carry no lease id (they are
  // reserved before the lease exists), so the hub's delete by lease id never
  // reached them: through 2.19 they stayed reserved until their own end.
  describe("release frees the lease's ports on the phone's server", () => {
    const ports = { systemPort: 9001, chromedriverPort: 9002, mjpegServerPort: 9003 };

    async function leaseOn(tok: string, host = 'http://node:4723') {
      const { hashToken } = await import('../../../src/services/lease/leaseToken');
      prismaStub.lease.findUnique.resolves({
        id: 'lse_test',
        tokenHash: hashToken(tok),
        status: 'active',
        deviceUdid: 'u1',
        deviceHost: host,
        allocatedPorts: JSON.stringify(ports),
        expiresAt: Date.now() + 60_000,
      });
    }

    it('asks a node to free the ports its own database holds', async () => {
      portClientStub.release = sinon.stub().resolves({ released: 3 });
      const tok = '4'.repeat(64);
      await leaseOn(tok);
      await svc.release('lse_test', tok);
      await svc.phoneServerCallsSettled();
      expect(portClientStub.release.calledOnce).to.equal(true);
      const args = portClientStub.release.firstCall.args[0];
      expect(args.nodeHost).to.equal('http://node:4723');
      expect(args.udid).to.equal('u1');
      expect(args.ports).to.have.members([9001, 9002, 9003]);
      expect(args.nodePairAuth).to.deep.equal({ accessKey: 'k', token: 't' });
    });

    it('asks nothing when this server already deleted every one', async () => {
      portClientStub.release = sinon.stub().resolves({ released: 0 });
      prismaStub.portLease.deleteMany.resolves({ count: 3 });
      const tok = '5'.repeat(64);
      await leaseOn(tok, 'http://hub:4723');
      await svc.release('lse_test', tok);
      await svc.phoneServerCallsSettled();
      expect(portClientStub.release.called).to.equal(false);
    });

    it("releases the lease whatever the phone's server says", async () => {
      portClientStub.release = sinon.stub().rejects(new Error('404 Not Found'));
      const tok = '6'.repeat(64);
      await leaseOn(tok);
      await svc.release('lse_test', tok);
      await svc.phoneServerCallsSettled();
      expect(prismaStub.lease.updateMany.firstCall.args[0].data.status).to.equal('released');
      expect(storeStub.releaseLeaseLock.calledOnceWith('u1', 'http://node:4723')).to.equal(true);
    });
  });

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
