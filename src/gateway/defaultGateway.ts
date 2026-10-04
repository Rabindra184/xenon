import { Container } from 'typedi';
import { routeToCommandName } from '@appium/base-driver';
import log from '../logger';
import { prisma } from '../prisma';
import { normalizeBasePath } from '../app/appiumBasePath';
import type { SessionGatewayOptions } from '../app/registerCommandAuth';
import type { IDevice } from '../interfaces/IDevice';
import type { IPluginArgs } from '../interfaces/IPluginArgs';
import { isLocalDeviceHost, localDeviceHosts } from '../device-managers/localDeviceHosts';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { SessionLifecycleService } from '../services/SessionLifecycleService';
import { NetworkConditioningService } from '../services/NetworkConditioningService';
import { DASHBORD_EVENT_MANAGER } from '../dashboard/event-manager';
import { updateCmdExecutedTime } from '../data-service/device-service';
import { HubSessionTokenIssuer, HubSessionTokenVerifier } from './hubSessionToken';
import { nodeWebDriverUrl } from './nodeWebDriverUrl';
import { SessionLocator, sessionRowsFrom } from './sessionLocator';
import { DashboardHooks, createHubRouting } from './sessionGateway';
import type { HubGrantCheck, SessionCreateDeps } from './sessionCreate';

/**
 * The session gateway as a Xenon server runs it: the production wiring of
 * sessionGateway.ts, sessionCreate.ts, sessionLocator.ts and hubSessionToken.ts.
 */

const latencyOf = (sessionId: string) =>
  Container.get(NetworkConditioningService).getLatency(sessionId);

/** `POST <basePath>/session` in the gateway, with the server's SessionLifecycleService. */
const createWith = (hubGrants?: HubGrantCheck): SessionCreateDeps => ({
  lifecycle: () => Container.get(SessionLifecycleService),
  hubGrants,
  logger: log.scope('SessionGateway'),
});

const dashboardHooks: DashboardHooks = {
  before: (sessionId, command, req, res) =>
    DASHBORD_EVENT_MANAGER.beforeSessionCommand(sessionId, command, req, res),
  after: (sessionId, command, req, res, body, heal) =>
    DASHBORD_EVENT_MANAGER.afterSessionCommand(sessionId, command, null, req, res, body, heal),
};

export interface HubGatewayConfig {
  /** This hub's Appium base path, as the operator wrote it. */
  basePath: unknown;
  /** Whether a phone's host is one this server drives (localDeviceHosts). */
  isLocalHost: (host: string) => boolean;
  /** This server's node id (PluginContext.nodeId). */
  nodeId: () => string;
  /** Whether the hub's dashboard is on: its command hooks run only then. */
  dashboard: () => boolean;
}

/** A hub: sessions other servers run are forwarded to them. */
export function hubGatewayOptions(config: HubGatewayConfig): SessionGatewayOptions {
  const basePath = normalizeBasePath(config.basePath);
  const isLocalDevice = (device: IDevice) =>
    !device.cloud && (device.nodeId === config.nodeId() || config.isLocalHost(device.host));

  const locator = new SessionLocator({
    getSession: (sessionId) => SESSION_MANAGER.getSession(sessionId),
    ...sessionRowsFrom(prisma),
    isLocalDevice,
    webDriverUrlOf: (device) => nodeWebDriverUrl(device, basePath),
  });
  const tokens = () => Container.get(HubSessionTokenIssuer);

  const routing = createHubRouting({
    basePath,
    locate: (sessionId) => locator.locate(sessionId),
    forget: (sessionId) => locator.forget(sessionId),
    tokenFor: (sessionId) => tokens().tokenFor(sessionId),
    forgetToken: (sessionId) => tokens().forget(sessionId),
    deleteSession: (next, sessionId) =>
      Container.get(SessionLifecycleService).deleteSession(next, sessionId),
    touch: (sessionId) => updateCmdExecutedTime(sessionId),
    commandName: (path, method) => routeToCommandName(path, method as any, basePath),
    get dashboard() {
      return config.dashboard() ? dashboardHooks : undefined;
    },
    logger: log.scope('SessionGateway'),
  });

  return { routing, latencyOf, create: createWith() };
}

/**
 * A node: the hub's session token is accepted in place of the client's
 * credentials, and its create token is a create's credential.
 */
export function nodeGatewayOptions(hubUrl: string): SessionGatewayOptions {
  const hub = new HubSessionTokenVerifier(hubUrl);
  return { hubTokens: hub, latencyOf, create: createWith(hub) };
}

/** The gateway for this server: a node when it has a hub, a hub otherwise. */
export function gatewayOptionsFor(
  pluginArgs: IPluginArgs,
  cliArgs: { basePath?: unknown; port: number },
  nodeId: () => string,
): SessionGatewayOptions {
  if (pluginArgs.hub !== undefined) return nodeGatewayOptions(pluginArgs.hub);
  const localHosts = localDeviceHosts(pluginArgs, cliArgs.port);
  return hubGatewayOptions({
    basePath: cliArgs.basePath,
    isLocalHost: (host) => isLocalDeviceHost(localHosts, host),
    nodeId,
    dashboard: () => !!pluginArgs.enableDashboard,
  });
}
