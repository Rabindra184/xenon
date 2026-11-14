import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { config } from '../config';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * The most buckets one limiter keeps. Past it the oldest go first, after any
 * that have expired. A bucket is a caller's address within a window, so a lab
 * reaches this only under a spread-out attack, which then can push out an
 * older caller's count but can't grow the server's memory.
 */
export const MAX_LOGIN_BUCKETS = 10_000;

export class LoginRateLimiter {
  private attempts: number;
  private windowMs: number;
  private buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  constructor(opts?: { attempts?: number; windowMs?: number }) {
    this.attempts = opts?.attempts ?? (config as any).loginRateLimitAttempts ?? 5;
    this.windowMs = opts?.windowMs ?? (config as any).loginRateLimitWindowMs ?? 5 * 60 * 1000;
  }

  consume(ipHashOrKey: string): 'ok' | 'blocked' {
    const now = Date.now();
    let b = this.buckets.get(ipHashOrKey);
    if (!b || b.resetAt < now) {
      b = { count: 0, resetAt: now + this.windowMs };
      // Deleted first so the Map's order stays the order buckets started in,
      // which is what the cap drops by.
      this.buckets.delete(ipHashOrKey);
      this.makeRoom(now);
      this.buckets.set(ipHashOrKey, b);
    }
    if (b.count >= this.attempts) return 'blocked';
    b.count++;
    return 'ok';
  }

  /** How many buckets are held. */
  size(): number {
    return this.buckets.size;
  }

  // Expired buckets go once a window, or whenever the cap is reached; then the
  // oldest, until there is room for one more. Through 2.36 a bucket was
  // removed only when its own key came back.
  private makeRoom(now: number) {
    if (now - this.lastSweep >= this.windowMs || this.buckets.size >= MAX_LOGIN_BUCKETS) {
      this.lastSweep = now;
      for (const [key, bucket] of this.buckets) {
        if (bucket.resetAt < now) this.buckets.delete(key);
      }
    }
    while (this.buckets.size >= MAX_LOGIN_BUCKETS) {
      const oldest = this.buckets.keys().next().value as string;
      this.buckets.delete(oldest);
    }
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

/**
 * The caller's address: Express's `req.ip`, which reads X-Forwarded-For only
 * as far back as the app's `trust proxy` setting allows (neither Appium nor
 * Xenon sets it, so it is the socket's address), else the socket's own.
 * Through 2.36 it was the first entry of X-Forwarded-For, which the client
 * writes: a new value with each attempt was never limited.
 */
function callerAddress(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function ipHash(req: Request): string {
  const ip = callerAddress(req);
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
