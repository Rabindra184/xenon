import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { appiumPathname, normalizeBasePath } from '../app/appiumBasePath';
import { CommandAuthDeps, decideSessionAccess, summarize } from './commandAuth';

/**
 * Per-command auth for session WebSockets.
 *
 * WebDriver BiDi (`<basePath>/bidi/<sessionId>`, added by Appium's main) and
 * the per-session sockets drivers add (`/ws/session/<sessionId>/...`, e.g.
 * UiAutomator2's logcat and XCUITest's syslog broadcasts) are WebSocket
 * upgrades. They never reach the Express routes commandAuth guards, so without
 * this anyone who has a session id can attach to that session.
 *
 * With XENON_REQUIRE_COMMAND_AUTH on, an upgrade for one of those paths must
 * carry the credentials a session command needs (the `x-xenon-*` pair or a
 * Bearer JWT), from the session's owner or an override admin: the same
 * decision, decideSessionAccess. Anything else is answered `404` on the raw
 * socket, which is then closed, before Appium's handler sees it. A check that
 * cannot run answers `503` the same way. Every other upgrade, including
 * Xenon's own ticketed sockets (`/xenon/api/control/:udid/stream/h264`,
 * `/logcat`) and socket.io, is left exactly as it was.
 *
 * Where Appium handles upgrades depends on the Node version (base-driver
 * `server()`):
 *
 * - Node >= 22.21 / 24.9 (`http.Server#shouldUpgradeCallback` exists): an
 *   `upgrade` listener on the http.Server, added before any plugin's
 *   updateServer runs, so a plugin's own listener always comes after it.
 * - Older Node: an Express middleware (`handleUpgrade`), ahead of the routes.
 *   Node hands an upgrade to Express only while the server has no `upgrade`
 *   listener at all.
 *
 * The check is asynchronous (a credential and an owner lookup), so being first
 * in line is not enough: Appium's handler must not run until the answer is
 * known. Two hooks cover both paths (registerSessionUpgradeGuard):
 *
 * - `guardUpgradeEvents` wraps the http.Server's `emit` for `upgrade`. A
 *   session upgrade is held back from every listener, Appium's included, until
 *   it is allowed, and then emitted to them unchanged. Wrapping the one call
 *   Node makes (`server.emit('upgrade', req, socket, head)`) covers listeners
 *   added before and after, in any order, so Appium's handler can never see a
 *   socket this has refused, and cannot be left out if a later Appium adds its
 *   listener later. Wrapping Appium's listener itself would miss one added
 *   after updateServer.
 * - `middleware`, spliced in front of the whole Express stack, holds a session
 *   upgrade that arrives as a request the same way, and calls `next()` only
 *   when it is allowed.
 *
 * Refusals are identical whether the session exists or not: without an allow,
 * no lookup's result reaches the answer. A socket the client drops mid-check
 * is never handed on.
 */

/** Appium's BiDi path (`BIDI_BASE_PATH`), under the base path. */
const BIDI = '/bidi';
/** base-driver's `DEFAULT_WS_PATHNAME_PREFIX`, where drivers add session sockets. */
const DRIVER_WS = '/ws';

/** The refusal: WebDriver's unknown session is a 404; no body, so nothing to tell apart. */
export const UPGRADE_REFUSED_RESPONSE =
  'HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n';
/** A credential check or owner lookup could not run. Retrying may work. */
export const UPGRADE_UNAVAILABLE_RESPONSE =
  'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Every session id an upgrade to `url` could attach to, the way Appium would
 * route it; empty when it attaches to no session.
 *
 * Appium matches its WebSocket paths with path-to-regexp against
 * `appiumPathname(url)`: case-insensitively, with an optional trailing slash,
 * and decoding a matched parameter. BiDi then reads the session id a second
 * time, from the raw URL (`/bidi/([^/]+)$`, query string included). Both
 * readings count, as do their decoded forms, and the caller must own every one
 * of them, so no spelling of a path can name a session the check did not.
 * An id no session has simply has no owner, and is refused.
 *
 * The umbrella BiDi socket (`<basePath>/bidi`) belongs to no session and is
 * not guarded.
 */
export function sessionIdsOfUpgrade(url: string | undefined, basePath: unknown): string[] {
  const raw = url ?? '';
  const pathname = appiumPathname(raw);
  const base = escapeRegExp(normalizeBasePath(basePath));
  const ids: string[] = [];

  const bidi = new RegExp(`^${base}${BIDI}(?:/([^/]+))?/?$`, 'i').exec(pathname);
  if (bidi) {
    if (bidi[1]) ids.push(bidi[1]);
    const appiumReading = /\/bidi\/([^/]+)$/.exec(raw);
    if (appiumReading) ids.push(appiumReading[1]);
  }

  // Drivers add these without the base path; accept it too, in case one does.
  const driver = new RegExp(`^(?:${base})?${DRIVER_WS}/session/([^/]+)(?:/|$)`, 'i').exec(pathname);
  if (driver) ids.push(driver[1]);

  return [...new Set(ids.flatMap((id) => [id, decoded(id)]))];
}

