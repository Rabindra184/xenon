import type { NextFunction, Request, Response } from 'express';
import log from '../logger';

/**
 * Errors under /xenon/api always get a JSON answer.
 *
 * Express 4 ignores the promise a handler returns. An async handler that
 * threw after an `await` left its request without an answer until the
 * client gave up, and only logged an unhandled rejection. That is what made
 * deleting an unknown API key, or creating a user whose email exists, hang.
 * Express 5 forwards a rejected promise to the error handlers; this gives
 * Express 4 the same behaviour, for every route, so a handler doesn't need
 * a try/catch of its own to be answered.
 */

const scoped = log.scope('API');
let installed = false;

/**
 * Makes Express 4 send an async handler's rejection to `next(err)`, as
 * Express 5 does. Idempotent; affects the routers of this package's own copy
 * of Express only (Appium's routes run on its own Express 5).
 */
export function forwardAsyncErrors(): void {
  if (installed) return;
  installed = true;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Layer = require('express/lib/router/layer');
  Layer.prototype.handle_request = function handleRequest(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const fn = this.handle;
    // An error handler (4 arguments) is never called for a normal request.
    if (fn.length > 3) return next();
    try {
      const result = fn(req, res, next);
      if (result && typeof result.then === 'function') {
        result.then(undefined, (err: unknown) =>
          next(err ?? new Error('A route handler rejected without a reason')),
        );
      }
    } catch (err) {
      next(err);
    }
  };
}

type ErrorAnswer = { status: number; body: { error: string; message?: string } };

const isPrismaError = (err: any): boolean =>
  typeof err?.code === 'string' && /^P\d{4}$/.test(err.code) && 'clientVersion' in err;

/** The answer for an error, by what it is; null for one we know nothing about. */
export function answerFor(err: any): ErrorAnswer | null {
  // A body that isn't JSON, or one past the size limit (body-parser).
  if (err?.type === 'entity.parse.failed') {
    return {
      status: 400,
      body: { error: 'bad_request', message: 'The request body is not valid JSON' },
    };
  }
  if (err instanceof URIError) {
    return {
      status: 400,
      body: { error: 'bad_request', message: 'The URL has a malformed % escape' },
    };
  }
  if (isPrismaError(err)) {
    // The record the request names doesn't exist (update or delete by id).
    if (err.code === 'P2025')
      return { status: 404, body: { error: 'not_found', message: 'Not found' } };
    // A unique field is already taken.
    if (err.code === 'P2002') {
      const target = err.meta?.target;
      const fields = Array.isArray(target)
        ? target.join(', ')
        : typeof target === 'string'
          ? target
          : '';
      return {
        status: 409,
        body: {
          error: 'conflict',
          message: fields ? `${fields} is already in use` : 'Already exists',
        },
      };
    }
    return null;
  }
  // An error that carries its own 4xx status (http-errors, body-parser's 413).
  const status = Number(err?.status ?? err?.statusCode);
  if (status >= 400 && status < 500) {
    return { status, body: { error: err.expose === false ? 'bad_request' : String(err.message) } };
  }
  return null;
}

/**
 * The last handler under /xenon/api. An error it doesn't know is a 500 with
 * a generic message; the details go to the log, not to the caller.
 */
export function apiErrorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    // The answer had started: it can only be ended. Express's own handler
    // would destroy the socket, which a streaming client sees the same way.
    scoped.warn(`${req.method} ${req.originalUrl} failed after answering: ${err?.message ?? err}`);
    if (!res.writableEnded) res.end();
    return;
  }
  const known = answerFor(err);
  if (known) {
    res.status(known.status).json(known.body);
    return;
  }
  scoped.error(`${req.method} ${req.originalUrl} failed: ${err?.stack ?? err}`);
  res.status(500).json({ error: 'internal', message: 'Internal server error' });
  void next;
}
