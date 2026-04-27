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
  SELECTOR_FIXED = 'selector_fixed',
  SELECTOR_RESOLVED = 'selector_resolved',
  SELECTOR_REGRESSED = 'selector_regressed',
  SELECTOR_CANCELLED = 'selector_cancelled',
  SELECTOR_MUTED = 'selector_muted',
  SELECTOR_UNMUTED = 'selector_unmuted',
  SELECTOR_PROGRESS = 'selector_progress',

  INTERCEPTOR_REQUEST = 'interceptor_request',
  INTERCEPTOR_SESSION_STARTED = 'interceptor_session_started',
  INTERCEPTOR_SESSION_STOPPED = 'interceptor_session_stopped',

  BUG_REPORT_GENERATED = 'bug_report_generated',

  RECORDING_STARTED = 'recording_started',
  RECORDING_STOPPED = 'recording_stopped',
  RECORDING_BOOKMARK_ADDED = 'recording_bookmark_added',
  RECORDING_ANNOTATION_ADDED = 'recording_annotation_added',
  RECORDING_FAILED = 'recording_failed',
  RECORDING_FRAME_DROPS = 'recording_frame_drops',
}

export const XENON_PROTOCOL_VERSION = '1.0.0';

export interface HandshakeData {
  version: string;
  nodeId?: string;
  host?: string;
  timestamp: number;
}