/** The same test Appium applies before it looks at a path. */
function isWebSocketUpgrade(req: IncomingMessage): boolean {
  const upgrade = req.headers?.upgrade;
  return typeof upgrade === 'string' && upgrade.toLowerCase() === 'websocket';
}

/** Answer on the raw socket, then close it. */
function answerAndClose(socket: Duplex, response: string): void {
  if (socket.destroyed) return;
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.once('finish', () => socket.destroy());
  socket.end(response);
}

export interface SessionUpgradeGuard {
  /**
   * Take over an `upgrade` event if it is a session upgrade to check: returns
   * true, and calls `proceed` later if and only if it is allowed. Returns false
   * for everything else, which the caller hands on at once.
   */
  hold(req: IncomingMessage, socket: Duplex, proceed: () => void): boolean;
  /** The same check for an upgrade Node hands to Express as a request. */
  middleware: RequestHandler;
}

export function createSessionUpgradeGuard(
  basePath: unknown,
  deps: CommandAuthDeps,
): SessionUpgradeGuard {
  const sessionsOf = (req: IncomingMessage): string[] | null => {
    if (!deps.enabled() || deps.authDisabled()) return null;
    if (!isWebSocketUpgrade(req)) return null;
    const ids = sessionIdsOfUpgrade(req.url, basePath);
    return ids.length > 0 ? ids : null;
  };

  const judge = (
    req: IncomingMessage,
    socket: Duplex,
    sessionIds: string[],
    proceed: () => void,
  ): void => {
    const where = `upgrade ${String((req as Request).originalUrl ?? req.url ?? '').split('?')[0]}`;
    const sessions = sessionIds.join(', ');

    // Node removes its own socket error handler before it emits 'upgrade',
    // and nothing else is listening until a WebSocket server takes the
    // socket. A client reset during the check would otherwise be an unhandled
    // 'error' event, which ends the process.
    const onError = () => socket.destroy();
    socket.on('error', onError);

    decideSessionAccess(req.headers, sessionIds, deps)
      .then((decision) => {
        if ('unavailable' in decision) {
          deps.logger.error(
            `Session WebSocket check unavailable for ${where} (session ${sessions}): ` +
              `${decision.stage} failed: ${summarize(decision.error)}`,
          );
          answerAndClose(socket, UPGRADE_UNAVAILABLE_RESPONSE);
          return;
        }
        if (!decision.allow) {
          deps.logger.warn(
            `Session WebSocket refused: ${where} (session ${sessions}, caller ${decision.caller}): ` +
              decision.reason,
          );
          answerAndClose(socket, UPGRADE_REFUSED_RESPONSE);
          return;
        }
        // The client left while we checked: there is nothing to hand on.
        if (socket.destroyed) return;
        socket.removeListener('error', onError);
        proceed();
      })
      .catch((error) => {
        // Only reachable if logging, answering or the handler itself threw.
        deps.logger.error(`Session WebSocket check failed for ${where}: ${summarize(error)}`);
        socket.destroy();
      });
  };

  return {
    hold(req, socket, proceed) {
      const sessionIds = sessionsOf(req);
      if (!sessionIds) return false;
      judge(req, socket, sessionIds, proceed);
      return true;
    },
    middleware(req: Request, _res: Response, next: NextFunction) {
      const sessionIds = sessionsOf(req);
      if (!sessionIds) return next();
      judge(req, req.socket, sessionIds, () => next());
    },
  };
}

interface EmittingServer {
  emit(event: string | symbol, ...args: any[]): boolean;
}

/**
 * Route every `upgrade` event through the guard before any listener sees it
 * (see the module comment for why `emit`). Everything else, and every upgrade
 * the guard does not take, is emitted at once and unchanged.
 */
export function guardUpgradeEvents(server: EmittingServer, guard: SessionUpgradeGuard): void {
  const emit = server.emit;
  server.emit = function emitThroughSessionGuard(
    this: unknown,
    event: string | symbol,
    ...args: any[]
  ): boolean {
    if (event === 'upgrade') {
      const [req, socket] = args as [IncomingMessage, Duplex];
      if (guard.hold(req, socket, () => emit.call(this, event, ...args))) return true;
    }
    return emit.call(this, event, ...args);
  };
}
