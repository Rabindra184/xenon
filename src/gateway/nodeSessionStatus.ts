import type { RequestHandler, Router } from 'express';
import { Container, Service } from 'typedi';
import log from '../logger';
import { config } from '../config';
import type { IPluginArgs } from '../interfaces/IPluginArgs';
import {
  COMMAND_AUTH_UNAVAILABLE_BODY,
  COMMAND_AUTH_UNAVAILABLE_STATUS,
  UNKNOWN_SESSION_BODY,
  UNKNOWN_SESSION_STATUS,
  commandAuthEnabled,
  summarize,
} from '../middleware/commandAuth';
import { AppiumUmbrella } from '../sessions/appiumUmbrella';
import { HUB_TOKEN_HEADER, HubSessionTokenVerifier } from './hubSessionToken';
import type { GatewayLogger, HubTokenCheck } from './sessionGateway';

/**
 * "Does session X still exist?", asked by a hub of a node without touching it.
 *
 * A hub checks each session it routes to a node every ~30 s
 * (SessionHeartbeatService, RemoteSession.checkHealth). It used to ask with a
 * WebDriver command (`GET <basePath>/session/<id>/timeouts`), and any command
 * restarts the node driver's new-command timeout and Xenon's idle clock there,
 * so a session its client had abandoned, and its phone, stayed alive for as
 * long as the hub did. A node's own sessions were fixed the same way in 2.1
 * (LocalSession.checkHealth asks the umbrella).
 *
 * A node answers `GET /xenon/api/node/sessions/<id>` from Appium's umbrella
 * (`sessionExists`), which runs no command: `200 { value: { sessionId,
 * exists } }`. It is outside the login, like `/xenon/api/webdriver`: the hub
 * holds no credentials for the node. It asks what a command to that session
 * asks, never more, so it is never stricter than the probe it replaces. With
 * per-command auth on (XENON_REQUIRE_COMMAND_AUTH, auth enabled) it needs the
 * hub's session token for that session (`x-xenon-hub-token`, audience
 * `xenon-node`, claim `sid`), the one the hub sends with every call about it:
 * any other caller gets the unknown-session answer, and a JWKS that can't be
 * fetched is `503`. With it off a command needs no credential, so neither does
 * this. Otherwise a hub that can't sign (its JWT key failed to load) would
 * see every node session as gone, and end them, where its command probe
 * worked.
 *
 * Every answer carries NODE_SESSION_STATUS_HEADER, so a hub can tell a node
 * that has this route from one that doesn't (an older Xenon, whose answer is a
 * 404 or a 401 from its login). For those the hub keeps the old WebDriver
 * probe and says so once per node (NodeSessionProbeSupport).
 */

export const NODE_SESSION_STATUS_ROUTE = '/node/sessions/:sessionId';
/** The route under a server's origin, for a hub building the URL. */
export const NODE_SESSION_STATUS_PATH = '/xenon/api/node/sessions';
export const NODE_SESSION_STATUS_HEADER = 'x-xenon-node-sessions';
/** How long a hub keeps using the old probe for a node without the route before asking again. */
export const UNSUPPORTED_RECHECK_MS = 10 * 60_000;

export interface NodeSessionStatusDeps {
  /** The hub's session tokens, checked against its JWKS. */
  hubTokens: HubTokenCheck;
  /** Whether a command to a session needs a credential here: per-command auth on, auth enabled. */
  enforced: () => boolean;
  /** Whether Appium has the session (AppiumUmbrella.hasSession). */
  hasSession: (sessionId: string) => boolean;
  logger: GatewayLogger;
}

export function nodeSessionStatusHandler(deps: NodeSessionStatusDeps): RequestHandler {
  return (req, res) => {
    res.setHeader(NODE_SESSION_STATUS_HEADER, '1');
    const sessionId = String(req.params?.sessionId ?? '');
    const answer = () =>
      res.status(200).json({ value: { sessionId, exists: deps.hasSession(sessionId) } });

    if (!deps.enforced()) return answer();

    const presented = req.headers[HUB_TOKEN_HEADER];
    const token = typeof presented === 'string' ? presented : undefined;
    if (token === undefined) {
      res.status(UNKNOWN_SESSION_STATUS).json(UNKNOWN_SESSION_BODY);
      return;
    }
    deps.hubTokens
      .verify(token, sessionId)
      .then((valid) => {
        if (valid) return answer();
        deps.logger.warn(
          `Session status for ${sessionId} refused: the hub token is not valid for it`,
        );
        res.status(UNKNOWN_SESSION_STATUS).json(UNKNOWN_SESSION_BODY);
      })
      .catch((error) => {
        deps.logger.error(
          `Session status for ${sessionId} unavailable: hub token check failed: ${summarize(error)}`,
        );
        if (!res.headersSent) {
          res.status(COMMAND_AUTH_UNAVAILABLE_STATUS).json(COMMAND_AUTH_UNAVAILABLE_BODY);
        }
      });
  };
}

/**
 * A node's route, on the `/xenon/api` router ahead of its login. Only a node
 * (a server with `hub`) has it; a hub or a standalone server answers it as an
 * unknown API route.
 */
export function registerNodeSessionStatus(router: Router, pluginArgs: IPluginArgs): void {
  if (pluginArgs.hub === undefined) return;
  router.get(
    NODE_SESSION_STATUS_ROUTE,
    nodeSessionStatusHandler({
      hubTokens: new HubSessionTokenVerifier(pluginArgs.hub),
      enforced: () => commandAuthEnabled() && config.authDisabled !== true,
      hasSession: (sessionId) => Container.get(AppiumUmbrella).hasSession(sessionId),
      logger: log.scope('NodeSessionStatus'),
    }),
  );
}

/**
 * Hub side: which nodes don't have the route. Such a node is probed the old
 * way, with a WebDriver command, and the hub logs that once for it. It is
 * asked again after UNSUPPORTED_RECHECK_MS, so a node upgraded in place is
 * picked up without restarting the hub.
 */
@Service()
export class NodeSessionProbeSupport {
  logger: Pick<GatewayLogger, 'warn'> = log.scope('RemoteSession');
  now: () => number = () => Date.now();
  private readonly unsupportedUntil = new Map<string, number>();
  private readonly warned = new Set<string>();

  /** Whether to ask this node its route (true unless it recently had none). */
  shouldAsk(origin: string): boolean {
    const until = this.unsupportedUntil.get(origin);
    if (until === undefined) return true;
    if (until > this.now()) return false;
    this.unsupportedUntil.delete(origin);
    return true;
  }

  /** The node answered without the route: use the WebDriver probe for it for a while. */
  unsupported(origin: string, status: number | undefined): void {
    this.unsupportedUntil.set(origin, this.now() + UNSUPPORTED_RECHECK_MS);
    if (this.warned.has(origin)) return;
    this.warned.add(origin);
    this.logger.warn(
      `Node ${origin} has no ${NODE_SESSION_STATUS_PATH} route (answered ${status ?? 'nothing'}); ` +
        'an older Xenon. Its sessions are checked with a WebDriver command, which restarts ' +
        'their new-command timeout and idle clock there, so an abandoned session is kept ' +
        'alive. Upgrade the node.',
    );
  }
}
