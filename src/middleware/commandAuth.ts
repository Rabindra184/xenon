import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { IncomingHttpHeaders } from 'http';
import { envSwitchOn } from '../services/sessionTokenGate';
import { CallerVerdict, PresentedCredential, readPresentedCredential } from './commandCaller';

/**
 * Per-command auth for WebDriver session commands.
 *
 * Xenon checks credentials when an Appium session is created. Without this,
 * every later command (`<basePath>/session/:sessionId/...`) is authorized by
 * the session id alone, so anyone who learns an id can drive that session.
 * With XENON_REQUIRE_COMMAND_AUTH on, each of those requests must carry the
 * credentials REST accepts (see commandCaller.ts), and the caller must be the
 * session's owner (SessionOwnerResolver) or an override admin (the
 * canOverrideLease rule: SUPER_ADMIN or an `admin`-scoped credential).
 *
 * A refusal is WebDriver's own unknown-session answer. A caller who may not
 * use a session therefore cannot tell it from one that does not exist, and a
 * client handles it as it would any dead session.
 *
 * Fails closed: a session with no owner on record (created without
 * credentials) is refused for everyone but override admins, and a credential
 * check or owner lookup that could not run answers 503, never a silent allow.
 *
 * Off by default. Never applies when auth is disabled. It runs ahead of
 * Appium's routes (registerCommandAuth.ts), because Appium adds them before a
 * plugin can add anything.
 */

/** XENON_REQUIRE_COMMAND_AUTH, parsed exactly like XENON_REQUIRE_SESSION_TOKEN. */
export function commandAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envSwitchOn(env.XENON_REQUIRE_COMMAND_AUTH);
}

/**
 * What Appium 3 answers for a session command naming a session it does not
 * have: base-driver's NoSuchDriverError (`invalid session id`, HTTP 404) with
 * its default message, keys in the order getResponseForW3CError writes them.
 * Appium puts its server-side stack trace in `stacktrace`. This sends an empty
 * one: W3C leaves the field's content to the implementation, clients read
 * `error` and `message`, and a stack trace would name this module.
 */
export const UNKNOWN_SESSION_STATUS = 404;
export const UNKNOWN_SESSION_BODY = {
  value: {
    error: 'invalid session id',
    message: 'A session is either terminated or not started',
    stacktrace: '',
  },
} as const;

/** A credential check or owner lookup could not run. Retrying may work. */
export const COMMAND_AUTH_UNAVAILABLE_STATUS = 503;
export const COMMAND_AUTH_UNAVAILABLE_BODY = {
  value: {
    error: 'unknown error',
    message: 'Xenon could not verify access to this session. Try again.',
    stacktrace: '',
  },
} as const;

export interface CommandAuthLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface CommandAuthDeps {
  /** XENON_REQUIRE_COMMAND_AUTH, read per request like the session-token gate. */
  enabled: () => boolean;
  /** config.authDisabled: every caller is a synthetic SUPER_ADMIN, so nothing to check. */
  authDisabled: () => boolean;
  verifier: {
    verify(credential: Exclude<PresentedCredential, { kind: 'none' }>): Promise<CallerVerdict>;
  };
  /** SessionOwnerResolver.ownerOf: the session's owning user id, or null. */
  ownerOf: (sessionId: string) => Promise<string | null>;
  /**
   * SessionOwnerResolver.ownersOf: every listed session's owner (null when
   * none is on record) in one query. Filters Appium's session listing.
   */
  ownersOf: (sessionIds: string[]) => Promise<Map<string, string | null>>;
  logger: CommandAuthLogger;
}

export type SessionAccessDecision =
  | { allow: true }
  | { allow: false; caller: string; reason: string }
  | { unavailable: true; stage: string; error: unknown };

/**
 * May the caller presenting these headers use every one of these sessions?
 *
 * The one decision behind per-command auth, shared by the WebDriver command
 * middleware and the session WebSocket guard (sessionUpgradeGuard.ts): an
 * override admin may use any session, anyone else only sessions they own. A
 * WebSocket path can name its session more than one way, so it passes every id
 * Appium might use, and the caller must own each. Never throws: a check that
 * could not run comes back `unavailable`.
 */
export async function decideSessionAccess(
  headers: IncomingHttpHeaders,
  sessionIds: readonly string[],
  deps: Pick<CommandAuthDeps, 'verifier' | 'ownerOf'>,
): Promise<SessionAccessDecision> {
  const credential = readPresentedCredential(headers);
  if (credential.kind === 'none') {
    // Nobody without credentials can be an owner or an admin: no lookups.
    return { allow: false, caller: 'no credentials', reason: 'no credentials presented' };
  }

  let verdict: CallerVerdict;
  try {
    verdict = await deps.verifier.verify(credential);
  } catch (error) {
    return { unavailable: true, stage: 'credential check', error };
  }
  if (!verdict.valid) {
    return { allow: false, caller: 'invalid credentials', reason: 'credentials did not verify' };
  }

  const { caller } = verdict;
  if (caller.overrideAdmin) return { allow: true };

  for (const sessionId of sessionIds) {
    let owner: string | null;
    try {
      owner = await deps.ownerOf(sessionId);
    } catch (error) {
      return { unavailable: true, stage: 'owner lookup', error };
    }
    if (!owner) {
      // Created without credentials, or no such session. Either way nobody but
      // an override admin may drive it.
      return { allow: false, caller: caller.userId, reason: 'no owner on record for this session' };
    }
    if (owner !== caller.userId) {
      return { allow: false, caller: caller.userId, reason: 'not the session owner' };
    }
  }
  return { allow: true };
}

/** The first line of an error's message, so a database error's query dump stays out of the log. */
export function summarize(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const line = message
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (line ?? 'unknown error').slice(0, 200);
}

export function createCommandAuthMiddleware(deps: CommandAuthDeps): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!deps.enabled() || deps.authDisabled()) return next();

    const sessionId = String(req.params?.sessionId ?? '');
    const where = `${req.method} ${String(req.originalUrl ?? req.url).split('?')[0]}`;

    decideSessionAccess(req.headers, [sessionId], deps)
      .then((decision) => {
        if ('unavailable' in decision) {
          deps.logger.error(
            `Command auth unavailable for ${where} (session ${sessionId}): ` +
              `${decision.stage} failed: ${summarize(decision.error)}`,
          );
          res.status(COMMAND_AUTH_UNAVAILABLE_STATUS).json(COMMAND_AUTH_UNAVAILABLE_BODY);
          return;
        }
        if (!decision.allow) {
          deps.logger.warn(
            `Command refused: ${where} (session ${sessionId}, caller ${decision.caller}): ${decision.reason}`,
          );
          res.status(UNKNOWN_SESSION_STATUS).json(UNKNOWN_SESSION_BODY);
          return;
        }
        next();
      })
      .catch((error) => {
        // Only reachable if logging or responding itself threw.
        deps.logger.error(
          `Command auth failed for ${where} (session ${sessionId}): ${summarize(error)}`,
        );
        if (!res.headersSent) {
          res.status(COMMAND_AUTH_UNAVAILABLE_STATUS).json(COMMAND_AUTH_UNAVAILABLE_BODY);
        }
      });
  };
}
