import { Router, Request, Response } from 'express';
import pkg from '../../../package.json';
import { roleGuard } from '../../middleware/roleGuard';

/**
 * What a client can rely on, so it asks this list rather than compares
 * versions:
 * - `sensitive-commands`: a command sent with `X-Appium-Is-Sensitive: true`
 *   keeps neither its arguments nor its answer in Xenon's command log and
 *   spans (after 2.20.1).
 * - `mask-input`: `xe:options.maskInput` keeps typed text out of them
 *   (after 2.20.1).
 */
const SUPPORTS = [
  'leases',
  'ports',
  'heartbeat',
  'lease-groups',
  'lease-queue',
  'sensitive-commands',
  'mask-input',
] as const;

export default function register(apiRouter: Router): void {
  const router = Router();
  router.use(roleGuard('MEMBER'));
  router.get('/', (_req: Request, res: Response) => {
    res.json({ pluginVersion: pkg.version, supports: [...SUPPORTS] });
  });
  apiRouter.use('/sdk/version', router);
}
