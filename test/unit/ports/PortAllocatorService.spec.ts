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
});
