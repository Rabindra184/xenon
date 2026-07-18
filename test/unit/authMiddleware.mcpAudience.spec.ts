import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { authMiddleware } from '../../src/middleware/authMiddleware';
import { UserService } from '../../src/services/UserService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { UserSessionService } from '../../src/services/UserSessionService';
import { prisma } from '../../src/prisma';

function fakeRes() {
  const res: any = { statusCode: 200 };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.cookie = () => res;
  return res;
}

// The MCP plugin's tools call Xenon REST with a gateway-injected `authToken`
// that carries audience `xenon-mcp` (not `xenon-rest`). The bearer branch of
// authMiddleware must accept BOTH audiences so those REST calls don't 401.
describe('authMiddleware — Bearer branch accepts xenon-mcp audience', () => {
  let dir: string;
  let keySvc: JwtKeyService;
  const user = { id: 'u1', role: 'MEMBER', status: 'ACTIVE' };

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-mcp-aud-'));
    keySvc = new JwtKeyService();
    await keySvc.init(dir);
    Container.set(JwtKeyService, keySvc);
    Container.set(UserService, { findById: sinon.stub().resolves(user) } as any);
    Container.set(ApiKeyService, { verifyPair: sinon.stub().resolves(null), verify: sinon.stub().resolves(null) } as any);
    Container.set(UserSessionService, { resolve: sinon.stub().resolves(null) } as any);
    sinon.stub(prisma.teamMember, 'findMany').resolves([{ teamId: 't1' }] as any);
  });
  afterEach(() => {
    sinon.restore();
    Container.reset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a valid xenon-mcp Bearer token (ACTIVE user) and sets req.auth.kind=bearer', async () => {
    const token = await keySvc.sign(
      { sub: 'u1', role: 'MEMBER', scopes: 'devices,read', teamId: 't1' },
      { audience: 'xenon-mcp', ttlSeconds: 60 },
    );
    const req: any = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const res = fakeRes();
    const next = sinon.spy();
    await authMiddleware(req, res as any, next);
    expect(next.calledOnce).to.equal(true);
    expect(req.auth.kind).to.equal('bearer');
    expect(req.auth.userId).to.equal('u1');
    expect(req.auth.scopes).to.equal('devices,read');
  });

  it('still accepts a valid xenon-rest Bearer token (regression)', async () => {
    const token = await keySvc.sign(
      { sub: 'u1', role: 'MEMBER', scopes: 'devices,read', teamId: 't1' },
      { audience: 'xenon-rest', ttlSeconds: 60 },
    );
    const req: any = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const res = fakeRes();
    const next = sinon.spy();
    await authMiddleware(req, res as any, next);
    expect(next.calledOnce).to.equal(true);
    expect(req.auth.kind).to.equal('bearer');
    expect(req.auth.userId).to.equal('u1');
  });

  it('rejects a token minted for neither xenon-rest nor xenon-mcp', async () => {
    const token = await keySvc.sign({ sub: 'u1' }, { audience: 'xenon-stream', ttlSeconds: 60 });
    const req: any = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const res = fakeRes();
    await authMiddleware(req, res as any, sinon.spy());
    expect(res.statusCode).to.equal(401);
  });

  it('rejects an xenon-mcp token for a disabled user (live revocation preserved)', async () => {
    (Container.get(UserService).findById as sinon.SinonStub).resolves({ ...user, status: 'DISABLED' });
    const token = await keySvc.sign({ sub: 'u1' }, { audience: 'xenon-mcp', ttlSeconds: 60 });
    const req: any = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const res = fakeRes();
    await authMiddleware(req, res as any, sinon.spy());
    expect(res.statusCode).to.equal(401);
  });
});
