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

  it('callerTeamIds === ["t1", "t2"] → teamId IN (null, t1, t2)', async () => {
    const captured = captureWhere();
    const { PrismaDeviceStore } = await import('../../src/data-service/prisma-store');
    await new PrismaDeviceStore().getDevices({ callerTeamIds: ['t1', 't2'] } as any);
    expect(captured.value?.teamId).to.deep.equal({ in: [null, 't1', 't2'] });
  });
});
