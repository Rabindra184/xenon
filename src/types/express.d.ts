import type { UserRole } from './identity';
import 'express';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        kind: 'user-session' | 'api-key' | 'bearer';
        userId: string;
        role: UserRole;
        scopes: string;
        teamId?: string | null;
        apiKeyId?: string;
        sessionId?: string;
        rateLimit: number;
        // Phase 4A: per-team device visibility. Populated for member cookie sessions
        // from TeamMember rows; populated for token-narrowed (apiKey) callers as
        // [apiKey.teamId]; undefined for ADMIN / SUPER_ADMIN cookie sessions and
        // admin-tier api-key callers (unscoped). Empty array means "no team
        // memberships" (member sees only shared-pool devices).
        teamIds?: string[];
      };
      // BACK-COMPAT: existing call sites still read `req.apiKey`. Keep this
      // until every reference has been migrated to req.auth.
      apiKey?: {
        id: string;
        scopes: string;
        rateLimit: number;
        teamId?: string | null;
      };
      // Set by loginRateLimitMiddleware so the /auth/login route can call
      // limiter.clearOnSuccess() with the same key on a successful sign-in.
      loginRateLimitKey?: string;
    }
  }
}
