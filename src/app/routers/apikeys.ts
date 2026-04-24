import { Router } from 'express';
import { Container } from 'typedi';
import { ApiKeyService, Scope } from '../../services/ApiKeyService';
import { scopeGuard } from '../../middleware/scopeGuard';

export function apiKeysRouter(): Router {
  const r = Router();
  const svc = Container.get(ApiKeyService);

  r.get('/', scopeGuard(['admin']), async (_req, res) => {
    res.json(await svc.list());
  });

  r.post('/', scopeGuard(['admin']), async (req, res) => {
    const { name, scopes, rateLimit, teamId } = req.body as {
      name: string;
      scopes: Scope[];
      rateLimit?: number;
      teamId?: string | null;
    };
    if (!name || !Array.isArray(scopes) || scopes.length === 0) {
      return res.status(400).json({ error: 'name and scopes required' });
    }
    const { id, raw } = await svc.create({ name, scopes, rateLimit, teamId: teamId ?? null });
    res.json({ id, key: raw });
  });

  r.delete('/:id', scopeGuard(['admin']), async (req, res) => {
    await svc.revoke(req.params.id);
    res.json({ ok: true });
  });

  return r;
}
