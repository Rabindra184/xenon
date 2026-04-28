/// <reference path="../types/express.d.ts" />
import { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { ApiKeyService } from '../services/ApiKeyService';
import { UserSessionService } from '../services/UserSessionService';
import { UserService } from '../services/UserService';
import { config } from '../config';

const SESSION_COOKIE = 'xenon_dashboard_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Role → scopes derivation. The same table is used in profile token creation
// to enforce that members can never grant 'admin'.
export function scopesForRole(role: 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER'): string {
  if (role === 'SUPER_ADMIN') return 'admin';
  if (role === 'ADMIN') return 'devices,sessions,read';
  return 'sessions,read';
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

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (config.authDisabled === true) {
    req.auth = {
      kind: 'api-key',
      userId: 'auth-disabled',
      role: 'SUPER_ADMIN',
      scopes: 'admin',
      rateLimit: 100_000,
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
    req.auth = {
      kind: 'api-key',
      userId: user.id,
      role: user.role as any,
      scopes: row.scopes,
      teamId: row.teamId ?? null,
      apiKeyId: row.id,
      rateLimit: row.rateLimit,
    };
    req.apiKey = { id: row.id, scopes: row.scopes, rateLimit: row.rateLimit, teamId: row.teamId ?? null };
    return next();
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
      req.auth = {
        kind: 'user-session',
        userId: user.id,
        role: user.role as any,
        scopes: scopesForRole(user.role as any),
        sessionId: session.id,
        rateLimit: 300,
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
      req.auth = {
        kind: 'api-key',
        userId: user.id,
        role: user.role as any,
        scopes: row.scopes,
        teamId: row.teamId ?? null,
        apiKeyId: row.id,
        rateLimit: row.rateLimit,
      };
      req.apiKey = { id: row.id, scopes: row.scopes, rateLimit: row.rateLimit, teamId: row.teamId ?? null };
      return next();
    }
  }

  // Path 3: legacy x-xenon-api-key header (single secret), only when flag is on.
  if ((config as any).acceptLegacyKey) {
    const headerKey = req.headers['x-xenon-api-key'] as string | undefined;
    if (headerKey) {
      const row = await apiKeySvc.verify(headerKey);
      if (row && row.userId) {
        const user = await userSvc.findById(row.userId);
        if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'invalid credentials' });
        req.auth = {
          kind: 'api-key',
          userId: user.id,
          role: user.role as any,
          scopes: row.scopes,
          teamId: row.teamId ?? null,
          apiKeyId: row.id,
          rateLimit: row.rateLimit,
        };
        req.apiKey = { id: row.id, scopes: row.scopes, rateLimit: row.rateLimit, teamId: row.teamId ?? null };
        return next();
      }
    }
  }

  return res.status(401).json({ error: 'unauthenticated' });
}
