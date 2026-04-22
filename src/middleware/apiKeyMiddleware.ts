import { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { ApiKeyService } from '../services/ApiKeyService';
import { config as xenonConfig } from '../config';

export async function apiKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  if (xenonConfig.authDisabled === true) {
    (req as any).apiKey = { id: 'auth-disabled', scopes: 'admin', rateLimit: 100_000 };
    return next();
  }

  const raw =
    (req.headers['x-xenon-api-key'] as string | undefined) ||
    (req.query.apiKey as string | undefined) ||
    ((req as any).cookies?.xenon_dashboard_session as string | undefined);

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
