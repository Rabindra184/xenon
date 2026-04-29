import { expect } from 'chai';
import sinon from 'sinon';
import { UserSessionService } from '../../src/services/UserSessionService';
import { prisma } from '../../src/prisma';

describe('UserSessionService', () => {
  afterEach(() => sinon.restore());

  it('create() inserts a row with sliding expiresAt', async () => {
    const create = sinon.stub(prisma.userSession, 'create').resolves({ id: 's1' } as any);
    const svc = new UserSessionService();
    const session = await svc.create('u1', { userAgent: 'curl', ipHash: 'abc' });
    expect(session.id).to.equal('s1');
    const data = create.firstCall.args[0].data;
    expect(data.userId).to.equal('u1');
    expect(data.expiresAt).to.be.instanceOf(Date);
  });

  it('resolve() returns session + slides expiresAt forward', async () => {
    sinon.stub(prisma.userSession, 'findUnique').resolves({
      id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 1_000_000),
    } as any);
    const update = sinon.stub(prisma.userSession, 'update').resolves({} as any);
    const svc = new UserSessionService();
    const out = await svc.resolve('s1');
    expect(out?.userId).to.equal('u1');
    expect(update.calledOnce).to.be.true;
  });

  it('resolve() returns null for expired sessions', async () => {
    sinon.stub(prisma.userSession, 'findUnique').resolves({
      id: 's1', userId: 'u1', expiresAt: new Date(Date.now() - 1_000),
    } as any);
    const svc = new UserSessionService();
    const out = await svc.resolve('s1');
    expect(out).to.be.null;
  });

  it('revoke() deletes a single session', async () => {
    const del = sinon.stub(prisma.userSession, 'delete').resolves({} as any);
    await new UserSessionService().revoke('s1');
    const where = del.firstCall.args[0].where as any;
    expect(where.id).to.equal('s1');
  });

  it('revokeAllForUserExcept() deletes everything except the given session', async () => {
    const del = sinon.stub(prisma.userSession, 'deleteMany').resolves({ count: 2 } as any);
    await new UserSessionService().revokeAllForUserExcept('u1', 'keep-me');
    const where = del.firstCall.args[0]?.where as any;
    expect(where.userId).to.equal('u1');
    expect(where.NOT).to.deep.equal({ id: 'keep-me' });
  });

  it('cleanupExpired() deletes rows whose expiresAt has passed', async () => {
    const del = sinon.stub(prisma.userSession, 'deleteMany').resolves({ count: 5 } as any);
    const removed = await new UserSessionService().cleanupExpired();
    expect(removed).to.equal(5);
    const where = del.firstCall.args[0]?.where as any;
    expect(where.expiresAt.lt).to.be.instanceOf(Date);
  });

  it('revokeAllForUser() deletes every session for the user', async () => {
    const del = sinon.stub(prisma.userSession, 'deleteMany').resolves({ count: 3 } as any);
    const removed = await new UserSessionService().revokeAllForUser('u1');
    expect(removed).to.equal(3);
    expect((del.firstCall.args[0] as any).where).to.deep.equal({ userId: 'u1' });
  });
});
