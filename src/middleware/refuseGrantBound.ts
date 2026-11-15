import type { NextFunction, Request, Response } from 'express';

/**
 * Refuses a caller signed in as an agent through the browser (a token issued
 * under a sign-in grant, `req.auth.grantId`) on a route that makes a
 * credential which would outlive that grant: an API key, a token, an access
 * key, another account's password or reset link. Revoking the grant stops
 * its own tokens at once, and anything it made with them must stop too, so
 * it makes none. The person makes those in the dashboard; an agent's token is
 * for using the lab, not for handing out access to it.
 *
 * Single-use tickets of a minute or so (a stream's, an app download's) are
 * not credentials of this kind and stay allowed.
 */
export function refuseGrantBound(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth?.grantId) return next();
  res.status(403).json({
    error: 'agent_sign_in_cannot_make_credentials',
    message:
      'An agent signed in through the browser cannot make keys, tokens or passwords; do this from the dashboard',
  });
}
