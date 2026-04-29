import { expect } from 'chai';
import sinon from 'sinon';
import crypto from 'crypto';
import { PasswordResetService } from '../../src/services/PasswordResetService';
import { prisma } from '../../src/prisma';

describe('PasswordResetService', () => {
  afterEach(() => sinon.restore());

  it('createToken() returns raw + persists sha256 hash with TTL', async () => {
    const create = sinon.stub(prisma.passwordResetToken, 'create').resolves({ id: 't1' } as any);
    const svc = new PasswordResetService();
    const { raw } = await svc.createToken('u1');
    expect(raw).to.match(/^[A-Za-z0-9_-]{40,}$/);
    const data = create.firstCall.args[0].data;
    expect(data.userId).to.equal('u1');
    expect(data.tokenHash).to.equal(crypto.createHash('sha256').update(raw).digest('hex'));
    expect(data.expiresAt).to.be.instanceOf(Date);
    expect((data.expiresAt as Date).getTime()).to.be.greaterThan(Date.now());
  });

  it('verifyToken() returns the row when valid', async () => {
    const raw = 'a'.repeat(43);
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    sinon.stub(prisma.passwordResetToken, 'findUnique').resolves({
      id: 't1', userId: 'u1', tokenHash,
      expiresAt: new Date(Date.now() + 3600_000), usedAt: null,
    } as any);
    const svc = new PasswordResetService();
    const row = await svc.verifyToken(raw);
    expect(row?.userId).to.equal('u1');
  });

  it('verifyToken() returns null for expired tokens', async () => {
    const raw = 'a'.repeat(43);
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    sinon.stub(prisma.passwordResetToken, 'findUnique').resolves({
      id: 't1', userId: 'u1', tokenHash,
      expiresAt: new Date(Date.now() - 1_000), usedAt: null,
    } as any);
    const svc = new PasswordResetService();
    expect(await svc.verifyToken(raw)).to.be.null;
  });

  it('verifyToken() returns null for already-used tokens', async () => {
    const raw = 'a'.repeat(43);
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    sinon.stub(prisma.passwordResetToken, 'findUnique').resolves({
      id: 't1', userId: 'u1', tokenHash,
      expiresAt: new Date(Date.now() + 3600_000), usedAt: new Date(),
    } as any);
    const svc = new PasswordResetService();
    expect(await svc.verifyToken(raw)).to.be.null;
  });

  it('consume() marks usedAt atomically', async () => {
    const update = sinon.stub(prisma.passwordResetToken, 'update').resolves({} as any);
    await new PasswordResetService().consume('t1');
    expect(update.firstCall.args[0].where).to.deep.equal({ id: 't1' });
    expect(update.firstCall.args[0].data.usedAt).to.be.instanceOf(Date);
  });

  it('cleanupExpired() deletes rows whose expiresAt has passed or that were used', async () => {
    const del: any = sinon.stub(prisma.passwordResetToken, 'deleteMany').resolves({ count: 7 } as any);
    const removed = await new PasswordResetService().cleanupExpired();
    expect(removed).to.equal(7);
    const where = del.firstCall.args[0].where as any;
    expect(where).to.have.property('OR');
  });
});
