import { Service } from 'typedi';
import log from '../../logger';
import SessionType from '../../enums/SessionType';
import { NodeReply, OlderNodes, readNodeReply } from '../../gateway/nodeAsk';

/**
 * A session's device log lines as a node holds them for its hub: it records
 * the session (`recording`), the session ended here (`ended`), or the node
 * has nothing for it (`off`: a session it doesn't record, doesn't know, or
 * stopped recording because no hub asked).
 */
export type NodeDeviceLogsState = 'recording' | 'ended' | 'off';

/** A row of the session's Device logs, numbered by the node in the order it was kept. */
export interface NodeDeviceLogLine {
  seq: number;
  message: string;
  /** The line's moment, ms, by the node's clock. */
  timestamp: number;
}

export interface NodeDeviceLogsAnswer {
  state: NodeDeviceLogsState;
  lines: NodeDeviceLogLine[];
  /** The node holds more lines than it answered: ask again at once. */
  more: boolean;
}

/** Where a node serves a session's device log lines, under `/xenon/api`. */
export const NODE_DEVICE_LOGS_ROUTE = '/node/sessions/:sessionId/device-logs';
/** On every answer of that route, so a hub can tell a node that has it. */
export const NODE_DEVICE_LOGS_HEADER = 'x-xenon-node-device-logs';
/** Lines in one answer. */
export const NODE_DEVICE_LOG_PAGE = 2_000;
/** How long a node keeps an ended session's lines for its hub's last ask. */
export const NODE_DEVICE_LOGS_KEEP_AFTER_END_MS = 10 * 60_000;
/**
 * A node stops recording a session no hub has asked about this long after
 * it started: its hub doesn't collect (its dashboard is off, the default) or
 * is older. A hub that collects asks as soon as the session is created.
 */
export const UNCLAIMED_MS = 2 * 60_000;

/** What a node's answer at NODE_DEVICE_LOGS_ROUTE means for the hub. */
export type NodeDeviceLogsAsk = NodeReply<NodeDeviceLogsAnswer>;

const STATES: readonly NodeDeviceLogsState[] = ['recording', 'ended', 'off'];

/**
 * The line, field by field, or null when it isn't one: one malformed row
 * would fail every later write of the session's lines (a failed batch goes
 * back to the front of the buffer).
 */
function lineOf(v: any): NodeDeviceLogLine | null {
  if (!v || typeof v !== 'object') return null;
  if (!Number.isSafeInteger(v.seq) || v.seq < 1) return null;
  if (typeof v.message !== 'string') return null;
  if (typeof v.timestamp !== 'number' || !Number.isFinite(v.timestamp)) return null;
  return { seq: v.seq, message: v.message, timestamp: v.timestamp };
}

function deviceLogsAnswerOf(value: any): NodeDeviceLogsAnswer | null {
  if (!value || !STATES.includes(value.state) || !Array.isArray(value.lines)) return null;
  return {
    state: value.state,
    lines: (value.lines as unknown[]).map(lineOf).filter((x): x is NodeDeviceLogLine => !!x),
    more: value.more === true,
  };
}

export function readNodeDeviceLogsReply(
  status: number,
  headers: Record<string, unknown>,
  data: any,
): NodeDeviceLogsAsk {
  return readNodeReply(NODE_DEVICE_LOGS_HEADER, status, headers, data, deviceLogsAnswerOf);
}

/** What the hub's collector needs of a session a node runs: a RemoteSession. */
export interface NodeDeviceLogsSource {
  nodeOrigin(): string | null;
  nodeDeviceLogs(after: number | null): Promise<NodeDeviceLogsAsk>;
}

/**
 * The session as a NodeDeviceLogsSource, when it runs on a node. A cloud
 * provider's session (CloudSession) and this server's own (LocalSession)
 * inherit the methods from RemoteSession, so the type decides.
 */
export function nodeDeviceLogsSourceOf(session: unknown): NodeDeviceLogsSource | undefined {
  const s = session as
    | (Partial<NodeDeviceLogsSource> & { getType?: () => string })
    | null
    | undefined;
  return s &&
    s.getType?.() === SessionType.REMOTE &&
    typeof s.nodeDeviceLogs === 'function' &&
    typeof s.nodeOrigin === 'function'
    ? (s as NodeDeviceLogsSource)
    : undefined;
}

/** Hub side: which nodes lack the route (an older Xenon). Their sessions have no Device logs. */
@Service()
export class NodeDeviceLogsSupport extends OlderNodes {
  logger: { warn(message: string): void } = log.scope('DeviceLogs');

  protected warning(origin: string, status: number): string {
    return (
      `Node ${origin} has no session device log route (answered ${status}): an older Xenon. ` +
      'Its sessions have no device logs here. Upgrade the node.'
    );
  }
}
