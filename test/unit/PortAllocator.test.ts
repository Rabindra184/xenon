import { expect } from 'chai';
import sinon from 'sinon';
import { PortAllocator, PortPurpose, PortRangeExhaustedError, PortRanges } from '../../src/services/PortAllocator';
import { prisma } from '../../src/prisma';

function makeAllocator(overrides: PortRanges) {
  const a = new PortAllocator();
  a.configure(overrides);
  return a;
}

describe('PortAllocator', () => {
  let createStub: sinon.SinonStub;
  let findManyStub: sinon.SinonStub;
  let findFirstStub: sinon.SinonStub;
  let deleteManyStub: sinon.SinonStub;
  let deleteStub: sinon.SinonStub;
  let updateStub: sinon.SinonStub;

  beforeEach(() => {
    createStub = sinon.stub(prisma.portLease, 'create');
    findManyStub = sinon.stub(prisma.portLease, 'findMany').resolves([]);
    findFirstStub = sinon.stub(prisma.portLease, 'findFirst').resolves(null as any);
    deleteManyStub = sinon.stub(prisma.portLease, 'deleteMany').resolves({ count: 0 } as any);
    deleteStub = sinon.stub(prisma.portLease, 'delete').resolves({} as any);
    updateStub = sinon.stub(prisma.portLease, 'update').resolves({} as any);
  });

  afterEach(() => sinon.restore());

  it('allocates first free port in the configured range', async () => {
    createStub.resolves({ port: 8100 } as any);
    const allocator = makeAllocator({ wda: [8100, 8102] });
    (allocator as any).isOsFree = async () => true;
    const port = await allocator.acquire('wda' as PortPurpose, 'udid-1');
    expect(port).to.equal(8100);
    expect(createStub.firstCall.args[0].data.port).to.equal(8100);
    expect(createStub.firstCall.args[0].data.leasedToUdid).to.equal('udid-1');
    expect(createStub.firstCall.args[0].data.purpose).to.equal('wda');
  });

  it('retries next port on unique-constraint collision', async () => {
    const collision: any = new Error('unique');
    collision.code = 'P2002';
    createStub.onFirstCall().rejects(collision);
    createStub.onSecondCall().resolves({ port: 8101 } as any);

    const allocator = makeAllocator({ wda: [8100, 8105] });
    (allocator as any).isOsFree = async () => true;
    const port = await allocator.acquire('wda' as PortPurpose, 'udid-1');
    expect(port).to.equal(8101);
  });

  it('throws PortRangeExhaustedError when range exhausted', async () => {
    findManyStub.resolves([{ port: 8100 }, { port: 8101 }, { port: 8102 }] as any);
    const allocator = makeAllocator({ wda: [8100, 8102] });
    (allocator as any).isOsFree = async () => true;
    try {
      await allocator.acquire('wda' as PortPurpose, 'udid-1');
      expect.fail('expected throw');
    } catch (err: any) {
      expect(err).to.be.instanceOf(PortRangeExhaustedError);
      expect(err.message).to.match(/wda/);
    }
  });

  it('reuses an existing lease when the same (purpose, udid) acquires again', async () => {
    findFirstStub.resolves({ port: 8101 } as any);
    const allocator = makeAllocator({ wda: [8100, 8102] });
    (allocator as any).isOsFree = async () => true;

    const port = await allocator.acquire('wda' as PortPurpose, 'udid-1');

    expect(port).to.equal(8101);
    expect(createStub.called, 'should not create a new lease').to.be.false;
    expect(updateStub.calledOnce, 'should refresh the existing lease').to.be.true;
    expect(updateStub.firstCall.args[0].where.port).to.equal(8101);
  });

  it('drops a stale existing lease when the OS port is already taken (Android→iOS collision)', async () => {
    // Regression: Android still holds mjpeg@9100 in PortLease while iOS iproxy
    // is the real listener. Reusing that lease without an OS probe made the
    // Android tile proxy the iPhone feed.
    findFirstStub.resolves({ port: 9100 } as any);
    createStub.callsFake(({ data }: any) => Promise.resolve({ port: data.port } as any));

    const allocator = makeAllocator({ mjpeg: [9100, 9101] });
    (allocator as any).isOsFree = async (port: number) => port !== 9100;

    const port = await allocator.acquire('mjpeg' as PortPurpose, 'android-udid');
    expect(port).to.equal(9101);
    expect(deleteStub.calledWith({ where: { port: 9100 } })).to.be.true;
    expect(createStub.called, 'should allocate a replacement lease').to.be.true;
  });

  it('releaseForUdid deletes all leases for that UDID', async () => {
    deleteManyStub.resolves({ count: 2 } as any);
    const allocator = makeAllocator({ wda: [8100, 8102] });
    await allocator.releaseForUdid('udid-1');
    const call = deleteManyStub.getCalls().find((c) => c.args[0]?.where?.leasedToUdid === 'udid-1');
    expect(call, 'expected deleteMany with leasedToUdid filter').to.exist;
  });

  it('never hands out a port already leased to another device (the 9100 collision)', async () => {
    // Regression: an iOS device must not be allocated port 9100 while the
    // Android stream holds a live lease on it. The lease table's `taken` set
    // must exclude it, so allocation moves to the next free port.
    findManyStub.resolves([{ port: 9100 }] as any); // 9100 leased to someone else
    createStub.callsFake(({ data }: any) => Promise.resolve({ port: data.port } as any));

    const allocator = makeAllocator({ mjpeg: [9100, 9101] });
    (allocator as any).isOsFree = async () => true;

    const port = await allocator.acquire('mjpeg' as PortPurpose, 'ios-udid');
    expect(port).to.equal(9101);
    // It must never have attempted to create a lease on the taken port.
    const attempted9100 = createStub.getCalls().some((c) => c.args[0]?.data?.port === 9100);
    expect(attempted9100, 'must not try to lease the already-taken 9100').to.be.false;
  });

  it('touch extends the lease expiry on a specific port', async () => {
    const allocator = makeAllocator({ mjpeg: [9100, 9101] });
    await allocator.touch(9101, 90 * 60 * 1000);
    expect(updateStub.calledOnce).to.be.true;
    expect(updateStub.firstCall.args[0].where.port).to.equal(9101);
    expect(updateStub.firstCall.args[0].data.expiresAt).to.be.a('number');
  });

  it('skips ports that fail OS-level availability check', async () => {
    let attempt = 0;
    createStub.callsFake(({ data }: any) => {
      attempt++;
      return Promise.resolve({ port: data.port } as any);
    });

    const allocator = makeAllocator({ wda: [8100, 8101] });
    let osCalls = 0;
    (allocator as any).isOsFree = async (port: number) => {
      osCalls++;
      return port !== 8100; // 8100 is busy at OS level
    };

    const port = await allocator.acquire('wda' as PortPurpose, 'udid-1');
    expect(port).to.equal(8101);
    expect(osCalls).to.be.greaterThan(1);
    const cleanup = deleteStub.getCalls().find((c) => c.args[0]?.where?.port === 8100);
    expect(cleanup, 'expected delete({ where: { port: 8100 } }) after OS probe failure').to.exist;
  });
});
