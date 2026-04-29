import 'reflect-metadata';
import { expect } from 'chai';
import { bootstrapIdentity } from '../../src/services/identity/bootstrap';
import { prisma } from '../../src/prisma';

describe('bootstrapIdentity idempotency (integration)', function () {
  this.timeout(30_000);

  it('running twice does not create duplicate users', async () => {
    const before = await prisma.user.count();
    await bootstrapIdentity();
    const after1 = await prisma.user.count();
    await bootstrapIdentity();
    const after2 = await prisma.user.count();
    expect(after2).to.equal(after1);
    expect(after1).to.be.greaterThanOrEqual(before);
  });
});
