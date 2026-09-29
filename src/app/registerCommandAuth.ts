import { Container } from 'typedi';
import log from '../logger';
import { config } from '../config';
import { SessionOwnerResolver } from '../services/device-access/SessionOwnerResolver';
import { CommandAuthDeps, commandAuthEnabled } from '../middleware/commandAuth';
import { CommandCallerVerifier } from '../middleware/commandCaller';
import { createSessionListingFilter } from '../middleware/sessionListingFilter';
import { createSessionUpgradeGuard, guardUpgradeEvents } from '../middleware/sessionUpgradeGuard';
import { createInternalCallLayer } from '../gateway/internalCall';
import { createSessionGatewayLayer, SessionGatewayDeps } from '../gateway/sessionGateway';
import { normalizeBasePath } from './appiumBasePath';
import { insertAtStart, insertBeforeRoutes, InsertResult } from './insertBeforeRoutes';

export { normalizeBasePath };

/**
 * Everything under `<basePath>/session/:sessionId`, every method. The create
 * route (`POST <basePath>/session`) has no id segment and does not match.
 */
export function sessionCommandPath(basePath: unknown): string {
  return `${normalizeBasePath(basePath)}/session/:sessionId`;
}

/** Appium 3's session listing route (base-driver `getAppiumSessions`). */
export function sessionListingPath(basePath: unknown): string {
  return `${normalizeBasePath(basePath)}/appium/sessions`;
}

/**
 * The dependencies per-command auth runs with. ServerManager builds one set
 * and hands it to both registrations below, so commands, the session listing
 * and session WebSockets share one credential cache.
 */
export function commandAuthDeps(overrides: Partial<CommandAuthDeps> = {}): CommandAuthDeps {
  return {
    enabled: overrides.enabled ?? (() => commandAuthEnabled()),
    authDisabled: overrides.authDisabled ?? (() => config.authDisabled === true),
    verifier: overrides.verifier ?? new CommandCallerVerifier(),
    ownerOf:
      overrides.ownerOf ?? ((sessionId) => Container.get(SessionOwnerResolver).ownerOf(sessionId)),
    ownersOf:
      overrides.ownersOf ??
      ((sessionIds) => Container.get(SessionOwnerResolver).ownersOf(sessionIds)),
    logger: overrides.logger ?? log.scope('CommandAuth'),
  };
}

const refuseToStart = (what: string) =>
  new Error(
    `XENON_REQUIRE_COMMAND_AUTH is on, but ${what}. Refusing to start rather than ` +
      'serve sessions unchecked.',
  );

/** What a server adds to the session gateway beyond per-command auth. */
export type SessionGatewayOptions = Omit<SessionGatewayDeps, 'auth'>;

/**
 * Install the session gateway (gateway/sessionGateway.ts) and the
 * session-listing filter (sessionListingFilter.ts) ahead of Appium's routes.
 * Called from ServerManager.registerRoutes, which Appium runs after adding
 * them. The gateway is two adjacent layers:
 *
 * 1. the internal-call layer (gateway/internalCall.ts), path-less, which turns
 *    Xenon's own `<basePath>/wd-internal/...` calls, when they carry this
 *    process's secret, into the plain session command;
 * 2. the session layer at `<basePath>/session/:sessionId`: per-command auth,
 *    then, on a hub, forwarding of the sessions other servers run.
 *
 * The first comes first, so the session layer sees an internal call by its
 * real path and knows it for one. It is path-less because Express puts a mount
 * path back onto the URL when a mounted layer calls next(), which would undo
 * the strip. The second is mounted, so its path matching is the router's own.
 *
 * All of it is always installed and reads the setting per request, so a
 * server with per-command auth off pays one env check per session command and
 * does no lookups for it. If a layer cannot be placed ahead of the routes the
 * error is logged, and with the setting on (and auth enabled) the server
 * refuses to start: an operator who asked for the check must not get a server
 * that silently serves session commands without it.
 *
 * Returns where the session layer was placed.
 */
