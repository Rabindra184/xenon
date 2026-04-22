import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { apiKeyMiddleware } from '../../src/middleware/apiKeyMiddleware';
import { ApiKeyService } from '../../src/services/ApiKeyService';

function mockReq(headers: Record<string, string> = {}, query: any = {}) {
  return { headers, query } as any;
}
function mockRes() {
  const json = sinon.stub();
  const status = sinon.stub().returnsThis();
  return { status, json, locals: {} } as any;
}

describe('apiKeyMiddleware', () => {
  afterEach(() => sinon.restore());

  it('401 when header missing', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = sinon.stub();
    await apiKeyMiddleware(req, res, next);
    expect(res.status.calledWith(401)).to.be.true;
    expect(next.called).to.be.false;
  });

  it('401 when key invalid', async () => {
    sinon.stub(Container.get(ApiKeyService), 'verify').resolves(null);
    const req = mockReq({ 'x-xenon-api-key': 'bad' });
    const res = mockRes();
    const next = sinon.stub();
    await apiKeyMiddleware(req, res, next);
    expect(res.status.calledWith(401)).to.be.true;
  });

  it('calls next and attaches apiKey on success', async () => {
    sinon
      .stub(Container.get(ApiKeyService), 'verify')
      .resolves({ id: 'k1', scopes: 'read', rateLimit: 300 } as any);
    const req = mockReq({ 'x-xenon-api-key': 'good' });
    const res = mockRes();
    const next = sinon.stub();
    await apiKeyMiddleware(req, res, next);
    expect(next.calledOnce).to.be.true;
    expect(req.apiKey.id).to.equal('k1');
  });
});
