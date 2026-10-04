import { Response, Request, Router } from 'express';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { QueueService } from '../../data-service/queue-service';

import { InternalHttpClient } from '../../InternalHttpClient';
import _ from 'lodash';
import {
  addNewDevice,
  userBlockDevice,
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
  /* dashboard-plugin-url is where this server reaches the appium-dashboard-plugin,
   * and dashboard-plugin-link the base of the link people open; both from
   * configuration, never from the request (app/dashboardPluginLink.ts).
   */
  const dashboardPluginUrl = (request as any)['dashboard-plugin-url'];
  const dashboardPluginLink = (request as any)['dashboard-plugin-link'];
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
      d.dashboard_link = `${dashboardPluginLink}?device_udid=${d.udid}&start_time=${SERVER_UP_TIME}`;
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

/**
 * The phone a block or unblock names: exactly one row, by udid and host.
 * Through 2.12 the body went to getDevice as a filter, so an empty body
 * blocked the first phone in the store, and a udid alone the first row of it,
 * whatever server it was on. Answers the refusal itself and returns
 * undefined, or the row.
 */
async function deviceToBlock(request: Request, response: Response) {
  const { udid, host } = request.body ?? {};
  if (typeof udid !== 'string' || udid === '' || typeof host !== 'string' || host === '') {
    response
      .status(400)
      .json({ success: false, error: 'bad_request', message: 'udid and host are required' });
    return undefined;
  }
  const device = await DeviceStoreFactory.getStore().findDevice({ udid, host });
  if (!device) {
    response.status(404).json({ success: false, error: 'Device not found' });
    return undefined;
  }
  return device;
}

async function blockDevice(request: Request, response: Response) {
  const device = await deviceToBlock(request, response);
  if (!device) return;
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
  const device = await deviceToBlock(request, response);
  if (!device) return;
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
  // The tags are saved for the phone (deviceSettings.ts): only for one that
  // is here. Through 2.13 any udid and host answered 200 and wrote nothing.
  if (!(await DeviceStoreFactory.getStore().findDevice({ udid, host }))) {
    return response.status(404).json({ error: 'Device not found' });
  }
  await updateDeviceTags(udid, host, tags);
  response.status(200).json({ success: true });
}

/**
 * Every phone of this udid that this server knows: those connected now, and
 * those whose settings are saved while they are away (deviceSettings.ts), so
 * a phone that is not connected can still be moved, and its team deleted.
 */
async function phonesOfUdid(udid: string): Promise<Array<{ udid: string; host: string }>> {
  const store = DeviceStoreFactory.getStore();
  const phones = new Map<string, { udid: string; host: string }>();
  for (const phone of [
    ...(await store.findDevices({ udid })),
    ...(await store.findSavedPhones(udid)),
  ]) {
    phones.set(`${phone.udid}\u0000${phone.host}`, { udid: phone.udid, host: phone.host });
  }
  return [...phones.values()];
}

async function assignDeviceToTeam(request: Request, response: Response) {
  const { udid } = request.params;
  const { teamId } = request.body as { teamId: string | null };
  if (teamId) {
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) return response.status(404).json({ error: 'team not found' });
  }
  const phones = await phonesOfUdid(udid);
  if (phones.length === 0) return response.status(404).json({ error: 'device not found' });
  // Through the store, which saves the team for the phone as it writes the
  // row: a phone keeps it when it disconnects and comes back.
  for (const phone of phones) {
    await DeviceStoreFactory.getStore().updateDevice(phone.udid, phone.host, {
      teamId: teamId || null,
    } as Partial<IDevice>);
  }
  // The live dashboard events follow the new team now, not after the cache's TTL.
  Container.get(DeviceTeamResolver).note(udid, teamId || null);
  response.json({ ok: true, updated: phones.length });
}

/**
 * Returns active session statistics
 */
async function getActiveSessions(request: Request, response: Response) {
  const { SessionManager } = await import('../../sessions/SessionManager');
  const sessionManager = Container.get(SessionManager);
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

  // The counts are of the sessions listed, so a member's describe only what
  // they may see. Through 2.12 they counted every team's sessions.
  const byType: Record<string, number> = { local: 0, remote: 0, cloud: 0 };
  for (const session of visibleSessions) {
    const type = String(session.type).toLowerCase();
    byType[type] = (byType[type] || 0) + 1;
  }

  response.json({
    stats: { total: visibleSessions.length, byType },
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