export function registerSessionGateway(
  app: any,
  cliArgs: { basePath?: unknown },
  deps: CommandAuthDeps,
  options: SessionGatewayOptions = {},
): InsertResult {
  const active = deps.enabled() && !deps.authDisabled();
  const basePath = normalizeBasePath(cliArgs?.basePath);

  const path = sessionCommandPath(basePath);
  const internal = insertBeforeRoutes(app, '/', createInternalCallLayer(basePath));
  const result = internal.placed
    ? insertBeforeRoutes(app, path, createSessionGatewayLayer({ ...options, auth: deps }))
    : internal;
  if (!result.placed) {
    deps.logger.error(
      `Per-command auth could not be placed ahead of Appium's routes for ${path}: ${result.reason}.`,
    );
    if (active) {
      throw refuseToStart(
        "the per-command check could not be placed ahead of Appium's WebDriver routes, " +
          'so it would never run',
      );
    }
    return result;
  }

  const listingPath = sessionListingPath(cliArgs?.basePath);
  const listing = insertBeforeRoutes(app, listingPath, createSessionListingFilter(deps));
  if (!listing.placed) {
    deps.logger.error(
      "The session-listing filter could not be placed ahead of Appium's routes for " +
        `${listingPath}: ${listing.reason}.`,
    );
    if (active) {
      throw refuseToStart(`the session-listing filter could not be placed ahead of ${listingPath}`);
    }
    return result;
  }

  deps.logger.info(
    active
      ? `Per-command auth is ON: every request under ${path} needs the session owner's ` +
          `credentials or an override admin, and ${listingPath} lists only the caller's ` +
          'sessions (XENON_REQUIRE_COMMAND_AUTH).'
      : `Per-command auth is off for ${path} and ${listingPath} ` +
          '(XENON_REQUIRE_COMMAND_AUTH not set, or auth disabled).',
  );
  return result;
}

/**
 * Per-command auth (commandAuth.ts) and the session-listing filter, through the
 * session gateway with no routing: a server that runs every session itself.
 */
export function registerCommandAuth(
  app: any,
  cliArgs: { basePath?: unknown },
  overrides: Partial<CommandAuthDeps> = {},
): InsertResult {
  return registerSessionGateway(app, cliArgs, commandAuthDeps(overrides));
}

/**
 * Install the session WebSocket guard (sessionUpgradeGuard.ts) on both of the
 * paths Appium can take an upgrade by: the http.Server's `upgrade` event and
 * the front of the Express stack. Called from ServerManager.updateServer with
 * the http.Server Appium hands plugins.
 *
 * Like registerCommandAuth, it is always installed and reads the setting per
 * upgrade; with the setting off every upgrade passes straight through. If
 * either hook cannot be installed the error is logged, and with the setting on
 * the server refuses to start.
 */
export function registerSessionUpgradeGuard(
  httpServer: any,
  app: any,
  cliArgs: { basePath?: unknown },
  overrides: Partial<CommandAuthDeps> = {},
): InsertResult {
  const deps = commandAuthDeps(overrides);
  const active = deps.enabled() && !deps.authDisabled();
  const basePath = normalizeBasePath(cliArgs?.basePath);
  const guard = createSessionUpgradeGuard(basePath, deps);

  const problems: string[] = [];
  if (httpServer && typeof httpServer.emit === 'function') {
    guardUpgradeEvents(httpServer, guard);
  } else {
    problems.push('no HTTP server was given to guard');
  }
  const front = insertAtStart(app, guard.middleware);
  if (!front.placed) problems.push(`the Express guard was not placed: ${front.reason}`);

  if (problems.length > 0) {
    const reason = problems.join('; ');
    deps.logger.error(`The session WebSocket guard could not be installed: ${reason}.`);
    if (active) {
      throw refuseToStart(
        `session WebSockets (${basePath}/bidi/<id>, /ws/session/<id>/...) could not be guarded`,
      );
    }
    return { placed: false, shape: front.shape, reason };
  }

  deps.logger.info(
    active
      ? `Session WebSocket guard is ON: upgrades to ${basePath}/bidi/:sessionId and ` +
          "/ws/session/:sessionId/... need the session owner's credentials or an override admin."
      : 'Session WebSocket guard is off (XENON_REQUIRE_COMMAND_AUTH not set, or auth disabled).',
  );
  return front;
}
