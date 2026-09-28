import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import log from '../../logger';
import { appiumPathname } from '../appiumBasePath';

/**
 * One owner per WebSocket upgrade on the server Appium hands plugins.
 *
 * Xenon serves three WebSockets on Appium's http.Server: the H.264 live
 * preview (`/xenon/api/control/:udid/stream/h264`), logcat
 * (`/xenon/api/control/:udid/logcat`) and socket.io (`/socket.io/`, the
 * dashboard's live events and a node's link to its hub). Appium serves BiDi
 * (`<basePath>/bidi[/<id>]`) and whatever drivers add (`/ws/session/<id>/...`,
 * e.g. UiAutomator2's `mobile: startLogsBroadcast`). Each used to take its
 * upgrades in its own way, and which one won depended on the Node version:
 *
 * - Node >= 22.21 / 24.9 (`http.Server#shouldUpgradeCallback` exists).
 *   base-driver's configureHttp sets a callback (every `Upgrade: websocket` is
 *   an upgrade) and adds an `upgrade` listener before any plugin's
 *   updateServer. That listener `socket.destroy()`s every path Appium has no
 *   handler for, and it runs first, so Xenon's listeners only ever got dead
 *   sockets: H.264 fell back to MJPEG and socket.io to polling.
 * - Node < 22.21 (the lab's 22.19, all of Node 20). Appium takes upgrades in an
 *   Express middleware instead (`handleUpgrade`). Node hands an upgrade to
 *   Express only while the server has no `upgrade` listener at all
 *   (`req.upgrade = listenerCount('upgrade') > 0` in _http_server), and Xenon's
 *   own listeners were always there. So BiDi and driver sockets never reached
 *   Appium: no answer at all on a node, and on a hub socket.io's listener
 *   ended them after 1 s.
 *
 * The router makes every Node behave the same way:
 *
 * 1. It wraps the server's `emit` for `upgrade`, the one call Node makes for
 *    an upgrade, as the session guard does (sessionUpgradeGuard.ts). An
 *    upgrade to one of Xenon's routes is handed to that route alone; no
 *    `upgrade` listener sees it, Appium's included. Everything else is emitted
 *    unchanged, through the session guard, to the listeners.
 * 2. On Node < 22.21 it adds the listener Appium would have added itself
 *    (appiumUpgradeListener). Its presence is what makes an old Node emit
 *    `upgrade` at all, and it gives Appium's handlers the upgrades Appium's
 *    unreachable Express middleware would have. On a newer Node Appium's own
 *    listener is already there and nothing is added.
 * 3. A WebSocket that attaches by adding its own `upgrade` listener (socket.io,
 *    through engine.io) is attached with `adopt`: the listener it added is
 *    taken off the server and called only for its own path. engine.io's
 *    listener would otherwise also see every other upgrade and end the ones
 *    it does not own after 1 s.
 *
 * So each socket has exactly one handler: a Xenon route, or Appium's. Because
 * the router, not listener order, decides, a listener added later (by Appium
 * or another plugin) can never take one of Xenon's sockets.
 *
 * A handler, a route's matcher or Appium's own dispatch that throws is caught
 * here: the socket is destroyed and the error logged. An exception out of an
 * `upgrade` listener otherwise ends the process, and both a malformed
 * percent-encoding in a udid (Xenon's path parsers) and one in a BiDi session
 * id (Appium's path-to-regexp decoding) throw.
 */

export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

export interface UpgradeRoute {
  /** For logs. */
  name: string;
  /** Whether this route owns an upgrade to `req`. */
  matches(req: IncomingMessage): boolean;
  handle: UpgradeHandler;
}

/** What Appium registers with `addWebSocketHandler`: a `ws` server in noServer mode. */
interface WebSocketServerLike {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (ws: unknown) => void,
  ): void;
  emit(event: string, ...args: unknown[]): boolean;
}

/** The http.Server Appium hands plugins, with base-driver's extension. */
type UpgradeServer = Server & {
  webSocketsMapping?: Record<string, WebSocketServerLike>;
  shouldUpgradeCallback?: unknown;
};

