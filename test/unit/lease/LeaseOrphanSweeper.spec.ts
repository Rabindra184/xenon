import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';

describe('LeaseOrphanSweeper', () => {
  let prismaStub: any;
  let storeStub: any;
  let sweeper: any;
  let now: number;

  beforeEach(async () => {
    now = Date.now();
    prismaStub = {
      lease: {
        findMany: sinon.stub(),
        update: sinon.stub().callsFake(async ({ data }: any) => data),
      },
      portLease: { deleteMany: sinon.stub().resolves({ count: 0 }) },
    };
    storeStub = { releaseLeaseLock: sinon.stub().resolves(true) };
    const { LeaseOrphanSweeper } = await import('../../../src/services/lease/LeaseOrphanSweeper');
    sweeper = new LeaseOrphanSweeper(prismaStub, storeStub);
  });

  it('reaps leases whose last heartbeat is older than 3× heartbeatSeconds', async () => {
    prismaStub.lease.findMany.resolves([
      { id: 'lse_1', deviceUdid: 'u1', deviceHost: 'h1', heartbeatSeconds: 30, lastHeartbeatAt: now - 120_000 },
      { id: 'lse_2', deviceUdid: 'u2', deviceHost: 'h2', heartbeatSeconds: 30, lastHeartbeatAt: now - 60_000 },
    ]);
    await sweeper.sweep();
    expect(prismaStub.lease.update.callCount).to.equal(1);
    expect(prismaStub.lease.update.firstCall.args[0].where.id).to.equal('lse_1');
    expect(prismaStub.lease.update.firstCall.args[0].data.status).to.equal('expired');
    expect(prismaStub.portLease.deleteMany.calledWith({ where: { leaseId: 'lse_1' } })).to.equal(true);
    expect(storeStub.releaseLeaseLock.calledOnceWith('u1', 'h1')).to.equal(true);
  });

  // The sweeper ends a lease as release does, so it frees the lease's ports
  // on the phone's server too (see LeaseService.release).
  it("frees a reaped lease's ports on the phone's server", async () => {
    const { LeaseOrphanSweeper } = await import('../../../src/services/lease/LeaseOrphanSweeper');
    const portClient = { release: sinon.stub().resolves({ released: 2 }) };
    const auth = { nodePairAuth: async () => ({ accessKey: 'k', token: 't' }) };
    const s = new LeaseOrphanSweeper(prismaStub, storeStub, portClient as any, auth);
    prismaStub.lease.findMany.resolves([
      {
        id: 'lse_1',
        deviceUdid: 'u1',
        deviceHost: 'http://node:4723',
        heartbeatSeconds: 30,
        lastHeartbeatAt: now - 120_000,
        expiresAt: now + 60_000,
        allocatedPorts: JSON.stringify({ systemPort: 9001, mjpegServerPort: 9003 }),
      },
    ]);
    await s.sweep();
    await s.phoneServerCallsSettled();
    expect(prismaStub.lease.findMany.firstCall.args[0].select.allocatedPorts).to.equal(true);
    expect(portClient.release.calledOnce).to.equal(true);
    expect(portClient.release.firstCall.args[0]).to.deep.include({
      nodeHost: 'http://node:4723',
      udid: 'u1',
      nodePairAuth: { accessKey: 'k', token: 't' },
    });
    expect(portClient.release.firstCall.args[0].ports).to.have.members([9001, 9003]);
  });

  it('no-op when no stale leases', async () => {
    prismaStub.lease.findMany.resolves([]);
    await sweeper.sweep();
    expect(prismaStub.lease.update.notCalled).to.equal(true);
  });
});
