import { Request, Response, NextFunction } from 'express';
import log from '../logger';
import { config as xenonConfig } from '../config';
import { validateNodeSecret } from '../auth/nodeSecret';

let lastWarnAt = 0;

export function nodeSecretMiddleware(expected: string | undefined) {
  return function (req: Request, res: Response, next: NextFunction) {
    if (!expected) {
      // Fail closed when API-key auth is also disabled — otherwise the route
      // would be wide open. If auth is enabled, fall through to apiKeyMiddleware.
      if (xenonConfig.authDisabled === true) {
        return res.status(503).json({
          error:
            'hub-node secret not configured while API-key auth is disabled; set --plugin-xenon-node-secret',
        });
      }
      const now = Date.now();
      if (now - lastWarnAt > 60_000) {
        log.warn(
          '[nodeSecret] node-secret not configured; hub-node channel falls back to API-key auth. Set --plugin-xenon-node-secret for defense in depth.',
        );
        lastWarnAt = now;
      }
      return next();
    }
    const got = (req.headers['x-xenon-node-secret'] as string | undefined) || '';
    const outcome = validateNodeSecret(got, {
      current: expected,
      previous: xenonConfig.nodeSecretPrevious,
    });
    if (outcome === 'reject') {
      return res.status(401).json({ error: 'invalid node secret' });
    }
    next();
  };
}
