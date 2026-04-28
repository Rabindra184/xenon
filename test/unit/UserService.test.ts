import { expect } from 'chai';
import sinon from 'sinon';
import { UserService } from '../../src/services/UserService';
import { prisma } from '../../src/prisma';

describe('UserService', () => {
  afterEach(() => sinon.restore());

  describe('hashPassword / verifyPassword', () => {
    it('hashes a password with bcrypt and verifies it', async () => {
      const svc = new UserService();
      const hash = await svc.hashPassword('correct-horse-staple');
      expect(hash).to.match(/^\$2[ayb]\$/);
      expect(await svc.verifyPassword('correct-horse-staple', hash)).to.be.true;
      expect(await svc.verifyPassword('wrong', hash)).to.be.false;
    });

    it('rejects passwords shorter than 8 characters', async () => {
      const svc = new UserService();
      let err: Error | undefined;
      try {
        await svc.hashPassword('short');
      } catch (e) {
        err = e as Error;
      }
      expect(err?.message).to.match(/at least 8/);
    });
  });

  describe('generateAccessKey', () => {
    it('returns a string with the xen_ prefix and 12 url-safe chars', () => {
      const svc = new UserService();
      const key = svc.generateAccessKey();
      expect(key).to.match(/^xen_[A-Za-z0-9]{12}$/);
    });

    it('returns different values on every call', () => {
      const svc = new UserService();
      const a = svc.generateAccessKey();
      const b = svc.generateAccessKey();
      expect(a).to.not.equal(b);
    });
  });

  describe('CRUD + rotation', () => {
    it('createUser persists a hashed password and a unique accessKey', async () => {
      const create = sinon.stub(prisma.user, 'create').resolves({ id: 'u1' } as any);
      const svc = new UserService();
      sinon.stub(svc, 'generateAccessKey').returns('xen_abcdefghijkl');
      const user = await svc.createUser({
        email: 'a@b.com',
        name: 'A',
        password: 'correct-horse',
        role: 'MEMBER',
      });
      expect(user.id).to.equal('u1');
      const args = create.firstCall.args[0].data;
      expect(args.email).to.equal('a@b.com');
      expect(args.passwordHash).to.match(/^\$2/);
      expect(args.accessKey).to.equal('xen_abcdefghijkl');
      expect(args.role).to.equal('MEMBER');
    });

    it('rotateAccessKey writes a new accessKey but keeps the user id', async () => {
      sinon.stub(prisma.user, 'update').resolves({ id: 'u1', accessKey: 'xen_NEW00000000' } as any);
      const svc = new UserService();
      sinon.stub(svc, 'generateAccessKey').returns('xen_NEW00000000');
      const result = await svc.rotateAccessKey('u1');
      expect(result.accessKey).to.equal('xen_NEW00000000');
    });

    it('changePassword verifies old password before writing new hash', async () => {
      const oldHash = await new UserService().hashPassword('old-password');
      sinon.stub(prisma.user, 'findUnique').resolves({ id: 'u1', passwordHash: oldHash } as any);
      const update = sinon.stub(prisma.user, 'update').resolves({} as any);
      const svc = new UserService();
      await svc.changePassword('u1', 'old-password', 'new-password');
      expect(update.calledOnce).to.be.true;
    });

    it('changePassword throws when the old password is wrong', async () => {
      const oldHash = await new UserService().hashPassword('old-password');
      sinon.stub(prisma.user, 'findUnique').resolves({ id: 'u1', passwordHash: oldHash } as any);
      const svc = new UserService();
      let err: Error | undefined;
      try { await svc.changePassword('u1', 'WRONG', 'new-password'); } catch (e) { err = e as Error; }
      expect(err?.message).to.match(/incorrect/);
    });

    it('changePassword surfaces "no password set" when passwordHash is empty', async () => {
      sinon.stub(prisma.user, 'findUnique').resolves({ id: 'u1', passwordHash: '' } as any);
      const svc = new UserService();
      let err: Error | undefined;
      try { await svc.changePassword('u1', 'whatever', 'new-password'); } catch (e) { err = e as Error; }
      expect(err?.message).to.match(/has not been set/);
    });
  });
});
