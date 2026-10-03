import type { RequestHandler, Router } from 'express';
import { Container } from 'typedi';
import log from '../logger';
import { config } from '../config';
import type { IPluginArgs } from '../interfaces/IPluginArgs';
import { commandAuthEnabled } from '../middleware/commandAuth';
import {
  NODE_METRICS_HEADER,
  NODE_METRICS_ROUTE,
  NodeMetricsAnswer,
} from '../services/metrics/nodeMetrics';
import { NodeMetricsStore } from '../services/metrics/NodeMetricsStore';
import { HubSessionTokenVerifier } from './hubSessionToken';
import { HubAnswerDeps, answerForHub } from './nodeSessionStatus';

/**
 * A session's CPU and memory, asked by the hub of the node that runs it
 * (NodeMetricsCollector). The node samples its own phones and holds the
 * figures in memory (NodeMetricsStore), since it has no Session row for a
 * session the hub created. `?after=<ms>` asks for the samples newer than the
 * hub has; those it has are dropped. The samples name the app in use, so the
 * route asks what a command to the session asks, as the session-status route
 * does (answerForHub).
 */
export interface NodeSessionMetricsDeps extends HubAnswerDeps {
  read: (sessionId: string, after: number | null) => NodeMetricsAnswer;
}

/** `?after=`: a time in ms, else none. A number too long to be one (Infinity) is none. */
export function parseAfter(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+(\.\d+)?$/.test(raw)) return null;
  const after = Number(raw);
  return Number.isFinite(after) ? after : null;
}

export function nodeSessionMetricsHandler(deps: NodeSessionMetricsDeps): RequestHandler {
  return (req, res) => {
    res.setHeader(NODE_METRICS_HEADER, '1');
    const sessionId = String(req.params?.sessionId ?? '');
    answerForHub(deps, req, res, sessionId, 'Session metrics', () =>
      res.status(200).json({ value: deps.read(sessionId, parseAfter(req.query?.after)) }),
    );
  };
}

/** A node's route, ahead of its login, like the session-status route. A hub or standalone server has none. */
export function registerNodeSessionMetrics(router: Router, pluginArgs: IPluginArgs): void {
  if (pluginArgs.hub === undefined) return;
  router.get(
    NODE_METRICS_ROUTE,
    nodeSessionMetricsHandler({
      hubTokens: new HubSessionTokenVerifier(pluginArgs.hub),
      enforced: () => commandAuthEnabled() && config.authDisabled !== true,
      read: (sessionId, after) => Container.get(NodeMetricsStore).read(sessionId, after),
      logger: log.scope('NodeSessionMetrics'),
    }),
  );
}
