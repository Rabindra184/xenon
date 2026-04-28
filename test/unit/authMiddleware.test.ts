import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { Container } from 'typedi';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserSessionService } from '../../src/services/UserSessionService';
import { UserService } from '../../src/services/UserService';
import { config } from '../../src/config';

function mkRes() {
  return {
    status(code: number) { (this as any)._code = code; return this; },
    json(b: any) { (this as any)._body = b; return this; },
    cookie() { return this; },
    _code: undefined as number | undefined,
    _body: undefined as any,
  };
}

describe('authMiddleware', () => {
  afterEach(() => sinon.restore());

  it('401s when no credentials are present', async () => {
    const req: any = { headers: {} };
    const res = mkRes() as any;
    await authMiddleware(req, res, () => { throw new Error('should not call next'); });
    expect(res._code).to.equal(401);
  });

  it('header (accessKey, token) pair → req.auth populated', async () => {
    const apiKey = { id: 'k1', userId: 'u1', scopes: 'admin', rateLimit: 300, teamId: null };
    sinon.stub(Container.get(ApiKeyService), 'verifyPair').resolves(apiKey as any);
    sinon.stub(Container.get(UserService), 'findById').resolves({
      id: 'u1', email: 'a@b', name: 'A', role: 'ADMIN', status: 'ACTIVE',
    } as any);
    const req: any = {
      headers: { 'x-xenon-access-key': 'xen_abc', 'x-xenon-token': 'tok' },
    };
    let called = false;
    await authMiddleware(req, mkRes() as any, () => { called = true; });
    expect(called).to.be.true;
    expect(req.auth?.kind).to.equal('api-key');
    expect(req.auth?.userId).to.equal('u1');
    expect(req.auth?.role).to.equal('ADMIN');
  });

  it('cookie session id → resolves UserSession → req.auth populated', async () => {
    sinon.stub(Container.get(UserSessionService), 'resolve').resolves({
      id: 's1', userId: 'u1',
    } as any);
    sinon.stub(Container.get(UserService), 'findById').resolves({
      id: 'u1', role: 'SUPER_ADMIN', status: 'ACTIVE',
    } as any);
    const req: any = { headers: { cookie: 'xenon_dashboard_session=s1' } };
    let called = false;
    await authMiddleware(req, mkRes() as any, () => { called = true; });
    expect(called).to.be.true;
    expect(req.auth?.kind).to.equal('user-session');
    expect(req.auth?.role).to.equal('SUPER_ADMIN');
    expect(req.auth?.scopes).to.equal('admin');
  });

  it('legacy x-xenon-api-key works only when XENON_ACCEPT_LEGACY_KEY=true', async () => {
    sinon.stub(Container.get(ApiKeyService), 'verify').resolves({
      id: 'k1', userId: 'u1', scopes: 'read', rateLimit: 300, teamId: null,
    } as any);
    sinon.stub(Container.get(UserService), 'findById').resolves({
      id: 'u1', role: 'MEMBER', status: 'ACTIVE',
    } as any);
    const orig = (config as any).acceptLegacyKey;
    (config as any).acceptLegacyKey = true;
    try {
      const req: any = { headers: { 'x-xenon-api-key': 'rawkey' } };
      let called = false;
      await authMiddleware(req, mkRes() as any, () => { called = true; });
      expect(called).to.be.true;
      expect(req.auth?.kind).to.equal('api-key');
    } finally {
      (config as any).acceptLegacyKey = orig;
    }
  });

  it('legacy x-xenon-api-key 401s when XENON_ACCEPT_LEGACY_KEY=false', async () => {
    const orig = (config as any).acceptLegacyKey;
    (config as any).acceptLegacyKey = false;
    try {
      const req: any = { headers: { 'x-xenon-api-key': 'rawkey' } };
      const res = mkRes() as any;
      await authMiddleware(req, res, () => { throw new Error('should not call'); });
      expect(res._code).to.equal(401);
    } finally {
      (config as any).acceptLegacyKey = orig;
    }
  });
});
