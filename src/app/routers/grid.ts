import { Response, Request, Router } from 'express';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { QueueService } from '../../data-service/queue-service';

import { InternalHttpClient } from '../../InternalHttpClient';
import _ from 'lodash';
import {
  addNewDevice,
  userBlockDevice,
  getDevice,
  NodeRemoval,
  removeNodeDevices,
  userUnblockDevice,
  updateDeviceTags,
  filterRowsByVisibleDevice,
  enrichDevicesWithTeamNames,
} from '../../data-service/device-service';
import {
  partitionPendingForCaller,
  withoutRequester,
} from '../../services/device-access/queueVisibility';
import { scopeGuard } from '../../middleware/scopeGuard';
import { roleGuard } from '../../middleware/roleGuard';
import log, { redactSecrets } from '../../logger';
import { XenonManager } from '../../device-managers';
import { Container } from 'typedi';
import { IPluginArgs } from '../../interfaces/IPluginArgs';
import { IDevice } from '../../interfaces/IDevice';
import { prisma } from '../../prisma';
import { DeviceTeamResolver } from '../../services/device-access/DeviceTeamResolver';
import { PluginContext } from '../../PluginContext';
import { isOwnDevice, localDeviceHosts } from '../../device-managers/localDeviceHosts';

const store = DeviceStoreFactory.getStore();
const pendingStore = DeviceStoreFactory.getPendingSessionStore();

const SERVER_UP_TIME = new Date().toISOString();

async function getDevices(request: Request, response: Response) {
  let devices = await store.getAllDevices();
  // Phase 4A team visibility. authMiddleware populates req.auth.teamIds
  // once per request: undefined for admins (unscoped), [a, b] for
  // member-tier callers' team set (or [singleTeamId] for token-narrowed
  // (accessKey, token) callers). Empty array = shared-pool-only.
  const auth = (request as Request & { auth?: { teamIds?: string[] } }).auth;
  if (auth && auth.teamIds !== undefined) {
    const ids = auth.teamIds;
    if (ids.length === 0) {
      devices = devices.filter((d) => !d.teamId);
    } else {
      devices = devices.filter((d) => !d.teamId || ids.includes(d.teamId));
    }
  }
  const { sessionId } = request.query;
  if (sessionId) {
    const match = devices.find((value) => value.session_id === sessionId);
    if (!match) return response.json(undefined);
    const [enriched] = await enrichDevicesWithTeamNames([match]);
    return response.json(enriched);
  }
  /* dashboard-plugin-url is the base url for opening the appium-dashboard-plugin
   * This value will be attached to all express request via middleware
   */
  const dashboardPluginUrl = (request as any)['dashboard-plugin-url'];
  if (dashboardPluginUrl) {
    const response: any = await InternalHttpClient.get(
      `${dashboardPluginUrl}/api/sessions?start_time=${SERVER_UP_TIME}`,
    );
    const sessions = response?.result?.rows || [];
    const deviceSessionMap: any = {};
    sessions.forEach((session: any) => {
      if (!deviceSessionMap[session.udid]) {
        deviceSessionMap[session.udid] = [];
      }
      deviceSessionMap[session.udid].push(session);
    });
    devices = devices.map((d) => {
      d.dashboard_link = `${dashboardPluginUrl}?device_udid=${d.udid}&start_time=${SERVER_UP_TIME}`;
      d.total_session_count = deviceSessionMap[d.udid]?.length || 0;
      return d;
    });
  }
  return response.json(await enrichDevicesWithTeamNames(devices));
}

async function getDeviceByPlatform(request: Request, response: Response) {
  const { platform } = request.params;
  const { deviceType, booted } = request.query;
  if (!platform || ['ios', 'android'].indexOf(platform.toLowerCase()) < 0) {
    return response.status(200).send([]);
  }
  let devices = await store.findDevices({
    platform: platform.toLowerCase() as any,
  });

  if (!_.isNil(deviceType)) {
    devices = devices.filter((value) => value.deviceType === deviceType);
  }

  if (!_.isNil(booted)) {
    devices = devices.filter((d) => d.state === 'Booted');
  }

  // Phase 4A: same team-visibility filter as /devices.
  const auth = (request as Request & { auth?: { teamIds?: string[] } }).auth;
  if (auth && auth.teamIds !== undefined) {
    const ids = auth.teamIds;
    if (ids.length === 0) {
      devices = devices.filter((d) => !d.teamId);
    } else {
      devices = devices.filter((d) => !d.teamId || ids.includes(d.teamId));
    }
  }

  return response.status(200).send(await enrichDevicesWithTeamNames(devices));
}

