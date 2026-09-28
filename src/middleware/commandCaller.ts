import { createHash } from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import { canOverrideLease } from '../services/device-access/leaseOverride';
import { verifyBearerCredential, verifyKeyPairCredential } from './verifyCredential';

/**
 * Who is calling a WebDriver command, for the per-command check (commandAuth.ts).
 *
 * The caller presents the credentials REST accepts: the
 * `x-xenon-access-key` + `x-xenon-token` pair, or `Authorization: Bearer <jwt>`
 * (see ACCEPTED_BEARER_AUDIENCES). Both are verified by the helpers
 * authMiddleware uses, so an inactive user, a revoked or expired key, and a
 * bad or expired token are refused here exactly as they are on /xenon/api.
 *
 * The dashboard cookie is deliberately not read. A browser attaches it to any
 * request it makes, including one a hostile page makes, so accepting it would
 * let such a page drive the viewer's sessions.
 */
export type PresentedCredential =
  | { kind: 'none' }
  | { kind: 'key-pair'; accessKey: string; token: string }
  | { kind: 'bearer'; token: string };

export interface CommandCaller {
  userId: string;
  /**
   * May drive a session they do not own: a SUPER_ADMIN, or a credential
   * carrying the `admin` scope. The rule is canOverrideLease's (and
   * resolveActor's); an ADMIN's ordinary key is not an override.
   */
  overrideAdmin: boolean;
}

export type CallerVerdict = { valid: true; caller: CommandCaller } | { valid: false };

/** Same precedence as authMiddleware: the pair wins over a Bearer token. */
export function readPresentedCredential(headers: IncomingHttpHeaders): PresentedCredential {
  const accessKey = headers['x-xenon-access-key'];
  const token = headers['x-xenon-token'];
  if (typeof accessKey === 'string' && accessKey && typeof token === 'string' && token) {
    return { kind: 'key-pair', accessKey, token };
  }
  const authorization = headers['authorization'];
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return { kind: 'bearer', token: authorization.slice(7) };
  }
  return { kind: 'none' };
}

/**
 * How long a verified identity is reused.
 *
 * Revocation is NOT pushed into this cache; it lives with the window. Access
 * ends through several doors: a key revoked from /apikeys or /profile, an
 * access key rotated, a user disabled or demoted, a key passing its
 * expiresAt, a row edited directly, or any of those done by another Xenon
 * process sharing the database. A clear-on-revoke hook would cover only the
 * doors someone remembered to wire, and would still read as "instant". A
 * uniform bound is honest about all of them: whatever ends a credential's
 * access, commands stop within 30 s. A key's own expiresAt and a token's exp
 * also cap an entry, so the cache never outlives the credential.
 *
 * REST re-verifies on every request, and createSession verifies the
 * credentials it is given, so only in-session commands see the window.
 */
export const CALLER_CACHE_TTL_MS = 30_000;

/** Distinct live credentials remembered at once. Oldest go first. */
export const CALLER_CACHE_MAX_ENTRIES = 1_000;

interface VerifierDeps {
  verifyKeyPair: typeof verifyKeyPairCredential;
  verifyBearer: typeof verifyBearerCredential;
  now: () => number;
  ttlMs: number;
  maxEntries: number;
}

interface CacheEntry {
  caller: CommandCaller;
  expiresAt: number;
}

/**
 * Verifies a presented credential and remembers the answer.
 *
 * The cache key is a SHA-256 of the presented secret, never the secret: for a
 * pair it covers the access key as well as the token (keying on the token
 * alone would let a wrong access key ride a cached right one), and each kind
 * is prefixed so a pair and a token can never collide. Only verified
 * identities are cached. A wrong credential is looked up again next time, and
 * a check that could not run throws to the caller and caches nothing.
 */
export class CommandCallerVerifier {
  private readonly deps: VerifierDeps;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(deps: Partial<VerifierDeps> = {}) {
    this.deps = {
      verifyKeyPair: verifyKeyPairCredential,
      verifyBearer: verifyBearerCredential,
      now: Date.now,
      ttlMs: CALLER_CACHE_TTL_MS,
      maxEntries: CALLER_CACHE_MAX_ENTRIES,
      ...deps,
    };
  }

  async verify(credential: Exclude<PresentedCredential, { kind: 'none' }>): Promise<CallerVerdict> {
    const key = cacheKey(credential);
    const now = this.deps.now();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) return { valid: true, caller: hit.caller };
    if (hit) this.cache.delete(key);

    const verified = await this.check(credential);
    if (!verified) return { valid: false };

    const expiresAt = Math.min(now + this.deps.ttlMs, verified.credentialExpiresAt ?? Infinity);
    if (expiresAt > now) this.remember(key, { caller: verified.caller, expiresAt }, now);
    return { valid: true, caller: verified.caller };
  }

  private async check(
    credential: Exclude<PresentedCredential, { kind: 'none' }>,
  ): Promise<{ caller: CommandCaller; credentialExpiresAt?: number } | null> {
    if (credential.kind === 'key-pair') {
      const out = await this.deps.verifyKeyPair(credential.accessKey, credential.token);
      if (!out) return null;
      return {
        caller: {
          userId: out.user.id,
          overrideAdmin: canOverrideLease({
            kind: 'api-key',
            scopes: out.row.scopes,
            user: out.user,
          }),
        },
        credentialExpiresAt: out.row.expiresAt ? new Date(out.row.expiresAt).getTime() : undefined,
      };
    }

    const out = await this.deps.verifyBearer(credential.token);
    if (!out) return null;
    // A Bearer token carries the scopes of the credential that minted it
    // (/auth/token), so it is judged like a key. Judging it by role alone,
    // as a xenon-session token is for leases, would let an ADMIN's ordinary
    // key mint its way to an override.
    return {
      caller: {
        userId: out.user.id,
        overrideAdmin: canOverrideLease({
          kind: 'api-key',
          scopes: String(out.payload.scopes ?? ''),
          user: out.user,
        }),
      },
      credentialExpiresAt: typeof out.payload.exp === 'number' ? out.payload.exp * 1000 : undefined,
    };
  }

  private remember(key: string, entry: CacheEntry, now: number): void {
    this.cache.delete(key);
    if (this.cache.size >= this.deps.maxEntries) {
      for (const [k, e] of this.cache) if (e.expiresAt <= now) this.cache.delete(k);
    }
    while (this.cache.size >= this.deps.maxEntries) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
    this.cache.set(key, entry);
  }
}

function cacheKey(credential: Exclude<PresentedCredential, { kind: 'none' }>): string {
  const material =
    credential.kind === 'key-pair'
      ? `key-pair\0${credential.accessKey}\0${credential.token}`
      : `bearer\0${credential.token}`;
  return createHash('sha256').update(material).digest('hex');
}
