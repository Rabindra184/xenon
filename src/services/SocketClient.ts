import { io, Socket } from 'socket.io-client';
import { Service } from 'typedi';
import log from '../logger';
import { config as xenonConfig } from '../config';
import { SocketEvents, XENON_PROTOCOL_VERSION } from '../enums/SocketEvents';
import { proxyAgentFor, socketProxyAgentFor } from '../helpers/outboundProxy';

@Service()
export class SocketClient {
  private socket: Socket | null = null;
  private hubUrl: string | null = null;
  private nodeHost: string | null = null;

  public initialize(hubUrl: string, nodeHost: string) {
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

    this.socket.on('connect', () => {
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
    });
  }

  public emit(event: string, data: any) {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    } else {
      log.debug(`[SocketClient] Cannot emit ${event}: Socket not connected`);
    }
  }

  public isConnected(): boolean {
    return this.socket?.connected || false;
  }
}
