import { AsyncLocalStorage } from 'async_hooks';
import express, { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { Container } from 'typedi';
import type { AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import {
  InvalidRequestError,
  InvalidScopeError,
  InvalidTargetError,
  OAuthError,
  ServerError,
  TooManyRequestsError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import log from '../../logger';
import { config } from '../../config';
import type { IPluginArgs } from '../../interfaces/IPluginArgs';
import {
  RESOURCE_METADATA_PATH,
  mcpResourceUrl,
  publicOrigin,
  servesMcp,
} from '../../mcp/publicOrigin';
import { XenonOAuthProvider, grantForRole } from '../../services/oauth/oauthProvider';
import { ClientStore } from '../../services/oauth/clientStore';
import { AuthCodes } from '../../services/oauth/authCodes';
import { PendingAuthorizations } from '../../services/oauth/pendingAuthorizations';
import { RequestLimiter, callerAddress, requestLimiter } from '../../services/oauth/callerAddress';
import { ALL_GRANULAR_SCOPES } from '../../services/token/mcpScopes';
import { UserSessionService } from '../../services/UserSessionService';
import { dashboardSessionIdOf } from '../../middleware/authMiddleware';
import { GrantStore } from '../../services/oauth/grantStore';
import { roleGuard } from '../../middleware/roleGuard';
import { scopeGuard } from '../../middleware/scopeGuard';

const logger = log.scope('OAuthRoutes');

/** Where the sign-in routes are, under the server's origin. */
const OAUTH_BASE = '/xenon/api/oauth';
/** The dashboard's consent page, under its `/xenon` base path. */
const CONSENT_PAGE = '/oauth/consent';
const PROTECTED_RESOURCE_ROOT = '/.well-known/oauth-protected-resource';
const AUTHORIZATION_SERVER_METADATA = '/.well-known/oauth-authorization-server';

/**
 * How often one address may call each route (`requestLimiter`, keyed by
 * `callerAddress`): the SDK handlers' own defaults, counted by the caller's
 * address as trustProxy reads it. The SDK's own limiters are turned off.
 */
const LIMITS = {
  register: {
    windowMs: 60 * 60_000,
    max: 20,
    message: 'Too many agent registrations from this address',
  },
  authorize: {
    windowMs: 15 * 60_000,
    max: 100,
    message: 'Too many sign-in requests from this address',
  },
  token: { windowMs: 15 * 60_000, max: 50, message: 'Too many token requests from this address' },
  revoke: { windowMs: 15 * 60_000, max: 50, message: 'Too many revocations from this address' },
};

/** Every limiter the sign-in routes made, so a spec can start from none counted. */
const limiters: RequestLimiter[] = [];

function limiter(limit: (typeof LIMITS)[keyof typeof LIMITS]): RequestLimiter {
  const made = requestLimiter(limit);
  limiters.push(made);
  return made;
}

/**
 * Forget every request the sign-in routes' limiters have counted. For specs:
 * the limiters live as long as the process's API router, so one spec's
 * requests would otherwise count against the next one's.
 */
export function resetOAuthRateLimits(): void {
  for (const made of limiters) made.reset();
}

/**
 * Whether this server signs agents in: a hub or a standalone server
 * (servesMcp), and only with auth on. With auth disabled there is no sign-in
 * and no metadata (tools act as the synthetic SUPER_ADMIN, as REST does).
 * Read per request, since auth can be turned off in place.
 */
function signInServed(_req: Request, _res: Response, next: NextFunction): void {
  if (config.authDisabled === true) return next('router');
  next();
}

/** A resource URL as compared: parsed, no fragment, no trailing slash. */
function canonicalResource(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** Whether `value` names this hub's MCP endpoint, with or without a trailing slash. */
function isThisHub(value: string, req: Request): boolean {
  const asked = canonicalResource(value);
  return asked !== null && asked === canonicalResource(mcpResourceUrl(req));
}

function invalidTarget(req: Request): InvalidTargetError {
  return new InvalidTargetError(`resource must be this hub's MCP endpoint, ${mcpResourceUrl(req)}`);
}

// ---------------------------------------------------------------------------
// The provider the SDK's handlers are built with, once: it looks its stores
// up per call, so they are the container's at that moment.
// ---------------------------------------------------------------------------

const clientsStore: OAuthRegisteredClientsStore = {
  getClient: (clientId) => Container.get(ClientStore).getClient(clientId),
};

/** The token request being answered, so the provider can check a refresh's `resource`. */
const tokenRequest = new AsyncLocalStorage<Request>();

function currentProvider(): XenonOAuthProvider {
  return new XenonOAuthProvider({
    beginAuthorization,
    resourceMatches: (resource) => {
      const req = tokenRequest.getStore();
      return req !== undefined && isThisHub(resource.href, req);
    },
  });
}

const provider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore;
  },
  skipLocalPkceValidation: true,
  authorize: (client, params, res) => currentProvider().authorize(client, params, res),
  challengeForAuthorizationCode: (client, code) =>
    currentProvider().challengeForAuthorizationCode(client, code),
  exchangeAuthorizationCode: (client, code, verifier, redirectUri, resource) =>
    currentProvider().exchangeAuthorizationCode(client, code, verifier, redirectUri, resource),
  exchangeRefreshToken: (client, token, scopes, resource) =>
    currentProvider().exchangeRefreshToken(client, token, scopes, resource),
  verifyAccessToken: (token) => currentProvider().verifyAccessToken(token),
  revokeToken: (client, request) => currentProvider().revokeToken(client, request),
};

/**
 * An OAuth error answered to the browser itself, never by a redirect: before
 * the user has consented, the hub sends a browser only to its own pages. A
 * self-registered agent may name any https redirect URI, and an automatic
 * redirect there on an error would make the hub an open redirector (RFC 9700
 * §4.11.2).
 */
function answerDirectly(res: Response, err: unknown): void {
  const error =
    err instanceof OAuthError ? err : new ServerError('The sign-in could not be started');
  if (!(err instanceof OAuthError)) {
    logger.error(`authorize failed: ${(err as Error)?.message ?? err}`);
  }
  res.setHeader('Cache-Control', 'no-store');
  if (error instanceof TooManyRequestsError) res.setHeader('Retry-After', '60');
  const status =
    error instanceof TooManyRequestsError ? 429 : error instanceof ServerError ? 500 : 400;
  res.status(status).json(error.toResponseObject());
}

const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/**
 * The authorize parameters the SDK would otherwise refuse by redirecting to
 * the agent (its second phase), checked first and refused here, `400`. The
 * SDK's first phase (the client and its redirect URI) already answers
 * directly.
 */
function refuseBadAuthorizeRequests(req: Request, res: Response, next: NextFunction): void {
  const q = req.query as Record<string, unknown>;
  const optionalString = (v: unknown) => v === undefined || typeof v === 'string';
  let problem: OAuthError | undefined;
  if (q.response_type !== 'code') {
    problem = new InvalidRequestError('response_type must be code');
  } else if (q.code_challenge_method !== 'S256') {
    problem = new InvalidRequestError('code_challenge_method must be S256');
  } else if (typeof q.code_challenge !== 'string' || !S256_CHALLENGE.test(q.code_challenge)) {
    problem = new InvalidRequestError('code_challenge must be an S256 challenge');
  } else if (!optionalString(q.scope) || !optionalString(q.state)) {
    problem = new InvalidRequestError('scope and state may be given once each');
  } else if (
    q.resource !== undefined &&
    (typeof q.resource !== 'string' || !isThisHub(q.resource, req))
  ) {
    problem = invalidTarget(req);
  }
  if (problem) return answerDirectly(res, problem);
  next();
}

/**
 * The authorize step after the SDK has checked the client and its redirect
 * URI: the `resource` must be this hub, then the request waits for the user's
 * consent. A signed-in browser goes to the consent page, any other to the
 * dashboard's sign-in first, which comes back to it. Both are paths, so the
 * browser stays on the host it reached the hub at. Never throws: a failure
 * here is answered directly (answerDirectly), since a throw would become the
 * SDK's redirect to the agent.
 */
async function beginAuthorization(
  client: OAuthClientInformationFull,
  params: AuthorizationParams,
  res: Response,
): Promise<void> {
  const req = res.req as Request;
  try {
    const resource = canonicalResource(mcpResourceUrl(req));
    if (!resource || (params.resource && !isThisHub(params.resource.href, req))) {
      throw invalidTarget(req);
    }
    const pending = Container.get(PendingAuthorizations).add(
      {
        clientId: client.client_id,
        clientName: client.client_name || client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        scopes: params.scopes ?? [],
        ...(params.state !== undefined ? { state: params.state } : {}),
        resource,
      },
      callerAddress(req),
    );
    const consentPage = `${CONSENT_PAGE}/${pending.id}`;
    const signedIn = await hasDashboardSession(req);
    res.redirect(
      302,
      signedIn ? `/xenon${consentPage}` : `/xenon/login?next=${encodeURIComponent(consentPage)}`,
    );
  } catch (err) {
    answerDirectly(res, err);
  }
}

/**
 * Whether the browser carries a live dashboard sign-in. A hint for where to
 * send it, nothing more: the consent routes check the sign-in themselves. The
 * cookie is SameSite=Strict, so a browser sent here from another site may
 * not carry it; it then goes to the sign-in page.
 */
async function hasDashboardSession(req: Request): Promise<boolean> {
  const id = dashboardSessionIdOf(req);
  if (!id) return false;
  try {
    return (await Container.get(UserSessionService).resolve(id, { renew: false })) !== null;
  } catch {
    return false;
  }
}

const urlencoded = express.urlencoded({ extended: false });

/**
 * The token request's form, for the `resource` check. On Appium's server
 * Appium's own parser has read it already (its body-parser 2 doesn't mark the
 * request as Express 4's checks, so reading it again throws "stream is not
 * readable"); alone, as in a spec's app, nothing has.
 */
function readForm(req: Request, res: Response, next: NextFunction): void {
  if (!req.readable) return next();
  urlencoded(req, res, next);
}

/** The token request's `resource`, when it names something else: refused before the code or token is looked at. */
function refuseOtherResources(req: Request, res: Response, next: NextFunction): void {
  const resource = (req.body as { resource?: unknown } | undefined)?.resource;
  if (resource === undefined || (typeof resource === 'string' && isThisHub(resource, req))) {
    return next();
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(400).json(invalidTarget(req).toResponseObject());
}

/**
 * The SDK's registration handler for this caller: its store counts the
 * registration against the caller's address (ClientStore.forAddress), read
 * through `trust proxy`. Built per request for that; its own limiter is off,
 * since a limiter built per request would count nothing.
 */
const registerForCaller: RequestHandler = (req, res, next) =>
  clientRegistrationHandler({
    clientsStore: Container.get(ClientStore).forAddress(callerAddress(req)),
    rateLimit: false,
  })(req, res, next);

/**
 * The public sign-in routes for agents, added to `router`, which the API
 * router mounts at `/oauth` ahead of the CSRF check and the login (an agent's
 * token call has no Origin and no credential but PKCE): register (RFC 7591),
 * authorize, token and revoke, each the SDK's handler behind a limit per
 * caller address.
 */
export function registerOAuthRoutes(router: Router, pluginArgs: IPluginArgs): void {
  if (!servesMcp(pluginArgs)) return;
  const authorize = authorizationHandler({ provider, rateLimit: false });
  const token = tokenHandler({ provider, rateLimit: false });
  const revoke = revocationHandler({ provider, rateLimit: false });

  const register = express.Router();
  register.use(signInServed);
  register.post('/', limiter(LIMITS.register), registerForCaller);
  router.use('/register', register);

  const authorizeRoute = express.Router();
  authorizeRoute.use(signInServed);
  authorizeRoute.get('/', limiter(LIMITS.authorize), refuseBadAuthorizeRequests, authorize);
  router.use('/authorize', authorizeRoute);

  const tokenRoute = express.Router();
  tokenRoute.use(signInServed);
  tokenRoute.post('/', limiter(LIMITS.token), readForm, refuseOtherResources, (req, res, next) =>
    tokenRequest.run(req, () => token(req, res, next)),
  );
  router.use('/token', tokenRoute);

  const revokeRoute = express.Router();
  revokeRoute.use(signInServed);
  revokeRoute.post('/', limiter(LIMITS.revoke), revoke);
  router.use('/revoke', revokeRoute);
}

// ---------------------------------------------------------------------------
// Consent: the dashboard's page, as the signed-in user
// ---------------------------------------------------------------------------

/** Consent is the person's, in the browser: a dashboard sign-in (the cookie), never a token. */
function dashboardUserOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.kind === 'user-session') return next();
  res.status(403).json({
    error: 'dashboard_sign_in_required',
    message: 'Allow or deny an agent from the dashboard, signed in',
  });
}

function notFound(res: Response): void {
  res.status(404).json({ error: 'not_found', message: 'Sign-in request not found' });
}

/** Where the browser goes back to the agent: its redirect URI with these parameters. */
function backToAgent(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(name, value);
  }
  return url.href;
}

