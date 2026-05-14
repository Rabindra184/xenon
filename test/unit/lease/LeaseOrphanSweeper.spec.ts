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
    storeStub = { updateDevice: sinon.stub().resolves() };
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
    expect(storeStub.updateDevice.calledWith('u1', 'h1', { busy: false })).to.equal(true);
  });

  it('no-op when no stale leases', async () => {
    prismaStub.lease.findMany.resolves([]);
    await sweeper.sweep();
    expect(prismaStub.lease.update.notCalled).to.equal(true);
  });
});