/** A removal a node asked for, from what it sent: strings only. */
function nodeRemoval(host: unknown, nodeId: unknown, udid?: string): NodeRemoval {
  return {
    udid,
    host: typeof host === 'string' && host !== '' ? host : undefined,
    nodeId: typeof nodeId === 'string' && nodeId !== '' ? nodeId : undefined,
  };
}

/** Whether a row is one of this server's own phones, which no node may remove. */
function isThisServersOwn(): (device: IDevice) => boolean {
  const context = Container.get(PluginContext);
  const local = localDeviceHosts(context.pluginArgs, context.port);
  return (device) => isOwnDevice(local, context.nodeId, device);
}

async function registerNode(request: Request, response: Response) {
  const requestBody = request.body;
  const { type } = request.query;
  if (type === 'add') {
    // A node's report of its phones (AddDevicesOptions.nodeReport): what the
    // node observes of them, and whether they are busy there (`nodeBusy`).
    // It never frees a phone this hub has claimed for a session, nor changes
    // the settings this hub owns for it: team, tags, reservation, block.
    const addedDevices = await addNewDevice(requestBody, undefined, { nodeReport: true });
    if (addedDevices.length > 0) {
      log.info(`Added new devices: ${JSON.stringify(addedDevices)}`);
    }
  } else if (type === 'remove') {
    // One phone each, by udid: an entry without one names no phone.
    const removals = (Array.isArray(requestBody) ? requestBody : [])
      .filter((entry: any) => typeof entry?.udid === 'string' && entry.udid !== '')
      .map((entry: any) => nodeRemoval(entry.host, entry.nodeId, entry.udid));
    await removeNodeDevices(removals, isThisServersOwn());
  } else if (type === 'unregister') {
    const { host, nodeId } = request.query;
    await removeNodeDevices([nodeRemoval(host, nodeId)], isThisServersOwn());
  }
  response.status(200).send({
    success: true,
  });
}

async function blockDevice(request: Request, response: Response) {
  const requestBody = request.body;
  const device = await getDevice(requestBody);
  if (_.isNil(device)) {
    return response.status(404).json({ success: false, error: 'Device not found' });
  }
  try {
    await userBlockDevice(device.udid, device.host);
  } catch (err: any) {
    log.error(`Failed to block device ${device.udid}@${device.host}: ${err?.message || err}`);
    return response
      .status(500)
      .json({ success: false, error: err?.message || 'Failed to block device' });
  }
  response.status(200).send({ success: true });
}

async function unBlockDevice(request: Request, response: Response) {
  const requestBody = request.body;
  const device = await getDevice(requestBody);
  if (_.isNil(device)) {
    return response.status(404).json({ success: false, error: 'Device not found' });
  }
  try {
    await userUnblockDevice(device.udid, device.host);
  } catch (err: any) {
    log.error(`Failed to unblock device ${device.udid}@${device.host}: ${err?.message || err}`);
    return response
      .status(500)
      .json({ success: false, error: err?.message || 'Failed to unblock device' });
  }
  response.status(200).send({ success: true });
}

// The session queue is team-scoped: "own teams + a count". A member sees in
// detail the waiting requests partitionPendingForCaller shows her (naming a
// phone she can see, or hers, or her team's); the rest only as a number,
// summary.otherCount. The length is the whole queue for every caller, as the
// summary's total always was. No row leaves with its requester.
type QueueCaller = { userId?: string; teamIds?: string[] };
const queueCaller = (request: unknown) => (request as Request & { auth?: QueueCaller }).auth;

async function getQueuedSessionLength(request: Request<void>, response: Response<number>) {
  const all = await pendingStore.getAllPendingSessions();
  response.json(all.length);
}

async function getQueuedSessionRequests(request: Request<void>, response: Response<unknown[]>) {
  const all = await pendingStore.getAllPendingSessions();
  const { visible } = await partitionPendingForCaller(all, queueCaller(request));
  // A row is the capabilities the client sent. createSession takes the
  // credentials out of xe:options before writing it, but a row queued by an
  // older server can still hold the key and token that signed it. Those are
  // nobody else's to read, a teammate's or an admin's.
  response.json(visible.map((row) => redactSecrets(withoutRequester(row))));
}

async function getNodes(request: Request, response: Response<string[]>) {
  const auth = (request as Request & { auth?: { teamIds?: string[] } }).auth;
  let allDevices = await store.getAllDevices();
  // Devices on hidden teams shouldn't contribute hosts members can't reach.
  if (auth && auth.teamIds !== undefined) {
    const ids = auth.teamIds;
    if (ids.length === 0) {
      allDevices = allDevices.filter((d) => !d.teamId);
    } else {
      allDevices = allDevices.filter((d) => !d.teamId || ids.includes(d.teamId));
    }
  }
  const nodes = allDevices.map((node) => node.host);
  // unique nodes
  const uniqueNodes = _.uniq(nodes);
  response.json(uniqueNodes);
}

