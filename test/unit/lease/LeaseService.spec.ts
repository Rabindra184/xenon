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
        update: sinon.stub(),
        delete: sinon.stub(),
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
    expect(out.appiumCapabilities['xenon:options'].leaseId).to.equal('lse_test');
    expect(storeStub.findAndLockDevice.calledOnce).to.equal(true);
    expect(portClientStub.allocate.calledOnce).to.equal(true);
    expect(prismaStub.lease.create.calledOnce).to.equal(true);
  });
});
