import { Request, Response, NextFunction } from 'express';

/**
 * Reads `x-xenon-lease-token` from the request and stashes the cleartext on
 * `req.leaseToken`. The actual hash compare happens inside LeaseService
 * (which has access to the DB-stored hash for the path-param leaseId).
 * This middleware just enforces the header is present + non-empty.
 */
export function leaseTokenMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.header('x-xenon-lease-token');
  if (!token || token.length === 0) {
    return res.status(403).json({ error: 'missing_lease_token' });
  }
  (req as any).leaseToken = token;
  next();
}