async function getQueueStatusById(request: Request<{ capability_id: string }>, response: Response) {
  const notFound = () => response.status(404).json({ error: 'Pending session not found' });
  // A request the caller may not see answers exactly as an unknown id.
  const caller = queueCaller(request);
  if (caller?.teamIds !== undefined) {
    const all = await pendingStore.getAllPendingSessions();
    const target = all.find((s) => s.capability_id === request.params.capability_id);
    if (!target) return notFound();
    const { visible } = await partitionPendingForCaller([target], caller);
    if (visible.length === 0) return notFound();
  }
  const status = await Container.get(QueueService).getQueueStatus(request.params.capability_id);
  if (!status) return notFound();
  response.json(status);
}

async function getQueueSummary(request: Request, response: Response) {
  // Counts only. `total` is the whole queue, like /queue/length; `otherCount`
  // is how many of those the caller doesn't get in detail from /queue.
  const all = await pendingStore.getAllPendingSessions();
  const { otherCount } = await partitionPendingForCaller(all, queueCaller(request));
  const summary = await Container.get(QueueService).getQueueSummary(all);
  response.json({ ...summary, otherCount });
}

async function nodeAdbStatusOnOtherHost(
  currentHost: string,
  request: Request<{ host: string }>,
  response: Response<{ udid: string; host: string; state: string; platform: string }[] | string>,
) {
  const { host } = request.params;
  // when host is this hub, return status from AndroidDeviceManager directly
  // otherwise, forward request to the node
  log.info(`currentHost: ${currentHost}, host: ${host}`);
  if (host === currentHost) {
    const devices = await getDevicesFromDeviceManager();
    response.json(
      devices.map((device) => {
        return {
          udid: device.udid,
          host: device.host,
          state: device.state,
          platform: device.platform,
        };
      }),
    );
  } else {
    // find node url from database of devices
    // The store's own host filter: findDevices hands its filter to Prisma
    // as it is, and Prisma rejected the `$contains` that used to be here.
    const devices = await store.getDevices({ filterByHost: host });
    if (devices.length === 0) {
      response
        .status(404)
        .send(
          `Host ${host} does not have any devices listed in database. I don't know how to forward request to that host`,
        );
      return;
    }
    const device = devices[0];

    // remove wd/hub from url
    const normalizedUrl = device.host.replace(/\/wd\/hub$/, '');
    const url = `${normalizedUrl}/xenon/api/node/status`;
    let result: unknown;
    try {
      result = await InternalHttpClient.get(url);
    } catch (err: any) {
      response.status(502).json({
        error: 'node_unreachable',
        message: `Could not get ${normalizedUrl}'s status: ${err?.message ?? err}`,
      } as any);
      return;
    }
    response.json(result as any);
  }
}

async function nodeAdbStatusOnThisHost(
  request: Request,
  response: Response<{ udid: string; host: string; state: string; platform: string }[]>,
) {
  const devices = await getDevicesFromDeviceManager();
  // return udid, host, state
  response.json(
    devices.map((device) => {
      return {
        udid: device.udid,
        host: device.host,
        state: device.state,
        platform: device.platform,
      };
    }),
  );
}

/**
 * Returns all devices from all device managers (this host only)
 * @returns IDevice[]
 */
async function getDevicesFromDeviceManager() {
  const dfm = Container.get(XenonManager);
  const instances = await dfm.deviceInstances();

  // return devices from all device managers
  const devices = [];
  for (const instance of instances) {
    const instanceDevices = await instance.getDevices(
      {
        androidDeviceType: 'both',
        iosDeviceType: 'both',
      },
      [],
    );
    devices.push(...instanceDevices);
  }

  return devices;
}

async function updateTags(request: Request, response: Response) {
  const { udid, host, tags } = request.body;
  if (!udid || !host || !Array.isArray(tags)) {
    return response.status(400).json({ error: 'Missing udid, host, or tags array' });
  }
  await updateDeviceTags(udid, host, tags);
  response.status(200).json({ success: true });
}

async function assignDeviceToTeam(request: Request, response: Response) {
  const { udid } = request.params;
  const { teamId } = request.body as { teamId: string | null };
  if (teamId) {
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) return response.status(404).json({ error: 'team not found' });
  }
  const result = await prisma.device.updateMany({
    where: { udid },
    data: { teamId: teamId || null },
  });
  if (result.count === 0) return response.status(404).json({ error: 'device not found' });
  // Refresh in-memory store so subsequent allocation sees the change immediately.
  const rows = await prisma.device.findMany({ where: { udid } });
  for (const row of rows) {
    await store.updateDevice(row.udid, row.host, { teamId: row.teamId } as Partial<IDevice>);
  }
  // The live dashboard events follow the new team now, not after the cache's TTL.
  Container.get(DeviceTeamResolver).note(udid, teamId || null);
  response.json({ ok: true, updated: result.count });
}

