import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { Service, Container } from 'typedi';
import type * as jose from 'jose';
import log from '../logger';
import { config as xenonConfig } from '../config';
import { ApiKeyService } from './ApiKeyService';
import { UserSessionService } from './UserSessionService';
import { JwtKeyService } from './token/JwtKeyService';
import { prisma } from '../prisma';
import { EventLogService } from './EventLogService';
import { SocketEvents, XENON_PROTOCOL_VERSION, HandshakeData } from '../enums/SocketEvents';
import { computeTeamIds } from './device-access/callerTeamIds';
import {
  DeviceTeam,
  DeviceTeamResolver,
  canSeeDeviceTeam,
} from './device-access/DeviceTeamResolver';
import { upgradeRouterFor } from '../app/ws/upgradeRouter';
import { sessionCommandSummary } from '../dashboard/sessionCommandSummary';
import type { SelectorKey } from './selector-health/selectorKeys';
import { SelectorVisibilityResolver } from './selector-health/SelectorVisibilityResolver';

/** socket.io's default path, which the dashboard and nodes connect to. */
const SOCKET_IO_PATH = '/socket.io';

// Socket principals mirror the two REST auth paths. 'auth-disabled' is a
// deliberate passthrough so XENON_AUTH_DISABLED=true still lets the dashboard
// and nodes connect (matches apiKeyMiddleware behavior).
type Principal = 'dashboard' | 'node' | 'auth-disabled';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';

/**
 * Who a socket is, fixed at connect and kept on `socket.data.identity`.
 * `teamIds` is computed as REST computes `req.auth.teamIds`: undefined for an
 * admin or an auth-disabled server (sees every device). A membership change
 * applies when the client reconnects, which a dashboard does on reload.
 */
export interface SocketIdentity {
  principal: Principal;
  userId: string;
  role: Role;
  teamIds: string[] | undefined;
}

/**
 * The phones a dashboard event is about.
 * - `{ udid }`: one phone, whose team comes from DeviceTeamResolver.
 * - `{ udid, teamId }`: one phone whose device row is in hand; its own team
 *   is used, with no lookup, and refreshes the resolver.
 * - `{ udids, strip }`: several phones in one payload. Each socket gets
 *   `strip(data, visibleUdids)`, or `data` untouched when it sees them all,
 *   or nothing when it sees none. `strip` must not mutate `data`.
 *
 * With `adminOnly`, only an admin's socket (role ADMIN or SUPER_ADMIN, as
 * `roleGuard('ADMIN')` decides) that can see the phone gets it: for captured
 * network traffic, which REST serves to admins only.
 */
export type DeviceEventScope = (
  | { udid: string | null | undefined; teamId?: string | null }
  | { udids: string[]; strip: (data: any, visibleUdids: string[]) => any }
) & { adminOnly?: boolean };

const SESSION_COOKIE = 'xenon_dashboard_session';

/**
 * What the event log keeps of a dashboard event that carries a session's own
 * data: `null` for no row, else the part it keeps. Any other event is kept
 * whole. Each one's record stays with its session, which deleting the
 * session or build removes; a copy here would outlive that for the log's
 * retention.
 * - `interceptor_request`: the app's own traffic, its headers (sign-in
 *   tokens, cookies) and, with `captureBodies`, its bodies. Its record is the
 *   session's capture (buffer, archive, HAR). Not even a summary: the path's
 *   query string can hold a token. The capture's start and stop are logged.
 * - `session_command`: the command's summary (`sessionCommandSummary`).
 *   Its emitter sends nothing more; this holds for any other that would.
 */
type EventLogKeep = ((data: any) => unknown) | null;
const EVENT_LOG_KEEPS: ReadonlyMap<string, EventLogKeep> = new Map<string, EventLogKeep>([
  [SocketEvents.INTERCEPTOR_REQUEST, null],
  [SocketEvents.SESSION_COMMAND, sessionCommandSummary],
]);

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

