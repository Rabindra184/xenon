import { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { ApiKeyService, Scope } from '../services/ApiKeyService';

export function scopeGuard(required: Scope[]) {
  return function (req: Request, res: Response, next: NextFunction) {
    const key = (req as any).apiKey;
    if (!key) return res.status(401).json({ error: 'unauthenticated' });
    const svc = Container.get(ApiKeyService);
    const ok = svc.hasScope(
      { id: key.id, name: '', keyHash: '', scopes: key.scopes, rateLimit: key.rateLimit, revokedAt: null },
      required,
    );
    if (!ok) return res.status(403).json({ error: 'insufficient scope' });
    next();
  };
}
