/// <reference path="../types/express.d.ts" />
import { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { ApiKeyService } from '../services/ApiKeyService';
import { UserSessionService } from '../services/UserSessionService';
import { UserService } from '../services/UserService';
import { JwtKeyService } from '../services/token/JwtKeyService';
import { StreamTicketService } from '../services/token/StreamTicketService';
import { config } from '../config';
import { prisma } from '../prisma';

const SESSION_COOKIE = 'xenon_dashboard_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

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

// Compute the request-scoped team-id set. Returns undefined for admin-tier
// callers (unscoped). For member-tier callers without a narrowing apiKey,
// fetches TeamMember rows. For member-tier callers with a team-narrowed
// apiKey, returns just [apiKey.teamId] (the token's narrow always wins).
async function computeTeamIds(opts: {
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';
  userId: string;
  apiKeyTeamId?: string | null;
}): Promise<string[] | undefined> {
  if (opts.role === 'SUPER_ADMIN' || opts.role === 'ADMIN') return undefined;
  if (opts.apiKeyTeamId) return [opts.apiKeyTeamId];
  const rows = await prisma.teamMember.findMany({
    where: { userId: opts.userId },
    select: { teamId: true },
  });
  return rows.map((r: { teamId: string }) => r.teamId);
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

  const apiKeySvc = Container.get(ApiKeyService);
  const userSessionSvc = Container.get(UserSessionService);
  const userSvc = Container.get(UserService);

  // Path 1: header (accessKey, token) pair
  const headerAccessKey = req.headers['x-xenon-access-key'] as string | undefined;
  const headerToken = req.headers['x-xenon-token'] as string | undefined;
  if (headerAccessKey && headerToken) {
    const row = await apiKeySvc.verifyPair(headerAccessKey, headerToken);
    if (!row || !row.userId) return res.status(401).json({ error: 'invalid credentials' });
    const user = await userSvc.findById(row.userId);
    if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'invalid credentials' });
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
    };
    req.apiKey = { id: row.id, scopes: row.scopes, rateLimit: row.rateLimit, teamId: row.teamId ?? null };
    return next();
  }

  // Path 1.5: Authorization: Bearer <hub-issued JWT> (audience xenon-rest or
  // xenon-mcp). xenon-mcp tokens are the gateway-injected `authToken` the MCP
  // plugin's tools present when calling this same REST surface, so both
  // audiences must verify here.
  //
  // JwtKeyService.verify()'s current signature is `{ audience: string }`
  // (single audience) — it does not accept an audience array, so we try each
  // accepted audience in turn rather than widening that shared service's
  // signature. jose's own jwtVerify does accept `string | string[]`; if
  // JwtKeyService.verify is ever widened to expose that, this loop can
  // collapse into a single call with `{ audience: ACCEPTED_BEARER_AUDIENCES }`.
  //
  // Live user lookup on every request → revocation is instant on the REST
  // surface even though the token itself is stateless (spec §7.1).
  // Accepting the xenon-mcp audience here (not just xenon-rest) lets the MCP plugin's tools
  // call REST with the gateway-injected authToken. Tradeoff (spec §7.1): mcp tokens carry a
  // 12-24h TTL vs xenon-rest's 1h, so a stolen active-user mcp token has REST access for its
  // full TTL. Mitigated — not eliminated — by the per-request live-user lookup below (a
  // disabled/revoked account is rejected on the next call regardless of the token's remaining life).
  const ACCEPTED_BEARER_AUDIENCES = ['xenon-rest', 'xenon-mcp'] as const;
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    try {
      const bearer = authHeader.slice(7);
      let payload: Awaited<ReturnType<JwtKeyService['verify']>> | undefined;
      for (const audience of ACCEPTED_BEARER_AUDIENCES) {
        try {
          payload = await Container.get(JwtKeyService).verify(bearer, { audience });
          break;
        } catch {
          // try next accepted audience
        }
      }
      if (!payload) {
        return res.status(401).json({ error: 'invalid token' });
      }
      const user = await userSvc.findById(String(payload.sub));
      if (!user || user.status !== 'ACTIVE') {
        return res.status(401).json({ error: 'invalid token' });
      }
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
      res.cookie(SESSION_COOKIE, cookie, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'strict',
        maxAge: SESSION_TTL_MS,
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
        maxAge: SESSION_TTL_MS,
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

  return res.status(401).json({ error: 'unauthenticated' });
}
