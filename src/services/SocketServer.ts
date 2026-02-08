import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { Service } from 'typedi';
import log from '../logger';
import { SocketEvents, XENON_PROTOCOL_VERSION, HandshakeData } from '../enums/SocketEvents';

@Service()
export class SocketServer {
    private io: SocketIOServer | null = null;
    private nodes: Map<string, string> = new Map(); // socketId -> nodeHost

    public initialize(server: HTTPServer) {
        this.io = new SocketIOServer(server, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST'],
            },
        });

        this.io.on('connection', (socket) => {
            const socketId = socket.id;
            log.info(`[SocketServer] New connection attempt: ${socketId}`);

            // 1. Mandatory Handshake for Protocol Sync
            socket.on(SocketEvents.HANDSHAKE, (data: HandshakeData) => {
                const { version, host } = data;
                if (version !== XENON_PROTOCOL_VERSION) {
                    log.error(`[SocketServer] Protocol mismatch for client ${socketId}. Hub: ${XENON_PROTOCOL_VERSION}, Client: ${version}`);
                    socket.disconnect();
                    return;
                }
                log.info(`[SocketServer] Handshake successful with client ${host || socketId} (v${version})`);
            });

            socket.on(SocketEvents.REGISTER_NODE, (data: { host: string }) => {
                const { host } = data;
                this.nodes.set(socketId, host);
                log.info(`[SocketServer] Node registered: ${host} (Socket: ${socketId})`);
                socket.join('nodes');

                // Notify dashboard about new node
                this.emitToDashboard(SocketEvents.NODE_CONNECTED, { host });
            });

            socket.on(SocketEvents.REGISTER_DASHBOARD, () => {
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

        log.info('[SocketServer] WebSocket server initialized');
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
