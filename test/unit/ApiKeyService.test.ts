import { expect } from 'chai';
import sinon from 'sinon';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { prisma } from '../../src/prisma';

describe('ApiKeyService', () => {
  afterEach(() => sinon.restore());

  it('verify returns the key row for a valid raw key', async () => {
    const raw = 'a'.repeat(64);
    const hash = (await import('crypto')).createHash('sha256').update(raw).digest('hex');
    sinon.stub(prisma.apiKey, 'findUnique').resolves({
      id: 'k1',
      keyHash: hash,
      scopes: 'read',
      rateLimit: 300,
      revokedAt: null,
    } as any);
    sinon.stub(prisma.apiKey, 'update').resolves({} as any);
    const svc = new ApiKeyService();
    const row = await svc.verify(raw);
    expect(row?.id).to.equal('k1');
  });

  it('verify rejects revoked keys', async () => {
    const raw = 'a'.repeat(64);
    const hash = (await import('crypto')).createHash('sha256').update(raw).digest('hex');
    sinon.stub(prisma.apiKey, 'findUnique').resolves({
      id: 'k1',
      keyHash: hash,
      scopes: 'read',
      rateLimit: 300,
      revokedAt: new Date(),
    } as any);
    const svc = new ApiKeyService();
    const row = await svc.verify(raw);
    expect(row).to.be.null;
  });

  it('create() persists the userId fk', async () => {
    const create = sinon.stub(prisma.apiKey, 'create').resolves({ id: 'k1' } as any);
    const svc = new ApiKeyService();
    await svc.create({ name: 'x', scopes: ['read'], userId: 'u1' });
    expect(create.firstCall.args[0].data.userId).to.equal('u1');
  });

  it('verifyPair() returns the row when accessKey matches token owner', async () => {
    const raw = 'a'.repeat(64);
    const hash = (await import('crypto')).createHash('sha256').update(raw).digest('hex');
    sinon.stub(prisma.user, 'findUnique').resolves({ id: 'u1' } as any);
    sinon.stub(prisma.apiKey, 'findFirst').resolves({
      id: 'k1', keyHash: hash, scopes: 'read', rateLimit: 300, revokedAt: null, userId: 'u1',
    } as any);
    sinon.stub(prisma.apiKey, 'update').resolves({} as any);
    const svc = new ApiKeyService();
    const row = await svc.verifyPair('xen_abc', raw);
    expect(row?.id).to.equal('k1');
  });

  it('verifyPair() returns null when token is not owned by the accessKey user', async () => {
    const raw = 'a'.repeat(64);
    sinon.stub(prisma.user, 'findUnique').resolves({ id: 'u1' } as any);
    sinon.stub(prisma.apiKey, 'findFirst').resolves(null);
    const svc = new ApiKeyService();
    const row = await svc.verifyPair('xen_abc', raw);
    expect(row).to.be.null;
  });

  it('verify rejects expired tokens (expiresAt in the past)', async () => {
    const raw = 'a'.repeat(64);
    const hash = (await import('crypto')).createHash('sha256').update(raw).digest('hex');
    sinon.stub(prisma.apiKey, 'findUnique').resolves({
      id: 'k1',
      keyHash: hash,
      scopes: 'read',
      rateLimit: 300,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
    } as any);
    const svc = new ApiKeyService();
    const row = await svc.verify(raw);
    expect(row).to.be.null;
  });

  it('verify accepts tokens whose expiresAt is in the future', async () => {
    const raw = 'a'.repeat(64);
    const hash = (await import('crypto')).createHash('sha256').update(raw).digest('hex');
    sinon.stub(prisma.apiKey, 'findUnique').resolves({
      id: 'k1',
      keyHash: hash,
      scopes: 'read',
      rateLimit: 300,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    } as any);
    sinon.stub(prisma.apiKey, 'update').resolves({} as any);
    const svc = new ApiKeyService();
    const row = await svc.verify(raw);
    expect(row?.id).to.equal('k1');
  });

  it('verify accepts tokens with no expiresAt', async () => {
    const raw = 'a'.repeat(64);
    const hash = (await import('crypto')).createHash('sha256').update(raw).digest('hex');
    sinon.stub(prisma.apiKey, 'findUnique').resolves({
      id: 'k1',
      keyHash: hash,
      scopes: 'read',
      rateLimit: 300,
      revokedAt: null,
      expiresAt: null,
    } as any);
    sinon.stub(prisma.apiKey, 'update').resolves({} as any);
    const svc = new ApiKeyService();
    const row = await svc.verify(raw);
    expect(row?.id).to.equal('k1');
  });

  it('verifyPair() rejects expired tokens', async () => {
    const raw = 'a'.repeat(64);
    const hash = (await import('crypto')).createHash('sha256').update(raw).digest('hex');
    sinon.stub(prisma.user, 'findUnique').resolves({ id: 'u1' } as any);
    sinon.stub(prisma.apiKey, 'findFirst').resolves({
      id: 'k1',
      keyHash: hash,
      scopes: 'read',
      rateLimit: 300,
      revokedAt: null,
      userId: 'u1',
      expiresAt: new Date(Date.now() - 60_000),
    } as any);
    const svc = new ApiKeyService();
    const row = await svc.verifyPair('xen_abc', raw);
    expect(row).to.be.null;
  });

  it('create() persists expiresAt when provided', async () => {
    const create = sinon.stub(prisma.apiKey, 'create').resolves({ id: 'k1' } as any);
    const svc = new ApiKeyService();
    const future = new Date(Date.now() + 24 * 60 * 60_000);
    await svc.create({ name: 'x', scopes: ['read'], userId: 'u1', expiresAt: future });
    expect(create.firstCall.args[0].data.expiresAt).to.deep.equal(future);
  });

  it('create() leaves expiresAt null when omitted', async () => {
    const create = sinon.stub(prisma.apiKey, 'create').resolves({ id: 'k1' } as any);
    const svc = new ApiKeyService();
    await svc.create({ name: 'x', scopes: ['read'], userId: 'u1' });
    expect(create.firstCall.args[0].data.expiresAt).to.be.null;
  });
});
