import { Request, Response, NextFunction } from 'express';

// Per-category token buckets so a burst in one class of traffic can't starve
// another. Before this split there was a single bucket per API key — a
// healing storm (AI-heavy, expensive) would exhaust it and 429 legitimate
// dashboard polling on the same key.
//
// Three categories:
//   read    — GET/HEAD/OPTIONS. Dashboard polling, metrics scrapes.
//   heavy   — AI/healing/visual endpoints. Slower + more expensive; smaller
//             bucket so a runaway loop can't drain the budget.
//   control — everything else (device mutations, config writes, etc).
//
// Capacity defaults derive from the key's `rateLimit` (per-minute budget):
//   read/control = rateLimit, heavy = max(10, rateLimit/4).

type Category = 'read' | 'heavy' | 'control';

interface Bucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillPerSec: number;
}

const buckets = new Map<string, Bucket>();

// Path patterns that should count against the 'heavy' bucket. Matches the
// AI / visual-healing / test-ai style routes where a single request can
// incur a multi-second LLM call.
const HEAVY_PATH_RE = /\/(test-ai|ai|omni|visual|heal|test-locator)(\b|\/|$)/i;

function categorize(req: Request): Category {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return 'read';
  if (HEAVY_PATH_RE.test(req.path)) return 'heavy';
  return 'control';
}

function capacityFor(keyLimit: number, cat: Category): number {
  if (cat === 'heavy') return Math.max(10, Math.floor(keyLimit / 4));
  return keyLimit;
}

function refill(b: Bucket) {
  const now = Date.now();
  const elapsed = (now - b.lastRefill) / 1000;
  b.tokens = Math.min(b.capacity, b.tokens + elapsed * b.refillPerSec);
  b.lastRefill = now;
}

export function rateLimitMiddleware() {
  return function (req: Request, res: Response, next: NextFunction) {
    const key = req.apiKey;
    if (!key) return next();

    const category = categorize(req);
    const bucketKey = `${key.id}:${category}`;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      const capacity = capacityFor(key.rateLimit, category);
      bucket = {
        tokens: capacity,
        lastRefill: Date.now(),
        capacity,
        refillPerSec: capacity / 60,
      };
      buckets.set(bucketKey, bucket);
    }
    refill(bucket);

    // Surfacing the category + remaining tokens makes 429s debuggable from
    // the client side without access to server logs.
    res.set('X-RateLimit-Category', category);
    res.set('X-RateLimit-Remaining', String(Math.floor(bucket.tokens)));
    res.set('X-RateLimit-Capacity', String(bucket.capacity));

    if (bucket.tokens < 1) {
      const retryAfter = Math.ceil((1 - bucket.tokens) / bucket.refillPerSec);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'rate limit exceeded',
        category,
        retryAfter,
      });
    }

    bucket.tokens -= 1;
    next();
  };
}

export function __resetBucketsForTests() {
  buckets.clear();
}
