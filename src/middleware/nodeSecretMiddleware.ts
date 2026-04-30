import { Request, Response, NextFunction } from 'express';
import log from '../logger';
import { config as xenonConfig } from '../config';
import { validateNodeSecret } from '../auth/nodeSecret';
import { ensureLegacyNodeUser } from '../services/identity/legacyNodeUser';

let lastWarnAt = 0;
const lastDeprecationWarnByIp = new Map<string, number>();

// Phase 4B-aware node-secret middleware. Three resolution paths:
//
//   1. Pair-auth headers present (x-xenon-access-key + x-xenon-token):
//      pass through. The downstream authMiddleware will populate req.auth
//      from the pair as it does for any other (accessKey, token) caller.
//
//   2. Legacy x-xenon-node-secret present AND
//      XENON_ACCEPT_LEGACY_NODE_SECRET=true (default for one minor):
//      validate timing-safely. On success, synthesize req.auth pointing
//      at the lazily-created Legacy Node User so downstream guards
//      (roleGuard('ADMIN') + scopeGuard(['devices'])) pass.
//
//   3. Neither shape: fall through. authMiddleware will 401.
//
// When XENON_ACCEPT_LEGACY_NODE_SECRET=false, path 2 returns 401 instead
// of synthesizing — operators must migrate to pair auth.
export function nodeSecretMiddleware(expected: string | undefined) {
  return function (req: Request, res: Response, next: NextFunction) {
    // Path 1: pair auth.
    const pairKey = req.headers['x-xenon-access-key'] as string | undefined;
    const pairTok = req.headers['x-xenon-token'] as string | undefined;
    if (pairKey && pairTok) {
      return next();
    }

    const legacyHeader = req.headers['x-xenon-node-secret'] as string | undefined;

    // No auth headers at all — let authMiddleware do its thing.
    if (!legacyHeader) {
      // Existing legacy warning — once a minute when running without any
      // node-secret AND auth-disabled is true, the route would be wide open.
      if (!expected && xenonConfig.authDisabled === true) {
        return res.status(503).json({
          error:
            'hub-node secret not configured while API-key auth is disabled; set --plugin-xenon-node-secret',
        });
      }
      const now = Date.now();
      if (!expected && now - lastWarnAt > 60_000) {
        log.warn(
          '[nodeSecret] node-secret not configured; hub-node channel falls back to API-key auth. Set --plugin-xenon-node-secret for defense in depth.',
        );
        lastWarnAt = now;
      }
      return next();
    }

    // Path 2: legacy header. Subject to the flag.
    if (xenonConfig.acceptLegacyNodeSecret !== true) {
      return res.status(401).json({
        error:
          'x-xenon-node-secret is rejected; XENON_ACCEPT_LEGACY_NODE_SECRET is false. Migrate this node to (accessKey, token) pair auth.',
      });
    }

    const outcome = validateNodeSecret(legacyHeader, {
      current: expected,
      previous: xenonConfig.nodeSecretPrevious,
    });
    if (outcome === 'reject') {
      return res.status(401).json({ error: 'invalid node secret' });
    }

    // Throttle the deprecation log per source IP.
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || 'unknown';
    const now = Date.now();
    const last = lastDeprecationWarnByIp.get(ip) ?? 0;
    if (now - last > 60_000) {
      log.warn(
        `[nodeSecret] DEPRECATED: ${ip} authenticated via x-xenon-node-secret. Migrate this node to pair auth (XENON_HUB_ACCESS_KEY + XENON_HUB_TOKEN).`,
      );
      lastDeprecationWarnByIp.set(ip, now);
    }

    // Synthesize req.auth so downstream roleGuard + scopeGuard succeed.
    ensureLegacyNodeUser()
      .then((u) => {
        (req as Request & { auth?: any }).auth = {
          kind: 'api-key',
          userId: u.id,
          role: 'ADMIN',
          scopes: 'devices',
          rateLimit: 1000,
          teamIds: undefined,
          apiKeyId: undefined,
          sessionId: undefined,
          teamId: null,
        };
        next();
      })
      .catch((e) => {
        log.error(`[nodeSecret] Legacy Node user lookup failed: ${e?.message ?? e}`);
        res.status(500).json({ error: 'internal server error' });
      });
  };
}
