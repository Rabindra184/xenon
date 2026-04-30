import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { Service, Container } from 'typedi';
import log from '../logger';
import { config as xenonConfig } from '../config';
import { ApiKeyService } from './ApiKeyService';
import { prisma } from '../prisma';
import { SocketEvents, XENON_PROTOCOL_VERSION, HandshakeData } from '../enums/SocketEvents';

// Socket principals mirror the two REST auth paths. 'auth-disabled' is a
// deliberate passthrough so XENON_AUTH_DISABLED=true still lets the dashboard
// and nodes connect (matches apiKeyMiddleware behavior).
type Principal = 'dashboard' | 'node' | 'auth-disabled';

const SESSION_COOKIE = 'xenon_dashboard_session';

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

  public initialize(server: HTTPServer) {
    this.io = new SocketIOServer(server, {
      // Same-origin only. Browsers on a different origin are blocked at the
      // handshake; server-to-server node connections send no Origin header
      // and are unaffected. Matches the apiRouter cors({origin:false}) policy.
      cors: {
        origin: false,
        methods: ['GET', 'POST'],
      },
    });

    this.io.use(async (socket, next) => {
      try {
        const principal = await this.authenticate(socket);
        socket.data.principal = principal;
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

  private async authenticate(socket: Socket): Promise<Principal> {
    if (xenonConfig.authDisabled === true) return 'auth-disabled';

    const auth = (socket.handshake.auth || {}) as Record<string, any>;
    const headers = socket.handshake.headers || {};

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
        select: { status: true },
      });
      if (!owner || owner.status !== 'ACTIVE') throw new Error('inactive user');
      return 'node';
    }

    // Dashboard path: API key header, or session cookie set by /auth/login.
    const apiKeyRaw =
      (typeof auth.apiKey === 'string' && auth.apiKey) ||
      ((headers['x-xenon-api-key'] as string | undefined) ?? '') ||
      readCookie(headers.cookie as string | undefined, SESSION_COOKIE) ||
      '';

    if (!apiKeyRaw) {
      throw new Error(
        'missing credentials (need (accessKey, token) pair, apiKey, or dashboard cookie)',
      );
    }

    const row = await Container.get(ApiKeyService).verify(apiKeyRaw);
    if (!row) {
      throw new Error('invalid or revoked API key');
    }
    return 'dashboard';
  }

  public emitToDashboard(event: string, data: any) {
    if (this.io) {
      this.io.to('dashboard').emit(event, data);
    }
  }

  public emitToNodes(event: string, data: any) {
    if (this.io) {
      this.io.to('nodes').emit(event, data);
    }
  }

  public broadcast(event: string, data: any) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }
}
