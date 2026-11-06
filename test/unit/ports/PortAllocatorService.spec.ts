import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';

describe('PortAllocatorService', () => {
  let prismaStub: any;
  let getPortStub: any;
  let svc: any;

  beforeEach(async () => {
    getPortStub = sinon.stub().resolves(0);
    let n = 9001;
    getPortStub.callsFake(async () => n++);

    prismaStub = {
      portLease: {
        create: sinon.stub().callsFake(async ({ data }: any) => data),
        deleteMany: sinon.stub().resolves({ count: 0 }),
        updateMany: sinon.stub().resolves({ count: 3 }),
      },
    };

    const { PortAllocatorService } = await import('../../../src/services/ports/PortAllocatorService');
    svc = new PortAllocatorService(prismaStub as any, getPortStub);
  });

  it('returns one port per requested purpose', async () => {
    const ports = await svc.allocate({
      udid: 'u1',
      host: 'h1',
      purposes: ['systemPort', 'chromedriverPort', 'mjpegServerPort'],
      durationMs: 60_000,
    });
    expect(ports.systemPort).to.equal(9001);
    expect(ports.chromedriverPort).to.equal(9002);
    expect(ports.mjpegServerPort).to.equal(9003);
    expect(prismaStub.portLease.create.callCount).to.equal(3);
  });

  it('rolls back PortLease rows when a later get-port call throws', async () => {
    // 9001 ok, then throw, so the first row should be cleaned up.
    getPortStub.onFirstCall().resolves(9001);
    getPortStub.onSecondCall().rejects(new Error('boom'));

    let thrown: any = null;
    try {
      await svc.allocate({
        udid: 'u1',
        host: 'h1',
        purposes: ['systemPort', 'chromedriverPort'],
        durationMs: 60_000,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.be.an('Error');
    expect(thrown.message).to.include('boom');
    expect(prismaStub.portLease.deleteMany.callCount).to.equal(1);
    expect(prismaStub.portLease.deleteMany.firstCall.args[0].where.port).to.deep.equal({ in: [9001] });
  });
  describe('extend', () => {
    // The lease's end, plus the same 5 minutes allocate adds.
    it("holds the lease's ports until its new end plus 5 minutes, only for that phone", async () => {
      const expiresAt = Date.now() + 60 * 60_000;
      const out = await svc.extend({ udid: 'u1', ports: [9001, 9002], expiresAt });
      expect(out).to.deep.equal({ extended: 3 });
      const { where, data } = prismaStub.portLease.updateMany.firstCall.args[0];
      expect(where.port).to.deep.equal({ in: [9001, 9002] });
      expect(where.leasedToUdid).to.equal('u1');
      expect(data.expiresAt).to.equal(expiresAt + 5 * 60_000);
      // Never earlier than a row already says.
      expect(where.expiresAt).to.deep.equal({ lt: expiresAt + 5 * 60_000 });
    });

    it('holds no port longer than 24 hours from now', async () => {
      const before = Date.now();
      await svc.extend({ udid: 'u1', ports: [9001], expiresAt: before + 72 * 60 * 60_000 });
      const { data } = prismaStub.portLease.updateMany.firstCall.args[0];
      expect(data.expiresAt).to.be.at.most(Date.now() + 24 * 60 * 60_000 + 5 * 60_000);
      expect(data.expiresAt).to.be.at.least(before + 24 * 60 * 60_000 + 5 * 60_000);
    });
  });
});
