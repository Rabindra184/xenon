import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { errors, getResponseForW3CError } from '@appium/base-driver';
import type { ISessionCapability } from '../interfaces/ISessionCapability';
import {
  COMMAND_AUTH_UNAVAILABLE_BODY,
  COMMAND_AUTH_UNAVAILABLE_STATUS,
  summarize,
} from '../middleware/commandAuth';
import { CreateHandoff, runWithCreateHandoff } from './createHandoff';
import { HUB_TOKEN_HEADER, HubCreateGrant } from './hubSessionToken';
import type { GatewayLogger } from './sessionGateway';

/**
 * `POST <basePath>/session` in the session gateway, in front of Appium's
 * route. The phone is allocated here, before Appium sees the request:
 *
 * - A phone another server drives (a node's, or a cloud provider's): the
 *   session is created there and answered here, as Appium answers a new
 *   session. Appium's umbrella driver never sees it, so it never has to hold
 *   a session it has no driver for. When it did (the plugin answering the
 *   create without calling `next()`), Appium >= 2.15 promoted the plugin to a
 *   session it didn't have and threw building its log prefix (a 500 while the
 *   node kept the session), and later versions still kept the promoted plugin
 *   for ever.
 * - A phone this server drives: the allocation goes on to
 *   XenonPlugin.createSession through the request's async context
 *   (createHandoff.ts), and Appium creates the session as always. If the
 *   request ends without the plugin taking it (Appium or another plugin
 *   refused the create first, or the client went away), it is given back.
 *
 * On a node, a create the hub forwarded carries the hub's create token
 * (hubSessionToken.ts). Each instance has its own database, so the node
 * can't check the client's key; the hub did. The token is checked here
 * against the hub's JWKS and becomes the session's credential: the owner it
 * names is the session's, it passes XENON_REQUIRE_SESSION_TOKEN, and the node
 * may allocate only the phone it names. A token that is not valid is refused;
 * one that can't be checked (the hub's keys can't be fetched) is a 503.
 * With auth disabled it is not checked, as no credential is.
 *
 * Refusals are answered exactly as Appium answers the same error thrown from
 * the plugin: getResponseForW3CError's status and body.
 */

/** What the create layer needs of SessionLifecycleService. */
export interface SessionCreateLifecycle<A extends { remote: boolean } = { remote: boolean }> {
  prepareSession(caps: ISessionCapability, opts: { hubGrant?: HubCreateGrant }): Promise<A>;
  completeRemoteSession(allocation: A): Promise<unknown>;
  releaseAllocation(allocation: A): Promise<void>;
}

/** A node's check of the hub's create token. */
export interface HubGrantCheck {
  /** The grant, or null for a token that is not valid; throws when it cannot check. */
  verifyCreate(token: string): Promise<HubCreateGrant | null>;
}

export interface SessionCreateDeps {
  /** SessionLifecycleService, looked up per request. */
  lifecycle: () => SessionCreateLifecycle<any>;
  /** Node only: the hub's create token is checked, and is the session's credential. */
  hubGrants?: HubGrantCheck;
  logger?: GatewayLogger;
}