interface RouterLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** How upgrades that are not Xenon's reach Appium on this server. */
export type AppiumUpgradePath =
  /** Node >= 22.21 / 24.9: Appium's own `upgrade` listener. */
  | 'appium-listener'
  /** Node < 22.21: appiumUpgradeListener, added by the router. */
  | 'router-listener';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The path-to-regexp v8 syntax Appium's patterns use: literal segments and
 * `:name` parameters. Anything else (groups, wildcards, escapes) is not
 * compiled, and such a pattern matches nothing here; see appiumPatternMatcher.
 */
const UNSUPPORTED_PATTERN_SYNTAX = /[{}()[\]*+?!\\"]/;
/** Splits a pattern into literal text (even indexes) and `:name` parameters (odd). */
const PARAM = /(:[A-Za-z_$][\w$]*)/;

type PathMatcher = (pathname: string) => boolean;
const compiled = new Map<string, PathMatcher | null>();
const warnedPatterns = new Set<string>();

/**
 * base-driver matches an upgrade's pathname against each registered pattern
 * with path-to-regexp's `match(pattern)` (v8, defaults): case-insensitive, an
 * optional trailing slash, the whole pathname, each parameter one or more
 * characters other than `/`, and each matched parameter decoded with
 * decodeURIComponent, which throws on a malformed escape. This is that, for
 * the patterns Appium and drivers register. It returns null for a pattern it
 * does not speak.
 */
export function appiumPatternMatcher(pattern: string): PathMatcher | null {
  const cached = compiled.get(pattern);
  if (cached !== undefined) return cached;
  let matcher: PathMatcher | null = null;
  if (!UNSUPPORTED_PATTERN_SYNTAX.test(pattern)) {
    const source = pattern
      .split(PARAM)
      .map((part, i) => (i % 2 === 1 ? '([^/]+)' : escapeRegExp(part)))
      .join('');
    const regex = new RegExp(`^${source}(?:/)?$`, 'i');
    matcher = (pathname) => {
      const m = regex.exec(pathname);
      if (!m) return false;
      // path-to-regexp decodes every matched parameter, and a malformed
      // escape throws out of Appium's dispatch. Do the same, so this behaves
      // as Appium's own listener does.
      for (const value of m.slice(1)) decodeURIComponent(value);
      return true;
    };
  }
  compiled.set(pattern, matcher);
  return matcher;
}

/**
 * base-driver's `tryHandleWebSocketUpgrade`, over the server's public
 * `webSocketsMapping`: hand a WebSocket upgrade to the first registered
 * handler whose pattern matches its pathname. False when none does.
 */
export function dispatchToAppiumHandlers(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  mapping: Record<string, WebSocketServerLike> | undefined,
  logger: RouterLogger,
): boolean {
  const upgrade = req.headers?.upgrade;
  if (typeof upgrade !== 'string' || upgrade.toLowerCase() !== 'websocket') return false;
  const pathname = appiumPathname(req.url ?? '');
  for (const [pattern, wsServer] of Object.entries(mapping ?? {})) {
    const matches = appiumPatternMatcher(pattern);
    if (!matches) {
      if (!warnedPatterns.has(pattern)) {
        warnedPatterns.add(pattern);
        logger.warn(
          `Appium WebSocket handler ${pattern} uses path syntax Xenon's copy of Appium's ` +
            'upgrade listener does not match; it is skipped on this Node (< 22.21).',
        );
      }
      continue;
    }
    if (matches(pathname)) {
      wsServer.handleUpgrade(req, socket, head, (ws) => wsServer.emit('connection', ws, req));
      return true;
    }
  }
  logger.info(`Did not match the websocket upgrade request at ${pathname} to any known route`);
  return false;
}

/**
 * The `upgrade` listener base-driver's configureHttp adds on Node >= 22.21:
 * Appium's handlers take what they match, and every other socket is destroyed.
 * `webSocketsMapping` is read per upgrade, since drivers add and remove
 * handlers as sessions come and go.
 */
export function appiumUpgradeListener(server: UpgradeServer, logger: RouterLogger): UpgradeHandler {
  return function appiumUpgradeThroughXenon(req, socket, head) {
    if (!dispatchToAppiumHandlers(req, socket, head, server.webSocketsMapping, logger)) {
      socket.destroy();
    }
  };
}

/** The upgrade's path without the query, which carries tickets. */
function pathOf(req: IncomingMessage): string {
  return String(req.url ?? '').split('?')[0];
}

export class UpgradeRouter {
  private readonly routes: UpgradeRoute[] = [];
  /** How upgrades that are not Xenon's reach Appium. */
  readonly appiumPath: AppiumUpgradePath;

  constructor(
    private readonly server: UpgradeServer,
    private readonly logger: RouterLogger = log.scope('UpgradeRouter'),
  ) {
    // base-driver's own test (`hasShouldUpgradeCallback`): without the
    // callback it took upgrades in Express and added no listener. A server
    // with no listener at all (not Appium's) needs one too, or neither Node
    // emits `upgrade` and Xenon's routes are never reached.
    const appiumListens =
      typeof server.shouldUpgradeCallback !== 'undefined' && server.listenerCount('upgrade') > 0;
    if (appiumListens) {
      this.appiumPath = 'appium-listener';
    } else {
      server.on('upgrade', appiumUpgradeListener(server, logger));
      this.appiumPath = 'router-listener';
    }
    this.routeEmit();
  }

  /** Give every upgrade `route.matches` to `route.handle`, and to nothing else. */
  add(route: UpgradeRoute): void {
    this.routes.push(route);
  }

  /**
   * Run `attach`, which attaches something that takes upgrades by adding an
   * `upgrade` listener (socket.io). The listeners it added are taken off the
   * server and become the route's handler, so they see only what `matches`.
   */
  adopt<T>(name: string, matches: (req: IncomingMessage) => boolean, attach: () => T): T {
    const before = new Set(this.server.listeners('upgrade'));
    const attached = attach();
    const added = (this.server.listeners('upgrade') as UpgradeHandler[]).filter(
      (l) => !before.has(l),
    );
    for (const listener of added) this.server.removeListener('upgrade', listener as any);
    if (added.length > 0) {
      const server = this.server;
      this.add({
        name,
        matches,
        handle: (req, socket, head) => {
          for (const listener of added) listener.call(server, req, socket, head);
        },
      });
    }
    return attached;
  }

  /** The route that owns an upgrade to `req`, or undefined when it is Appium's. */
  routeFor(req: IncomingMessage): UpgradeRoute | undefined {
    return this.routes.find((route) => route.matches(req));
  }

  /** Where the upgrades that are not Xenon's go, for the boot log. */
  describeAppiumPath(): string {
    return this.appiumPath === 'appium-listener'
      ? "Appium's own upgrade listener"
      : "Appium's WebSocket handlers, through Xenon's copy of Appium's upgrade listener " +
          '(this Node has no http.Server shouldUpgradeCallback, so Appium took upgrades in ' +
          'Express, which no upgrade reaches once any upgrade listener exists)';
  }

  /** Close a socket whose upgrade could not be handed on, and say why. */
  private refuse(req: IncomingMessage, socket: Duplex, what: string, error: any): boolean {
    this.logger.error(
      `WebSocket upgrade ${pathOf(req)} ${what}: ${error?.message ?? error}. Closing the socket.`,
    );
    socket.destroy();
    return true;
  }

  private routeEmit(): void {
    const server = this.server;
    const emit = server.emit;
    const routeFor = (req: IncomingMessage) => this.routeFor(req);
    const refuse = (req: IncomingMessage, socket: Duplex, what: string, error: unknown) =>
      this.refuse(req, socket, what, error);

    server.emit = function emitThroughUpgradeRouter(
      this: unknown,
      event: string | symbol,
      ...args: any[]
    ): boolean {
      if (event !== 'upgrade') return emit.call(this, event, ...args);
      const [req, socket, head] = args as [IncomingMessage, Duplex, Buffer];

      let route: UpgradeRoute | undefined;
      try {
        route = routeFor(req);
      } catch (error) {
        return refuse(req, socket, 'could not be routed', error);
      }
      try {
        if (!route) return emit.call(this, event, ...args);
        route.handle(req, socket, head);
        return true;
      } catch (error) {
        return refuse(req, socket, `failed in the ${route ? route.name : 'Appium'} handler`, error);
      }
    } as typeof server.emit;
  }
}

const routers = new WeakMap<object, UpgradeRouter>();

/**
 * The server's router, installed on first use. ServerManager installs it in
 * registerRoutes; attaching a WebSocket installs it on a server that has none.
 */
export function upgradeRouterFor(server: Server): UpgradeRouter {
  let router = routers.get(server);
  if (!router) {
    router = new UpgradeRouter(server as UpgradeServer);
    routers.set(server, router);
  }
  return router;
}
