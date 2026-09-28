import { Container } from 'typedi';
import log from '../logger';
import { config } from '../config';
import { SessionOwnerResolver } from '../services/device-access/SessionOwnerResolver';
import {
  CommandAuthDeps,
  commandAuthEnabled,
  createCommandAuthMiddleware,
} from '../middleware/commandAuth';
import { CommandCallerVerifier } from '../middleware/commandCaller';
import { insertBeforeRoutes, InsertResult } from './insertBeforeRoutes';

/**
 * Appium's base-path rule (base-driver `normalizeBasePath`): drop one trailing
 * '/', and add a leading '/' unless the path is empty. `cliArgs.basePath`
 * reaches a plugin as the operator wrote it, while Appium normalises its own
 * copy before building routes, so the guard must normalise the same way or it
 * would miss the routes it is meant to sit in front of.
 */
export function normalizeBasePath(basePath: unknown): string {
  let normalized = typeof basePath === 'string' ? basePath : '';
  normalized = normalized.replace(/\/$/, '');
  if (normalized !== '' && !normalized.startsWith('/')) normalized = `/${normalized}`;
  return normalized;
}

/**
 * Everything under `<basePath>/session/:sessionId`, every method. The create
 * route (`POST <basePath>/session`) has no id segment and does not match.
 */
export function sessionCommandPath(basePath: unknown): string {
  return `${normalizeBasePath(basePath)}/session/:sessionId`;
}

/**
 * Install per-command auth (commandAuth.ts) ahead of Appium's routes. Called
 * from ServerManager.registerRoutes, which Appium runs after adding them.
 *
 * The middleware is always installed and reads the setting per request, so a
 * server with the setting off pays one env check per session command and does
 * no lookups. If it cannot be placed ahead of the routes the error is logged,
 * and with the setting on (and auth enabled) the server refuses to start:
 * an operator who asked for the check must not get a server that silently
 * serves session commands without it.
 */
export function registerCommandAuth(
  app: any,
  cliArgs: { basePath?: unknown },
  overrides: Partial<CommandAuthDeps> = {},
): InsertResult {
  const deps: CommandAuthDeps = {
    enabled: () => commandAuthEnabled(),
    authDisabled: () => config.authDisabled === true,
    verifier: new CommandCallerVerifier(),
    ownerOf: (sessionId) => Container.get(SessionOwnerResolver).ownerOf(sessionId),
    logger: log.scope('CommandAuth'),
    ...overrides,
  };

  const path = sessionCommandPath(cliArgs?.basePath);
  const result = insertBeforeRoutes(app, path, createCommandAuthMiddleware(deps));
  const active = deps.enabled() && !deps.authDisabled();

  if (!result.placed) {
    deps.logger.error(
      `Per-command auth could not be placed ahead of Appium's routes for ${path}: ${result.reason}.`,
    );
    if (active) {
      throw new Error(
        'XENON_REQUIRE_COMMAND_AUTH is on, but the per-command check could not be placed ahead ' +
          "of Appium's WebDriver routes, so it would never run. Refusing to start rather than " +
          'serve session commands unchecked.',
      );
    }
    return result;
  }

  deps.logger.info(
    active
      ? `Per-command auth is ON: every request under ${path} needs the session owner's ` +
          'credentials or an override admin (XENON_REQUIRE_COMMAND_AUTH).'
      : `Per-command auth is off for ${path} (XENON_REQUIRE_COMMAND_AUTH not set, or auth disabled).`,
  );
  return result;
}
