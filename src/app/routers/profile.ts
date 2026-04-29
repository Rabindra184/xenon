/// <reference path="../../types/express.d.ts" />
import { Router } from 'express';
import { Container } from 'typedi';
import { ApiKeyService, Scope } from '../../services/ApiKeyService';
import { UserService } from '../../services/UserService';
import { prisma } from '../../prisma';

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

  r.get('/access-key', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const user = await userSvc.findById(auth.userId);
    if (!user) return res.status(404).json({ error: 'user not found' });
    return res.json({ accessKey: user.accessKey });
  });

  r.post('/access-key/rotate', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const updated = await userSvc.rotateAccessKey(auth.userId);
    return res.json({ accessKey: updated.accessKey });
  });

  r.get('/tokens', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const rows = await prisma.apiKey.findMany({
      where: { userId: auth.userId, revokedAt: null },
      select: { id: true, name: true, scopes: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        scopes: row.scopes.split(','),
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
      })),
    );
  });

  r.post('/tokens', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { name, scopes } = req.body as { name?: string; scopes?: Scope[] };
    if (!name) return res.status(400).json({ error: 'name required' });

    const allowed = ROLE_SCOPES[auth.role] ?? ROLE_SCOPES.MEMBER;
    const requested = scopes && scopes.length > 0 ? scopes : allowed;
    if (widenedScope(requested, allowed)) {
      return res.status(400).json({ error: 'cannot widen scopes beyond your role' });
    }
    const { id, raw } = await apiKeySvc.create({
      name,
      scopes: requested,
      userId: auth.userId,
    });
    return res.status(201).json({ id, token: raw });
  });

  r.delete('/tokens/:id', async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const row = await prisma.apiKey.findFirst({
      where: { id: req.params.id, userId: auth.userId },
    });
    if (!row) return res.status(404).json({ error: 'token not found' });
    await apiKeySvc.revoke(req.params.id);
    return res.status(204).end();
  });

  return r;
}
