import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JwtKeyService } from '../../src/services/token/JwtKeyService';

describe('JwtKeyService', () => {
  let dir: string;
  let svc: JwtKeyService;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenon-jwt-'));
    svc = new JwtKeyService();
    await svc.init(dir);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('generates a private key file with 0600 on first init', () => {
    const keyPath = path.join(dir, 'xenon-jwt-private.pem');
    expect(fs.existsSync(keyPath)).to.equal(true);
    const mode = fs.statSync(keyPath).mode & 0o777;
    expect(mode).to.equal(0o600);
  });

  it('reloads the same key on second init (stable kid)', async () => {
    const kid1 = svc.jwks().keys[0].kid;
    const svc2 = new JwtKeyService();
    await svc2.init(dir);
    expect(svc2.jwks().keys[0].kid).to.equal(kid1);
  });

  it('signs and verifies a token round-trip with audience check', async () => {
    const token = await svc.sign({ sub: 'user-1', scopes: 'devices,read' }, { audience: 'xenon-rest', ttlSeconds: 60 });
    const payload = await svc.verify(token, { audience: 'xenon-rest' });
    expect(payload.sub).to.equal('user-1');
    expect(payload.scopes).to.equal('devices,read');
  });

  it('rejects wrong audience', async () => {
    const token = await svc.sign({ sub: 'u' }, { audience: 'xenon-mcp', ttlSeconds: 60 });
    try {
      await svc.verify(token, { audience: 'xenon-rest' });
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(String(e.message)).to.match(/aud/i);
    }
  });

  it('rejects expired tokens', async () => {
    const token = await svc.sign({ sub: 'u' }, { audience: 'xenon-rest', ttlSeconds: -10 });
    try {
      await svc.verify(token, { audience: 'xenon-rest' });
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(String(e.code ?? e.message)).to.match(/expired|ERR_JWT_EXPIRED/i);
    }
  });

  it('exposes a JWKS with kid, use=sig, alg=RS256 and no private material', () => {
    const jwk = svc.jwks().keys[0] as any;
    expect(jwk.kid).to.be.a('string');
    expect(jwk.use).to.equal('sig');
    expect(jwk.alg).to.equal('RS256');
    expect(jwk.d).to.equal(undefined); // private exponent must never appear
  });
});
