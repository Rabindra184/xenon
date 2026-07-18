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
  let authenticate: (socket: any) => Promise<string>;

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
    sinon.stub(prisma.user, 'findUnique').resolves({ status: 'ACTIVE' } as any);
    const token = await keySvc.sign({ sub: 'u1' }, { audience: 'xenon-rest', ttlSeconds: 60 });
    const principal = await authenticate(fakeSocket({ bearer: token }));
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
    sinon.stub(prisma.user, 'findUnique').resolves({ status: 'ACTIVE' } as any);
    const principal = await authenticate(
      fakeSocket({ accessKey: 'xen_ak', token: 'xen_tok' }),
    );
    expect(principal).to.equal('node');
  });

  it('4b. bearer takes precedence when present alongside a valid pair → dashboard', async () => {
    (Container.get(ApiKeyService).verifyPair as sinon.SinonStub).resolves({
      id: 'k1',
      userId: 'other-user',
    } as any);
    sinon.stub(prisma.user, 'findUnique').resolves({ status: 'ACTIVE' } as any);
    const token = await keySvc.sign({ sub: 'u1' }, { audience: 'xenon-rest', ttlSeconds: 60 });
    const principal = await authenticate(
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
