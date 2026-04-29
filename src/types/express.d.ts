import type { UserRole } from './identity';
import 'express';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        kind: 'user-session' | 'api-key';
        userId: string;
        role: UserRole;
        scopes: string;
        teamId?: string | null;
        apiKeyId?: string;
        sessionId?: string;
        rateLimit: number;
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
