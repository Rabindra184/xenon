import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { Container } from 'typedi';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SocketServer } from '../../src/services/SocketServer';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { ApiKeyService } from '../../src/services/ApiKeyService';
import { prisma } from '../../src/prisma';
import { config as xenonConfig } from '../../src/config';
import { saveRegistrations } from '../helpers/container-registration';

// Test seam: `authenticate()` is private and there is no existing SocketServer
// spec to mirror, so — consistent with how authMiddleware.bearer.spec.ts
// calls `authMiddleware()` directly with a fake req/res rather than spinning
// up a real HTTP server — we call the private method directly via a cast,
// with a minimal fake `Socket` shaped as `{ handshake: { auth, headers } }`
// (the only two properties `authenticate()` reads off the socket).
function fakeSocket(auth: Record<string, any> = {}, headers: Record<string, any> = {}) {
  return { handshake: { auth, headers } } as any;
}

describe('SocketServer — authenticate() bearer path', () => {
  let dir: string;
  let keySvc: JwtKeyService;
  let server: SocketServer;
  let authenticate: (socket: any) => Promise<{ principal: string }>;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-socket-bearer-'));
    keySvc = new JwtKeyService();
    await keySvc.init(dir);
    Container.set(JwtKeyService, keySvc);
    Container.set(ApiKeyService, {
      verifyPair: sinon.stub().resolves(null),
      verify: sinon.stub().resolves(null),
    } as any);
    server = new SocketServer();
    authenticate = (socket: any) => (server as any).authenticate(socket);
  });

  afterEach(() => {
    sinon.restore();
    Container.reset();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('1. valid xenon-rest bearer JWT for an ACTIVE user → principal dashboard', async () => {
    sinon.stub(prisma.user, 'findUnique').resolves({ status: 'ACTIVE', role: 'ADMIN' } as any);
    const token = await keySvc.sign({ sub: 'u1' }, { audience: 'xenon-rest', ttlSeconds: 60 });
    const { principal } = await authenticate(fakeSocket({ bearer: token }));
    expect(principal).to.equal('dashboard');
  });

  it('2. valid bearer JWT but user is INACTIVE → auth error (socket rejected)', async () => {
    sinon.stub(prisma.user, 'findUnique').resolves({ status: 'INACTIVE' } as any);
    const token = await keySvc.sign({ sub: 'u1' }, { audience: 'xenon-rest', ttlSeconds: 60 });
    try {
      await authenticate(fakeSocket({ bearer: token }));
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(String(e.message)).to.match(/inactive/i);
    }
  });

  it('3. garbage bearer → auth error', async () => {
    const findUnique = sinon.stub(prisma.user, 'findUnique');
    try {
      await authenticate(fakeSocket({ bearer: 'not-a-real-jwt' }));
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(String(e.message)).to.match(/invalid bearer/i);
    }
    expect(findUnique.called).to.equal(false);
  });

  it('4a. no bearer, valid (accessKey, token) pair → principal node (unchanged)', async () => {
    (Container.get(ApiKeyService).verifyPair as sinon.SinonStub).resolves({
      id: 'k1',
      userId: 'u1',
    } as any);
    sinon.stub(prisma.user, 'findUnique').resolves({ status: 'ACTIVE', role: 'ADMIN' } as any);
    const { principal } = await authenticate(fakeSocket({ accessKey: 'xen_ak', token: 'xen_tok' }));
    expect(principal).to.equal('node');
  });

  it('4b. bearer takes precedence when present alongside a valid pair → dashboard', async () => {
    (Container.get(ApiKeyService).verifyPair as sinon.SinonStub).resolves({
      id: 'k1',
      userId: 'other-user',
    } as any);
    sinon.stub(prisma.user, 'findUnique').resolves({ status: 'ACTIVE', role: 'ADMIN' } as any);
    const token = await keySvc.sign({ sub: 'u1' }, { audience: 'xenon-rest', ttlSeconds: 60 });
    const { principal } = await authenticate(
      fakeSocket({ bearer: token, accessKey: 'xen_ak', token: 'xen_tok' }),
    );
    expect(principal).to.equal('dashboard');
  });

  it('5. no credentials at all → auth error (existing behavior preserved)', async () => {
    try {
      await authenticate(fakeSocket());
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(String(e.message)).to.match(/missing credentials/i);
    }
  });
});

