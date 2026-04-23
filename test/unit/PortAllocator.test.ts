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

  it('releaseForUdid deletes all leases for that UDID', async () => {
    deleteManyStub.resolves({ count: 2 } as any);
    const allocator = makeAllocator({ wda: [8100, 8102] });
    await allocator.releaseForUdid('udid-1');
    const call = deleteManyStub.getCalls().find((c) => c.args[0]?.where?.leasedToUdid === 'udid-1');
    expect(call, 'expected deleteMany with leasedToUdid filter').to.exist;
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
