import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import log from '../logger';
import { config as xenonConfig } from '../config';

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
    const a = Buffer.from(got, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'invalid node secret' });
    }
    next();
  };
}
