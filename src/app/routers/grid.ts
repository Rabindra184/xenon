import { Response, Request, Router } from 'express';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { QueueService } from '../../data-service/queue-service';

import { InternalHttpClient } from '../../InternalHttpClient';
import _ from 'lodash';
import {
  addNewDevice,
  userBlockDevice,
  getDevice,
  removeDevice,
  removeDevicesByHost,
  userUnblockDevice,
} from '../../data-service/device-service';
import log from '../../logger';
import { XenonManager } from '../../device-managers';
import Container from 'typedi';
import { IPluginArgs } from '../../interfaces/IPluginArgs';
import { IDevice } from '../../interfaces/IDevice';

const store = DeviceStoreFactory.getStore();
const pendingStore = DeviceStoreFactory.getPendingSessionStore();

const SERVER_UP_TIME = new Date().toISOString();

async function getDevices(request: Request, response: Response) {
  let devices = await store.getAllDevices();
  const { sessionId } = request.query;
  if (sessionId) {
    return response.json(devices.find((value) => value.session_id === sessionId));
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
  return response.json(devices);
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

  return response.status(200).send(devices);
}

async function registerNode(request: Request, response: Response) {
  const requestBody = request.body;
  const { type } = request.query;
  if (type === 'add') {
    const addedDevices = await addNewDevice(requestBody);
    if (addedDevices.length > 0) {
      log.info(`Added new devices: ${JSON.stringify(addedDevices)}`);
    }
  } else if (type === 'remove') {
    await removeDevice(requestBody);
  } else if (type === 'unregister') {
    const { host } = request.query;
    if (host) {
      await removeDevicesByHost(host as string);
    }
  }
  response.status(200).send({
    success: true,
  });
}

async function blockDevice(request: Request, response: Response) {
  const requestBody = request.body;
  const device = await getDevice(requestBody);
  if (!_.isNil(device)) {
    await userBlockDevice(device.udid, device.host);
  }
  response.status(200).send({
    success: true,
  });
}

async function unBlockDevice(request: Request, response: Response) {
  const requestBody = request.body;
  const device = await getDevice(requestBody);
  if (!_.isNil(device)) {
    await userUnblockDevice(device.udid, device.host);
  }
  response.status(200).send({
    success: true,
  });
}

async function getQueuedSessionLength(request: Request<void>, response: Response<number>) {
  response.json((await pendingStore.getAllPendingSessions()).length);
}

async function getQueuedSessionRequests(request: Request<void>, response: Response<unknown[]>) {
  response.json(await pendingStore.getAllPendingSessions());
}

async function getNodes(request: Request, response: Response<string[]>) {
  const allDevices = await store.getAllDevices();
  const nodes = allDevices.map((node) => node.host);
  // unique nodes
  const uniqueNodes = _.uniq(nodes);
  response.json(uniqueNodes);
}

async function getQueueStatusById(request: Request<{ capability_id: string }>, response: Response) {
  const status = await QueueService.getQueueStatus(request.params.capability_id);
  if (!status) {
    return response.status(404).json({ error: 'Pending session not found' });
  }
  response.json(status);
}

async function getQueueSummary(request: Request, response: Response) {
  const summary = await QueueService.getQueueSummary();
  response.json(summary);
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
    const devices = await store.findDevices({ host: { $contains: host } as any });
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
    const result = await InternalHttpClient.get(url);
    response.json(result);
  }
}

async function nodeAdbStatusOnThisHost(
  request: Request<void>,
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

function register(router: Router, pluginArgs: IPluginArgs) {
  router.get('/device', getDevices);
  router.get('/device/:platform', getDeviceByPlatform);
  router.post('/register', registerNode);
  router.post('/block', blockDevice);
  router.post('/unblock', unBlockDevice);

  // session related
  router.get('/queue/length', getQueuedSessionLength);
  router.get('/queue', getQueuedSessionRequests);
  router.get('/queue/status/:capability_id', getQueueStatusById);
  router.get('/queue/summary', getQueueSummary);

  // node related routes
  router.get('/node', getNodes);
  router.get('/node/status', nodeAdbStatusOnThisHost);
  router.get('/node/:host/status', _.curry(nodeAdbStatusOnOtherHost)(pluginArgs.bindHostOrIp));

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
