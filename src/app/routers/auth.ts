import { Router } from 'express';
import { Container } from 'typedi';
import { ApiKeyService } from '../../services/ApiKeyService';

export function authRouter(): Router {
  const r = Router();
  const svc = Container.get(ApiKeyService);

  r.post('/dashboard-session', async (req, res) => {
    const { apiKey } = req.body as { apiKey?: string };
    if (!apiKey) return res.status(400).json({ error: 'apiKey required' });
    const row = await svc.verify(apiKey);
    if (!row) return res.status(401).json({ error: 'invalid key' });
    const isSecure =
      req.secure || (req.headers['x-forwarded-proto'] as string | undefined) === 'https';
    res.cookie('xenon_dashboard_session', apiKey, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000,
    });
    res.json({ ok: true, scopes: row.scopes });
  });

  // Identity probe for the dashboard. Used by the live-devices view to
  // tell its own manual locks apart from another user's. Requires
  // authentication (apiKeyMiddleware mounts before this router).
  r.get('/me', (req, res) => {
    if (!req.apiKey) return res.status(401).json({ error: 'unauthenticated' });
    res.json({
      userId: req.apiKey.id,
      scopes: req.apiKey.scopes,
      teamId: req.apiKey.teamId ?? null,
    });
  });

  return r;
}
