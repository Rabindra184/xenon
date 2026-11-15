import { createHash, timingSafeEqual } from 'crypto';
import type { Response } from 'express';
import { Container } from 'typedi';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  InvalidGrantError,
  InvalidRequestError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
  ServerError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { UserService } from '../UserService';
import { JwtKeyService } from '../token/JwtKeyService';
import { McpGrant, mcpScopesAllowedBy, resolveMcpGrant } from '../token/mcpScopes';
import { mcpTokenClaims } from '../token/mcpTokenClaims';
import { scopesForRole } from '../../middleware/authMiddleware';
import { verifyBearerCredential } from '../../middleware/verifyCredential';
import { AuthCodes } from './authCodes';
import { ClientStore } from './clientStore';
import { GrantStore } from './grantStore';

/** An access token from browser sign-in lasts an hour. */
export const OAUTH_ACCESS_TOKEN_TTL_SEC = 3600;

/** A PKCE verifier (RFC 7636 §4.1): 43 to 128 unreserved characters. */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';

/**
 * The MCP scopes a user's agent is granted: those asked for that the user's
 * role allows (scopesForRole), anything else dropped; the default set
 * (DEFAULT_MCP_SCOPES) when none were asked for. `invalid_scope` when some
 * were asked for and none can be granted.
 */
export function grantForRole(role: string, requested: string[]): McpGrant {
  const flat = scopesForRole(role as Role);
  const asked = requested.filter(Boolean);
  if (asked.length === 0) return resolveMcpGrant(flat);
  const allowed = mcpScopesAllowedBy(flat);
  const kept = [...new Set(asked.filter((s) => allowed.has(s)))];
  if (kept.length === 0) {
    throw new InvalidScopeError('None of the scopes asked for can be granted to this user');
  }
  return resolveMcpGrant(flat, kept);
}

/** A resource URL as compared: no fragment, no trailing slash. */
function comparableResource(value: string): string {
  const hash = value.indexOf('#');
  return (hash === -1 ? value : value.slice(0, hash)).replace(/\/$/, '');
}

