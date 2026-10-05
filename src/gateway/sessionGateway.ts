import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  COMMAND_AUTH_UNAVAILABLE_BODY,
  COMMAND_AUTH_UNAVAILABLE_STATUS,
  CommandAuthDeps,
  UNKNOWN_SESSION_BODY,
  UNKNOWN_SESSION_STATUS,
  createCommandAuthMiddleware,
  summarize,
} from '../middleware/commandAuth';
import { isInternalCall } from './internalCall';
import { HUB_TOKEN_HEADER } from './hubSessionToken';
import { HealReport, runReportingHeals, takeHealReport } from './healReport';
import type { SessionLocation } from './sessionLocator';
import {
  NODE_UNREACHABLE_BODY,
  NODE_UNREACHABLE_STATUS,
  NodeAnswer,
  forwardedRequestHeaders,
  readAnswer,
  relayAnswer,
  sendAnswer,
  sendToNode,
} from './forwardToNode';

/**
 * The session gateway: the one layer in front of Appium's routes for
 * `<basePath>/session/:sessionId/...`. It decides, in order:
 *
 * 1. Internal calls. A request the internal-call layer accepted as Xenon's own
 *    (internalCall.ts) skips per-command auth.
 * 2. Per-command auth (commandAuth.ts), once, for local and remote sessions
 *    alike. On a node, a hub-signed session token (hubSessionToken.ts) takes
 *    the place of the client's credentials: the hub checked those.
 * 3. Remote sessions (a hub only). A session another server runs is forwarded
 *    there with the hub's session token, and that server's answer relayed.
 *    Appium's umbrella driver never sees it. DELETE runs Xenon's session
 *    lifecycle with the forward as its driver step.
 * 4. Everything else goes on to Appium's routes.
 *
 * It is mounted with `app.use()` at `<basePath>/session/:sessionId`, so its
 * path matching (letter case, encoding) is the router's own, exactly the
 * routes it stands in front of.
 */

export interface GatewayLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** A node's check of the hub's session token. */
export interface HubTokenCheck {
  /** Resolves whether the token is valid for this session; throws when it cannot check. */
  verify(token: string, sessionId: string): Promise<boolean>;
}

/** A hub's routing of sessions other servers run. */
export interface SessionRouting {
  locate(sessionId: string): Promise<SessionLocation>;
  forward(
    req: Request,
    res: Response,
    sessionId: string,
    location: Extract<SessionLocation, { kind: 'remote' }>,
  ): Promise<void>;
}

export interface SessionGatewayDeps {
  auth: CommandAuthDeps;
  /** Node only: the hub's session tokens are accepted in place of credentials. */
  hubTokens?: HubTokenCheck;
  /** Hub only: sessions other servers run are forwarded. */
  routing?: SessionRouting;
  /** Injected per-command latency (network conditioning) for local sessions. */
  latencyOf?: (sessionId: string) => number;
}

/** Where a session runs could not be determined (a database error). */
export const ROUTING_UNAVAILABLE_STATUS = 503;
export const ROUTING_UNAVAILABLE_BODY = {
  value: {
    error: 'unknown error',
    message: 'Xenon could not find where this session runs. Try again.',
    stacktrace: '',
  },
} as const;

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function where(req: Request): string {
  return `${req.method} ${String(req.originalUrl ?? req.url).split('?')[0]}`;
}

