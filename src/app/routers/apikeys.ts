import { Router } from 'express';
import { Container } from 'typedi';
import { ApiKeyService, Scope } from '../../services/ApiKeyService';
import { scopeGuard } from '../../middleware/scopeGuard';
import { roleGuard } from '../../middleware/roleGuard';
import { keyExpiryWithin } from '../../services/token/mintedLifetime';

const KNOWN_SCOPES: readonly Scope[] = ['read', 'sessions', 'devices', 'admin'];

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
    // Only the scopes that exist. Any string was stored, so a typo made a key
    // with none of the scopes its maker meant.
    if (!scopes.every((s) => (KNOWN_SCOPES as readonly unknown[]).includes(s))) {
      return res.status(400).json({ error: `scopes must be some of ${KNOWN_SCOPES.join(', ')}` });
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
    // Made with a credential that expires, a key ends no later than it.
    const within = keyExpiryWithin(expiresAtDate, req.auth?.credentialExpiresAt);
    if ('error' in within) return res.status(400).json({ error: within.error });
    expiresAtDate = within.expiresAt;

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
