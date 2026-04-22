import { Router } from 'express';
import { Container } from 'typedi';
import { ApiKeyService, Scope } from '../../services/ApiKeyService';
import { scopeGuard } from '../../middleware/scopeGuard';

export function apiKeysRouter(): Router {
  const r = Router();
  const svc = Container.get(ApiKeyService);

  r.post('/', scopeGuard(['admin']), async (req, res) => {
    const { name, scopes, rateLimit } = req.body as {
      name: string;
      scopes: Scope[];
      rateLimit?: number;
    };
    if (!name || !Array.isArray(scopes) || scopes.length === 0) {
      return res.status(400).json({ error: 'name and scopes required' });
    }
    const { id, raw } = await svc.create({ name, scopes, rateLimit });
    res.json({ id, key: raw });
  });

  r.delete('/:id', scopeGuard(['admin']), async (req, res) => {
    await svc.revoke(req.params.id);
    res.json({ ok: true });
  });

  return r;
}