export function createSessionGatewayLayer(deps: SessionGatewayDeps): RequestHandler {
  const authorize = createCommandAuthMiddleware(deps.auth);
  const logger = deps.auth.logger;
  const authActive = () => deps.auth.enabled() && !deps.auth.authDisabled();

  async function route(req: Request, res: Response, next: NextFunction, sessionId: string) {
    // A request that came from a hub is never forwarded again: a hub that
    // routed a session to itself would otherwise loop.
    const fromHub = headerValue(req, HUB_TOKEN_HEADER) !== undefined;
    delete req.headers[HUB_TOKEN_HEADER];

    if (deps.routing && !fromHub) {
      let location: SessionLocation;
      try {
        location = await deps.routing.locate(sessionId);
      } catch (error) {
        logger.error(
          `Could not find where session ${sessionId} runs for ${where(req)}: ${summarize(error)}`,
        );
        res.status(ROUTING_UNAVAILABLE_STATUS).json(ROUTING_UNAVAILABLE_BODY);
        return;
      }
      if (location.kind === 'remote') {
        await deps.routing.forward(req, res, sessionId, location);
        return;
      }
    }

    const latency = deps.latencyOf?.(sessionId) ?? 0;
    if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
    // On a node, a heal of the hub's command goes back to the hub on the answer
    // (healReport.ts). The header proves nothing elsewhere: a hub or a
    // standalone server checks no hub token, so a client could send one there
    // to keep its heals out of the record.
    if (fromHub && deps.hubTokens) runReportingHeals(res, next);
    else next();
  }

  return function xenonSessionGateway(req: Request, res: Response, next: NextFunction) {
    const sessionId = String(req.params?.sessionId ?? '');
    const proceed = () => {
      route(req, res, next, sessionId).catch((error) => {
        logger.error(`Session gateway failed for ${where(req)}: ${summarize(error)}`);
        if (!res.headersSent) res.status(NODE_UNREACHABLE_STATUS).json(NODE_UNREACHABLE_BODY);
      });
    };

    if (isInternalCall(req)) return proceed();

    const hubToken = headerValue(req, HUB_TOKEN_HEADER);
    if (hubToken !== undefined && deps.hubTokens && authActive()) {
      deps.hubTokens
        .verify(hubToken, sessionId)
        .then((valid) => {
          if (valid) return proceed();
          logger.warn(
            `Command refused: ${where(req)} (session ${sessionId}): hub token not valid for this session`,
          );
          res.status(UNKNOWN_SESSION_STATUS).json(UNKNOWN_SESSION_BODY);
        })
        .catch((error) => {
          logger.error(
            `Command auth unavailable for ${where(req)} (session ${sessionId}): ` +
              `hub token check failed: ${summarize(error)}`,
          );
          if (!res.headersSent) {
            res.status(COMMAND_AUTH_UNAVAILABLE_STATUS).json(COMMAND_AUTH_UNAVAILABLE_BODY);
          }
        });
      return;
    }

    authorize(req, res, proceed);
  };
}

/** The dashboard's command hooks (DASHBORD_EVENT_MANAGER), as the old proxy called them. */
export interface DashboardHooks {
  before(
    sessionId: string,
    command: string | undefined,
    req: Request,
    res: Response,
  ): Promise<boolean>;
  after(
    sessionId: string,
    command: string | undefined,
    req: Request,
    res: Response,
    body: string,
    /** A heal the node made for the command (healReport.ts). */
    heal?: HealReport,
  ): Promise<void>;
}

export interface HubRoutingDeps {
  /** This hub's normalised base path. */
  basePath: string;
  locate(sessionId: string): Promise<SessionLocation>;
  /** Drop what is remembered about a session once it is deleted. */
  forget(sessionId: string): void;
  /** The hub's session token for a node (null when this hub cannot sign). */
  tokenFor(sessionId: string): Promise<string | null>;
  forgetToken(sessionId: string): void;
  /** SessionLifecycleService.deleteSession, with `next` as the driver step. */
  deleteSession(next: () => Promise<unknown>, sessionId: string): Promise<unknown>;
  /** Mark the session's phone as just used (updateCmdExecutedTime). */
  touch(sessionId: string): Promise<void>;
  /** The WebDriver command name for the dashboard. */
  commandName(path: string, method: string): string | undefined;
  /** Present when the hub's dashboard is on. */
  dashboard?: DashboardHooks;
  logger: GatewayLogger;
}

const BODYLESS = new Set(['GET', 'HEAD', 'DELETE', 'OPTIONS']);

