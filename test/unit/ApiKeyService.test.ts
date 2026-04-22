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
    const key = await svc.bootstrapIfEmpty('/tmp/test-bootstrap.txt');

    expect(key).to.be.a('string').with.lengthOf(64);
    expect(create.calledOnce).to.be.true;
    expect(create.firstCall.args[0].data.scopes).to.equal('admin');
    expect(writeStub.calledOnce).to.be.true;
    expect(writeStub.firstCall.args[0]).to.equal('/tmp/test-bootstrap.txt');
  });

  it('returns null when keys already exist', async () => {
    sinon.stub(prisma.apiKey, 'count').resolves(1);
    const svc = new ApiKeyService();
    const key = await svc.bootstrapIfEmpty('/tmp/test-bootstrap.txt');
    expect(key).to.be.null;
  });

  it('verify returns the key row for a valid raw key', async () => {
    const raw = 'a'.repeat(64);
    const hash = (await import('crypto'))
      .createHash('sha256')
      .update(raw)
      .digest('hex');
    sinon
      .stub(prisma.apiKey, 'findUnique')
      .resolves({ id: 'k1', keyHash: hash, scopes: 'read', rateLimit: 300, revokedAt: null } as any);
    sinon.stub(prisma.apiKey, 'update').resolves({} as any);
    const svc = new ApiKeyService();
    const row = await svc.verify(raw);
    expect(row?.id).to.equal('k1');
  });

  it('verify rejects revoked keys', async () => {
    const raw = 'a'.repeat(64);
    const hash = (await import('crypto'))
      .createHash('sha256')
      .update(raw)
      .digest('hex');
    sinon
      .stub(prisma.apiKey, 'findUnique')
      .resolves({ id: 'k1', keyHash: hash, scopes: 'read', rateLimit: 300, revokedAt: new Date() } as any);
    const svc = new ApiKeyService();
    const row = await svc.verify(raw);
    expect(row).to.be.null;
  });
});
