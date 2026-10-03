import { Service } from 'typedi';
import log from '../../logger';
import SessionType from '../../enums/SessionType';
import type { MetricSample } from './types';

/**
 * A session's figures as a node holds them for its hub: it samples the
 * session (`sampling`), its sampler gave up (`stopped`), the session ended
 * here (`ended`), or the node has nothing for it (`off`).
 */
export type NodeMetricsState = 'sampling' | 'stopped' | 'ended' | 'off';

export interface NodeMetricsAnswer {
  platform: string;
  state: NodeMetricsState;
  samples: MetricSample[];
}

/** Where a node serves a session's figures, under `/xenon/api`. */
export const NODE_METRICS_ROUTE = '/node/sessions/:sessionId/metrics';
/** On every answer of that route, so a hub can tell a node that has it. */
export const NODE_METRICS_HEADER = 'x-xenon-node-metrics';
/** How long a node keeps an ended session's figures for its hub's last collection. */
export const KEEP_AFTER_END_MS = 10 * 60_000;

/** What a node's answer at NODE_METRICS_ROUTE means for the hub. */
export type NodeAsk =
  | { kind: 'answer'; answer: NodeMetricsAnswer }
  /** An older node, without the route. */
  | { kind: 'unsupported'; status: number }
  /** The node refused the hub's token: the session is gone, or isn't the hub's. */
  | { kind: 'refused' }
  /** Unreachable, timed out, or couldn't check the token (503): ask again. */
  | { kind: 'unavailable'; reason: string };

const STATES: readonly NodeMetricsState[] = ['sampling', 'stopped', 'ended', 'off'];

const figure = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isFinite(v));

/**
 * The sample, field by field, or null when it isn't one. A node is our own
 * code, but one malformed sample would fail every later write of the
 * session's figures (the batch goes back to the front of the buffer).
 */
function sampleOf(v: any): MetricSample | null {
  if (!v || typeof v !== 'object') return null;
  if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
  const { deviceCpuPct, deviceMemMb, deviceMemTotalMb, appCpuPct, appMemMb, appId } = v;
  if (![deviceCpuPct, deviceMemMb, deviceMemTotalMb, appCpuPct, appMemMb].every(figure)) {
    return null;
  }
  if (appId !== null && typeof appId !== 'string') return null;
  return { at: v.at, deviceCpuPct, deviceMemMb, deviceMemTotalMb, appCpuPct, appMemMb, appId };
}

export function readNodeMetricsReply(
  status: number,
  headers: Record<string, unknown>,
  data: any,
): NodeAsk {
  if (!headers?.[NODE_METRICS_HEADER]) {
    // An older node answers its login's 401, an unknown route's 404, or a
    // catch-all's 2xx. Anything else without the header (a proxy's 502 in
    // front of a node) is an outage: ask again, never give the node up.
    if (status === 401 || status === 404 || (status >= 200 && status < 300)) {
      return { kind: 'unsupported', status };
    }
    return { kind: 'unavailable', reason: `answered ${status}` };
  }
  if (status === 404) return { kind: 'refused' };
  const value = data?.value;
  if (status === 200 && value && STATES.includes(value.state) && Array.isArray(value.samples)) {
    return {
      kind: 'answer',
      answer: {
        platform: String(value.platform ?? ''),
        state: value.state,
        samples: (value.samples as unknown[])
          .map(sampleOf)
          .filter((x): x is MetricSample => x !== null),
      },
    };
  }
  return { kind: 'unavailable', reason: `answered ${status}` };
}

/** What the hub's collector needs of a session a node runs: a RemoteSession. */
export interface NodeMetricsSource {
  nodeOrigin(): string | null;
  nodeMetrics(after: number | null): Promise<NodeAsk>;
}

/**
 * The session as a NodeMetricsSource, when it runs on a node. A cloud
 * provider's session (CloudSession) and this server's own (LocalSession)
 * inherit the methods from RemoteSession, so the type decides.
 */
export function nodeMetricsSourceOf(session: unknown): NodeMetricsSource | undefined {
  const s = session as (Partial<NodeMetricsSource> & { getType?: () => string }) | null | undefined;
  return s &&
    s.getType?.() === SessionType.REMOTE &&
    typeof s.nodeMetrics === 'function' &&
    typeof s.nodeOrigin === 'function'
    ? (s as NodeMetricsSource)
    : undefined;
}

/** How long the hub leaves a node without the route alone before asking it again. */
export const NODE_METRICS_RECHECK_MS = 10 * 60_000;

/**
 * Hub side: which nodes lack the route (an older Xenon). Their sessions show
 * no figures; the hub says so once per node, and asks again after
 * NODE_METRICS_RECHECK_MS, so a node upgraded in place is picked up.
 */
@Service()
export class NodeMetricsSupport {
  logger: { warn(message: string): void } = log.scope('NodeMetrics');
  now: () => number = () => Date.now();
  private readonly unsupportedUntil = new Map<string, number>();
  private readonly warned = new Set<string>();

  shouldAsk(origin: string): boolean {
    const until = this.unsupportedUntil.get(origin);
    if (until === undefined) return true;
    if (until > this.now()) return false;
    this.unsupportedUntil.delete(origin);
    return true;
  }

  unsupported(origin: string, status: number): void {
    this.unsupportedUntil.set(origin, this.now() + NODE_METRICS_RECHECK_MS);
    if (this.warned.has(origin)) return;
    this.warned.add(origin);
    this.logger.warn(
      `Node ${origin} has no session metrics route (answered ${status}): an older Xenon. ` +
        'Its sessions show no CPU or memory. Upgrade the node.',
    );
  }
}
