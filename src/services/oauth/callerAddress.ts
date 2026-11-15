import { isIPv4, isIPv6 } from 'net';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { TooManyRequestsError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

/**
 * The key one caller's sign-in requests are counted under: their address,
 * so one address can't register agents or try codes without limit.
 *
 * - An IPv4 address is itself, and so is its IPv4-mapped IPv6 spelling
 *   (`::ffff:198.51.100.7`), which a dual-stack socket reports.
 * - Any other IPv6 address counts by its /64: one host is usually given a
 *   whole /64, and could otherwise take a new address for every request.
 * - Anything else (no address at all) is kept as given, `''` included.
 */
export function addressKey(address: string | undefined): string {
  if (!address) return '';
  if (isIPv4(address)) return address;
  const groups = isIPv6(address) ? ipv6Groups(address) : null;
  if (!groups) return address;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}

/**
 * The caller's address key: `req.ip`, which Express reads through the app's
 * `trust proxy` (trustProxy.ts), so behind a trusted reverse proxy it is the
 * address the proxy saw and otherwise the socket's.
 */
export function callerAddress(req: Request): string {
  return addressKey(req.ip ?? req.socket?.remoteAddress);
}

/** The eight 16-bit groups of a valid IPv6 address (net.isIPv6 said so). */
function ipv6Groups(address: string): number[] | null {
  let text = address.split('%')[0].toLowerCase();
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!isIPv4(tail)) return null;
    const [a, b, c, d] = tail.split('.').map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...new Array(fill).fill('0'), ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

/** Keys a limiter counts at once, at most: past that the oldest is forgotten. */
const MAX_COUNTED_KEYS = 10_000;

export interface RequestLimit {
  /** The window, in ms. */
  windowMs: number;
  /** Requests one address may send in the window. */
  max: number;
  /** What the refusal says. */
  message: string;
  /** The clock, in ms; a spec replaces it. */
  now?: () => number;
}

/** A limiter, with a way to forget what it has counted (`reset`, for specs). */
export type RequestLimiter = RequestHandler & { reset(): void };

/**
 * At most `max` requests per caller address (`callerAddress`) in each window
 * of `windowMs`; past that `429 too_many_requests` with `Retry-After`. Counted
 * in memory, per process, before the request is read, so a refused request
 * counts too.
 */
export function requestLimiter(limit: RequestLimit): RequestLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();
  const clock = limit.now ?? Date.now;
  const handler = (req: Request, res: Response, next: NextFunction) => {
    const now = clock();
    const key = callerAddress(req);
    let window = windows.get(key);
    if (!window || window.resetAt <= now) {
      windows.delete(key);
      if (windows.size >= MAX_COUNTED_KEYS) {
        for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
        if (windows.size >= MAX_COUNTED_KEYS) {
          windows.delete(windows.keys().next().value as string);
        }
      }
      window = { count: 0, resetAt: now + limit.windowMs };
      windows.set(key, window);
    }
    window.count += 1;
    if (window.count <= limit.max) return next();
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((window.resetAt - now) / 1000))));
    res.setHeader('Cache-Control', 'no-store');
    res.status(429).json(new TooManyRequestsError(limit.message).toResponseObject());
  };
  return Object.assign(handler, { reset: () => windows.clear() });
}
