import { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { ApiKeyService } from '../services/ApiKeyService';
import { config as xenonConfig } from '../config';

const SESSION_COOKIE = 'xenon_dashboard_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function readSessionCookie(req: Request): string | undefined {
  // cookie-parser isn't mounted globally, so parse the header inline.
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

export async function apiKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  if (xenonConfig.authDisabled === true) {
    req.apiKey = { id: 'auth-disabled', scopes: 'admin', rateLimit: 100_000 };
    return next();
  }

  const headerKey = req.headers['x-xenon-api-key'] as string | undefined;
  const cookieKey = headerKey ? undefined : readSessionCookie(req);
  const raw = headerKey || cookieKey;

  if (!raw) {
    return res.status(401).json({ error: 'missing API key' });
  }

  const row = await Container.get(ApiKeyService).verify(raw);
  if (!row) {
    return res.status(401).json({ error: 'invalid or revoked API key' });
  }

  // Slide the dashboard session forward on every authenticated hit so active
  // users don't get kicked out 24h after their original login.
  if (cookieKey) {
    const isSecure =
      req.secure || (req.headers['x-forwarded-proto'] as string | undefined) === 'https';
    res.cookie(SESSION_COOKIE, raw, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'strict',
      maxAge: SESSION_TTL_MS,
    });
  }

  req.apiKey = {
    id: row.id,
    scopes: row.scopes,
    rateLimit: row.rateLimit,
    teamId: row.teamId ?? null,
  };
  next();
}