export interface SessionCreateLayerDeps extends SessionCreateDeps {
  authDisabled: () => boolean;
  logger: GatewayLogger;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The path under the layer's mount point is the create path itself. */
function isCreatePath(url: string | undefined): boolean {
  const path = (url || '/').split('?')[0];
  return path === '/' || path === '';
}

/** Answer an error as Appium's route answers it. */
function sendError(res: Response, error: unknown): void {
  if (res.headersSent) return;
  const err = error instanceof Error ? error : new Error(String(error));
  const [status, body] = getResponseForW3CError(err as any) as [number, unknown];
  res.status(status).json(body);
}

/** Appium's answer to a new session: `{ value: { capabilities, sessionId } }`. */
function newSessionBody(created: unknown): { value: { capabilities: unknown; sessionId: string } } {
  const value = (created as { value?: unknown })?.value;
  if (!Array.isArray(value) || typeof value[0] !== 'string') {
    throw new errors.SessionNotCreatedError('The node answered the create without a session id.');
  }
  return { value: { capabilities: value[1] ?? null, sessionId: value[0] } };
}

export function createSessionCreateLayer(deps: SessionCreateLayerDeps): RequestHandler {
  const { logger } = deps;

  /** The grant a node creates by, or false when the request has been answered. */
  async function hubGrantOf(
    token: string | undefined,
    res: Response,
  ): Promise<HubCreateGrant | undefined | false> {
    if (token === undefined || !deps.hubGrants || deps.authDisabled()) return undefined;
    let grant: HubCreateGrant | null;
    try {
      grant = await deps.hubGrants.verifyCreate(token);
    } catch (error) {
      logger.error(
        `New session refused: the hub's token could not be checked: ${summarize(error)}`,
      );
      res.status(COMMAND_AUTH_UNAVAILABLE_STATUS).json(COMMAND_AUTH_UNAVAILABLE_BODY);
      return false;
    }
    if (grant) return grant;
    logger.warn("New session refused: the hub's token on it is not valid");
    sendError(
      res,
      new errors.InvalidArgumentError(
        "session rejected: the hub's token for this session is not valid " +
          '(forged, expired, or not a create token)',
      ),
    );
    return false;
  }

  async function create(
    res: Response,
    next: NextFunction,
    caps: ISessionCapability,
    token: string | undefined,
  ): Promise<void> {
    // Registered before anything waits, so a client that leaves while its
    // phone is being found is seen.
    const request: { closed: boolean; handoff?: CreateHandoff<{ remote: boolean }> } = {
      closed: false,
    };
    res.on('close', () => {
      request.closed = true;
      request.handoff?.abandon();
    });

    const hubGrant = await hubGrantOf(token, res);
    if (hubGrant === false) return;

    const lifecycle = deps.lifecycle();
    let allocation: { remote: boolean };
    try {
      allocation = await lifecycle.prepareSession(caps, hubGrant ? { hubGrant } : {});
    } catch (error) {
      logger.warn(`New session refused: ${summarize(error)}`);
      sendError(res, error);
      return;
    }

    if (request.closed) {
      logger.warn('The client left before its session was created; its device was released.');
      await lifecycle.releaseAllocation(allocation);
      return;
    }

    if (allocation.remote) {
      try {
        res.status(200).json(newSessionBody(await lifecycle.completeRemoteSession(allocation)));
      } catch (error) {
        sendError(res, error);
      }
      return;
    }

    const local = new CreateHandoff(allocation, (unused) => {
      logger.warn(
        "A new session's device was allocated, but the request ended without Xenon's " +
          'createSession taking it; the device was released.',
      );
      lifecycle
        .releaseAllocation(unused)
        .catch((error) => logger.error(`Could not release a device: ${summarize(error)}`));
    });
    request.handoff = local;
    runWithCreateHandoff(local, () => next());
  }

  return function xenonSessionCreate(req: Request, res: Response, next: NextFunction) {
    if (req.method !== 'POST' || !isCreatePath(req.url)) return next();

    // The hub's token is for this layer alone: nothing after it sees it.
    const presented = req.headers[HUB_TOKEN_HEADER];
    const token = typeof presented === 'string' ? presented : undefined;
    delete req.headers[HUB_TOKEN_HEADER];

    // Anything but a capabilities object is Appium's to answer, as before.
    const caps = isPlainObject(req.body) ? req.body.capabilities : undefined;
    if (!isPlainObject(caps)) return next();
    // W3C lets clients omit `firstMatch` (it defaults to [{}]); what reads the
    // caps from here on relies on `firstMatch[0]`, as the plugin did.
    if (!Array.isArray(caps.firstMatch) || caps.firstMatch.length === 0) caps.firstMatch = [{}];

    create(res, next, caps as ISessionCapability, token).catch((error) => {
      logger.error(`Session gateway: a create failed: ${summarize(error)}`);
      sendError(res, error);
    });
  };
}
