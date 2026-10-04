import { Request, Response, NextFunction } from 'express';
import log from '../logger';
import { config as xenonConfig } from '../config';

// Defense-in-depth CSRF for cookie-authed dashboard callers. The session
// cookie is already SameSite=Strict (see auth.ts), which blocks the common
// cross-origin form-submit vector on modern browsers. This middleware adds
// an Origin/Referer check so we're also covered against:
//   - subdomain-takeover (SameSite considers *.example.com same-site)
//   - reverse-proxy misconfigurations that strip SameSite enforcement
//   - older browsers whose SameSite implementation has known gaps
//
// Header-authed callers — the (x-xenon-access-key, x-xenon-token) pair, or
// an `Authorization: Bearer` token — are immune to CSRF by construction: a
// browser will not attach either header cross-origin without an explicit CORS
// preflight, and the apiRouter's cors({origin:false}) already refuses
// preflights. Those requests pass through unchanged. A bearer request is
// authenticated by its token alone: authMiddleware answers a bad one 401 and
// never falls back to the cookie. Through 2.12 bearer callers (SDK, MCP
// tools) were held to the Origin check, so every state change they sent
// without a browser's Origin header was refused.

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

// Comma-separated list of allowed origins, intended for ops running the
// dashboard behind a reverse proxy on a different host than the Xenon API.
// Values can be full origins (https://dash.example.com) or bare hosts
// (dash.example.com) — either matches.
const ALLOWED_ORIGINS: Set<string> = (() => {
  const raw = process.env.XENON_ALLOWED_ORIGINS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
})();

function sourceHostOf(source: string | undefined): string | null {
  if (!source) return null;
  try {
    return new URL(source).host;
  } catch {
    return null;
  }
}

export function csrfMiddleware(req: Request, res: Response, next: NextFunction) {
  if (xenonConfig.authDisabled === true) return next();
  if (!STATE_CHANGING_METHODS.has(req.method)) return next();

  // Header-based auth: safe by construction (see block comment above). A
  // hub's signed call to its node (x-xenon-hub-token) is one too.
  if (req.headers['x-xenon-access-key'] || req.headers['x-xenon-hub-token']) {
    return next();
  }
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return next();
  }

  // Cookie-authed (or unauthenticated) state-changer. Require Origin or
  // Referer to match the Host we're being served from.
  const host = req.headers.host;
  const origin = req.headers.origin as string | undefined;
  const referer = req.headers.referer as string | undefined;
  const source = origin || referer;

  if (!source) {
    log.warn(`[csrf] Blocked ${req.method} ${req.originalUrl}: no Origin/Referer header`);
    return res.status(403).json({ error: 'CSRF: Origin or Referer header required' });
  }

  const sourceHost = sourceHostOf(source);
  if (!sourceHost) {
    log.warn(
      `[csrf] Blocked ${req.method} ${req.originalUrl}: unparseable Origin/Referer=${source}`,
    );
    return res.status(403).json({ error: 'CSRF: invalid Origin/Referer' });
  }

  if (sourceHost === host) return next();
  if (ALLOWED_ORIGINS.has(source) || ALLOWED_ORIGINS.has(sourceHost)) return next();

  log.warn(
    `[csrf] Blocked ${req.method} ${req.originalUrl}: Origin/Referer host=${sourceHost} != Host=${host}`,
  );
  return res.status(403).json({ error: 'CSRF: Origin/Referer mismatch' });
}
