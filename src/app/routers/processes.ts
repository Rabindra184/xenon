import { Router } from 'express';
import { Container } from 'typedi';
import { ProcessRegistry } from '../../services/ProcessRegistry';
import { scopeGuard } from '../../middleware/scopeGuard';

export function processesRouter(): Router {
  const r = Router();

  r.get('/', scopeGuard(['admin']), (_req, res) => {
    const snapshot = Container.get(ProcessRegistry)
      .snapshot()
      .map(({ id, sessionId, udid, kind, pid, startedAt }) => ({
        id,
        sessionId,
        udid,
        kind,
        pid,
        uptimeMs: Date.now() - startedAt,
      }));
    res.json(snapshot);
  });

  return r;
}
