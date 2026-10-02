import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { CleanupService } from '../../src/services/CleanupService';
import { prisma } from '../../src/prisma';

describe('CleanupService Unit Tests', () => {
  let cleanupService: CleanupService;

  beforeEach(() => {
    cleanupService = Container.get(CleanupService);
  });

  afterEach(() => sinon.restore());

  it('should be instantiable via TypeDI', () => {
    expect(cleanupService).to.be.an.instanceOf(CleanupService);
  });

  it('should have runCleanup method', () => {
    expect(cleanupService.runCleanup).to.be.a('function');
  });

  it('should have purgeBuild method', () => {
    expect(cleanupService.purgeBuild).to.be.a('function');
  });

  it("deletes a session's CPU and memory samples with its other rows", async () => {
    const deleted: string[] = [];
    for (const model of ['sessionLog', 'log', 'profiling', 'sessionMetric']) {
      sinon.stub((prisma as any)[model], 'deleteMany').callsFake(async (args: any) => {
        deleted.push(`${model}:${args.where.session_id}`);
        return { count: 0 };
      });
    }

    await (cleanupService as any).deleteSessionChildren('s-cleanup-1');

    expect(deleted).to.include('sessionMetric:s-cleanup-1');
  });
});