@Service()
export class SocketServer {
  private io: SocketIOServer | null = null;
  private nodes: Map<string, string> = new Map(); // socketId -> nodeHost
  /** The tail of each phone's pending event deliveries (see emitToDashboardForDevices). */
  private readonly deliveries = new Map<string, Promise<void>>();
  /** The tail of each selector's pending event deliveries (see emitToDashboardForSelector). */
  private readonly selectorDeliveries = new Map<string, Promise<void>>();

  public initialize(server: HTTPServer) {
    // socket.io (engine.io) takes its websocket transport by adding its own
    // `upgrade` listener, which would also see every other upgrade and end
    // the ones it doesn't own after 1 s. The upgrade router moves that
    // listener behind socket.io's path, engine.io's own test (a prefix match
    // on the raw URL), so it sees only its own upgrades (upgradeRouter.ts).
    this.io = upgradeRouterFor(server).adopt(
      'socket.io',
      (req) => String(req.url ?? '').startsWith(`${SOCKET_IO_PATH}/`),
      () =>
        new SocketIOServer(server, {
          path: SOCKET_IO_PATH,
          // Same-origin only. Browsers on a different origin are blocked at the
          // handshake; server-to-server node connections send no Origin header
          // and are unaffected. Matches the apiRouter cors({origin:false}) policy.
          cors: {
            origin: false,
            methods: ['GET', 'POST'],
          },
        }),
    );

    this.io.use(async (socket, next) => {
      try {
        const identity = await this.authenticate(socket);
        socket.data.identity = identity;
        socket.data.principal = identity.principal;
        next();
      } catch (err: any) {
        log.warn(`[SocketServer] Handshake rejected for ${socket.id}: ${err.message}`);
        next(new Error('unauthorized'));
      }
    });

    this.io.on('connection', (socket) => {
      const socketId = socket.id;
      const principal: Principal = socket.data.principal;
      log.info(`[SocketServer] New connection: ${socketId} (principal=${principal})`);

      // Protocol version handshake — still runs after auth so a logged-in
      // client on the wrong protocol version still gets a clean disconnect.
      socket.on(SocketEvents.HANDSHAKE, (data: HandshakeData) => {
        const { version, host } = data;
        if (version !== XENON_PROTOCOL_VERSION) {
          log.error(
            `[SocketServer] Protocol mismatch for client ${socketId}. Hub: ${XENON_PROTOCOL_VERSION}, Client: ${version}`,
          );
          socket.disconnect();
          return;
        }
        log.info(
          `[SocketServer] Handshake successful with client ${host || socketId} (v${version})`,
        );
      });

      socket.on(SocketEvents.REGISTER_NODE, (data: { host: string }) => {
        if (!SocketServer.canRegisterAs(principal, 'node')) {
          log.warn(
            `[SocketServer] Rejected REGISTER_NODE from principal=${principal} on ${socketId}`,
          );
          socket.disconnect();
          return;
        }
        const { host } = data;
        this.nodes.set(socketId, host);
        log.info(`[SocketServer] Node registered: ${host} (Socket: ${socketId})`);
        socket.join('nodes');

        // Notify dashboard about new node
        this.emitToDashboard(SocketEvents.NODE_CONNECTED, { host });
      });

      socket.on(SocketEvents.REGISTER_DASHBOARD, () => {
        if (!SocketServer.canRegisterAs(principal, 'dashboard')) {
          log.warn(
            `[SocketServer] Rejected REGISTER_DASHBOARD from principal=${principal} on ${socketId}`,
          );
          socket.disconnect();
          return;
        }
        log.info(`[SocketServer] Dashboard client registered (Socket: ${socketId})`);
        socket.join('dashboard');
      });

      socket.on('disconnect', () => {
        if (this.nodes.has(socketId)) {
          const host = this.nodes.get(socketId);
          log.info(`[SocketServer] Node disconnected: ${host} (Socket: ${socketId})`);
          this.nodes.delete(socketId);
          this.emitToDashboard(SocketEvents.NODE_DISCONNECTED, { host });
        } else {
          log.info(`[SocketServer] Client disconnected: ${socketId}`);
        }
      });
    });

    log.info('[SocketServer] WebSocket server initialized (auth enabled)');
  }

