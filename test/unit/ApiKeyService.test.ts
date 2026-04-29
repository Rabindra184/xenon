import { expect } from 'chai';
import sinon from 'sinon';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { prisma } from '../../src/prisma';
import fs from 'fs';

describe('ApiKeyService', () => {
  afterEach(() => sinon.restore());

  it('creates a bootstrap key when the table is empty', async () => {
    sinon.stub(prisma.apiKey, 'count').resolves(0);
    const create = sinon.stub(prisma.apiKey, 'create').resolves({} as any);
    const writeStub = sinon.stub(fs, 'writeFileSync');
    sinon.stub(fs, 'mkdirSync');

    const svc = new ApiKeyService();
    const key = await svc.bootstrapIfEmpty('/tmp/test-bootstrap.txt', 'u-test');

    expect(key).to.be.a('string').with.lengthOf(64);
    expect(create.calledOnce).to.be.true;
    expect(create.firstCall.args[0].data.scopes).to.equal('admin');
    expect(create.firstCall.args[0].data.userId).to.equal('u-test');
    expect(writeStub.calledOnce).to.be.true;
    expect(writeStub.firstCall.args[0]).to.equal('/tmp/test-bootstrap.txt');
  });

  it('returns null when keys already exist', async () => {
    sinon.stub(prisma.apiKey, 'count').resolves(1);
    const svc = new ApiKeyService();
    const key = await svc.bootstrapIfEmpty('/tmp/test-bootstrap.txt', 'u-test');
    expect(key).to.be.null;
  });

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
});
