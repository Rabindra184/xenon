import { Request, Response, NextFunction } from 'express';

interface Bucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillPerSec: number;
}

const buckets = new Map<string, Bucket>();

function refill(b: Bucket) {
  const now = Date.now();
  const elapsed = (now - b.lastRefill) / 1000;
  b.tokens = Math.min(b.capacity, b.tokens + elapsed * b.refillPerSec);
  b.lastRefill = now;
}

export function rateLimitMiddleware() {
  return function (req: Request, res: Response, next: NextFunction) {
    const key = (req as any).apiKey;
    if (!key) return next();

    let bucket = buckets.get(key.id);
    if (!bucket) {
      bucket = {
        tokens: key.rateLimit,
        lastRefill: Date.now(),
        capacity: key.rateLimit,
        refillPerSec: key.rateLimit / 60,
      };
      buckets.set(key.id, bucket);
    }
    refill(bucket);

    if (bucket.tokens < 1) {
      const retryAfter = Math.ceil((1 - bucket.tokens) / bucket.refillPerSec);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'rate limit exceeded' });
    }

    bucket.tokens -= 1;
    next();
  };
}

export function __resetBucketsForTests() {
  buckets.clear();
}
