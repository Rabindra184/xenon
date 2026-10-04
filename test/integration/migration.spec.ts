import 'reflect-metadata';
import { expect } from 'chai';
import { bootstrapIdentity } from '../../src/services/identity/bootstrap';
import { prisma } from '../../src/prisma';
import { useScratchDatabase } from '../helpers/scratch-database';

describe('bootstrapIdentity idempotency (integration)', function () {
  this.timeout(30_000);
  useScratchDatabase({ wholeSuite: true });

  // On a fresh database, so the first run has a super-admin to create. On a
  // developer's populated one both runs returned at once and proved nothing.
  it('running twice does not create duplicate users', async () => {
    const before = await prisma.user.count();
    expect(before, 'a fresh database').to.equal(0);
    await bootstrapIdentity();
    const after1 = await prisma.user.count();
    expect(after1, 'the bootstrap super-admin').to.equal(1);
    await bootstrapIdentity();
    const after2 = await prisma.user.count();
    expect(after2).to.equal(after1);
  });
});
