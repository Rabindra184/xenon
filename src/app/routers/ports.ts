import { Router, Request, Response } from 'express';
import { roleGuard } from '../../middleware/roleGuard';
import { scopeGuard } from '../../middleware/scopeGuard';
import log from '../../logger';
import { PortAllocatorService, PortPurpose } from '../../services/ports/PortAllocatorService';

const VALID_PURPOSES: PortPurpose[] = ['systemPort', 'wdaLocalPort', 'chromedriverPort', 'mjpegServerPort'];

interface MakeRouterOpts {
  allocator?: { allocate: PortAllocatorService['allocate'] };
}

/**
 * Factory that returns the ports router. Accepts dependency injection of
 * the allocator for tests; defaults to a fresh PortAllocatorService.
 */
export function makeRouter(opts: MakeRouterOpts = {}): Router {
  const router = Router();
  const allocator = opts.allocator ?? new PortAllocatorService();
  const logger = log.scope('ports-router');

  router.post('/allocate', async (req: Request, res: Response) => {
    const { udid, host, purposes, durationMs, leaseId } = req.body ?? {};
    if (
      typeof udid !== 'string' ||
      typeof host !== 'string' ||
      !Array.isArray(purposes) ||
      purposes.length === 0 ||
      purposes.some((p: string) => !VALID_PURPOSES.includes(p as PortPurpose))
    ) {
      return res.status(400).json({ error: 'bad_request', details: 'udid, host, purposes (non-empty, valid) required' });
    }
    const dur = typeof durationMs === 'number' && durationMs > 0 ? durationMs : 30 * 60 * 1000;
    try {
      const ports = await allocator.allocate({ udid, host, purposes, durationMs: dur, leaseId });
      return res.status(200).json({ ports });
    } catch (err) {
      logger.error(`allocate failed: ${(err as Error).message}`);
      return res.status(500).json({ error: 'allocate_failed', details: (err as Error).message });
    }
  });

  return router;
}

/**
 * Default-export router with auth gates applied. Used by app/index.ts.
 */
export default function register(apiRouter: Router): void {
  const router = Router();
  router.use(roleGuard('ADMIN'));
  router.use(scopeGuard(['devices']));
  router.use(makeRouter());
  apiRouter.use('/ports', router);
}
