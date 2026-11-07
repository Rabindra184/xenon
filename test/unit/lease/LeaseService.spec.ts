import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';

describe('LeaseService', () => {
  let prismaStub: any;
  let storeStub: any;
  let portClientStub: any;
  let svc: any;

  let created: any;

  beforeEach(async () => {
    created = undefined;
    prismaStub = {
      lease: {
        // The grant writes the lease (LeaseQueue → LeaseGranter), and create
        // reads it back with its members.
        create: sinon.stub().callsFake(async ({ data }: any) => {
          created = { ...data, members: data.members?.create ?? [] };
          return created;
        }),
        findUnique: sinon.stub().callsFake(async () => created ?? null),
        findMany: sinon.stub().resolves([]),
        update: sinon.stub().callsFake(async ({ data }: any) => ({ id: 'lse_test', ...data })),
        updateMany: sinon.stub().resolves({ count: 1 }),
        delete: sinon.stub().resolves({ id: 'lse_test' }),
      },
      leaseMember: { findMany: sinon.stub().resolves([]) },
      portLease: {
        updateMany: sinon.stub().resolves({ count: 0 }),
        deleteMany: sinon.stub().resolves({ count: 0 }),
      },
    };
    const phone = {
      udid: 'u1',
      host: 'h1',
      platform: 'android',
      sdk: '14',
      name: 'Pixel 7',
      teamId: null,
    };
    storeStub = {
      findAndLockDevice: sinon.stub().resolves(phone),
      updateDevice: sinon.stub().resolves(),
      releaseLeaseLock: sinon.stub().resolves(true),
      getDevices: sinon.stub().resolves([phone]),
      findDevice: sinon.stub().resolves(phone),
    };
    portClientStub = {
      allocate: sinon
        .stub()
        .resolves({ systemPort: 9001, chromedriverPort: 9002, mjpegServerPort: 9003 }),
    };

    const { LeaseService } = await import('../../../src/services/lease/LeaseService');
    svc = new LeaseService(prismaStub, storeStub, portClientStub, {
      nodePairAuth: async () => ({ accessKey: 'k', token: 't' }),
    });
  });

  const oneAndroid = {
    filters: { platform: 'android' },
    durationMs: 60_000,
    heartbeatSeconds: 30,
    actorId: 'actor-1',
    teamId: null,
  };

  async function thrownBy(work: () => Promise<unknown>): Promise<any> {
    try {
      await work();
    } catch (e) {
      return e;
    }
    return null;
  }

  it('create returns a lease with token, ports, and capability bag', async () => {
    const out = await svc.create(oneAndroid);
    expect(out.status).to.equal('granted');
    const body = out.body;
    expect(body.leaseId).to.equal(created.id);
    expect(body.leaseToken).to.match(/^[0-9a-f]{64}$/);
    expect(body.allocatedPorts).to.deep.equal({
      systemPort: 9001,
      chromedriverPort: 9002,
      mjpegServerPort: 9003,
    });
    expect(body.appiumCapabilities['appium:udid']).to.equal('u1');
    expect(body.appiumCapabilities['xe:options'].leaseId).to.equal(created.id);
    // Only the namespace Xenon documents.
    expect(body.appiumCapabilities).to.not.have.property('xenon:options');
    expect(body.device).to.deep.include({
      udid: 'u1',
      host: 'h1',
      platform: 'android',
      name: 'Pixel 7',
    });
    expect(body.members).to.have.length(1);
    expect(storeStub.findAndLockDevice.calledOnce).to.equal(true);
    expect(portClientStub.allocate.calledOnce).to.equal(true);
    expect(prismaStub.lease.create.calledOnce).to.equal(true);
  });

  it('create writes member 0 with the lease, in one write', async () => {
    const before = Date.now();
    await svc.create(oneAndroid);

    const data = prismaStub.lease.create.firstCall.args[0].data;
    expect(data).to.deep.include({
      status: 'active',
      deviceUdid: 'u1',
      deviceHost: 'h1',
      durationMs: 60_000,
    });
    expect(data.members.create).to.have.length(1);
    const member = data.members.create[0];
    expect(member).to.deep.include({ index: 0, udid: 'u1', host: 'h1' });
    expect(member.allocatedPorts).to.equal(data.allocatedPorts);
    expect(member.capabilityBag).to.equal(data.capabilityBag);
    expect(member.heldAt).to.be.at.least(before);
    // Nothing is patched in afterwards.
    expect(prismaStub.lease.update.called).to.equal(false);
  });

  it('create rolls back the device lock when port RPC fails', async () => {
    portClientStub.allocate.rejects(new Error('node unreachable'));
    const { DeviceUnhealthy } = await import('../../../src/services/lease/LeaseService');
    const thrown = await thrownBy(() => svc.create(oneAndroid));
    expect(thrown).to.be.instanceOf(DeviceUnhealthy);
    expect(storeStub.releaseLeaseLock.calledWith('u1', 'h1')).to.equal(true);
    expect(prismaStub.lease.create.notCalled).to.equal(true);
  });

  it('create throws NoMatchingDevice when no device matches (empty pool), and writes nothing', async () => {
    storeStub.findAndLockDevice.resolves(null);
    storeStub.getDevices.resolves([]);
    const { NoMatchingDevice } = await import('../../../src/services/lease/LeaseService');
    const thrown = await thrownBy(() =>
      svc.create({ ...oneAndroid, filters: { platform: 'android', udid: 'absent' } }),
    );
    expect(thrown).to.be.instanceOf(NoMatchingDevice);
    expect(thrown.message).to.equal('No device matches the filters');
    expect(storeStub.findAndLockDevice.called).to.equal(false);
    expect(prismaStub.lease.create.called).to.equal(false);
  });

  it('create throws AllMatchingBusy when pool exists but every match is busy', async () => {
    storeStub.findAndLockDevice.resolves(null);
    storeStub.getDevices.resolves([{ udid: 'u1', host: 'h1', busy: true, platform: 'android' }]);
    const { AllMatchingBusy } = await import('../../../src/services/lease/LeaseService');
    const thrown = await thrownBy(() => svc.create(oneAndroid));
    expect(thrown).to.be.instanceOf(AllMatchingBusy);
    expect(prismaStub.lease.create.called).to.equal(false);
  });

  it("create gives back the lock and this server's port rows when the lease can't be written", async () => {
    prismaStub.lease.create.rejects(new Error('db transient error'));
    const thrown = await thrownBy(() => svc.create(oneAndroid));
    expect(thrown).to.be.an('Error');
    expect(storeStub.releaseLeaseLock.calledWith('u1', 'h1')).to.equal(true);
    // By the phone as well as the port numbers: another phone's rows on the
    // same numbers (another server's) are left alone.
    const where = prismaStub.portLease.deleteMany.firstCall.args[0].where;
    expect(where).to.deep.include({ leasedToUdid: 'u1', leasedToHost: 'h1' });
  });

  describe('create, as the queue answers', () => {
    let queue: any;
    let queued: any;

    beforeEach(async () => {
      queue = {
        tryNow: sinon.stub(),
        pass: sinon.stub().resolves(),
        positionOf: sinon.stub().resolves(3),
        giveUp: sinon.stub().resolves('expired'),
        granter: { skipReason: sinon.stub().returns(undefined) },
      };
      const { LeaseService } = await import('../../../src/services/lease/LeaseService');
      queued = new LeaseService(
        prismaStub,
        storeStub,
        portClientStub,
        { nodePairAuth: async () => ({ accessKey: 'k', token: 't' }) },
        queue,
      );
    });

    it("hands the queue the token's hash, the members and the clamped duration", async () => {
      const { hashToken } = await import('../../../src/services/lease/leaseToken');
      queue.tryNow.callsFake(async () => {
        created = {
          id: 'lse_q',
          status: 'active',
          expiresAt: 1,
          heartbeatSeconds: 30,
          members: [
            { index: 0, udid: 'u1', host: 'h1', allocatedPorts: '{}', capabilityBag: '{}' },
          ],
        };
        return { leaseId: 'lse_q' };
      });

      const out = await queued.create({ ...oneAndroid, durationMs: 1, callerTeamIds: ['team-1'] });

      expect(out.status).to.equal('granted');
      const request = queue.tryNow.firstCall.args[0];
      expect(request.tokenHash).to.equal(hashToken(out.body.leaseToken));
      expect(request.members).to.deep.equal([{ filters: { platform: 'android' } }]);
      expect(request.durationMs).to.equal(60_000);
      expect(request.callerTeamIds).to.deep.equal(['team-1']);
      expect(queue.pass.called).to.equal(false);
    });

    it('answers DeviceUnhealthy when the queue says a port reservation failed', async () => {
      queue.tryNow.resolves('unhealthy');
      const { DeviceUnhealthy } = await import('../../../src/services/lease/LeaseService');
      expect(await thrownBy(() => queued.create(oneAndroid))).to.be.instanceOf(DeviceUnhealthy);
    });

    it('with waitMs, writes a waiting lease, runs a pass, and answers its place', async () => {
      const { hashToken } = await import('../../../src/services/lease/leaseToken');
      prismaStub.lease.create.callsFake(async ({ data }: any) => {
        created = { ...data, id: 'lse_w', members: [] };
        return created;
      });
      storeStub.getDevices.callsFake(async ({ platform }: any) => [
        { udid: `${platform}-1`, host: 'h1', platform },
      ]);
      const before = Date.now();

      const out = await queued.create({
        members: [{ filters: { platform: 'android' } }, { filters: { platform: 'ios' } }],
        waitMs: 120_000,
        durationMs: 600_000,
        heartbeatSeconds: 20,
        actorId: 'actor-1',
        teamId: 'team-1',
        callerTeamIds: ['team-1'],
        buildId: 'b-1',
        reason: 'call test',
      });

      expect(out).to.deep.equal({
        status: 'waiting',
        body: {
          leaseId: 'lse_w',
          leaseToken: out.body.leaseToken,
          status: 'waiting',
          position: 3,
          waitUntil: created.waitUntil,
          heartbeatSeconds: 20,
        },
      });
      const data = prismaStub.lease.create.firstCall.args[0].data;
      expect(data).to.deep.include({
        tokenHash: hashToken(out.body.leaseToken),
        status: 'waiting',
        deviceUdid: '',
        deviceHost: '',
        actorId: 'actor-1',
        teamId: 'team-1',
        buildId: 'b-1',
        reason: 'call test',
        heartbeatSeconds: 20,
        durationMs: 600_000,
        requestedMembers: JSON.stringify([{ platform: 'android' }, { platform: 'ios' }]),
        callerTeamIds: JSON.stringify(['team-1']),
      });
      expect(data.waitUntil).to.be.within(before + 120_000, Date.now() + 120_000);
      expect(data.lastHeartbeatAt).to.be.within(before, Date.now());
      expect(queue.pass.calledOnce).to.equal(true);
      expect(queue.pass.calledAfter(prismaStub.lease.create)).to.equal(true);
      expect(queue.tryNow.called).to.equal(false);
    });

    const waitingFor = (status: string) => ({
      id: 'lse_w',
      status,
      waitUntil: Date.now() - 1,
      expiresAt: Date.now() + 600_000,
      heartbeatSeconds: 30,
      members:
        status === 'active'
          ? [{ index: 0, udid: 'u1', host: 'h1', allocatedPorts: '{}', capabilityBag: '{}' }]
          : [],
    });
    const waitOne = { ...oneAndroid, waitMs: 1 };

    it('gives up a wait that ran out before its answer, and answers busy', async () => {
      prismaStub.lease.create.resolves({ id: 'lse_w' });
      prismaStub.lease.findUnique.resolves(waitingFor('waiting'));
      queue.positionOf.resolves(null);
      const { AllMatchingBusy } = await import('../../../src/services/lease/LeaseService');

      expect(await thrownBy(() => queued.create(waitOne))).to.be.instanceOf(AllMatchingBusy);
      expect(queue.giveUp.calledOnceWith('lse_w')).to.equal(true);
    });

    it('answers the granted lease when a pass granted it before it could give up', async () => {
      prismaStub.lease.create.resolves({ id: 'lse_w' });
      prismaStub.lease.findUnique
        .onFirstCall()
        .resolves(waitingFor('waiting'))
        .onSecondCall()
        .resolves(waitingFor('active'));
      queue.positionOf.resolves(null);
      queue.giveUp.resolves('not-waiting');

      const out = await queued.create(waitOne);

      expect(out.status).to.equal('granted');
      expect(out.body.leaseId).to.equal('lse_w');
      expect(out.body.members).to.have.length(1);
    });

    it('answers busy when the lease it was granted is gone before it is read', async () => {
      queue.tryNow.resolves({ leaseId: 'lse_gone' });
      prismaStub.lease.findUnique.resolves(null);
      const { AllMatchingBusy } = await import('../../../src/services/lease/LeaseService');
      expect(await thrownBy(() => queued.create(oneAndroid))).to.be.instanceOf(AllMatchingBusy);
    });

    it("says why the ports couldn't be reserved, as the phone's server said", async () => {
      queue.tryNow.resolves('unhealthy');
      queue.granter.skipReason.withArgs('u1@h1').returns('connect ECONNREFUSED 10.0.0.2:4723');
      const thrown = await thrownBy(() => queued.create(oneAndroid));
      expect(thrown.message).to.equal('port allocation failed: connect ECONNREFUSED 10.0.0.2:4723');
    });

    it('refuses filters and members together, and more than 8 members', async () => {
      const both = await thrownBy(() =>
        queued.create({ ...oneAndroid, members: [{ filters: { platform: 'android' } }] }),
      );
      expect(both).to.be.instanceOf(RangeError);
      const nine = Array.from({ length: 9 }, () => ({ filters: { platform: 'android' } }));
      const tooMany = await thrownBy(() =>
        queued.create({ ...oneAndroid, filters: undefined, members: nine }),
      );
      expect(tooMany).to.be.instanceOf(RangeError);
      expect(queue.tryNow.called).to.equal(false);
    });
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
