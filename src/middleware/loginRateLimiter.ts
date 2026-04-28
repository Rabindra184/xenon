import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config';

interface Bucket {
  count: number;
  resetAt: number;
}

export class LoginRateLimiter {
  private attempts: number;
  private windowMs: number;
  private buckets = new Map<string, Bucket>();

  constructor(opts?: { attempts?: number; windowMs?: number }) {
    this.attempts = opts?.attempts ?? (config as any).loginRateLimitAttempts ?? 5;
    this.windowMs = opts?.windowMs ?? (config as any).loginRateLimitWindowMs ?? 5 * 60 * 1000;
  }

  consume(ipHashOrKey: string): 'ok' | 'blocked' {
    const now = Date.now();
    let b = this.buckets.get(ipHashOrKey);
    if (!b || b.resetAt < now) {
      b = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(ipHashOrKey, b);
    }
    if (b.count >= this.attempts) return 'blocked';
    b.count++;
    return 'ok';
  }

  clearOnSuccess(ipHashOrKey: string) {
    this.buckets.delete(ipHashOrKey);
  }

  retryAfterSec(ipHashOrKey: string): number {
    const b = this.buckets.get(ipHashOrKey);
    if (!b) return 0;
    return Math.max(0, Math.ceil((b.resetAt - Date.now()) / 1000));
  }
}

const ipSecret = process.env.XENON_IP_HASH_SECRET || 'xenon-ip-hash';

function ipHash(req: Request): string {
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown';
  return crypto
    .createHash('sha256')
    .update(ip + ':' + ipSecret)
    .digest('hex')
    .slice(0, 16);
}

export function loginRateLimitMiddleware(limiter: LoginRateLimiter) {
  return function (req: Request, res: Response, next: NextFunction) {
    const key = ipHash(req);
    if (limiter.consume(key) === 'blocked') {
      res.set('Retry-After', String(limiter.retryAfterSec(key)));
      return res.status(429).json({ error: 'too many login attempts' });
    }
    // Cast: ts-node/register (used by mocha) doesn't auto-include .d.ts
    // files, so the Request augmentation in src/types/express.d.ts isn't
    // visible at unit-test compile time. The augmentation still helps full
    // project tsc and IDE autocomplete.
    (req as Request & { loginRateLimitKey?: string }).loginRateLimitKey = key;
    next();
  };
}

export const ipHashOf = ipHash;