function verifierMatches(verifier: string | undefined, challenge: string): boolean {
  if (!verifier || !VERIFIER.test(verifier)) return false;
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/** Where the authorize step goes on: the hub's sign-in and consent (Task 6's routes). */
export type BeginAuthorization = (
  client: OAuthClientInformationFull,
  params: AuthorizationParams,
  res: Response,
) => Promise<void>;

export interface XenonOAuthProviderOptions {
  clients?: ClientStore;
  codes?: AuthCodes;
  grants?: GrantStore;
  beginAuthorization?: BeginAuthorization;
  /**
   * Whether a refresh's `resource` names this hub (the token route knows the
   * request). Without it a refresh's `resource` isn't checked here.
   */
  resourceMatches?: (resource: URL) => boolean;
}

/**
 * The hub as an OAuth 2.1 authorization server for agents (the SDK's
 * OAuthServerProvider), behind the SDK's own route handlers.
 *
 * - PKCE S256 is checked here, not by the SDK's token handler
 *   (`skipLocalPkceValidation`), so a code is looked up, used and checked in
 *   one step: any failed exchange uses the code up, and a code exchanged
 *   twice revokes the grant the first exchange made.
 * - Access tokens are the `xenon-mcp` JWTs POST /auth/token mints
 *   (mcpTokenClaims), for an hour, carrying the grant's id (`gid`), with the
 *   scopes asked for cut to the user's role, looked up at every exchange.
 * - Refresh tokens rotate on every use (GrantStore).
 */
export class XenonOAuthProvider implements OAuthServerProvider {
  readonly skipLocalPkceValidation = true;
  private readonly clients: ClientStore;
  private readonly codes: AuthCodes;
  private readonly grants: GrantStore;
  private readonly beginAuthorization?: BeginAuthorization;
  private readonly resourceMatches?: (resource: URL) => boolean;

  constructor(opts: XenonOAuthProviderOptions = {}) {
    this.clients = opts.clients ?? Container.get(ClientStore);
    this.codes = opts.codes ?? Container.get(AuthCodes);
    this.grants = opts.grants ?? Container.get(GrantStore);
    this.beginAuthorization = opts.beginAuthorization;
    this.resourceMatches = opts.resourceMatches;
  }

  get clientsStore(): ClientStore {
    return this.clients;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    if (!S256_CHALLENGE.test(params.codeChallenge)) {
      throw new InvalidRequestError('code_challenge must be an S256 challenge');
    }
    if (!this.beginAuthorization) {
      throw new ServerError('Sign-in for agents is not set up on this server');
    }
    await this.beginAuthorization(client, params, res);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const code = this.codes.peek(authorizationCode);
    if (!code || code.clientId !== client.client_id) {
      throw new InvalidGrantError('The authorization code is not valid');
    }
    return code.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    // Synchronous: a second exchange of this code, even one already running,
    // finds it used.
    // Nothing is used up when no token could be signed: the agent can try again.
    this.assertCanSign();
    const taken = this.codes.take(authorizationCode);
    if (taken.kind === 'unknown')
      throw new InvalidGrantError('The authorization code is not valid');
    if (taken.kind === 'used') {
      const grantId = await taken.grantId;
      if (grantId) await this.grants.revoke(grantId, 'authorization_code_reused');
      throw new InvalidGrantError('The authorization code was already used');
    }
    let grantId: string | undefined;
    try {
      const code = taken.code;
      if (code.clientId !== client.client_id) {
        throw new InvalidGrantError('The authorization code is not valid');
      }
      if (redirectUri !== undefined && redirectUri !== code.redirectUri) {
        throw new InvalidGrantError('redirect_uri is not the one the code was issued for');
      }
      if (!verifierMatches(codeVerifier, code.codeChallenge)) {
        throw new InvalidGrantError('code_verifier does not match the challenge');
      }
      if (resource && comparableResource(resource.href) !== comparableResource(code.resource)) {
        throw new InvalidTargetError('resource is not the one the code was issued for');
      }
      const user = await this.activeUser(code.userId);
      const grant = grantForRole(user.role, code.scopes);
      const created = await this.grants.create(user.id, client.client_id, grant.granular);
      grantId = created.grantId;
      await this.clients.noteUsed(client.client_id);
      return {
        ...(await this.accessToken(user, grant, created.grantId)),
        refresh_token: created.refreshToken,
      };
    } finally {
      taken.settle(grantId);
    }
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    this.assertCanSign();
    // Before the token is used, so a wrong resource keeps it.
    if (resource && this.resourceMatches && !this.resourceMatches(resource)) {
      throw new InvalidTargetError("resource is not this hub's MCP endpoint");
    }
    const narrowed = scopes?.filter(Boolean) ?? [];
    if (narrowed.length > 0) {
      // Checked before the token is used, so a refused narrowing keeps it. A
      // spent token goes on to rotate, which revokes its grant.
      const current = await this.grants.grantOfRefreshToken(refreshToken);
      if (current && !current.spent && current.clientId === client.client_id) {
        const extra = narrowed.filter((s) => !current.scopes.includes(s));
        if (extra.length > 0) {
          throw new InvalidScopeError(`A refresh can't add scopes: ${extra.join(', ')}`);
        }
      }
    }
    const rotated = await this.grants.rotate(refreshToken, { clientId: client.client_id });
    if (rotated === 'reused') {
      throw new InvalidGrantError('The refresh token was already used; this sign-in is revoked');
    }
    if (rotated === 'invalid') throw new InvalidGrantError('The refresh token is not valid');
    let user;
    try {
      user = await this.activeUser(rotated.userId);
    } catch (err) {
      await this.grants.revoke(rotated.grantId, 'user_not_active');
      throw err;
    }
    const grant = grantForRole(user.role, narrowed.length > 0 ? narrowed : rotated.scopes);
    await this.clients.noteUsed(client.client_id);
    return {
      ...(await this.accessToken(user, grant, rotated.grantId)),
      refresh_token: rotated.refreshToken,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const verified = await verifyBearerCredential(token);
    if (!verified) throw new InvalidTokenError('The access token is not valid');
    const { payload } = verified;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes('xenon-mcp'))
      throw new InvalidTokenError('The access token is not an MCP token');
    const gid = typeof payload.gid === 'string' && payload.gid ? payload.gid : undefined;
    let clientId = '';
    if (gid) {
      const grant = await this.grants.find(gid);
      if (!grant) throw new InvalidTokenError('The access token names no sign-in');
      clientId = grant.clientId;
    }
    return {
      token,
      clientId,
      scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
      ...(typeof payload.exp === 'number' ? { expiresAt: payload.exp } : {}),
      extra: { userId: verified.user.id, ...(gid ? { grantId: gid } : {}) },
    };
  }

  /**
   * RFC 7009: a refresh or access token of this client revokes its grant.
   * Anything else (another client's, an unknown token) does nothing.
   */
  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    const byRefresh = await this.grants.grantOfRefreshToken(request.token);
    if (byRefresh) {
      if (byRefresh.clientId === client.client_id) {
        await this.grants.revoke(byRefresh.id, 'client_revoked');
      }
      return;
    }
    if (request.token.split('.').length !== 3) return;
    let gid: unknown;
    try {
      gid = (await Container.get(JwtKeyService).verify(request.token, { audience: 'xenon-mcp' }))
        .gid;
    } catch {
      return;
    }
    if (typeof gid !== 'string' || !gid) return;
    const grant = await this.grants.find(gid);
    if (grant && grant.clientId === client.client_id) {
      await this.grants.revoke(grant.id, 'client_revoked');
    }
  }

  /** The signing key loaded at boot; else a sign-in would spend a code or token for nothing. */
  private assertCanSign(): void {
    if (!Container.get(JwtKeyService).ready) {
      throw new ServerError('This server cannot sign tokens right now');
    }
  }

  private async activeUser(userId: string): Promise<{ id: string; role: string }> {
    const user = await Container.get(UserService).findById(userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new InvalidGrantError('The signed-in user is no longer active');
    }
    return user;
  }

  private async accessToken(
    user: { id: string; role: string },
    grant: McpGrant,
    grantId: string,
  ): Promise<Omit<OAuthTokens, 'refresh_token'>> {
    const accessToken = await Container.get(JwtKeyService).sign(
      mcpTokenClaims({ userId: user.id, role: user.role, teamId: null }, grant, { grantId }),
      { audience: 'xenon-mcp', ttlSeconds: OAUTH_ACCESS_TOKEN_TTL_SEC },
    );
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: OAUTH_ACCESS_TOKEN_TTL_SEC,
      scope: grant.granular.join(' '),
    };
  }
}
