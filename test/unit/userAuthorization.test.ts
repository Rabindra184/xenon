import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  canActOn,
  assertNotSelf,
  assertNotLastSuperAdmin,
} from '../../src/services/identity/userAuthorization';
import { prisma } from '../../src/prisma';

describe('userAuthorization helpers', () => {
  afterEach(() => sinon.restore());

  describe('canActOn', () => {
    it('SUPER_ADMIN can act on any role', () => {
      expect(canActOn('SUPER_ADMIN', 'SUPER_ADMIN')).to.be.true;
      expect(canActOn('SUPER_ADMIN', 'ADMIN')).to.be.true;
      expect(canActOn('SUPER_ADMIN', 'MEMBER')).to.be.true;
    });
    it('ADMIN can only act on MEMBER', () => {
      expect(canActOn('ADMIN', 'SUPER_ADMIN')).to.be.false;
      expect(canActOn('ADMIN', 'ADMIN')).to.be.false;
      expect(canActOn('ADMIN', 'MEMBER')).to.be.true;
    });
    it('MEMBER can act on no one', () => {
      expect(canActOn('MEMBER', 'SUPER_ADMIN')).to.be.false;
      expect(canActOn('MEMBER', 'ADMIN')).to.be.false;
      expect(canActOn('MEMBER', 'MEMBER')).to.be.false;
    });
  });

  describe('assertNotSelf', () => {
    it('throws when actor and target ids match', () => {
      expect(() => assertNotSelf('u1', 'u1', 'role-change')).to.throw(/cannot role-change yourself/);
    });
    it('passes when ids differ', () => {
      expect(() => assertNotSelf('u1', 'u2', 'delete')).to.not.throw();
    });
  });

  describe('assertNotLastSuperAdmin', () => {
    it('throws when target is the last active SUPER_ADMIN', async () => {
      sinon.stub(prisma.user, 'count').resolves(0);
      let err: Error | undefined;
      try {
        await assertNotLastSuperAdmin('target-id');
      } catch (e) {
        err = e as Error;
      }
      expect(err?.message).to.match(/last active super-admin/);
    });
    it('passes when another active SUPER_ADMIN exists', async () => {
      sinon.stub(prisma.user, 'count').resolves(1);
      await assertNotLastSuperAdmin('target-id');
    });
  });
});
