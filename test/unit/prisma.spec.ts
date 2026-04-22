import { expect } from 'chai';
import { prisma, getPrismaClient } from '../../src/prisma';
import { PrismaClient } from '../../src/generated/client';

describe('Prisma Client Unit Tests', () => {
  it('getPrismaClient should return an instance of PrismaClient', () => {
    const client = getPrismaClient();
    expect(client).to.be.an.instanceOf(PrismaClient);
  });

  it('getPrismaClient should be idempotent', () => {
    const client1 = getPrismaClient();
    const client2 = getPrismaClient();
    expect(client1).to.equal(client2);
  });

  it('prisma proxy should forward properties to getPrismaClient', () => {
    // Non-model properties ($connect, $disconnect, etc.) are forwarded directly.
    // Model delegates (device, session, portLease, …) are wrapped in plain objects
    // so test frameworks can stub individual methods via sinon.
    expect(prisma.$connect).to.be.a('function');
    // Model delegates are stable (same wrapper returned on every access)
    expect(prisma.device).to.equal(prisma.device);
    // Model delegates expose the core CRUD methods
    expect((prisma.device as any).findMany).to.be.a('function');
  });
});
