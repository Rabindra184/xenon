import { Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { ApiKeyService, Scope } from '../services/ApiKeyService';

// Full guard: denies unless the caller's API key has at least one of the
// required scopes (admin always satisfies). Use when GETs on the same
// resource should also be gated.
export function scopeGuard(required: Scope[]) {
  return function (req: Request, res: Response, next: NextFunction) {
    const key = req.apiKey;
    if (!key) return res.status(401).json({ error: 'unauthenticated' });
    const svc = Container.get(ApiKeyService);
    const ok = svc.hasScope(
      {
        id: key.id,
        name: '',
        keyHash: '',
        scopes: key.scopes,
        rateLimit: key.rateLimit,
        revokedAt: null,
      },
      required,
    );
    if (!ok) return res.status(403).json({ error: 'insufficient scope' });
    next();
  };
}

// Mutation-only guard: GET/HEAD/OPTIONS pass through, POST/PUT/DELETE/PATCH
// go through scopeGuard. Lets us mount one middleware on a whole sub-router
// (e.g. /control) and keep all its mutations gated without touching the
// existing GET reads. Any authenticated API key can still list/query.
export function mutationScopeGuard(required: Scope[]) {
  const STATE_CHANGING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
  const guard = scopeGuard(required);
  return function (req: Request, res: Response, next: NextFunction) {
    if (!STATE_CHANGING.has(req.method)) return next();
    return guard(req, res, next);
  };
}