/**
 * The consent routes, added to `router`, which the API router mounts at
 * `/oauth` after the CSRF check and the login (`authMiddleware`): the
 * dashboard reads a waiting request and posts the user's answer.
 *
 * - `GET /oauth/consent/:requestId`: the agent's name, this hub, the redirect
 *   URI and the scopes this user would grant (those asked for, cut to the
 *   user's role).
 * - `POST /oauth/consent/:requestId` `{ allow }`: answers once.
 *   `{ redirectTo }`, where the browser goes back to the agent: a code, or
 *   `error=access_denied`. JSON, not a redirect: a page's fetch can't follow
 *   one to an app's own scheme or a loopback port.
 */
export function registerOAuthConsentRoutes(router: Router, pluginArgs: IPluginArgs): void {
  if (!servesMcp(pluginArgs)) return;
  const consent = express.Router();
  consent.use(signInServed);
  consent.use('/consent', dashboardUserOnly);

  consent.get('/consent/:requestId', (req, res) => {
    const pending = Container.get(PendingAuthorizations).get(req.params.requestId);
    if (!pending) return notFound(res);
    let scopes: string[] = [];
    try {
      scopes = grantForRole(req.auth!.role, pending.scopes).granular;
    } catch {
      // None of the asked-for scopes can be granted to this user.
    }
    res.json({
      requestId: pending.id,
      client: { id: pending.clientId, name: pending.clientName },
      hub: publicOrigin(req),
      redirectUri: pending.redirectUri,
      scopes,
      expiresAt: new Date(pending.expiresAt).toISOString(),
    });
  });

  consent.post('/consent/:requestId', (req, res) => {
    const allow = (req.body as { allow?: unknown } | undefined)?.allow;
    if (typeof allow !== 'boolean') {
      return res
        .status(400)
        .json({ error: 'invalid_request', message: '`allow` must be true or false' });
    }
    const requests = Container.get(PendingAuthorizations);
    const pending = requests.take(req.params.requestId);
    if (!pending) return notFound(res);
    const userId = req.auth!.userId;
    if (!allow) {
      logger.info(`user ${userId} denied agent ${pending.clientId}`);
      return res.json({
        redirectTo: backToAgent(pending.redirectUri, {
          error: 'access_denied',
          error_description: 'The user denied the sign-in',
          state: pending.state,
        }),
      });
    }
    try {
      grantForRole(req.auth!.role, pending.scopes);
    } catch (err) {
      if (!(err instanceof InvalidScopeError)) throw err;
      logger.info(`agent ${pending.clientId} asked for no scope user ${userId} may grant`);
      return res.json({
        redirectTo: backToAgent(pending.redirectUri, {
          error: 'invalid_scope',
          error_description: err.message,
          state: pending.state,
        }),
      });
    }
    let code: string;
    try {
      code = Container.get(AuthCodes).issue({
        userId,
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        scopes: pending.scopes,
        resource: pending.resource,
      });
    } catch (err) {
      // The request can be answered again: nothing was issued.
      requests.putBack(pending);
      if (err instanceof TooManyRequestsError) {
        res.setHeader('Retry-After', '60');
        return res.status(429).json(err.toResponseObject());
      }
      if (err instanceof OAuthError) return res.status(400).json(err.toResponseObject());
      throw err;
    }
    logger.info(`user ${userId} allowed agent ${pending.clientId}`);
    res.json({ redirectTo: backToAgent(pending.redirectUri, { code, state: pending.state }) });
  });

  router.use(consent);
  router.use('/grants', grantsRouter());
}

