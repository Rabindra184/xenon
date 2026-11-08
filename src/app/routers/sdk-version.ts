import { Router, Request, Response } from 'express';
import pkg from '../../../package.json';
import { roleGuard } from '../../middleware/roleGuard';

/**
 * What a client can rely on, so it asks this list rather than compares
 * versions. Every behaviour a client may need to detect gets a name here in
 * the release that brings it:
 * - `lease-read`: `GET /sdk/leases/:id` (2.20.0).
 * - `lease-extend-never-shortens`: extend makes a lease last at least the
 *   duration asked for and never less than it already does (2.19.0).
 * - `healing-tiers-empty-off`: `xe:options.healingTiers: []` turns healing
 *   off for the session (2.15.0; before, it ran every tier).
 * - `own-phone-leases`: a lease of this server's own phone needs no node
 *   credentials (after 2.20.1), and a lease only another server's phones could
 *   fill, without them, is `500 lab_misconfigured`.
 * - `sensitive-commands`: a command sent with `X-Appium-Is-Sensitive: true`
 *   keeps neither its arguments nor its answer in Xenon's command log and
 *   spans (after 2.20.1).
 * - `mask-input`: `xe:options.maskInput` keeps typed text out of them
 *   (after 2.20.1).
 * - `lease-exclude-tags`: a lease's `filters.excludeTags` leaves out phones
 *   carrying any of those tags (after 2.22.0).
 * - `fingerprint-read`: `GET /healing/fingerprint` describes what this
 *   server has learnt about a selector (after 2.22.0).
 */
const SUPPORTS = [
  'leases',
  'ports',
  'heartbeat',
  'lease-groups',
  'lease-queue',
  'lease-read',
  'lease-extend-never-shortens',
  'healing-tiers-empty-off',
  'own-phone-leases',
  'sensitive-commands',
  'mask-input',
  'lease-exclude-tags',
  'fingerprint-read',
] as const;

export default function register(apiRouter: Router): void {
  const router = Router();
  router.use(roleGuard('MEMBER'));
  router.get('/', (_req: Request, res: Response) => {
    res.json({ pluginVersion: pkg.version, supports: [...SUPPORTS] });
  });
  apiRouter.use('/sdk/version', router);
}
