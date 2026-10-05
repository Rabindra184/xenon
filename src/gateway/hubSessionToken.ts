import { randomUUID } from 'crypto';
import { Container, Service } from 'typedi';
import * as jose from 'jose';
import log from '../logger';
import { JwtKeyService } from '../services/token/JwtKeyService';
import { SingleUseLedger } from '../services/token/singleUseLedger';
import { proxyAgentFor } from '../helpers/outboundProxy';

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
 *
 * A create has no session yet, so it carries a token of its own kind:
 * audience `xenon-node-create`, naming the owner the hub verified (`sub`,
 * absent when the create is unattributed), the phone the hub allocated
 * (`udid`) and that phone's node (`host`, the phone row's host). A separate
 * audience rather than a claim on the `xenon-node` token, so neither kind can
 * be taken for the other whatever claims a verifier reads: jose refuses the
 * other kind's audience before any claim is looked at. The node treats a valid
 * one as the session's credential (sessionCreate.ts).
 *
 * A hub's own device-control call to a node's phone (`/xenon/api/control/
 * <udid>/tap`, swipe, text, keyevent, touchAndHold, which the hub forwards to
 * the phone's node) carries a third kind: audience `xenon-node-control`, one
 * minute, naming the hub user it acts for (`sub`), whether they are an admin
 * (`adm`), the phone (`udid`) and its node (`host`). The hub checked the
 * caller, the team rule and ownership before forwarding. The node accepts it
 * only for `/control` on that phone (authMiddleware), then runs its own
 * ownership guard with that user.
 *
 * A create token is single-use. The hub sends a create once (it is not safe
 * to repeat), and each token has its own id (`jti`), which the node's
 * verifier remembers until the token expires: the same token again is
 * refused. A token with no id, from a hub before this rule, is accepted as
 * before, without that check.
 */

export const HUB_TOKEN_HEADER = 'x-xenon-hub-token';
export const HUB_TOKEN_AUDIENCE = 'xenon-node';
export const HUB_TOKEN_TTL_SECONDS = 300;
export const HUB_CREATE_AUDIENCE = 'xenon-node-create';
/**
 * Long enough for the create to reach the node, which checks the token as the
 * request arrives; short enough that a copied token is soon worthless. It
 * opens one phone, on one node, once.
 */
export const HUB_CREATE_TTL_SECONDS = 120;
export const HUB_CONTROL_AUDIENCE = 'xenon-node-control';
/** A forwarded tap is sent at once; a minute covers clock skew and a slow node. */
export const HUB_CONTROL_TTL_SECONDS = 60;
/** A cached token is re-minted once it has less than this left. */
const RENEW_BEFORE_EXPIRY_MS = 60_000;
const MAX_CACHED_TOKENS = 1_000;
/** Clock skew tolerated between hub and node, as JwtKeyService.verify allows. */
const CLOCK_TOLERANCE_SECONDS = 60;

export interface TokenSigner {
  sign(
    claims: Record<string, unknown>,
    opts: { audience: string; ttlSeconds: number; jti?: string },
  ): Promise<string>;
}

/** What a hub's create token grants: this owner, on this phone, on this node. */
export interface HubCreateGrant {
  /** The owner the hub verified; null for an unattributed create. */
  userId: string | null;
  /** The phone the hub allocated. */
  udid: string;
  /** Its node, as the phone row's host names it. */
  host: string;
}

/** What a hub's control token grants: this user, admin or not, on this phone of this node. */
export interface HubControlGrant {
  /** The hub user the call acts for. */
  userId: string;
  /** Whether they are an admin on the hub (resolveActor). */
  isAdmin: boolean;
  udid: string;
  /** The phone's node, as the hub's phone row names it. */
  host: string;
}

/** Hub side: mints a session's token (reused while it lasts), a create's and a control call's (fresh each time). */
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
      this.warnCannotSign(err);
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

  /**
   * The token for a create the hub forwards to the phone's node, or null when
   * this server cannot sign. Minted fresh for each create, never cached, with
   * an id of its own: the node takes it once.
   */
  async createTokenFor(grant: HubCreateGrant): Promise<string | null> {
    const claims: Record<string, unknown> = { udid: grant.udid, host: grant.host };
    if (grant.userId) claims.sub = grant.userId;
    try {
      return await this.signer().sign(claims, {
        audience: HUB_CREATE_AUDIENCE,
        ttlSeconds: HUB_CREATE_TTL_SECONDS,
        jti: randomUUID(),
      });
    } catch (err: any) {
      this.warnCannotSign(err);
      return null;
    }
  }

  /**
   * The token for a device-control call the hub forwards to the phone's
   * node, or null when this server cannot sign. Fresh for each call.
   */
  async controlTokenFor(grant: HubControlGrant): Promise<string | null> {
    try {
      return await this.signer().sign(
        { sub: grant.userId, adm: grant.isAdmin, udid: grant.udid, host: grant.host },
        { audience: HUB_CONTROL_AUDIENCE, ttlSeconds: HUB_CONTROL_TTL_SECONDS },
      );
    } catch (err: any) {
      this.warnCannotSign(err);
      return null;
    }
  }

  private warnCannotSign(err: any): void {
    if (this.warned) return;
    this.warned = true;
    this.logger.warn(
      `Cannot sign session tokens for nodes (${err?.message ?? err}). Calls to nodes go ` +
        'without one, and a node with XENON_REQUIRE_COMMAND_AUTH or ' +
        'XENON_REQUIRE_SESSION_TOKEN on will refuse them.',
    );
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
  /** The create tokens already taken, by id, until each one expires. */
  private readonly usedCreates = new SingleUseLedger(HUB_CREATE_TTL_SECONDS);

  constructor(hubUrl: string, keys?: jose.JWTVerifyGetKey) {
    const jwksUrl = hubJwksUrl(hubUrl);
    this.keys =
      keys ??
      jose.createRemoteJWKSet(jwksUrl, {
        timeoutDuration: 5_000,
        cooldownDuration: 30_000,
        cacheMaxAge: 10 * 60_000,
        // The proxy the node's axios calls to its hub take; jose's own fetch
        // takes none.
        agent: proxyAgentFor(jwksUrl),
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

  /**
   * The grant in a hub's create token, or null for any token that is not one
   * (forged, expired, another audience's, missing the phone or its node, or
   * already taken: a create token is taken once). Throws
   * HubTokenUnavailableError when the hub's keys cannot be fetched.
   */
  async verifyCreate(token: string): Promise<HubCreateGrant | null> {
    let payload: jose.JWTPayload;
    try {
      ({ payload } = await jose.jwtVerify(token, this.keys, {
        audience: HUB_CREATE_AUDIENCE,
        algorithms: ['RS256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      }));
    } catch (err: any) {
      if (isVerdict(err)) return null;
      throw new HubTokenUnavailableError(err?.message ?? String(err));
    }
    const nonEmpty = (value: unknown): value is string =>
      typeof value === 'string' && value.length > 0;
    if (!nonEmpty(payload.udid) || !nonEmpty(payload.host)) return null;
    if (nonEmpty(payload.jti)) {
      try {
        this.usedCreates.consume(payload);
      } catch {
        return null;
      }
    }
    return {
      userId: nonEmpty(payload.sub) ? payload.sub : null,
      udid: payload.udid,
      host: payload.host,
    };
  }

  /**
   * The grant in a hub's control token, or null for any token that is not
   * one (forged, expired, another audience's, missing the user, the phone or
   * its node). Throws HubTokenUnavailableError when the hub's keys cannot be
   * fetched.
   */
  async verifyControl(token: string): Promise<HubControlGrant | null> {
    let payload: jose.JWTPayload;
    try {
      ({ payload } = await jose.jwtVerify(token, this.keys, {
        audience: HUB_CONTROL_AUDIENCE,
        algorithms: ['RS256'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      }));
    } catch (err: any) {
      if (isVerdict(err)) return null;
      throw new HubTokenUnavailableError(err?.message ?? String(err));
    }
    const nonEmpty = (value: unknown): value is string =>
      typeof value === 'string' && value.length > 0;
    if (!nonEmpty(payload.sub) || !nonEmpty(payload.udid) || !nonEmpty(payload.host)) return null;
    return {
      userId: payload.sub,
      isAdmin: payload.adm === true,
      udid: payload.udid,
      host: payload.host,
    };
  }
}
