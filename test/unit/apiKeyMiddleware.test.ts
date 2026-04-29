import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import { apiKeyMiddleware } from '../../src/middleware/apiKeyMiddleware';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserService } from '../../src/services/UserService';
import { config } from '../../src/config';

// `apiKeyMiddleware` is a back-compat re-export of `authMiddleware`; this
// suite verifies the legacy `x-xenon-api-key` header path still works for
// callers that haven't migrated to the (accessKey, token) pair yet. The
// new authMiddleware-shaped tests live in authMiddleware.test.ts.

function mockReq(headers: Record<string, string> = {}, query: any = {}) {
  return { headers, query } as any;
}
function mockRes() {
  const json = sinon.stub();
  const status = sinon.stub().returnsThis();
  return { status, json, locals: {}, cookie: sinon.stub().returnsThis() } as any;
}

describe('apiKeyMiddleware (legacy header shim)', () => {
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
    const orig = (config as any).acceptLegacyKey;
    (config as any).acceptLegacyKey = true;
    try {
      sinon.stub(Container.get(ApiKeyService), 'verify').resolves(null);
      const req = mockReq({ 'x-xenon-api-key': 'bad' });
      const res = mockRes();
      const next = sinon.stub();
      await apiKeyMiddleware(req, res, next);
      expect(res.status.calledWith(401)).to.be.true;
    } finally {
      (config as any).acceptLegacyKey = orig;
    }
  });

  it('calls next and attaches apiKey on success (legacy header, flag on)', async () => {
    const orig = (config as any).acceptLegacyKey;
    (config as any).acceptLegacyKey = true;
    try {
      sinon
        .stub(Container.get(ApiKeyService), 'verify')
        .resolves({ id: 'k1', userId: 'u1', scopes: 'read', rateLimit: 300, teamId: null } as any);
      sinon
        .stub(Container.get(UserService), 'findById')
        .resolves({ id: 'u1', role: 'MEMBER', status: 'ACTIVE' } as any);
      const req = mockReq({ 'x-xenon-api-key': 'good' });
      const res = mockRes();
      const next = sinon.stub();
      await apiKeyMiddleware(req, res, next);
      expect(next.calledOnce).to.be.true;
      expect(req.apiKey.id).to.equal('k1');
      expect(req.auth?.kind).to.equal('api-key');
      expect(req.auth?.userId).to.equal('u1');
    } finally {
      (config as any).acceptLegacyKey = orig;
    }
  });

  it('legacy header is ignored when XENON_ACCEPT_LEGACY_KEY=false', async () => {
    const orig = (config as any).acceptLegacyKey;
    (config as any).acceptLegacyKey = false;
    try {
      const req = mockReq({ 'x-xenon-api-key': 'good' });
      const res = mockRes();
      const next = sinon.stub();
      await apiKeyMiddleware(req, res, next);
      expect(res.status.calledWith(401)).to.be.true;
      expect(next.called).to.be.false;
    } finally {
      (config as any).acceptLegacyKey = orig;
    }
  });
});