/** The part of the path after `/session/<id>`, with its query string, from the mounted layer. */
function restOf(req: Request): string {
  const url = req.url || '/';
  const q = url.indexOf('?');
  const pathname = q === -1 ? url : url.slice(0, q);
  const query = q === -1 ? '' : url.slice(q);
  return `${pathname === '/' ? '' : pathname}${query}`;
}

export function createHubRouting(deps: HubRoutingDeps): SessionRouting {
  const { logger } = deps;

  async function nodeRequest(
    req: Request,
    sessionId: string,
    location: Extract<SessionLocation, { kind: 'remote' }>,
    signal?: AbortSignal,
  ) {
    const headers = forwardedRequestHeaders(req.headers);
    if (!location.cloud) {
      const token = await deps.tokenFor(sessionId);
      if (token) headers[HUB_TOKEN_HEADER] = token;
    }
    let body: Buffer | undefined;
    if (!BODYLESS.has(req.method.toUpperCase())) {
      body = Buffer.from(JSON.stringify(req.body ?? {}));
      headers['content-type'] = 'application/json; charset=utf-8';
    }
    return {
      url: `${location.url}/session/${encodeURIComponent(sessionId)}${restOf(req)}`,
      method: req.method,
      headers,
      body,
      signal,
    };
  }

  async function deleteRemote(
    req: Request,
    res: Response,
    sessionId: string,
    location: Extract<SessionLocation, { kind: 'remote' }>,
  ) {
    let answer: NodeAnswer | undefined;
    await deps.deleteSession(async () => {
      answer = await readAnswer(await sendToNode(await nodeRequest(req, sessionId, location)));
      return answer;
    }, sessionId);
    deps.forget(sessionId);
    deps.forgetToken(sessionId);
    if (answer) {
      sendAnswer(res, answer);
    } else {
      logger.warn(`Session ${sessionId}: the node did not answer its DELETE; ended here anyway.`);
      res.status(NODE_UNREACHABLE_STATUS).json(NODE_UNREACHABLE_BODY);
    }
  }

  return {
    locate: (sessionId) => deps.locate(sessionId),

    async forward(req, res, sessionId, location) {
      const rest = restOf(req);
      if (req.method.toUpperCase() === 'DELETE' && (rest === '' || rest.startsWith('?'))) {
        await deleteRemote(req, res, sessionId, location);
        return;
      }

      // Xenon's own call (internalCall.ts) is never one of the test's
      // commands: it isn't the session's activity, nor in its record.
      const own = isInternalCall(req);
      if (!own) {
        await deps
          .touch(sessionId)
          .catch((error) =>
            logger.warn(`Could not record activity for session ${sessionId}: ${summarize(error)}`),
          );
      }

      const hooks = location.session && !location.cloud && !own ? deps.dashboard : undefined;
      const command = hooks
        ? deps.commandName(`${deps.basePath}/session/${sessionId}${rest.split('?')[0]}`, req.method)
        : undefined;
      if (hooks && !(await hooks.before(sessionId, command, req, res))) return;

      // A client that goes away takes its forwarded command with it.
      const abort = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) abort.abort();
      });

      let captured: string | undefined;
      let heal: HealReport | undefined;
      try {
        const upstream = await sendToNode(
          await nodeRequest(req, sessionId, location, abort.signal),
        );
        heal = takeHealReport(upstream.headers);
        captured = await relayAnswer(upstream, res, !!hooks);
      } catch (error) {
        if (abort.signal.aborted) return;
        logger.error(
          `Could not forward ${req.method} for session ${sessionId} to ${location.url}: ${summarize(error)}`,
        );
        if (!res.headersSent) res.status(NODE_UNREACHABLE_STATUS).json(NODE_UNREACHABLE_BODY);
        else res.destroy();
        return;
      }

      if (hooks && captured !== undefined) {
        await hooks
          .after(sessionId, command, req, res, captured, heal)
          .catch((error) =>
            logger.warn(`Dashboard log failed for session ${sessionId}: ${summarize(error)}`),
          );
      }
    },
  };
}
