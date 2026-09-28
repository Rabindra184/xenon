import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { readPresentedCredential } from './commandCaller';
import {
  COMMAND_AUTH_UNAVAILABLE_BODY,
  COMMAND_AUTH_UNAVAILABLE_STATUS,
  CommandAuthDeps,
  summarize,
} from './commandAuth';

/**
 * Appium 3's session listing under per-command auth.
 *
 * `GET <basePath>/appium/sessions` (base-driver's only listing route; Appium 3
 * has no `GET /sessions`) answers every live session's id and capabilities.
 * Appium gates it behind the `session_discovery` insecure feature, but once an
 * operator enables that (Appium Inspector's "attach to session" needs it), it
 * answers anyone, without credentials: the easiest way to find an id to use.
 *
 * With XENON_REQUIRE_COMMAND_AUTH on, the credentials are read exactly as for
 * a session command (commandCaller.ts), and Appium's answer is filtered:
 * - an override admin sees the whole list, untouched;
 * - a verified caller sees the sessions they own, decided for the whole list
 *   with one owner query (SessionOwnerResolver.ownersOf, ownerOf's rule);
 * - no credentials, or credentials that do not verify: an empty list, in
 *   Appium's normal shape, which is exactly what an idle server answers.
 *
 * Appium still produces the listing; this only removes entries from it, by
 * wrapping `res.json` before the route runs. Any other answer (an error, such
 * as session_discovery not being enabled) passes through as Appium wrote it.
 *
 * The owners are looked up when the listing is answered rather than before
 * the route runs, because only then are the listed ids known. The alternative,
 * precomputing "this caller's live sessions", has no reliable "live" signal:
 * `xenon: setSessionStatus` changes a running session's status, and without a
 * status filter it is every session the user ever ran.
 *
 * Fails closed: a credential check that cannot run answers 503 before the
 * route runs, an owner lookup that fails answers 503 instead of the listing,
 * and a listed entry without an id is dropped.
 */

/** The listed sessions in Appium's answer, or null when the answer is not a listing. */
function listingOf(body: unknown): unknown[] | null {
  if (!body || typeof body !== 'object') return null;
  const value = (body as { value?: unknown }).value;
  return Array.isArray(value) ? value : null;
}

function idOf(entry: unknown): string | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const id = (entry as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : undefined;
}

/**
 * The listing route itself: GET, or HEAD (which Express answers from the GET
 * route, with a Content-Length that would otherwise reveal the list's size),
 * on the mounted path exactly. Method override has already run by now.
 */
function isListingRequest(req: Request): boolean {
  return (req.method === 'GET' || req.method === 'HEAD') && req.path === '/';
}

/**
 * Replace the listing in the route's answer with `rewrite(entries)`. The
 * route's JSON answer is intercepted once; an answer that is not a listing is
 * sent as the route wrote it. A rewrite that rejects answers 503.
 */
function rewriteListing(
  res: Response,
  rewrite: (entries: unknown[]) => unknown[] | Promise<unknown[]>,
  onFailure: (error: unknown) => void,
): void {
  const json = res.json;
  res.json = ((body?: unknown) => {
    // One answer per request: restore first, so nothing can run this twice.
    res.json = json;
    const entries = listingOf(body);
    if (!entries) return json.call(res, body);
    const answer = (value: unknown[]) => json.call(res, { ...(body as object), value });

    let rewritten: unknown[] | Promise<unknown[]>;
    try {
      rewritten = rewrite(entries);
    } catch (error) {
      rewritten = Promise.reject(error);
    }
    if (!(rewritten instanceof Promise)) return answer(rewritten);

    rewritten
      .then(answer, (error) => {
        onFailure(error);
        res.status(COMMAND_AUTH_UNAVAILABLE_STATUS);
        json.call(res, COMMAND_AUTH_UNAVAILABLE_BODY);
      })
      .catch((error) => {
        // Only reachable if sending itself threw; the response is past saving.
        onFailure(error);
      });
    return res;
  }) as Response['json'];
}

export function createSessionListingFilter(deps: CommandAuthDeps): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!deps.enabled() || deps.authDisabled()) return next();
    if (!isListingRequest(req)) return next();

    const where = `${req.method} ${String(req.originalUrl ?? req.url).split('?')[0]}`;

    const showNothing = (caller: string, reason: string) =>
      rewriteListing(
        res,
        (entries) => {
          deps.logger.warn(
            `Session listing emptied: ${where} (caller ${caller}): ${reason}; ` +
              `${entries.length} session(s) withheld.`,
          );
          return [];
        },
        () => undefined,
      );

    const showOwn = (userId: string) =>
      rewriteListing(
        res,
        async (entries) => {
          const ids = [...new Set(entries.map(idOf).filter((id): id is string => !!id))];
          const owners =
            ids.length > 0 ? await deps.ownersOf(ids) : new Map<string, string | null>();
          const kept = entries.filter((entry) => {
            const id = idOf(entry);
            return !!id && owners.get(id) === userId;
          });
          deps.logger.info(
            `Session listing filtered: ${where} (caller ${userId}): ` +
              `${kept.length} of ${entries.length} sessions shown.`,
          );
          return kept;
        },
        (error) =>
          deps.logger.error(
            `Session listing unavailable for ${where} (caller ${userId}): ` +
              `owner lookup failed: ${summarize(error)}`,
          ),
      );

    const credential = readPresentedCredential(req.headers);
    if (credential.kind === 'none') {
      // Nobody without credentials owns anything: no lookups.
      showNothing('no credentials', 'no credentials presented');
      return next();
    }

    deps.verifier
      .verify(credential)
      .then(
        (verdict) => {
          if (!verdict.valid) showNothing('invalid credentials', 'credentials did not verify');
          else if (!verdict.caller.overrideAdmin) showOwn(verdict.caller.userId);
          next();
        },
        (error) => {
          deps.logger.error(
            `Session listing unavailable for ${where}: credential check failed: ${summarize(error)}`,
          );
          res.status(COMMAND_AUTH_UNAVAILABLE_STATUS).json(COMMAND_AUTH_UNAVAILABLE_BODY);
        },
      )
      .catch((error) => {
        deps.logger.error(`Session listing check failed for ${where}: ${summarize(error)}`);
        if (!res.headersSent) {
          res.status(COMMAND_AUTH_UNAVAILABLE_STATUS).json(COMMAND_AUTH_UNAVAILABLE_BODY);
        }
      });
  };
}