  // Role-based registration guard. A dashboard-authed socket can't join the
  // 'nodes' broadcast room and a node-authed socket can't subscribe to
  // dashboard events — keeps a stolen credential of one class from acting
  // as the other. auth-disabled mode trusts the caller for parity with REST.
  private static canRegisterAs(principal: Principal, role: 'dashboard' | 'node'): boolean {
    if (principal === 'auth-disabled') return true;
    return principal === role;
  }

  private async authenticate(socket: Socket): Promise<SocketIdentity> {
    if (xenonConfig.authDisabled === true) {
      return {
        principal: 'auth-disabled',
        userId: 'auth-disabled',
        role: 'SUPER_ADMIN',
        teamIds: undefined,
      };
    }

    const auth = (socket.handshake.auth || {}) as Record<string, any>;
    const headers = socket.handshake.headers || {};

    // Client path: short-lived hub-issued JWT (audience xenon-rest) — the
    // IDE extension's path into the dashboard events room. Mirrors REST
    // authMiddleware Path 1.5 including the live-user revocation check.
    const bearer = typeof auth.bearer === 'string' ? auth.bearer : '';
    if (bearer) {
      let payload: jose.JWTPayload;
      try {
        payload = await Container.get(JwtKeyService).verify(bearer, { audience: 'xenon-rest' });
      } catch {
        throw new Error('invalid bearer token');
      }
      const owner = await prisma.user.findUnique({
        where: { id: String(payload.sub) },
        select: { status: true, role: true },
      });
      if (!owner || owner.status !== 'ACTIVE') throw new Error('inactive user');
      // The team claim is read exactly as REST's bearer path reads it.
      return this.identify(
        'dashboard',
        String(payload.sub),
        owner.role,
        (payload.teamId as string | null) ?? null,
      );
    }

    // Node path: per-node (accessKey, token) pair. Resolves to a real
    // ApiKey row owned by a real User; we additionally enforce that the
    // User is ACTIVE so a disabled account can't keep a stolen key alive.
    const pairKey =
      (typeof auth.accessKey === 'string' && auth.accessKey) ||
      ((headers['x-xenon-access-key'] as string | undefined) ?? '');
    const pairTok =
      (typeof auth.token === 'string' && auth.token) ||
      ((headers['x-xenon-token'] as string | undefined) ?? '');
    if (pairKey && pairTok) {
      const row = await Container.get(ApiKeyService).verifyPair(pairKey, pairTok);
      if (!row) throw new Error('invalid (accessKey, token) pair');
      const owner = await prisma.user.findUnique({
        where: { id: row.userId },
        select: { status: true, role: true },
      });
      if (!owner || owner.status !== 'ACTIVE') throw new Error('inactive user');
      return this.identify('node', row.userId, owner.role, row.teamId);
    }

    // Dashboard path: the cookie. As in REST's authMiddleware, it is first a
    // UserSession id (set by /auth/login), then a raw API key (the older
    // /api-key-gate cookie). A session whose user is disabled is refused, not
    // retried as a key.
    const cookieValue = readCookie(headers.cookie as string | undefined, SESSION_COOKIE) ?? '';

    if (!cookieValue) {
      throw new Error('missing credentials (need (accessKey, token) pair or dashboard cookie)');
    }

    const session = await Container.get(UserSessionService).resolve(cookieValue);
    if (session) {
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { status: true, role: true },
      });
      if (!user || user.status !== 'ACTIVE') throw new Error('inactive user');
      return this.identify('dashboard', session.userId, user.role, null);
    }

    const row = await Container.get(ApiKeyService).verify(cookieValue);
    if (!row) {
      throw new Error('invalid or revoked dashboard session');
    }
    // The key owner's role decides the team scope, and an inactive owner is
    // refused here as REST refuses them.
    const owner = await prisma.user.findUnique({
      where: { id: row.userId },
      select: { status: true, role: true },
    });
    if (!owner || owner.status !== 'ACTIVE') throw new Error('inactive user');
    return this.identify('dashboard', row.userId, owner.role, row.teamId);
  }

  private async identify(
    principal: Principal,
    userId: string,
    role: string,
    apiKeyTeamId: string | null | undefined,
  ): Promise<SocketIdentity> {
    const r = role as Role;
    const teamIds = await computeTeamIds({ role: r, userId, apiKeyTeamId });
    return { principal, userId, role: r, teamIds };
  }

  /**
   * Unscoped: every dashboard socket. Only for the hub's node events, which
   * carry a node's address and nothing of a phone, a session or a selector.
   */
  private emitToDashboard(event: string, data: any) {
    if (this.io) {
      this.io.to('dashboard').emit(event, data);
    }
    this.logEvent(event, data);
  }

  /** Once per event, unscoped: whole, or what EVENT_LOG_KEEPS keeps of it. */
  private logEvent(event: string, data: any): void {
    const keep = EVENT_LOG_KEEPS.get(event);
    if (keep === null) return;
    Container.get(EventLogService).appendSafe({
      type: event,
      payload: keep ? keep(data) : data,
    });
  }

  /**
   * A Selector Health event (`selector_*`): each dashboard socket gets it only
   * if its caller may see the selector, by REST's rule (a selector healed in a
   * session the caller may see; SelectorVisibilityResolver). Admins get every
   * one. The event log records it once, unscoped.
   *
   * Each selector's events are delivered through one chain, in the order they
   * were emitted. With no scoped socket connected and nothing pending for the
   * selector, it is the synchronous room broadcast, with no lookup. The
   * returned promise settles once the event is delivered and never rejects.
   */
  public emitToDashboardForSelector(
    event: string,
    data: any,
    selector: SelectorKey,
  ): Promise<void> {
    this.logEvent(event, data);
    const key = JSON.stringify([selector.strategy, selector.selector]);
    if (!this.hasScopedDashboard() && !this.selectorDeliveries.has(key)) {
      this.io?.to('dashboard').emit(event, data);
      return Promise.resolve();
    }
    return this.enqueue(
      event,
      [key],
      () => this.deliverForSelector(event, data, selector),
      this.selectorDeliveries,
    );
  }

  private async deliverForSelector(event: string, data: any, selector: SelectorKey): Promise<void> {
    // The scoped sockets may have left while this waited its turn.
    if (!this.hasScopedDashboard()) {
      this.io?.to('dashboard').emit(event, data);
      return;
    }
    const resolver = Container.get(SelectorVisibilityResolver);
    const sockets = this.dashboardSockets();
    const allowed = await Promise.all(
      sockets.map((socket) => {
        const teamIds = teamIdsOf(socket);
        if (teamIds === undefined) return true;
        const userId = (socket.data?.identity as SocketIdentity | undefined)?.userId;
        return resolver.canSee(selector, { userId, teamIds });
      }),
    );
    sockets.forEach((socket, i) => {
      if (allowed[i]) socket.emit(event, data);
    });
  }

  /**
   * A dashboard event about one or more phones: each dashboard socket gets it
   * only if its caller can see the phone ({@link DeviceEventScope}), by the
   * same team rule as REST. The event log records it once, unscoped, as
   * EVENT_LOG_KEEPS says.
   *
   * Each phone's events are delivered through one chain, in the order they
   * were emitted, whatever their scope shape: one that waits on a team lookup
   * holds back the phone's later events, including a group event naming the
   * phone. A lookup is bounded by DeviceTeamResolver's timeout, after which
   * that event goes to admins only and the chain moves on.
   *
   * With no scoped socket connected (an auth-disabled server, or admins only)
   * and nothing pending for these phones, it is emitToDashboard's synchronous
   * room broadcast, with no lookup. The returned promise settles once the
   * event is delivered and never rejects.
   */
  public emitToDashboardForDevices(
    event: string,
    data: any,
    scope: DeviceEventScope,
  ): Promise<void> {
    this.logEvent(event, data);
    const udids = 'udids' in scope ? scope.udids : [scope.udid ?? ''];

    if (this.reachesEverySocket(scope) && udids.every((udid) => !this.deliveries.has(udid))) {
      this.noteRow(scope);
      this.io?.to('dashboard').emit(event, data);
      return Promise.resolve();
    }
    // The row's team is noted in its turn, so an earlier event still waiting
    // on a lookup is scoped by what was known when it was emitted.
    return this.enqueue(event, udids, () => {
      this.noteRow(scope);
      return this.deliver(event, data, scope);
    });
  }

  /** A device row in hand refreshes the resolver (see DeviceEventScope). */
  private noteRow(scope: DeviceEventScope): void {
    if ('teamId' in scope && scope.udid && scope.teamId !== undefined) {
      Container.get(DeviceTeamResolver).note(scope.udid, scope.teamId);
    }
  }

  /**
   * Whether any dashboard socket is team-scoped. When none is, a caller can
   * skip a lookup it would only make to scope an event (auth disabled).
   */
  public hasScopedDashboard(): boolean {
    return this.dashboardSockets().some((socket) => teamIdsOf(socket) !== undefined);
  }

  /** Runs `step` after every pending delivery for `keys` in `chains`, and makes it their new tail. */
  private enqueue(
    event: string,
    keys: string[],
    step: () => Promise<void>,
    chains: Map<string, Promise<void>> = this.deliveries,
  ): Promise<void> {
    const before = keys.map((key) => chains.get(key) ?? Promise.resolve());
    const done = Promise.all(before)
      .then(step)
      .catch((err: any) =>
        log.warn(`[SocketServer] ${event} not delivered: ${err?.message ?? err}`),
      );
    for (const key of keys) chains.set(key, done);
    void done.then(() => {
      for (const key of keys) {
        if (chains.get(key) === done) chains.delete(key);
      }
    });
    return done;
  }

  /**
   * Whether every dashboard socket gets an event of this scope whatever its
   * phones are, so it can be the room broadcast with no lookup.
   */
  private reachesEverySocket(scope: DeviceEventScope): boolean {
    return this.dashboardSockets().every(
      (socket) => teamIdsOf(socket) === undefined && (!scope.adminOnly || isAdmin(socket)),
    );
  }

  private async deliver(event: string, data: any, scope: DeviceEventScope): Promise<void> {
    // The scoped sockets may have left while this waited its turn.
    if (this.reachesEverySocket(scope)) {
      this.io?.to('dashboard').emit(event, data);
      return;
    }
    const resolver = Container.get(DeviceTeamResolver);
    // Read once the team is known, so a socket that joined meanwhile is included.
    const recipients = () =>
      this.dashboardSockets().filter((socket) => !scope.adminOnly || isAdmin(socket));

    if ('udids' in scope) {
      const teams = await Promise.all(scope.udids.map((udid) => resolver.resolve(udid)));
      for (const socket of recipients()) {
        const teamIds = teamIdsOf(socket);
        if (teamIds === undefined) {
          socket.emit(event, data);
          continue;
        }
        const visible = scope.udids.filter((_, i) => canSeeDeviceTeam(teams[i], teamIds));
        if (visible.length === 0) continue;
        socket.emit(
          event,
          visible.length === scope.udids.length ? data : scope.strip(data, visible),
        );
      }
      return;
    }

    const team: DeviceTeam =
      scope.teamId !== undefined
        ? { known: true, teamId: scope.teamId }
        : await resolver.resolve(scope.udid);
    for (const socket of recipients()) {
      if (canSeeDeviceTeam(team, teamIdsOf(socket))) socket.emit(event, data);
    }
  }

  /** The sockets in this server's local 'dashboard' room. */
  private dashboardSockets(): Socket[] {
    const ids = this.io?.sockets.adapter.rooms.get('dashboard');
    if (!this.io || !ids) return [];
    const out: Socket[] = [];
    for (const id of ids) {
      const socket = this.io.sockets.sockets.get(id);
      if (socket) out.push(socket);
    }
    return out;
  }

  public emitToNodes(event: string, data: any) {
    if (this.io) {
      this.io.to('nodes').emit(event, data);
    }
  }
}

/** A socket with no identity (never expected) is a member of no team: it sees only the shared pool. */
function teamIdsOf(socket: Socket): string[] | undefined {
  const identity = socket.data?.identity as SocketIdentity | undefined;
  return identity ? identity.teamIds : [];
}

/** An admin by role, as `roleGuard('ADMIN')` decides. A socket with no identity is not one. */
function isAdmin(socket: Socket): boolean {
  const role = (socket.data?.identity as SocketIdentity | undefined)?.role;
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}
