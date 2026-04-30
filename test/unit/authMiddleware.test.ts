import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { authMiddleware, scopesForRole } from '../../src/middleware/authMiddleware';
import { Container } from 'typedi';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserSessionService } from '../../src/services/UserSessionService';
import { UserService } from '../../src/services/UserService';
import { prisma } from '../../src/prisma';

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
    expect(req.auth?.scopes).to.equal('admin,devices,sessions,read');
  });

  it('x-xenon-api-key header is rejected (legacy auth removed)', async () => {
    const req: any = { headers: { 'x-xenon-api-key': 'rawkey' } };
    const res = mkRes() as any;
    await authMiddleware(req, res, () => { throw new Error('should not call'); });
    expect(res._code).to.equal(401);
  });

  it('cookie falls back to ApiKey when UserSession misses', async () => {
    sinon.stub(Container.get(UserSessionService), 'resolve').resolves(null);
    sinon.stub(Container.get(ApiKeyService), 'verify').resolves({
      id: 'k1',
      userId: 'u1',
      scopes: 'read',
      rateLimit: 300,
      teamId: null,
    } as any);
    sinon.stub(Container.get(UserService), 'findById').resolves({
      id: 'u1',
      role: 'MEMBER',
      status: 'ACTIVE',
    } as any);
    const req: any = { headers: { cookie: 'xenon_dashboard_session=legacy-key-id' } };
    let called = false;
    await authMiddleware(req, mkRes() as any, () => {
      called = true;
    });
    expect(called).to.be.true;
    expect(req.auth?.kind).to.equal('api-key');
    expect(req.auth?.userId).to.equal('u1');
    expect(req.apiKey?.id).to.equal('k1');
  });

  describe('scopesForRole', () => {
    it('maps each role to the cookie-session scope set (ADMIN gets admin too)', () => {
      // SUPER_ADMIN and ADMIN both get the full set on cookie sessions —
      // they hit scopeGuard(['admin']) routes via the dashboard and must
      // pass. Token-default scopes (in /profile/tokens) stay narrower.
      expect(scopesForRole('SUPER_ADMIN')).to.equal('admin,devices,sessions,read');
      expect(scopesForRole('ADMIN')).to.equal('admin,devices,sessions,read');
      expect(scopesForRole('MEMBER')).to.equal('sessions,read');
    });
  });

  describe('teamIds population (Phase 4A)', () => {
    it('cookie session for MEMBER fetches TeamMember rows', async () => {
      sinon.stub(Container.get(UserSessionService), 'resolve').resolves({
        id: 's1', userId: 'u1',
      } as any);
      sinon.stub(Container.get(UserService), 'findById').resolves({
        id: 'u1', role: 'MEMBER', status: 'ACTIVE',
      } as any);
      const tmFind = sinon.stub(prisma.teamMember, 'findMany').resolves([
        { teamId: 't1' }, { teamId: 't2' },
      ] as any);
      const req: any = { headers: { cookie: 'xenon_dashboard_session=s1' } };
      await authMiddleware(req, mkRes() as any, () => {});
      expect(req.auth?.teamIds).to.deep.equal(['t1', 't2']);
      expect((tmFind.firstCall.args[0] as any).where).to.deep.equal({ userId: 'u1' });
    });

    it('cookie session for SUPER_ADMIN does NOT fetch TeamMember rows; teamIds undefined', async () => {
      sinon.stub(Container.get(UserSessionService), 'resolve').resolves({
        id: 's1', userId: 'u1',
      } as any);
      sinon.stub(Container.get(UserService), 'findById').resolves({
        id: 'u1', role: 'SUPER_ADMIN', status: 'ACTIVE',
      } as any);
      const tmFind = sinon.stub(prisma.teamMember, 'findMany').resolves([] as any);
      const req: any = { headers: { cookie: 'xenon_dashboard_session=s1' } };
      await authMiddleware(req, mkRes() as any, () => {});
      expect(req.auth?.teamIds).to.be.undefined;
      expect(tmFind.called).to.be.false;
    });

    it('cookie session for ADMIN does NOT fetch TeamMember rows', async () => {
      sinon.stub(Container.get(UserSessionService), 'resolve').resolves({
        id: 's1', userId: 'u1',
      } as any);
      sinon.stub(Container.get(UserService), 'findById').resolves({
        id: 'u1', role: 'ADMIN', status: 'ACTIVE',
      } as any);
      const tmFind = sinon.stub(prisma.teamMember, 'findMany').resolves([] as any);
      const req: any = { headers: { cookie: 'xenon_dashboard_session=s1' } };
      await authMiddleware(req, mkRes() as any, () => {});
      expect(req.auth?.teamIds).to.be.undefined;
      expect(tmFind.called).to.be.false;
    });

    it('header (accessKey, token) with team-narrowed key sets teamIds=[apiKey.teamId]', async () => {
      sinon.stub(Container.get(ApiKeyService), 'verifyPair').resolves({
        id: 'k1', userId: 'u1', scopes: 'sessions,read', rateLimit: 300, teamId: 't9',
      } as any);
      sinon.stub(Container.get(UserService), 'findById').resolves({
        id: 'u1', role: 'MEMBER', status: 'ACTIVE',
      } as any);
      const tmFind = sinon.stub(prisma.teamMember, 'findMany').resolves([
        { teamId: 't9' }, { teamId: 't10' },
      ] as any);
      const req: any = {
        headers: { 'x-xenon-access-key': 'xen_abc', 'x-xenon-token': 'tok' },
      };
      await authMiddleware(req, mkRes() as any, () => {});
      expect(req.auth?.teamIds).to.deep.equal(['t9']);
      // Token already narrows; TeamMember query should NOT have run.
      expect(tmFind.called).to.be.false;
    });

    it('header (accessKey, token) without team narrow sets teamIds from TeamMember', async () => {
      sinon.stub(Container.get(ApiKeyService), 'verifyPair').resolves({
        id: 'k1', userId: 'u1', scopes: 'sessions,read', rateLimit: 300, teamId: null,
      } as any);
      sinon.stub(Container.get(UserService), 'findById').resolves({
        id: 'u1', role: 'MEMBER', status: 'ACTIVE',
      } as any);
      sinon.stub(prisma.teamMember, 'findMany').resolves([{ teamId: 't1' }] as any);
      const req: any = {
        headers: { 'x-xenon-access-key': 'xen_abc', 'x-xenon-token': 'tok' },
      };
      await authMiddleware(req, mkRes() as any, () => {});
      expect(req.auth?.teamIds).to.deep.equal(['t1']);
    });
  });
});
