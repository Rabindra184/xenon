import { Router, Request, Response } from 'express';
import { Container } from 'typedi';
import { roleGuard } from '../../middleware/roleGuard';
import { mutationScopeGuard } from '../../middleware/scopeGuard';
import { leaseTokenMiddleware } from '../../middleware/leaseTokenMiddleware';
import {
  LeaseService, NoMatchingDevice, AllMatchingBusy, DeviceUnhealthy,
  LeaseTokenMismatch, LeaseGone,
} from '../../services/lease/LeaseService';
import log from '../../logger';

interface MakeRouterOpts {
  leaseService?: any;
}

export function makeRouter(opts: MakeRouterOpts = {}): Router {
  const router = Router();
  const svc = opts.leaseService ?? Container.get(LeaseService);
  const logger = log.scope('sdk-leases-router');

  router.post('/', async (req: Request, res: Response) => {
    const { filters, durationMs, heartbeatSeconds, reason, buildId } = req.body ?? {};
    if (!filters || typeof filters.platform !== 'string') {
      return res.status(400).json({ error: 'bad_request', details: 'filters.platform required' });
    }
    const apiKey: any = (req as any).apiKey;
    try {
      const out = await svc.create({
        filters,
        durationMs: typeof durationMs === 'number' ? durationMs : 30 * 60 * 1000,
        heartbeatSeconds: typeof heartbeatSeconds === 'number' ? heartbeatSeconds : 30,
        actorId: apiKey?.id ?? 'anonymous',
        teamId: apiKey?.teamId ?? null,
        buildId,
        reason,
      });
      return res.status(201).json(out);
    } catch (err) {
      if (err instanceof NoMatchingDevice) {
        return res.status(404).json({ error: 'no_matching_device', message: err.message });
      }
      if (err instanceof AllMatchingBusy) {
        return res.status(409).json({ error: 'all_matching_busy', retryAfterMs: 2_000 });
      }
      if (err instanceof DeviceUnhealthy) {
        return res.status(503).json({ error: 'device_unhealthy', details: err.message });
      }
      logger.error(`create failed: ${(err as Error).message}`);
      return res.status(500).json({ error: 'internal', message: (err as Error).message });
    }
  });

  router.post('/:id/heartbeat', leaseTokenMiddleware, async (req: Request, res: Response) => {
    try {
      const out = await svc.heartbeat(req.params.id, (req as any).leaseToken);
      return res.status(200).json(out);
    } catch (err) {
      if (err instanceof LeaseTokenMismatch) return res.status(403).json({ error: 'token_mismatch' });
      if (err instanceof LeaseGone) return res.status(410).json({ error: 'gone', message: (err as Error).message });
      return res.status(500).json({ error: 'internal', message: (err as Error).message });
    }
  });

  router.post('/:id/extend', leaseTokenMiddleware, async (req: Request, res: Response) => {
    const { durationMs } = req.body ?? {};
    if (typeof durationMs !== 'number') return res.status(400).json({ error: 'bad_request', details: 'durationMs required' });
    try {
      const out = await svc.extend(req.params.id, (req as any).leaseToken, durationMs);
      return res.status(200).json(out);
    } catch (err) {
      if (err instanceof LeaseTokenMismatch) return res.status(403).json({ error: 'token_mismatch' });
      if (err instanceof LeaseGone) return res.status(410).json({ error: 'gone' });
      return res.status(500).json({ error: 'internal', message: (err as Error).message });
    }
  });

  router.delete('/:id', leaseTokenMiddleware, async (req: Request, res: Response) => {
    try {
      await svc.release(req.params.id, (req as any).leaseToken);
      return res.status(204).send();
    } catch (err) {
      if (err instanceof LeaseTokenMismatch) return res.status(403).json({ error: 'token_mismatch' });
      if (err instanceof LeaseGone) return res.status(404).json({ error: 'not_found' });
      return res.status(500).json({ error: 'internal', message: (err as Error).message });
    }
  });

  return router;
}

export default function register(apiRouter: Router): void {
  const router = Router();
  router.use(roleGuard('MEMBER'));
  router.use(mutationScopeGuard(['devices']));
  router.use(makeRouter());
  apiRouter.use('/sdk/leases', router);
}
