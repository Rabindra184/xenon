/// <reference path="../../types/express.d.ts" />
import { Router } from 'express';
import { Container } from 'typedi';
import { ApiKeyService, Scope } from '../../services/ApiKeyService';
import { UserService } from '../../services/UserService';
import { prisma } from '../../prisma';
import { AUTH_DISABLED_USER_ID, resolveEffectiveUserId } from './profileIdentity';
import { keyExpiryWithin } from '../../services/token/mintedLifetime';

const ROLE_SCOPES: Record<string, Scope[]> = {
  SUPER_ADMIN: ['admin'],
  ADMIN: ['devices', 'sessions', 'read'],
  MEMBER: ['sessions', 'read'],
};

const KNOWN_SCOPES: readonly Scope[] = ['read', 'sessions', 'devices', 'admin'];

function isScope(value: unknown): value is Scope {
  return KNOWN_SCOPES.includes(value as Scope);
}

/** Whether a scope list grants `scope`; `admin` grants every scope, as scopeGuard reads it. */
function grants(scopes: readonly string[], scope: Scope): boolean {
  return scopes.includes('admin') || scopes.includes(scope);
}

/**
 * Whether a token with `requested` would reach past the caller's role or past
 * the credential creating it. Through 2.12 only the role was checked, so a
 * `read`-only key of an admin could mint itself a `devices,sessions` token.
 * And a SUPER_ADMIN, whose role's list is just `admin`, could not ask for a
 * narrower token than that.
 */
function widenedScope(requested: Scope[], allowed: Scope[], credential: string): boolean {
  const credentialScopes = credential.split(',').map((s) => s.trim());
  return requested.some((r) => !grants(allowed, r) || !grants(credentialScopes, r));
}

export function profileRouter(): Router {
  const r = Router();
  const userSvc = Container.get(UserService);
  const apiKeySvc = Container.get(ApiKeyService);

  function requireAuth(req: any, res: any) {
    const auth = req.auth;
    if (!auth) {
      res.status(401).json({ error: 'unauthenticated' });
      return null;
    }
    return auth;
  }

  // Map req.auth.userId to a real User id. Auth-disabled mode uses a synthetic
  // userId with no User row; resolve it to the seeded bootstrap SUPER_ADMIN so
  // access-key/token management works as that admin. Real users pass through.
  async function effectiveUserId(rawUserId: string): Promise<string | null> {
    const firstAdminId =
      rawUserId === AUTH_DISABLED_USER_ID
        ? (
            await prisma.user.findFirst({
              where: { role: 'SUPER_ADMIN' },
              orderBy: { createdAt: 'asc' },
              select: { id: true },
            })
          )?.id ?? null
        : null;
    return resolveEffectiveUserId(rawUserId, firstAdminId);
  }

  r.get('/access-key', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const userId = await effectiveUserId(auth.userId);
    const user = userId ? await userSvc.findById(userId) : null;
    if (!user) return res.status(404).json({ error: 'user not found' });
    return res.json({ accessKey: user.accessKey });
  });

  // Rotating the access key ends every key pair its owner has, whatever their
  // scopes, so it takes the person themselves (a dashboard sign-in) or a
  // credential with the admin scope. Through 2.14 any credential could, a
  // read-only token included, and cut off every one of its owner's clients.
  r.post('/access-key/rotate', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const credentialScopes = String(auth.scopes ?? '')
      .split(',')
      .map((s: string) => s.trim());
    if (auth.kind !== 'user-session' && !credentialScopes.includes('admin')) {
      return res.status(403).json({
        error:
          'rotating the access key needs a dashboard sign-in or a credential with the admin scope',
      });
    }
    const userId = await effectiveUserId(auth.userId);
    if (!userId) return res.status(404).json({ error: 'user not found' });
    const updated = await userSvc.rotateAccessKey(userId);
    return res.json({ accessKey: updated.accessKey });
  });

  r.get('/tokens', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const userId = await effectiveUserId(auth.userId);
    if (!userId) return res.json([]);
    const rows = await prisma.apiKey.findMany({
      where: { userId, revokedAt: null },
      select: { id: true, name: true, scopes: true, createdAt: true, lastUsedAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        scopes: row.scopes.split(','),
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        expiresAt: row.expiresAt,
      })),
    );
  });

  r.post('/tokens', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const userId = await effectiveUserId(auth.userId);
    if (!userId) return res.status(404).json({ error: 'user not found' });
    const { name, scopes, expiresAt } = req.body as {
      name?: string;
      scopes?: Scope[];
      expiresAt?: string | null;
    };
    if (!name) return res.status(400).json({ error: 'name required' });

    let expiresAtDate: Date | undefined;
    if (expiresAt !== undefined && expiresAt !== null) {
      const d = new Date(expiresAt);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: 'expiresAt must be an ISO-8601 datetime' });
      }
      if (d.getTime() <= Date.now()) {
        return res.status(400).json({ error: 'expiresAt must be in the future' });
      }
      expiresAtDate = d;
    }

    // A token made with a credential that expires (a Bearer token, an API key
    // with an expiry) ends no later than it. Through 2.14 a 1-hour Bearer
    // token could make itself a key that never expired.
    const within = keyExpiryWithin(expiresAtDate, auth.credentialExpiresAt);
    if ('error' in within) return res.status(400).json({ error: within.error });
    expiresAtDate = within.expiresAt;

    const allowed = ROLE_SCOPES[auth.role] ?? ROLE_SCOPES.MEMBER;
    if (scopes !== undefined && (!Array.isArray(scopes) || !scopes.every(isScope))) {
      return res.status(400).json({ error: `scopes must be some of ${KNOWN_SCOPES.join(', ')}` });
    }
    const requested = scopes && scopes.length > 0 ? scopes : allowed;
    if (widenedScope(requested, allowed, String(auth.scopes ?? ''))) {
      return res
        .status(400)
        .json({ error: 'cannot widen scopes beyond your role or the credential you are using' });
    }
    const { id, raw } = await apiKeySvc.create({
      name,
      scopes: requested,
      userId,
      expiresAt: expiresAtDate,
    });
    return res.status(201).json({
      id,
      token: raw,
      expiresAt: expiresAtDate?.toISOString() ?? null,
    });
  });

  r.delete('/tokens/:id', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const userId = await effectiveUserId(auth.userId);
    const row = userId
      ? await prisma.apiKey.findFirst({ where: { id: req.params.id, userId } })
      : null;
    if (!row) return res.status(404).json({ error: 'token not found' });
    await apiKeySvc.revoke(req.params.id);
    return res.status(204).end();
  });

  return r;
}
