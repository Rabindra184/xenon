import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { UserService } from '../../src/services/UserService';
import { LastSuperAdminError } from '../../src/services/identity/userAuthorization';
import { prisma, prismaTransactions } from '../../src/prisma';

/**
 * A transaction's client of stubs, and `prisma.$transaction` stubbed to run the
 * callback on it, failing first with each of `failures`.
 */
function fakeTransactions(target: { role: string } | null, others = 1, failures: unknown[] = []) {
  const tx = {
    user: {
      findUnique: sinon.stub().resolves(target),
      count: sinon.stub().resolves(others),
      update: sinon.stub().resolves({ id: 'u1' }),
      delete: sinon.stub().resolves({}),
    },
    userSession: { deleteMany: sinon.stub().resolves({ count: 2 }) },
  };
  const pending = [...failures];
  const $transaction = sinon.stub(prismaTransactions, '$transaction').callsFake((async (
    fn: (t: unknown) => unknown,
  ) => {
    if (pending.length) throw pending.shift();
    return fn(tx);
  }) as any);
  return { tx, db: { $transaction } };
}

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

    // Written by the native `bcrypt` 5 that hashed passwords through 2.17, at
    // its cost of 12: every stored password is one of these.
    it('verifies a password stored before 2.18', async () => {
      const stored = '$2b$12$5kTngvxC6mQpOaiVCcexfuHPHKvxQMKz/IFm3Gxzia4Sb3lzK85dC';
      const svc = new UserService();
      expect(await svc.verifyPassword('signed-in-before-2.18', stored)).to.be.true;
      expect(await svc.verifyPassword('signed-in-before-2.17', stored)).to.be.false;
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

  describe('list / update / setRole / deactivate / delete', () => {
    it('listUsers(callerRole) filters out admins/super-admins for ADMIN callers', async () => {
      const findMany = sinon.stub(prisma.user, 'findMany').resolves([] as any);
      await new UserService().listUsers('ADMIN');
      const args = (findMany.firstCall?.args?.[0]) as any;
      expect(args.where.role).to.equal('MEMBER');
    });

    it('listUsers(callerRole) returns everyone for SUPER_ADMIN callers', async () => {
      const findMany = sinon.stub(prisma.user, 'findMany').resolves([] as any);
      await new UserService().listUsers('SUPER_ADMIN');
      const args = (findMany.firstCall?.args?.[0]) as any;
      expect(args.where).to.not.have.property('role');
    });

    it('updateUser silently drops email from the patch', async () => {
      const update = sinon.stub(prisma.user, 'update').resolves({} as any);
      await new UserService().updateUser('u1', { email: 'evil@x.local', name: 'Alice' } as any);
      const data = (update.firstCall?.args?.[0])?.data;
      expect(data).to.not.have.property('email');
      expect(data.name).to.equal('Alice');
    });

    it('setRole writes role', async () => {
      const { tx, db } = fakeTransactions({ role: 'MEMBER' });
      await new UserService().setRole('u1', 'ADMIN');
      expect(tx.user.update.firstCall.args[0].data.role).to.equal('ADMIN');
    });

    it('deactivateUser sets status=INACTIVE and revokes all sessions, in one transaction', async () => {
      const { tx, db } = fakeTransactions({ role: 'MEMBER' });
      await new UserService().deactivateUser('u1');
      expect(db.$transaction.calledOnce).to.be.true;
      expect(tx.user.update.firstCall.args[0].data.status).to.equal('INACTIVE');
      expect(tx.userSession.deleteMany.firstCall.args[0].where).to.deep.equal({ userId: 'u1' });
    });

    it('deleteUser revokes sessions then deletes, in one transaction; cascade handles the rest', async () => {
      const { tx, db } = fakeTransactions({ role: 'MEMBER' });
      await new UserService().deleteUser('u1');
      expect(tx.userSession.deleteMany.calledOnce).to.be.true;
      expect(tx.user.delete.firstCall.args[0]).to.deep.equal({ where: { id: 'u1' } });
      expect(tx.userSession.deleteMany.calledBefore(tx.user.delete)).to.be.true;
    });
  });

  describe('the last active super-admin', () => {
    const removals: Array<[string, (svc: UserService) => Promise<unknown>]> = [
      ['a demotion', (svc) => svc.updateUser('u1', { role: 'ADMIN' })],
      ['a deactivation', (svc) => svc.updateUser('u1', { status: 'INACTIVE' })],
      ['setRole', (svc) => svc.setRole('u1', 'MEMBER')],
      ['deactivateUser', (svc) => svc.deactivateUser('u1')],
      ['deleteUser', (svc) => svc.deleteUser('u1')],
    ];

    for (const [name, remove] of removals) {
      it(`refuses ${name} of the last one, checking in the transaction and writing nothing`, async () => {
        const { tx, db } = fakeTransactions({ role: 'SUPER_ADMIN' }, 0);
        let err: unknown;
        try {
          await remove(new UserService());
        } catch (e) {
          err = e;
        }
        expect(err).to.be.instanceOf(LastSuperAdminError);
        expect(tx.user.count.firstCall.args[0].where).to.deep.equal({
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          NOT: { id: 'u1' },
        });
        expect(tx.user.update.called || tx.user.delete.called).to.be.false;
        expect(tx.userSession.deleteMany.called).to.be.false;
      });

      it(`lets ${name} through while another active one stays`, async () => {
        const { tx, db } = fakeTransactions({ role: 'SUPER_ADMIN' }, 1);
        await remove(new UserService());
        expect(tx.user.update.called || tx.user.delete.called).to.be.true;
      });
    }

    it('counts nothing for a target who is not a super-admin', async () => {
      const { tx, db } = fakeTransactions({ role: 'MEMBER' }, 0);
      await new UserService().deleteUser('u1');
      expect(tx.user.count.called).to.be.false;
      expect(tx.user.delete.calledOnce).to.be.true;
    });

    it('runs serializable and tries again on a write conflict (P2034)', async () => {
      const conflict = Object.assign(new Error('write conflict'), { code: 'P2034' });
      const { tx, db } = fakeTransactions({ role: 'SUPER_ADMIN' }, 1, [conflict]);
      await new UserService().deleteUser('u1');
      expect(db.$transaction.callCount).to.equal(2);
      expect(db.$transaction.firstCall.args[1]).to.deep.equal({ isolationLevel: 'Serializable' });
      expect(tx.user.delete.calledOnce).to.be.true;
    });

    it('gives up after three write conflicts', async () => {
      const conflict = () => Object.assign(new Error('write conflict'), { code: 'P2034' });
      const { tx, db } = fakeTransactions({ role: 'SUPER_ADMIN' }, 1, [
        conflict(),
        conflict(),
        conflict(),
      ]);
      let err: any;
      try {
        await new UserService().deleteUser('u1');
      } catch (e) {
        err = e;
      }
      expect(err?.code).to.equal('P2034');
      expect(db.$transaction.callCount).to.equal(3);
      expect(tx.user.delete.called).to.be.false;
    });

    it('leaves a name change and a promotion out of the transaction', async () => {
      const { db } = fakeTransactions({ role: 'SUPER_ADMIN' }, 0);
      const update = sinon.stub(prisma.user, 'update').resolves({} as any);
      const svc = new UserService();
      await svc.updateUser('u1', { name: 'Renamed' });
      await svc.setRole('u1', 'SUPER_ADMIN');
      expect(db.$transaction.called).to.be.false;
      expect(update.callCount).to.equal(2);
    });
  });
});
