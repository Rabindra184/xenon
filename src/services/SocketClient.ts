import { io, Socket } from 'socket.io-client';
import { Service } from 'typedi';
import log from '../logger';
import { config as xenonConfig } from '../config';
import { SocketEvents, XENON_PROTOCOL_VERSION } from '../enums/SocketEvents';
import { proxyAgentFor, socketProxyAgentFor } from '../helpers/outboundProxy';

/** The hub's `connect_error` when it could not check the handshake now (SocketServer). */
const HANDSHAKE_UNAVAILABLE = 'unavailable';
/** The first wait before a handshake the hub couldn't check is tried again; it doubles from there. */
const RETRY_DELAY_MS = 1_000;
/** The longest wait between those tries. */
const RETRY_DELAY_MAX_MS = 30_000;

@Service()
export class SocketClient {
  private socket: Socket | null = null;
  private hubUrl: string | null = null;
  private nodeHost: string | null = null;
  private retryTimer: NodeJS.Timeout | undefined;

  public initialize(hubUrl: string, nodeHost: string, options: { retryDelayMs?: number } = {}) {
    this.hubUrl = hubUrl;
    this.nodeHost = nodeHost;

    // Remove wd/hub if present in hubUrl
    const normalizedHubUrl = hubUrl.replace(/\/wd\/hub$/, '');

    log.info(`[SocketClient] Connecting to Hub WebSocket: ${normalizedHubUrl}`);

    // (accessKey, token) pair the node was provisioned with on the hub.
    // auth-disabled mode on the hub (XENON_AUTH_DISABLED=true) ignores
    // this field entirely.
    const hubAccessKey = xenonConfig.hubAccessKey;
    const hubToken = xenonConfig.hubToken;

    let socketAuth: Record<string, string> | undefined;
    if (hubAccessKey && hubToken) {
      socketAuth = { accessKey: hubAccessKey, token: hubToken };
    } else {
      socketAuth = undefined;
      log.warn(
        '[SocketClient] XENON_HUB_ACCESS_KEY + XENON_HUB_TOKEN not set; hub will reject the handshake unless it also has auth disabled.',
      );
    }

    this.socket = io(normalizedHubUrl, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      auth: socketAuth,
      // The proxy the node's other calls to its hub take (its phone reports,
      // its JWKS fetch); it used to go straight to the hub whatever the
      // environment said. Polling goes as plain requests, as axios sends
      // them; only the WebSocket upgrade needs a CONNECT tunnel, and when the
      // proxy refuses one (a stock Squid allows port 443 only) the
      // connection stays on polling.
      transportOptions: {
        polling: { agent: proxyAgentFor(normalizedHubUrl) },
        websocket: { agent: socketProxyAgentFor(normalizedHubUrl) },
      },
    });

    const firstDelay = options.retryDelayMs ?? RETRY_DELAY_MS;
    let retryDelay = firstDelay;

    this.socket.on('connect', () => {
      retryDelay = firstDelay;
      log.info(`[SocketClient] Connected to Hub: ${this.socket?.id}`);

      // 1. Send Handshake
      this.socket?.emit(SocketEvents.HANDSHAKE, {
        version: XENON_PROTOCOL_VERSION,
        host: this.nodeHost,
        timestamp: Date.now(),
      });

      // 2. Register Node
      this.socket?.emit(SocketEvents.REGISTER_NODE, { host: this.nodeHost });
    });

    this.socket.on('disconnect', (reason) => {
      log.warn(`[SocketClient] Disconnected from Hub: ${reason}`);
    });

    this.socket.on('connect_error', (error) => {
      log.error(`[SocketClient] Connection error: ${error.message}`);
      // socket.io-client never tries a handshake the hub answered again (the
      // socket is left inactive). `unavailable` is the hub saying it could
      // not check the node's credential now (its database or signing key),
      // so try again, waiting longer each time; `unauthorized` is a refusal,
      // which another try with the same credential won't change. Through
      // 2.36 the hub answered both `unauthorized` and the node never retried.
      const socket = this.socket;
      if (!socket || socket.active || error.message !== HANDSHAKE_UNAVAILABLE) return;
      const delay = retryDelay;
      retryDelay = Math.min(retryDelay * 2, RETRY_DELAY_MAX_MS);
      log.warn(`[SocketClient] The hub could not check this node now; trying again in ${delay} ms`);
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        if (this.socket === socket && !socket.active) socket.connect();
      }, delay);
      this.retryTimer.unref();
    });
  }

  public emit(event: string, data: any) {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    } else {
      log.debug(`[SocketClient] Cannot emit ${event}: Socket not connected`);
    }
  }

  /** Ends the connection to the hub, and any try waiting to be made. */
  public close(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.socket?.close();
  }

  public isConnected(): boolean {
    return this.socket?.connected || false;
  }
}
