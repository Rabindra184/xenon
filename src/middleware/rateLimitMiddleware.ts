/// <reference path="../types/express.d.ts" />
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
//
// A signed-in dashboard user and a bearer token (`req.auth.kind` 'user-session'
// or 'bearer') carry no API key, so through 2.12 they were never limited at
// all. They now share one set of buckets per user, whichever session or token
// they use, with the same control and heavy budgets. Their read budget is ten
// times larger: a dashboard page loads every screenshot of a session at once,
// and the device mosaic polls each tile, so a human's reads come in bursts no
// script sends.

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

const USER_READ_MULTIPLIER = 10;

function capacityFor(keyLimit: number, cat: Category, perUser: boolean): number {
  if (cat === 'heavy') return Math.max(10, Math.floor(keyLimit / 4));
  if (cat === 'read' && perUser) return keyLimit * USER_READ_MULTIPLIER;
  return keyLimit;
}

/** Whose buckets a request draws from, and their per-minute budget; undefined is unlimited. */
function limitedCaller(
  req: Request,
): { id: string; rateLimit: number; perUser: boolean } | undefined {
  const key = req.apiKey;
  if (key) return { id: key.id, rateLimit: key.rateLimit, perUser: false };
  const auth = req.auth;
  if (auth && (auth.kind === 'user-session' || auth.kind === 'bearer') && auth.userId) {
    return { id: `user:${auth.userId}`, rateLimit: auth.rateLimit, perUser: true };
  }
  return undefined;
}

function refill(b: Bucket) {
  const now = Date.now();
  const elapsed = (now - b.lastRefill) / 1000;
  b.tokens = Math.min(b.capacity, b.tokens + elapsed * b.refillPerSec);
  b.lastRefill = now;
}

export function rateLimitMiddleware() {
  return function (req: Request, res: Response, next: NextFunction) {
    const caller = limitedCaller(req);
    if (!caller) return next();

    const category = categorize(req);
    const bucketKey = `${caller.id}:${category}`;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      const capacity = capacityFor(caller.rateLimit, category, caller.perUser);
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
