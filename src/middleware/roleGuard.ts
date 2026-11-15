/// <reference path="../types/express.d.ts" />
import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '../types/identity';
import { effectiveRole } from './callerRole';

const RANK: Record<UserRole, number> = {
  SUPER_ADMIN: 3,
  ADMIN: 2,
  MEMBER: 1,
};

type RoleAuth = { role: UserRole; grantId?: string };

// Composes with scopeGuard. roleGuard runs first; scopeGuard second.
// Returns 401 when req.auth is missing (the caller is unauthenticated),
// 403 when the caller's role is below `min` or unknown (fail-closed).
// The role is effectiveRole's: an agent's browser sign-in (a grant-bound
// caller) is a MEMBER here whatever its user's role, so it passes
// roleGuard('MEMBER') and never roleGuard('ADMIN').
export function roleGuard(min: UserRole) {
  const minRank = RANK[min];
  return function (req: Request, res: Response, next: NextFunction) {
    const auth = (req as Request & { auth?: RoleAuth }).auth;
    if (!auth) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const role = effectiveRole(auth);
    const callerRank = role === undefined ? undefined : RANK[role];
    if (typeof callerRank !== 'number' || callerRank < minRank) {
      res.status(403).json({ error: `requires role >= ${min}` });
      return;
    }
    next();
  };
}

/**
 * SUPER_ADMIN only, refused in words a tester can act on: the dashboard shows
 * the `error` of a refused change as it is. By effectiveRole, so never an
 * agent's browser sign-in.
 */
export function superAdminGuard(message: string) {
  return function (req: Request, res: Response, next: NextFunction) {
    const auth = (req as Request & { auth?: RoleAuth }).auth;
    if (!auth) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    if (effectiveRole(auth) !== 'SUPER_ADMIN') {
      // `message` too: the AI Engine page shows a refused test's message.
      res.status(403).json({ error: message, message });
      return;
    }
    next();
  };
}
