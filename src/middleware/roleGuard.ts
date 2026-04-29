/// <reference path="../types/express.d.ts" />
import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '../types/identity';

const RANK: Record<UserRole, number> = {
  SUPER_ADMIN: 3,
  ADMIN: 2,
  MEMBER: 1,
};

// Composes with scopeGuard. roleGuard runs first; scopeGuard second.
// Returns 401 when req.auth is missing (the caller is unauthenticated),
// 403 when the caller's role is below `min` or unknown (fail-closed).
export function roleGuard(min: UserRole) {
  const minRank = RANK[min];
  return function (req: Request, res: Response, next: NextFunction) {
    const auth = (req as Request & { auth?: { role: UserRole } }).auth;
    if (!auth) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const callerRank = RANK[auth.role as UserRole];
    if (typeof callerRank !== 'number' || callerRank < minRank) {
      res.status(403).json({ error: `requires role >= ${min}` });
      return;
    }
    next();
  };
}
