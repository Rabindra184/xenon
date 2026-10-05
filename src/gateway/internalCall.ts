import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes, timingSafeEqual } from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { normalizeBasePath } from '../app/appiumBasePath';

/**
 * Xenon's own loopback calls to its Appium server.
 *
 * A LocalSession asks its own server for a few things over HTTP (a page
 * source or a screen recording when the in-process driver call fails). Those
 * go to `<basePath>/wd-internal/session/<id>/...`, carrying this header with
 * a secret made once per process. The session gateway recognises such a call
 * only when both are present: it strips `/wd-internal` so Appium's own route
 * answers, and lets the call skip per-command auth, since it is Xenon asking
 * about a session it already runs.
 *
 * The path proves nothing on its own. Without the secret a `/wd-internal`
 * request is left exactly as it came, matches no route, and gets Appium's
 * unknown-route answer. Before this, the path alone was the marker, which on a
 * server with per-command auth on was a way around it.
 *
 * The secret never leaves the process: it is sent only to this server's own
 * address, with any HTTP proxy bypassed, and the gateway removes the header
 * before anything after it sees the request.
 *
 * Such a call is never one of the test's commands. The rest of its request
 * runs in an async context the plugin can read (`isInsideInternalCall`), since
 * the plugin's `handle`, deep inside Appium's route, is never given the
 * request. Through 2.16 it couldn't tell, so the dashboard recorded the call
 * as the session's own: a performance recording's stop the driver refused at
 * the end of an iPhone session (through 2.15, of every simulator session)
 * failed a session whose commands had all passed.
 */

export const INTERNAL_CALL_HEADER = 'x-xenon-internal';
export const INTERNAL_CALL_MARKER = '/wd-internal';

const SECRET = Buffer.from(randomBytes(32).toString('base64url'));
const INTERNAL = Symbol('xenon.internalCall');
const internalCalls = new AsyncLocalStorage<true>();

/** The headers a loopback call to this process's own server carries. */
export function internalCallHeaders(): Record<string, string> {
  return { [INTERNAL_CALL_HEADER]: SECRET.toString() };
}

/** Whether these headers carry this process's secret. Constant-time. */
export function hasInternalCallSecret(headers: IncomingHttpHeaders): boolean {
  const presented = headers[INTERNAL_CALL_HEADER];
  if (typeof presented !== 'string') return false;
  const candidate = Buffer.from(presented);
  return candidate.length === SECRET.length && timingSafeEqual(candidate, SECRET);
}

/** Whether the internal-call layer accepted this request as Xenon's own. */
export function isInternalCall(req: unknown): boolean {
  return !!req && (req as Record<symbol, unknown>)[INTERNAL] === true;
}

/**
 * Whether this code runs for a request the internal-call layer accepted: the
 * plugin's `handle` and the driver's command under it, which never see the
 * request itself.
 *
 * Read it where a command enters the plugin (CommandInterceptor.handle). It
 * also holds in whatever the driver starts during the call and runs later (a
 * timer, a socket's callback): base-driver's new-command timer, restarted at
 * the call's end, fires inside it, and so does an idle session's shutdown.
 */
export function isInsideInternalCall(): boolean {
  return internalCalls.getStore() === true;
}

/**
 * Where a local session's loopback calls go: this server, under its base
 * path, marked `/wd-internal`. A wildcard bind address is reached on 127.0.0.1.
 */
export function internalCallBaseUrl(address: string, port: number, basePath: unknown): string {
  const wildcard = !address || address === '0.0.0.0' || address === '::';
  const host = wildcard ? '127.0.0.1' : address.includes(':') ? `[${address}]` : address;
  return `http://${host}:${port}${normalizeBasePath(basePath)}${INTERNAL_CALL_MARKER}`;
}

/**
 * The layer that recognises internal calls. Path-less, because Express puts a
 * mount path back onto `req.url` when a mounted layer calls `next()`, which
 * would undo the strip. The marker is compared exactly as Xenon writes it:
 * any other spelling is not an internal call and falls through untouched.
 */
export function createInternalCallLayer(basePath: unknown): RequestHandler {
  const base = normalizeBasePath(basePath);
  const prefix = `${base}${INTERNAL_CALL_MARKER}`;

  /** Accept the call as Xenon's own, rewriting it in place; false leaves it untouched. */
  function accept(req: Request): boolean {
    const url = req.url;
    const rest = url.startsWith(prefix) ? url.slice(prefix.length) : undefined;
    if (rest === undefined || (rest !== '' && rest[0] !== '/' && rest[0] !== '?')) return false;
    if (!hasInternalCallSecret(req.headers)) return false;

    delete req.headers[INTERNAL_CALL_HEADER];
    (req as unknown as Record<symbol, unknown>)[INTERNAL] = true;
    req.url = `${base}${rest}` || '/';
    req.originalUrl = req.url;
    return true;
  }

  // Every request this layer leaves alone goes on through the one call to
  // next() below: Appium's 404 carries a stack trace, and a second call site
  // would make a refused /wd-internal request's answer differ from any other
  // unknown route's by that one frame. An accepted call goes on inside its
  // context, down to the plugin's handle (isInsideInternalCall).
  return function xenonInternalCalls(req: Request, _res: Response, next: NextFunction) {
    if (accept(req)) internalCalls.run(true, next);
    else next();
  };
}
