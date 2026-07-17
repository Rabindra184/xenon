import { Service } from 'typedi';
import * as jose from 'jose';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

const KEY_FILE = 'xenon-jwt-private.pem';
const ISSUER = process.env.XENON_JWT_ISSUER || 'xenon-hub';

/**
 * RS256 signing key for hub-issued JWTs (REST/MCP tokens, stream tickets).
 * Key material lives on disk (0600), never in the database. `kid` is derived
 * from the public key so it is stable across restarts; rotation = drop a new
 * PEM in place, old tokens fail verification (acceptable: TTLs are short).
 */
@Service()
export class JwtKeyService {
  private privateKey!: jose.KeyLike;
  private publicJwk!: jose.JWK;
  private kid!: string;
  // Boot degrades gracefully if key material is unavailable (bad perms, full
  // disk, corrupt PEM): the server still comes up, and only the token routes
  // fail. sign()/verify() throw a clear error; jwks() serves an empty set.
  private initialized = false;

  async init(keyDir: string): Promise<void> {
    fs.mkdirSync(keyDir, { recursive: true });
    const keyPath = path.join(keyDir, KEY_FILE);
    let pkcs8: string;
    if (fs.existsSync(keyPath)) {
      pkcs8 = fs.readFileSync(keyPath, 'utf8');
    } else {
      const { privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
      pkcs8 = await jose.exportPKCS8(privateKey);
      fs.writeFileSync(keyPath, pkcs8, { mode: 0o600 });
    }
    this.privateKey = await jose.importPKCS8(pkcs8, 'RS256');
    // Public JWK derived from the private key; strip private fields.
    const fullJwk = await jose.exportJWK(this.privateKey);
    this.publicJwk = { kty: fullJwk.kty, n: fullJwk.n, e: fullJwk.e };
    this.kid = createHash('sha256')
      .update(`${fullJwk.n}.${fullJwk.e}`)
      .digest('base64url')
      .slice(0, 16);
    this.initialized = true;
  }

  async sign(
    claims: Record<string, unknown>,
    opts: { audience: string; ttlSeconds: number; jti?: string },
  ): Promise<string> {
    if (!this.initialized) throw new Error('JWT key service not initialized');
    const jwt = new jose.SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: this.kid })
      .setIssuer(ISSUER)
      .setAudience(opts.audience)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + opts.ttlSeconds);
    if (opts.jti) jwt.setJti(opts.jti);
    return jwt.sign(this.privateKey);
  }

  async verify(token: string, opts: { audience: string }): Promise<jose.JWTPayload> {
    if (!this.initialized) throw new Error('JWT key service not initialized');
    const publicKey = await jose.importJWK({ ...this.publicJwk, alg: 'RS256' }, 'RS256');
    const { payload } = await jose.jwtVerify(token, publicKey, {
      issuer: ISSUER,
      audience: opts.audience,
      clockTolerance: 60, // spec §7.1: ±60 s skew, mirrors appium-mcp-auth
    });
    return payload;
  }

  jwks(): { keys: Array<Record<string, unknown>> } {
    // Empty JWKS when uninitialized — valid JSON, honest about having no keys.
    if (!this.initialized) return { keys: [] };
    return { keys: [{ ...this.publicJwk, kid: this.kid, use: 'sig', alg: 'RS256' }] };
  }
}
