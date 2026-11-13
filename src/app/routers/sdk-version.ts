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
 * - `ai-redaction`: the server option `aiRedaction` redacts text and can
 *   withhold screenshots from every AI call (after 2.23.0).
 * - `trace-context`: a session create's and a command's W3C `traceparent`
 *   (header, or `xe:options.traceparent` on a create) is joined by Xenon's
 *   spans and command log (after 2.24.0).
 * - `app-reuse`: an uploaded app named by id is downloaded at most once per
 *   build per host, with sign-in on too (after 2.25.0).
 * - `ci-app-store`: a member uploads into their own teams with the `apps`
 *   scope, an iOS app's bundle id, version and build number are read, and
 *   `GET /apps?md5=` looks a build up (after 2.26.0).
 * - `network-profile-mid-session`: `xenon: setNetworkProfile` changes the
 *   session's network profile, and on an Android emulator 4G, 3G and Edge
 *   shape the app's own traffic (after 2.28.0).
 * - `node-command-spans`: a hub makes a span for each command it forwards to
 *   a node or a cloud provider, and sends the node that span as the
 *   command's `traceparent` (after 2.29.0).
 * - `lifecycle-webhooks`: webhooks can take `session_started`,
 *   `session_stopped` (every outcome) and `healing_event` (after 2.30.1).
 * - `real-phone-shaping`: 4G, 3G and Edge shape a real Android phone's
 *   proxy-aware traffic through a relay on the server that drives it (after
 *   2.31.0).
 * - `observer-recording`: `POST /recordings` takes `sessionIds`, the caller's
 *   own sessions, and records their phones without holding them or touching
 *   the test; the group stops when the first of them ends (after 2.32.0).
 * - `phone-host`: a phone is named by udid and host: `?host=` on `/control`
 *   and `PUT /device/:udid/team`, `{ udid, host }` in `POST /recordings`
 *   and `add-device`; a udid two servers report, named without a host, is
 *   `409 ambiguous_phone` with the hosts to choose from (after 2.33.0).
 * - `phone-host-events`: every live event about a phone is delivered by the
 *   exact phone (udid and host), reaching only the sockets that may see it,
 *   and the events that carry a phone's udid name its host beside it
 *   (website/docs/real-time-events.md);
 *   the recording answers (start, add-device, stop, active, the group's
 *   phones) carry each recording's `host`; `GET /recordings` and
 *   `video.mp4` take `host` beside `udid` (after 2.34.0).
 * - `lease-host`: a lease's `filters.host` takes only the phone on that
 *   server (after 2.35.0).
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
  'ai-redaction',
  'trace-context',
  'app-reuse',
  'ci-app-store',
  'network-profile-mid-session',
  'node-command-spans',
  'lifecycle-webhooks',
  'real-phone-shaping',
  'observer-recording',
  'phone-host',
  'phone-host-events',
  'lease-host',
] as const;

export default function register(apiRouter: Router): void {
  const router = Router();
  router.use(roleGuard('MEMBER'));
  router.get('/', (_req: Request, res: Response) => {
    res.json({ pluginVersion: pkg.version, supports: [...SUPPORTS] });
  });
  apiRouter.use('/sdk/version', router);
}
