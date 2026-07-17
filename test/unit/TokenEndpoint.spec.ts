import 'reflect-metadata';
import { expect } from 'chai';
import { Container } from 'typedi';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';
import { issueToken } from '../../src/app/routers/auth';

describe('POST /auth/token handler (issueToken)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-tok-'));
    const svc = new JwtKeyService();
    await svc.init(dir);
    Container.set(JwtKeyService, svc);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    Container.reset();
  });

  const auth = {
    kind: 'api-key',
    userId: 'u1',
    role: 'MEMBER',
    scopes: 'devices,read',
    teamId: 't1',
    rateLimit: 300,
  } as any;

  it('mints a xenon-rest token by default with 3600s TTL', async () => {
    const out = await issueToken(auth, {});
    expect(out.audience).to.equal('xenon-rest');
    expect(out.expiresIn).to.equal(3600);
    const payload = await Container.get(JwtKeyService).verify(out.token, {
      audience: 'xenon-rest',
    });
    expect(payload.sub).to.equal('u1');
    expect(payload.scopes).to.equal('devices,read');
    expect(payload.teamId).to.equal('t1');
  });

  it('mints a xenon-mcp token with 86400s TTL', async () => {
    const out = await issueToken(auth, { audience: 'xenon-mcp' });
    expect(out.expiresIn).to.equal(86400);
    await Container.get(JwtKeyService).verify(out.token, { audience: 'xenon-mcp' });
  });

  it('rejects unknown audiences', async () => {
    try {
      await issueToken(auth, { audience: 'xenon-stream' }); // tickets are not minted here
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.message).to.match(/audience/);
    }
  });
});
