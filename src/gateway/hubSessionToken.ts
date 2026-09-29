import { Container, Service } from 'typedi';
import * as jose from 'jose';
import log from '../logger';
import { JwtKeyService } from '../services/token/JwtKeyService';

/**
 * The credential a hub's calls to a node carry.
 *
 * Auth is enforced at the hub: it checks the client's credentials, then
 * forwards the command to the node that runs the session. Each instance has
 * its own database, so the node cannot check the client's key itself. It
 * trusts the hub instead: every call the hub makes about a session (forwarded
 * commands, and its own screenshot, source, recording and heartbeat calls)
 * carries a short-lived RS256 token the hub signs for that one session. The
 * node verifies it against the hub's public keys (`/xenon/api/auth/jwks.json`)
 * when its own per-command auth is on.
 *
 * The audience is `xenon-node`, which /auth/token will not mint, and the token
 * names its session (`sid`), so a token for one session opens no other.
 */

export const HUB_TOKEN_HEADER = 'x-xenon-hub-token';
export const HUB_TOKEN_AUDIENCE = 'xenon-node';
export const HUB_TOKEN_TTL_SECONDS = 300;
/** A cached token is re-minted once it has less than this left. */
const RENEW_BEFORE_EXPIRY_MS = 60_000;
const MAX_CACHED_TOKENS = 1_000;
/** Clock skew tolerated between hub and node, as JwtKeyService.verify allows. */
const CLOCK_TOLERANCE_SECONDS = 60;

export interface TokenSigner {
  sign(
    claims: Record<string, unknown>,
    opts: { audience: string; ttlSeconds: number },
  ): Promise<string>;
}

/** Hub side: mints, and reuses, the token for a session. */
@Service()
export class HubSessionTokenIssuer {
  private readonly logger = log.scope('HubSessionToken');
  private readonly cache = new Map<string, { token: string; renewAt: number }>();
  private signer: () => TokenSigner = () => Container.get(JwtKeyService);
  private warned = false;

  /** For tests: sign with this instead of the server's JwtKeyService. */
  useSigner(signer: TokenSigner): void {
    this.signer = () => signer;
    this.cache.clear();
  }

  /**
   * The token for a session, or null when this server cannot sign (its JWT
   * key failed to load). A node with per-command auth off needs none, so the
   * call still goes out; one with it on refuses it, and the warning says why.
   */
  async tokenFor(sessionId: string): Promise<string | null> {
    if (!sessionId) return null;
    const now = Date.now();
    const hit = this.cache.get(sessionId);
    if (hit && hit.renewAt > now) return hit.token;

    let token: string;
    try {
      token = await this.signer().sign(
        { sid: sessionId },
        { audience: HUB_TOKEN_AUDIENCE, ttlSeconds: HUB_TOKEN_TTL_SECONDS },
      );
    } catch (err: any) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          `Cannot sign session tokens for nodes (${err?.message ?? err}). Calls to nodes go ` +
            'without one, and a node with XENON_REQUIRE_COMMAND_AUTH on will refuse them.',
        );
      }
      return null;
    }

    this.cache.delete(sessionId);
    if (this.cache.size >= MAX_CACHED_TOKENS) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
    this.cache.set(sessionId, {
      token,
      renewAt: now + HUB_TOKEN_TTL_SECONDS * 1000 - RENEW_BEFORE_EXPIRY_MS,
    });
    return token;
  }

  forget(sessionId: string): void {
    this.cache.delete(sessionId);
  }
}

/** The hub's public keys, which JwtKeyService serves without a login. */
export function hubJwksUrl(hub: string): URL {
  return new URL('/xenon/api/auth/jwks.json', hub);
}

/** The node could not check a hub token (the hub's keys could not be fetched). */
export class HubTokenUnavailableError extends Error {}

// jose's codes for a token that was checked and is not good: forged, expired,
// for another audience, malformed, or signed by a key the hub does not have.
// Anything else (the key set could not be fetched, or was not a key set) means
// the check did not run.
const VERDICT_CODES = new Set([
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED',
]);

function isVerdict(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (typeof code !== 'string') return false;
  return code.startsWith('ERR_JWT_') || code.startsWith('ERR_JWS_') || VERDICT_CODES.has(code);
}

/**
 * Node side: is this a token the hub signed for this session?
 *
 * Resolves false for any token that is not (forged, expired, another
 * session's, another audience's), and throws HubTokenUnavailableError when
 * the hub's keys cannot be fetched, so the caller can answer 503 rather than
 * pretend the token was checked. jose caches the key set, refetching it when
 * a token names a key it does not have (a hub that rotated its key).
 */
export class HubSessionTokenVerifier {
  private readonly keys: jose.JWTVerifyGetKey;

  constructor(hubUrl: string, keys?: jose.JWTVerifyGetKey) {
    this.keys =
      keys ??
      jose.createRemoteJWKSet(hubJwksUrl(hubUrl), {
        timeoutDuration: 5_000,
        cooldownDuration: 30_000,
        cacheMaxAge: 10 * 60_000,
      });
  }

  async verify(token: string, sessionId: string): Promise<boolean> {
    try {
      const { payload } = await jose.jwtVerify(token, this.keys, {
        audience: HUB_TOKEN_AUDIENCE,
        algorithms: ['RS256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      return typeof payload.sid === 'string' && payload.sid === sessionId;
    } catch (err: any) {
      if (isVerdict(err)) return false;
      throw new HubTokenUnavailableError(err?.message ?? String(err));
    }
  }
}
