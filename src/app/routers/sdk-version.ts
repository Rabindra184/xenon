import { Router, Request, Response } from 'express';
import pkg from '../../../package.json';
import { roleGuard } from '../../middleware/roleGuard';

const SUPPORTS = ['leases', 'ports', 'heartbeat'] as const;

export default function register(apiRouter: Router): void {
  const router = Router();
  router.use(roleGuard('MEMBER'));
  router.get('/', (_req: Request, res: Response) => {
    res.json({ pluginVersion: pkg.version, supports: [...SUPPORTS] });
  });
  apiRouter.use('/sdk/version', router);
}