/**
 * Returns active session statistics
 */
async function getActiveSessions(request: Request, response: Response) {
  const { SessionManager } = await import('../../sessions/SessionManager');
  const sessionManager = Container.get(SessionManager);
  const stats = sessionManager.getStats();
  const sessions = sessionManager.getAllSessions().map((s) => ({
    id: s.getId(),
    type: s.getType(),
    deviceUdid: s.getDevice()?.udid,
    deviceName: s.getDevice()?.name,
    platform: s.getDevice()?.platform,
  }));

  // Phase 4A: filter by visibility of the underlying device.
  const auth = (request as Request & { auth?: { teamIds?: string[] } }).auth;
  const visibleSessions = await filterRowsByVisibleDevice(
    sessions,
    auth?.teamIds,
    'deviceUdid' as any,
  );

  response.json({
    stats,
    sessions: visibleSessions,
  });
}

/**
 * Returns HTTP request logs for debugging
 */
async function getRequestLogs(request: Request, response: Response) {
  const { RequestLogService } = await import('../../services/RequestLogService');
  const logService = Container.get(RequestLogService);

  const limit = parseInt(request.query.limit as string) || 50;
  const method = request.query.method as string;
  const urlPattern = request.query.url as string;
  const hasError =
    request.query.hasError === 'true'
      ? true
      : request.query.hasError === 'false'
        ? false
        : undefined;

  const logs = logService.getRecentLogs(limit, {
    method,
    urlPattern,
    hasError,
  });

  const stats = logService.getStats();

  response.json({
    stats,
    logs,
  });
}

function register(router: Router, pluginArgs: IPluginArgs) {
  // MEMBER-tier baseline: device reads (devices, queue, sessions, nodes)
  // require Member role. Mounted on the passed-in router so existing route
  // paths (/devices, /queue, /node, ...) keep their unchanged URLs.
  router.use(roleGuard('MEMBER'));

  // GET reads — covered by MEMBER floor above
  router.get('/devices', getDevices);
  router.get('/device', getDevices);
  router.get('/device/:platform', getDeviceByPlatform);

  // ADMIN-tier mutations: register, block/unblock, tags, team-assignment.
  // Node registration + device manipulation all require devices scope.
  // Per-node pair-auth tokens (provisioned with role=ADMIN, scope=devices)
  // pass the role+scope guards; admin-scope tokens also pass via the
  // admin-satisfies-everything rule.
  router.post('/register', roleGuard('ADMIN'), scopeGuard(['devices']), registerNode);
  router.post('/block', roleGuard('ADMIN'), scopeGuard(['devices']), blockDevice);
  router.post('/unblock', roleGuard('ADMIN'), scopeGuard(['devices']), unBlockDevice);
  router.post('/device/tags', roleGuard('ADMIN'), scopeGuard(['devices']), updateTags);
  router.put('/device/:udid/team', roleGuard('ADMIN'), scopeGuard(['admin']), assignDeviceToTeam);

  // session related
  router.get('/queue/length', getQueuedSessionLength);
  router.get('/queue', getQueuedSessionRequests);
  router.get('/queue/status/:capability_id', getQueueStatusById);
  router.get('/queue/summary', getQueueSummary);
  router.get('/sessions/active', getActiveSessions);

  // debugging / observability. Admin-only, like /processes: the log holds
  // every internal HTTP call, including control proxied to other nodes'
  // phones (with what was typed) and forwarded new sessions (their ids).
  router.get('/logs/requests', roleGuard('ADMIN'), scopeGuard(['admin']), getRequestLogs);

  // node related routes. The status reads list every attached phone, so
  // they are admin-only too.
  router.get('/node', getNodes);
  router.get('/node/status', roleGuard('ADMIN'), scopeGuard(['admin']), nodeAdbStatusOnThisHost);
  router.get(
    '/node/:host/status',
    roleGuard('ADMIN'),
    scopeGuard(['admin']),
    _.curry(nodeAdbStatusOnOtherHost)(pluginArgs.bindHostOrIp),
  );

  // node status
  router.get(
    '/status',
    (request: Request<void>, response: Response<{ status: string; version: string }>) => {
      response.json({
        status: 'ok',
        version: process.env.npm_package_version || 'unknown (not running from npm package)',
      });
    },
  );
}

export default {
  register,
};