// ---------------------------------------------------------------------------
// Grants: the agents a user has signed in, and revoking them
// ---------------------------------------------------------------------------

/** The one answer for a grant the caller can't revoke: unknown, revoked, or someone else's. */
const GRANT_NOT_FOUND = { error: 'not_found', message: 'Agent sign-in not found' };

/**
 * The signed-in agents (grants), mounted at `/oauth/grants` after the login.
 * Any credential REST takes: they are the caller's own.
 *
 * - `GET /`: the caller's live sign-ins, most recently used first:
 *   `[{ id, clientName, scopes, createdAt, lastUsedAt }]`.
 * - `DELETE /:id`: revoke one (GrantStore.revoke: its tokens stop at once,
 *   its leases end). The caller's own, or any user's for an admin holding
 *   the `admin` scope (holdsAdminScope, the bulk route's rule). Anything else, an unknown or already revoked one, or one
 *   named by a spent refresh token's row, is the same `404`, so nobody learns
 *   whether another user's grant exists.
 * - `DELETE /?userId=`: admins only, every live sign-in of that user:
 *   `{ revoked }`.
 */
/**
 * An ADMIN or SUPER_ADMIN whose credential carries the `admin` scope: what
 * `roleGuard('ADMIN')` plus `scopeGuard(['admin'])` let through, as the bulk
 * route asks. A SUPER_ADMIN's read-only token is not an admin here.
 */
