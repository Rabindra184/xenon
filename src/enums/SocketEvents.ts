export enum SocketEvents {
  HANDSHAKE = 'handshake',
  REGISTER_NODE = 'register_node',
  REGISTER_DASHBOARD = 'register_dashboard',
  NODE_CONNECTED = 'node_connected',
  NODE_DISCONNECTED = 'node_disconnected',
  SESSION_STARTED = 'session_started',
  SESSION_STOPPED = 'session_stopped',
  SESSION_COMMAND = 'session_command',
  HEALING_EVENT = 'healing_event',
}

export const XENON_PROTOCOL_VERSION = '1.0.0';

export interface HandshakeData {
  version: string;
  nodeId?: string;
  host?: string;
  timestamp: number;
}
