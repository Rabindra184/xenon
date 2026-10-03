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
