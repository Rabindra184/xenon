/// <reference path="../../types/express.d.ts" />
import { Router } from 'express';
import { Container } from 'typedi';
import { ApiKeyService, Scope } from '../../services/ApiKeyService';
import { UserService } from '../../services/UserService';
import { prisma } from '../../prisma';
import { AUTH_DISABLED_USER_ID, resolveEffectiveUserId } from './profileIdentity';

const ROLE_SCOPES: Record<string, Scope[]> = {
  SUPER_ADMIN: ['admin'],
  ADMIN: ['devices', 'sessions', 'read'],
  MEMBER: ['sessions', 'read'],
};

function widenedScope(requested: Scope[], allowed: Scope[]): boolean {
  // 'admin' is widening for any non-super-admin allowed set.
  for (const r of requested) {
    if (r === 'admin' && !allowed.includes('admin')) return true;
    if (!allowed.includes(r)) return true;
  }
  return false;
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

  r.post('/access-key/rotate', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
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

    const allowed = ROLE_SCOPES[auth.role] ?? ROLE_SCOPES.MEMBER;
    const requested = scopes && scopes.length > 0 ? scopes : allowed;
    if (widenedScope(requested, allowed)) {
      return res.status(400).json({ error: 'cannot widen scopes beyond your role' });
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