// The socket keeps who it is, so the dashboard events can be scoped by team.
// teamIds is computed exactly as REST's computeTeamIds (callerTeamIds.ts) does:
// ADMIN/SUPER_ADMIN → undefined (sees everything), a team-narrowed key or
// bearer → [thatTeam], otherwise the user's TeamMember teams.
describe('SocketServer — authenticate() identity', () => {
  let dir: string;
  let keySvc: JwtKeyService;
  let server: SocketServer;
  let restore: () => void;
  let apiKeys: { verifyPair: sinon.SinonStub; verify: sinon.SinonStub };
  let authDisabled: boolean;
  const authenticate = (socket: any) => (server as any).authenticate(socket);

  function users(byId: Record<string, { status: string; role: string }>) {
    return sinon
      .stub(prisma.user, 'findUnique')
      .callsFake(((args: any) => Promise.resolve(byId[args.where.id] ?? null)) as any);
  }

  beforeEach(async () => {
    authDisabled = xenonConfig.authDisabled;
    xenonConfig.authDisabled = false;
    restore = saveRegistrations(JwtKeyService, ApiKeyService);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-socket-identity-'));
    keySvc = new JwtKeyService();
    await keySvc.init(dir);
    Container.set(JwtKeyService, keySvc);
    apiKeys = { verifyPair: sinon.stub().resolves(null), verify: sinon.stub().resolves(null) };
    Container.set(ApiKeyService, apiKeys as any);
    server = new SocketServer();
  });

  afterEach(() => {
    sinon.restore();
    restore();
    xenonConfig.authDisabled = authDisabled;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('an auth-disabled server: every socket is unscoped', async () => {
    xenonConfig.authDisabled = true;
    const identity = await authenticate(fakeSocket());
    expect(identity).to.deep.equal({
      principal: 'auth-disabled',
      userId: 'auth-disabled',
      role: 'SUPER_ADMIN',
      teamIds: undefined,
    });
  });

  it('an admin bearer: unscoped, and no TeamMember lookup', async () => {
    users({ 'u-admin': { status: 'ACTIVE', role: 'ADMIN' } });
    const members = sinon.stub(prisma.teamMember, 'findMany').resolves([] as any);
    const token = await keySvc.sign({ sub: 'u-admin' }, { audience: 'xenon-rest', ttlSeconds: 60 });
    const identity = await authenticate(fakeSocket({ bearer: token }));
    expect(identity).to.deep.equal({
      principal: 'dashboard',
      userId: 'u-admin',
      role: 'ADMIN',
      teamIds: undefined,
    });
    expect(members.called).to.equal(false);
  });

  it("a member bearer: the user's TeamMember teams", async () => {
    users({ 'u-member': { status: 'ACTIVE', role: 'MEMBER' } });
    const members = sinon
      .stub(prisma.teamMember, 'findMany')
      .resolves([{ teamId: 'team-a' }, { teamId: 'team-c' }] as any);
    const token = await keySvc.sign(
      { sub: 'u-member' },
      { audience: 'xenon-rest', ttlSeconds: 60 },
    );
    const identity = await authenticate(fakeSocket({ bearer: token }));
    expect(identity).to.deep.equal({
      principal: 'dashboard',
      userId: 'u-member',
      role: 'MEMBER',
      teamIds: ['team-a', 'team-c'],
    });
    expect(members.firstCall.args[0]).to.deep.include({ where: { userId: 'u-member' } });
  });

  it('a member in no team: an empty list, which still sees the shared pool', async () => {
    users({ 'u-lonely': { status: 'ACTIVE', role: 'MEMBER' } });
    sinon.stub(prisma.teamMember, 'findMany').resolves([] as any);
    const token = await keySvc.sign(
      { sub: 'u-lonely' },
      { audience: 'xenon-rest', ttlSeconds: 60 },
    );
    const identity = await authenticate(fakeSocket({ bearer: token }));
    expect(identity.teamIds).to.deep.equal([]);
  });

  it("a team-narrowed bearer: just the token's team", async () => {
    users({ 'u-member': { status: 'ACTIVE', role: 'MEMBER' } });
    const members = sinon
      .stub(prisma.teamMember, 'findMany')
      .resolves([{ teamId: 'team-a' }] as any);
    const token = await keySvc.sign(
      { sub: 'u-member', teamId: 'team-b' },
      { audience: 'xenon-rest', ttlSeconds: 60 },
    );
    const identity = await authenticate(fakeSocket({ bearer: token }));
    expect(identity.teamIds).to.deep.equal(['team-b']);
    expect(members.called).to.equal(false);
  });

  it("a team-narrowed (accessKey, token) pair: node principal, the key's team", async () => {
    apiKeys.verifyPair.resolves({ id: 'k1', userId: 'u-member', teamId: 'team-b' });
    users({ 'u-member': { status: 'ACTIVE', role: 'MEMBER' } });
    const members = sinon
      .stub(prisma.teamMember, 'findMany')
      .resolves([{ teamId: 'team-a' }] as any);
    const identity = await authenticate(fakeSocket({ accessKey: 'xen_ak', token: 'xen_tok' }));
    expect(identity).to.deep.equal({
      principal: 'node',
      userId: 'u-member',
      role: 'MEMBER',
      teamIds: ['team-b'],
    });
    expect(members.called).to.equal(false);
  });

  it("a dashboard cookie (raw key): the key owner's identity", async () => {
    apiKeys.verify.resolves({ id: 'k2', userId: 'u-super', teamId: null });
    users({ 'u-super': { status: 'ACTIVE', role: 'SUPER_ADMIN' } });
    const identity = await authenticate(
      fakeSocket({}, { cookie: 'other=1; xenon_dashboard_session=raw-key' }),
    );
    expect(apiKeys.verify.firstCall.args[0]).to.equal('raw-key');
    expect(identity).to.deep.equal({
      principal: 'dashboard',
      userId: 'u-super',
      role: 'SUPER_ADMIN',
      teamIds: undefined,
    });
  });

  it('a dashboard cookie whose owner is inactive is refused, as REST refuses it', async () => {
    apiKeys.verify.resolves({ id: 'k2', userId: 'u-gone', teamId: null });
    users({ 'u-gone': { status: 'DISABLED', role: 'ADMIN' } });
    try {
      await authenticate(fakeSocket({}, { cookie: 'xenon_dashboard_session=raw-key' }));
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(String(e.message)).to.match(/inactive/i);
    }
  });
});
