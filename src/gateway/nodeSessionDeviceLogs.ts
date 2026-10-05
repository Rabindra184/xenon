import type { RequestHandler, Router } from 'express';
import { Container } from 'typedi';
import log from '../logger';
import { config } from '../config';
import type { IPluginArgs } from '../interfaces/IPluginArgs';
import { commandAuthEnabled } from '../middleware/commandAuth';
import {
  NODE_DEVICE_LOGS_HEADER,
  NODE_DEVICE_LOGS_ROUTE,
  NodeDeviceLogsAnswer,
} from '../services/logcat/nodeDeviceLogs';
import { NodeDeviceLogStore } from '../services/logcat/NodeDeviceLogStore';
import { HubSessionTokenVerifier } from './hubSessionToken';
import { parseAfter } from './nodeSessionMetrics';
import { HubAnswerDeps, answerForHub } from './nodeSessionStatus';

/**
 * A session's device log lines, asked by the hub of the node that runs it
 * (NodeDeviceLogsCollector). The node records its own phone's lines and holds
 * them in memory (NodeDeviceLogStore), since it has no Session row for a
 * session the hub created. `?after=<seq>` asks for the lines after the
 * newest the hub has; those it has are dropped.
 *
 * The lines are what the phone logged, which can hold sign-in tokens and
 * personal data, so the route asks what a command to the session asks
 * (answerForHub), never less: with per-command auth off, the session id is
 * all a command needs, and a command could read the same lines
 * (`getLog('logcat')`).
 */
export interface NodeSessionDeviceLogsDeps extends HubAnswerDeps {
  read: (sessionId: string, after: number | null) => NodeDeviceLogsAnswer;
}

export function nodeSessionDeviceLogsHandler(deps: NodeSessionDeviceLogsDeps): RequestHandler {
  return (req, res) => {
    res.setHeader(NODE_DEVICE_LOGS_HEADER, '1');
    const sessionId = String(req.params?.sessionId ?? '');
    answerForHub(deps, req, res, sessionId, 'Session device logs', () =>
      res.status(200).json({ value: deps.read(sessionId, parseAfter(req.query?.after)) }),
    );
  };
}

/** A node's route, ahead of its login, like the session-status route. A hub or standalone server has none. */
export function registerNodeSessionDeviceLogs(router: Router, pluginArgs: IPluginArgs): void {
  if (pluginArgs.hub === undefined) return;
  router.get(
    NODE_DEVICE_LOGS_ROUTE,
    nodeSessionDeviceLogsHandler({
      hubTokens: new HubSessionTokenVerifier(pluginArgs.hub),
      enforced: () => commandAuthEnabled() && config.authDisabled !== true,
      read: (sessionId, after) => Container.get(NodeDeviceLogStore).read(sessionId, after),
      logger: log.scope('NodeSessionDeviceLogs'),
    }),
  );
}
