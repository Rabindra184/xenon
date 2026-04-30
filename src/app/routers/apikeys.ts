import { Router } from 'express';
import { Container } from 'typedi';
import { ApiKeyService, Scope } from '../../services/ApiKeyService';
import { scopeGuard } from '../../middleware/scopeGuard';
import { roleGuard } from '../../middleware/roleGuard';

export function apiKeysRouter(): Router {
  const r = Router();
  r.use(roleGuard('ADMIN'));
  const svc = Container.get(ApiKeyService);

  r.get('/', scopeGuard(['admin']), async (_req, res) => {
    res.json(await svc.list());
  });

  r.post('/', scopeGuard(['admin']), async (req, res) => {
    const { name, scopes, rateLimit, teamId, expiresAt } = req.body as {
      name: string;
      scopes: Scope[];
      rateLimit?: number;
      teamId?: string | null;
      expiresAt?: string | null;
    };
    if (!name || !Array.isArray(scopes) || scopes.length === 0) {
      return res.status(400).json({ error: 'name and scopes required' });
    }

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

    const { id, raw } = await svc.create({
      name,
      scopes,
      rateLimit,
      teamId: teamId ?? null,
      userId: req.auth!.userId,
      expiresAt: expiresAtDate,
    });
    res.json({ id, key: raw, expiresAt: expiresAtDate?.toISOString() ?? null });
  });

  r.delete('/:id', scopeGuard(['admin']), async (req, res) => {
    await svc.revoke(req.params.id);
    res.json({ ok: true });
  });

  return r;
}
