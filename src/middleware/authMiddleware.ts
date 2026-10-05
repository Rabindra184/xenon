/// <reference path="../types/express.d.ts" />
import { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { ApiKeyService } from '../services/ApiKeyService';
import { UserSessionService } from '../services/UserSessionService';
import { UserService } from '../services/UserService';
import { StreamTicketService } from '../services/token/StreamTicketService';
import { AppDownloadTicketService } from '../services/token/AppDownloadTicketService';
import { config } from '../config';
import { computeTeamIds } from '../services/device-access/callerTeamIds';
import { verifyBearerCredential, verifyKeyPairCredential } from './verifyCredential';
import { PluginContext } from '../PluginContext';
import {
  HUB_TOKEN_HEADER,
  HubSessionTokenVerifier,
  HubTokenUnavailableError,
} from '../gateway/hubSessionToken';
import { isLocalDeviceHost, localDeviceHosts } from '../device-managers/localDeviceHosts';

const SESSION_COOKIE = 'xenon_dashboard_session';

/** An API key's expiresAt as epoch ms, or undefined for a key that never expires. */
function keyExpiresAt(expiresAt: Date | string | null | undefined): number | undefined {
  if (!expiresAt) return undefined;
  const ms = new Date(expiresAt).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

// Role → scopes derivation. The same table is used in profile token creation
// to enforce that members can never grant 'admin'.
// Cookie-session scopes: a logged-in user gets the full set of scopes
// their role is permitted to exercise. ADMIN users hit `scopeGuard(['admin'])`
// routes via the dashboard, so their session must carry the admin scope --
// otherwise the role hierarchy is decorative.
//
// This is intentionally DIFFERENT from default token scopes (see
// `ROLE_SCOPES` in src/app/routers/profile.ts): a token an admin creates
// without explicit scopes still narrows to `devices,sessions,read` -- the
// admin's CI token shouldn't auto-grant 'admin'. Token-creation narrowing
// is enforced at /profile/tokens; cookie sessions are the user themselves
// and inherit their full role grant.
export function scopesForRole(role: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER'): string {
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return 'admin,devices,sessions,read';
  // MEMBER carries `devices`. /control already declares per-device interaction
  // a Member action via roleGuard('MEMBER'), but mutationScopeGuard(['devices'])
  // on the next line contradicted it and 403'd every member — so device control
  // was admin-only in practice, and admins bypass the ownership guard, meaning
  // no dashboard user could ever be told a device was held by someone else.
  //
  // This widens MEMBER to: /control mutations, reservations, and SDK leases.
  // The destructive surfaces stay ADMIN-gated by their own roleGuard — app
  // upload/delete (apps.ts), node register/block/tags (grid.ts), and the whole
  // of ports.ts — so `devices` alone grants no new privilege there.
  return 'devices,sessions,read';
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/** One verifier per hub URL, so its fetched key set is reused. */
const hubVerifiers = new Map<string, HubSessionTokenVerifier>();

function hubVerifierFor(hub: string): HubSessionTokenVerifier {
  let verifier = hubVerifiers.get(hub);
  if (!verifier) {
    verifier = new HubSessionTokenVerifier(hub);
    hubVerifiers.set(hub, verifier);
  }
  return verifier;
}

type HubControlCaller = NonNullable<Request['auth']> | 'refused' | 'unavailable' | undefined;

/**
 * On a node: the caller a hub's signed device-control call names, for
 * `/control/<udid>/...` on the phone the token names, of this node. The hub
 * checked the caller, the team rule and ownership before forwarding; the
 * node's own ownership guard then judges that user again. undefined when the
 * request isn't one (no hub token, not a node, not /control): the other
 * credential paths decide it. 'refused' for a token that isn't a valid grant
 * for this phone of this node; 'unavailable' when the hub's keys can't be
 * fetched.
 */
async function hubControlCallerOf(req: Request): Promise<HubControlCaller> {
  const presented = req.headers[HUB_TOKEN_HEADER];
  if (typeof presented !== 'string') return undefined;
  const context = Container.get(PluginContext);
  const hub = context.pluginArgs?.hub;
  if (hub === undefined) return undefined;
  const match = /^\/control\/([^/]+)(?:\/|$)/.exec(req.path);
  if (!match) return undefined;

  let udid: string;
  try {
    udid = decodeURIComponent(match[1]);
  } catch {
    return 'refused';
  }
  let grant;
  try {
    grant = await hubVerifierFor(hub).verifyControl(presented);
  } catch (err) {
    return err instanceof HubTokenUnavailableError ? 'unavailable' : 'refused';
  }
  if (!grant || grant.udid !== udid) return 'refused';
  if (!isLocalDeviceHost(localDeviceHosts(context.pluginArgs, context.port), grant.host)) {
    return 'refused';
  }
  const role = grant.isAdmin ? 'ADMIN' : 'MEMBER';
  return {
    kind: 'hub-control',
    userId: grant.userId,
    role,
    scopes: scopesForRole(role),
    rateLimit: 300,
    // The hub applied the team rule: the node's rows carry the hub's teams.
    teamIds: undefined,
  };
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (config.authDisabled === true) {
    req.auth = {
      kind: 'api-key',
      userId: 'auth-disabled',
      role: 'SUPER_ADMIN',
      scopes: 'admin',
      rateLimit: 100_000,
      teamIds: undefined,
    };
    req.apiKey = { id: 'auth-disabled', scopes: 'admin', rateLimit: 100_000 };
    return next();
  }

  // Path 0: on a node, the hub's signed device-control call
  // (x-xenon-hub-token, audience xenon-node-control), for /control on the
  // phone it names only. Anywhere else the header is not a credential.
  const hubControl = await hubControlCallerOf(req);
  if (hubControl === 'refused') return res.status(401).json({ error: 'invalid hub token' });
  if (hubControl === 'unavailable') {
    return res.status(503).json({ error: "the hub's token could not be checked" });
  }
  if (hubControl) {
    req.auth = hubControl;
    return next();
  }

  const apiKeySvc = Container.get(ApiKeyService);
  const userSessionSvc = Container.get(UserSessionService);
  const userSvc = Container.get(UserService);

  // Path 1: header (accessKey, token) pair. verifyKeyPairCredential is shared
  // with the WebDriver per-command check (commandAuth.ts).
  const headerAccessKey = req.headers['x-xenon-access-key'] as string | undefined;
  const headerToken = req.headers['x-xenon-token'] as string | undefined;
  if (headerAccessKey && headerToken) {
    const verified = await verifyKeyPairCredential(headerAccessKey, headerToken);
    if (!verified) return res.status(401).json({ error: 'invalid credentials' });
    const { row, user } = verified;
    const teamIds = await computeTeamIds({
      role: user.role as any,
      userId: user.id,
      apiKeyTeamId: row.teamId,
    });
    req.auth = {
      kind: 'api-key',
      userId: user.id,
      role: user.role as any,
      scopes: row.scopes,
      teamId: row.teamId ?? null,
      apiKeyId: row.id,
      rateLimit: row.rateLimit,
      teamIds,
      credentialExpiresAt: keyExpiresAt(row.expiresAt),
    };
    req.apiKey = { id: row.id, scopes: row.scopes, rateLimit: row.rateLimit, teamId: row.teamId ?? null };
    return next();
  }

  // Path 1.5: Authorization: Bearer <hub-issued JWT> (audience xenon-rest or
  // xenon-mcp; see ACCEPTED_BEARER_AUDIENCES in verifyCredential.ts, shared
  // with the WebDriver per-command check).
  //
  // Live user lookup on every request → revocation is instant on the REST
  // surface even though the token itself is stateless (spec §7.1).
  // Accepting the xenon-mcp audience here (not just xenon-rest) lets the MCP plugin's tools
  // call REST with the gateway-injected authToken. Tradeoff (spec §7.1): mcp tokens carry a
  // 12-24h TTL vs xenon-rest's 1h, so a stolen active-user mcp token has REST access for its
  // full TTL. Mitigated — not eliminated — by the per-request live-user lookup (a
  // disabled/revoked account is rejected on the next call regardless of the token's remaining life).
  //
  // Any failure here, including one where the token could not be checked at
  // all, answers 401.
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    try {
      const verified = await verifyBearerCredential(authHeader.slice(7));
      if (!verified) {
        return res.status(401).json({ error: 'invalid token' });
      }
      const { payload, user } = verified;
      const teamIds = await computeTeamIds({
        role: user.role as any,
        userId: user.id,
        apiKeyTeamId: (payload.teamId as string | null) ?? null,
      });
      req.auth = {
        kind: 'bearer',
        userId: user.id,
        role: user.role as any,
        scopes: String(payload.scopes ?? ''),
        teamId: (payload.teamId as string | null) ?? null,
        rateLimit: 300,
        teamIds,
        credentialExpiresAt: typeof payload.exp === 'number' ? payload.exp * 1000 : undefined,
      };
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid token' });
    }
  }

  // Path 2: cookie — UserSession first, then ApiKey (legacy issuance path).
  // Both ids are UUIDv4; collision is astronomically unlikely (<1 in 2^128).
  // On collision, UserSession wins and we never look at the ApiKey branch.
  const cookie = readCookie(req, SESSION_COOKIE);
  if (cookie) {
    const session = await userSessionSvc.resolve(cookie);
    if (session) {
      const user = await userSvc.findById(session.userId);
      if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'invalid session' });
      const isSecure = req.secure || (req.headers['x-forwarded-proto'] as string) === 'https';
      // Renewed for as long as the session row now lasts
      // (XENON_USER_SESSION_TTL_MS). A fixed 24 hours here capped any longer
      // setting: the browser dropped the cookie after a day away.
      res.cookie(SESSION_COOKIE, cookie, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'strict',
        maxAge: userSessionSvc.ttlMs(),
      });
      const teamIds = await computeTeamIds({
        role: user.role as any,
        userId: user.id,
      });
      req.auth = {
        kind: 'user-session',
        userId: user.id,
        role: user.role as any,
        scopes: scopesForRole(user.role as any),
        sessionId: session.id,
        rateLimit: 300,
        teamIds,
      };
      // NOTE: req.apiKey is intentionally NOT set on the user-session path.
      // It's a legacy shape that only carries api-key context (id, scopes,
      // rateLimit, teamId) — there's no apiKey here. Routers that still
      // read req.apiKey?.id as an actor identifier need to migrate to
      // req.auth.userId; that migration is Task 12.
      return next();
    }
    // Fall through: maybe it's a raw API key in the cookie (legacy issuance path).
    const row = await apiKeySvc.verify(cookie);
    if (row && row.userId) {
      const user = await userSvc.findById(row.userId);
      if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'invalid session' });
      const isSecure = req.secure || (req.headers['x-forwarded-proto'] as string) === 'https';
      res.cookie(SESSION_COOKIE, cookie, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'strict',
        maxAge: userSessionSvc.ttlMs(),
      });
      const teamIds = await computeTeamIds({
        role: user.role as any,
        userId: user.id,
        apiKeyTeamId: row.teamId,
      });
      req.auth = {
        kind: 'api-key',
        userId: user.id,
        role: user.role as any,
        scopes: row.scopes,
        teamId: row.teamId ?? null,
        apiKeyId: row.id,
        rateLimit: row.rateLimit,
        teamIds,
        credentialExpiresAt: keyExpiresAt(row.expiresAt),
      };
      req.apiKey = { id: row.id, scopes: row.scopes, rateLimit: row.rateLimit, teamId: row.teamId ?? null };
      return next();
    }
  }

  // Path 3: single-use stream ticket — ONLY for GET <control>/:udid/stream.
  // req.path here is relative to apiRouter's own mount (authMiddleware is
  // registered directly on apiRouter, before ControlRouter mounts '/control'
  // onto it), so it is '/control/<udid>/stream' — not the full
  // '/xenon/api/control/...' external URL. Verified against
  // src/app/index.ts (apiRouter.use(authMiddleware) at line 223, then
  // ControlRouter.register(apiRouter) -> parentRouter.use('/control', router)).
  const ticket = req.query?.ticket;
  const streamMatch = req.method === 'GET' && /^\/control\/([^/]+)\/stream$/.exec(req.path);
  if (typeof ticket === 'string' && streamMatch) {
    try {
      const { actorId } = await Container.get(StreamTicketService).redeem(ticket, streamMatch[1]);
      req.auth = {
        kind: 'stream-ticket',
        userId: actorId,
        role: 'MEMBER',
        scopes: 'read',
        rateLimit: 300,
        teamIds: undefined,
      };
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid ticket' });
    }
  }

  // Path 4: single-use app download ticket — ONLY for GET /apps/:id/download.
  // An Appium driver downloads a session's app itself and sends no
  // credentials; SessionLifecycleService puts a ticket in the URL after
  // checking the session's creator may see the app. The ticket carries no
  // identity, so req.auth is an unprivileged member bound to that one app
  // (appId), and teamIds undefined because the team check happened at mint.
  // Every failure is the same 401 whichever app the URL names: a ticket is
  // not a way to learn whether some other app exists.
  const appMatch = req.method === 'GET' && /^\/apps\/([^/]+)\/download$/.exec(req.path);
  if (typeof ticket === 'string' && appMatch) {
    try {
      await Container.get(AppDownloadTicketService).redeem(ticket, appMatch[1]);
      req.auth = {
        kind: 'app-ticket',
        userId: 'app-ticket',
        role: 'MEMBER',
        scopes: 'read',
        rateLimit: 300,
        teamIds: undefined,
        appId: appMatch[1],
      };
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid ticket' });
    }
  }

  return res.status(401).json({ error: 'unauthenticated' });
}
