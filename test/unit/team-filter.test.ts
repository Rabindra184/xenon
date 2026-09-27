import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { prisma } from '../../src/prisma';

describe('team filter SQL shape (Phase 4A)', () => {
  afterEach(() => sinon.restore());

  function captureWhere(): { value?: any } {
    const captured: { value?: any } = {};
    (sinon.stub(prisma.device, 'findMany') as any).callsFake(async (args: any) => {
      captured.value = args.where;
      return [];
    });
    return captured;
  }

  // PrismaDeviceStore is the canonical export from src/data-service/prisma-store.ts.
  it('callerTeamIds undefined → no team predicate', async () => {
    const captured = captureWhere();
    const { PrismaDeviceStore } = await import('../../src/data-service/prisma-store');
    await new PrismaDeviceStore().getDevices({} as any);
    expect(captured.value?.teamId).to.be.undefined;
  });

  it('callerTeamIds === [] → teamId IS NULL only', async () => {
    const captured = captureWhere();
    const { PrismaDeviceStore } = await import('../../src/data-service/prisma-store');
    await new PrismaDeviceStore().getDevices({ callerTeamIds: [] } as any);
    expect(captured.value?.teamId).to.equal(null);
  });

  // Not `teamId: { in: [null, 't1', 't2'] }`: Prisma rejects a null inside
  // `in`, so that shape threw on every real query. This test used to pin it,
  // which is how the bug survived; test/integration/team-visibility-leases.spec.ts
  // runs the real query.
  it('callerTeamIds === ["t1", "t2"] → teamId IS NULL OR teamId IN (t1, t2)', async () => {
    const captured = captureWhere();
    const { PrismaDeviceStore } = await import('../../src/data-service/prisma-store');
    await new PrismaDeviceStore().getDevices({ callerTeamIds: ['t1', 't2'] } as any);
    expect(captured.value?.teamId).to.equal(undefined);
    expect(captured.value?.OR).to.deep.equal([{ teamId: null }, { teamId: { in: ['t1', 't2'] } }]);
  });
});
