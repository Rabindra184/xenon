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

  return r;
}
