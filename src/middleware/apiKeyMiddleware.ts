import { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { ApiKeyService } from '../services/ApiKeyService';
import { config as xenonConfig } from '../config';

const SESSION_COOKIE = 'xenon_dashboard_session';

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
    (req as any).apiKey = { id: 'auth-disabled', scopes: 'admin', rateLimit: 100_000 };
    return next();
  }

  const raw =
    (req.headers['x-xenon-api-key'] as string | undefined) || readSessionCookie(req);

  if (!raw) {
    return res.status(401).json({ error: 'missing API key' });
  }

  const row = await Container.get(ApiKeyService).verify(raw);
  if (!row) {
    return res.status(401).json({ error: 'invalid or revoked API key' });
  }

  (req as any).apiKey = { id: row.id, scopes: row.scopes, rateLimit: row.rateLimit };
  next();
}
