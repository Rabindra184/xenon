import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import log from '../logger';

let lastWarnAt = 0;

export function nodeSecretMiddleware(expected: string | undefined) {
  return function (req: Request, res: Response, next: NextFunction) {
    if (!expected) {
      const now = Date.now();
      if (now - lastWarnAt > 60_000) {
        log.warn(
          '[nodeSecret] node-secret not configured; hub-node channel is unauthenticated. Set --plugin-xenon-node-secret.',
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