function holdsAdminScope(req: Request): boolean {
  const role = req.auth?.role;
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') return false;
  return String(req.auth?.scopes ?? '')
    .split(',')
    .some((s) => s.trim() === 'admin');
}

function grantsRouter(): Router {
  const grants = express.Router();
  grants.use(signInServed);
  grants.use((req, res, next) => {
    if (req.auth?.userId) return next();
    res.status(403).json({ error: 'forbidden', message: 'Agent sign-ins belong to a user' });
  });

  grants.get('/', async (req, res) => {
    const list = await Container.get(GrantStore).listOf(req.auth!.userId);
    const clients = Container.get(ClientStore);
    const names = new Map<string, string>();
    for (const clientId of new Set(list.map((g) => g.clientId))) {
      names.set(clientId, await clients.nameOf(clientId));
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(
      list.map((g) => ({
        id: g.id,
        clientName: names.get(g.clientId),
        scopes: g.scopes,
        createdAt: g.createdAt,
        lastUsedAt: g.lastUsedAt,
      })),
    );
  });

  grants.delete('/:id', async (req, res) => {
    const store = Container.get(GrantStore);
    const grant = await store.find(req.params.id);
    const userId = req.auth!.userId;
    const own = grant?.userId === userId;
    if (!grant || grant.revokedAt || (!own && !holdsAdminScope(req))) {
      return res.status(404).json(GRANT_NOT_FOUND);
    }
    await store.revoke(grant.id, own ? 'user' : `admin ${userId}`);
    res.status(204).end();
  });

  grants.delete('/', roleGuard('ADMIN'), scopeGuard(['admin']), async (req, res) => {
    const target = req.query.userId;
    if (typeof target !== 'string' || !target) {
      return res
        .status(400)
        .json({ error: 'invalid_request', message: 'Name the user: ?userId=<id>' });
    }
    const revoked = await Container.get(GrantStore).revokeAllOf(
      target,
      `admin ${req.auth!.userId}`,
    );
    res.json({ revoked });
  });

  return grants;
}

// ---------------------------------------------------------------------------
// Discovery (RFC 9728, RFC 8414), on the server's root
// ---------------------------------------------------------------------------

/**
 * The protected-resource metadata (RFC 9728) for `/xenon/mcp`. `scopes_supported`
 * lists every MCP scope: an agent asks for those (the SDK's client does), and
 * the user's role cuts them at consent and at every token.
 */
export function protectedResourceMetadata(req: Request) {
  return {
    resource: mcpResourceUrl(req),
    authorization_servers: [publicOrigin(req)],
    scopes_supported: [...ALL_GRANULAR_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Xenon',
  };
}

/**
 * The authorization-server metadata (RFC 8414). Written here, not with the
 * SDK's `createOAuthMetadata`, which refuses a plain-HTTP issuer other than
 * localhost: labs run `http://lab-mac:4723`.
 */
export function authorizationServerMetadata(req: Request) {
  const issuer = publicOrigin(req);
  return {
    issuer,
    authorization_endpoint: `${issuer}${OAUTH_BASE}/authorize`,
    token_endpoint: `${issuer}${OAUTH_BASE}/token`,
    registration_endpoint: `${issuer}${OAUTH_BASE}/register`,
    revocation_endpoint: `${issuer}${OAUTH_BASE}/revoke`,
    scopes_supported: [...ALL_GRANULAR_SCOPES],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
  };
}

/**
 * The discovery documents, on the server's root (Appium's app, where
 * ServerManager mounts this router): the protected-resource metadata at
 * `/.well-known/oauth-protected-resource/xenon/mcp` and at the root form, and
 * the authorization-server metadata. Not on a node, and not with auth
 * disabled (the request goes on, to Appium's 404).
 */
export function oauthWellKnownRouter(pluginArgs: IPluginArgs): Router {
  const router = express.Router();
  if (!servesMcp(pluginArgs)) return router;
  router.use(signInServed);
  const noStore: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
  router.get([RESOURCE_METADATA_PATH, PROTECTED_RESOURCE_ROOT], noStore, (req, res) =>
    res.json(protectedResourceMetadata(req)),
  );
  router.get(AUTHORIZATION_SERVER_METADATA, noStore, (req, res) =>
    res.json(authorizationServerMetadata(req)),
  );
  return router;
}
