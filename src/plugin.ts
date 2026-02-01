/* eslint-disable no-prototype-builtins */
import 'reflect-metadata';
import commands from './commands/index';
import BasePlugin from '@appium/base-plugin';
import { createRouter } from './app';
import { IDevice } from './interfaces/IDevice';
import {
  CreateSessionResponseInternal,
  ISessionCapability,
  W3CNewSessionResponse,
  W3CNewSessionResponseError,
} from './interfaces/ISessionCapability';
import AsyncLock from 'async-lock';
import {
  setSimulatorState,
  unblockDevice,
  unblockDeviceMatchingFilter,
  updatedAllocatedDevice,
} from './data-service/device-service';
import {
  addNewPendingSession,
  removePendingSession,
} from './data-service/pending-sessions-service';
import {
  allocateDeviceForSession,
  setupCronReleaseBlockedDevices,
  setupCronUpdateDeviceList,
  deviceType,
  initializeStorage,
  isIOS,
  refreshSimulatorState,
  setupCronCheckStaleDevices,
  updateDeviceList,
  setupCronCleanPendingSessions,
  setupCronCleanExpiredReservations,
  removeStaleDevices,
} from './device-utils';
import { XenonManager } from './device-managers';
import IOSDeviceManager from './device-managers/IOSDeviceManager';
import { Container } from 'typedi';
import log from './logger';
import { v4 as uuidv4 } from 'uuid';
import axios, { AxiosError } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import http from 'http';
import https from 'https';
import {
  nodeUrl,
  spinWith,
  stripAppiumPrefixes,
  isXenonRunning,
  hasCloudArgument,
} from './helpers';
import { addProxyHandler, registerProxyMiddlware } from './proxy/wd-command-proxy';
import ChromeDriverManager from './device-managers/ChromeDriverManager';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { addCLIArgs } from './data-service/pluginArgs';
import Cloud from './enums/Cloud';
import { ADB } from 'appium-adb';
import { DefaultPluginArgs, IPluginArgs } from './interfaces/IPluginArgs';
import NodeDevices from './device-managers/NodeDevices';
import { IDeviceFilterOptions } from './interfaces/IDeviceFilterOptions';
import { PluginConfig, ServerArgs } from '@appium/types';
import { SESSION_MANAGER } from './sessions/SessionManager';
import { LocalSession } from './sessions/LocalSession';
import { CloudSession } from './sessions/CloudSession';
import { RemoteSession } from './sessions/RemoteSession';
import { DASHBORD_EVENT_MANAGER } from './dashboard/event-manager';
import { saveVideoRecording } from './dashboard/asset-manager';
import { updateSessionDetails } from './dashboard/services/session-service';
import { getXenonCapabilities, XENON_CAPABILITIES } from './XenonCapabilityManager';
import ip from 'ip';
import _ from 'lodash';
import SessionType from './enums/SessionType';
import { XenonSession, XenonSessionOptions } from './sessions/XenonSession';
import { DeviceStoreFactory } from './data-service/device-store';
import { SessionStatus } from './types/SessionStatus';

const commandsQueueGuard = new AsyncLock();
const DEVICE_MANAGER_LOCK_NAME = 'DeviceManager';
let platform: any;
let androidDeviceType: any;
let iosDeviceType: any;
let hasEmulators: any;
let proxy: any;

class XenonPlugin extends BasePlugin {
  static nodeBasePath = '';
  static port: number;
  private xenonLog = log.scope('Plugin');
  private pluginArgs: IPluginArgs = Object.assign({}, DefaultPluginArgs);
  public static NODE_ID: string;
  public static IS_HUB = false;

  constructor(pluginName: string, cliArgs: any) {
    super(pluginName, cliArgs);
    // here, CLI Args are already pluginArgs. Different case for updateServer
    this.xenonLog.debug(`📱 Plugin Args: ${JSON.stringify(cliArgs)}`);
    // plugin args will assign undefined value as well for bindHostOrIp
    this.pluginArgs = Object.assign({}, DefaultPluginArgs, this.cliArgs as unknown as IPluginArgs);
    // not pretty but will do for now
    if (this.pluginArgs.bindHostOrIp === undefined) {
      this.pluginArgs.bindHostOrIp = ip.address();
    }
  }

  private getLockName(caps: ISessionCapability): string {
    const requiredCaps = caps.alwaysMatch || {};
    const firstMatchCaps = caps.firstMatch?.[0] || {};
    const platformName = (
      requiredCaps['platformName'] ||
      firstMatchCaps['platformName'] ||
      'any'
    ).toString();
    const udid = (requiredCaps['appium:udid'] || firstMatchCaps['appium:udid'] || 'any').toString();
    return `${DEVICE_MANAGER_LOCK_NAME}-${platformName}-${udid}`.toLowerCase();
  }

  /**
   * Intercepts all commands for local sessions to capture logs
   * Similar to appium-dashboard-plugin's handle method
   */
  async handle(next: () => any, driver: any, commandName: string, ...args: any) {
    const IGNORED_COMMANDS = ['getScreenshot', 'stopRecordingScreen', 'startRecordingScreen'];

    if (IGNORED_COMMANDS.includes(commandName)) {
      return await next();
    }

    // Skip createSession and deleteSession as they have their own handlers
    if (commandName === 'createSession' || commandName === 'deleteSession') {
      return await next();
    }

    // For local sessions on hub with dashboard enabled, capture command logs
    const sessionId = args[args.length - 1];
    const isDashboardEnabled = !!this.pluginArgs.enableDashboard;

    // Intercept execute command for dashboard commands
    if (XenonPlugin.IS_HUB && isDashboardEnabled && commandName === 'execute') {
      const script = args[0];
      if (
        script &&
        typeof script === 'string' &&
        (script.startsWith('xenon') || script.startsWith('devicefarm'))
      ) {
        log.info(`[XenonPlugin] Dashboard command detected: ${script}`);
        // Execute the dashboard command directly
        const commandName = script.split(':')[1]?.trim();
        if (commandName) {
          const commandArgs = args[1];
          await this.executeDashboardCommand(sessionId, commandName, commandArgs);
          return null; // Dashboard commands don't return a value
        }
      }
    }

    if (XenonPlugin.IS_HUB && isDashboardEnabled && SESSION_MANAGER.isValidSession(sessionId)) {
      try {
        const response = await next();

        // Log the successful command
        await DASHBORD_EVENT_MANAGER.afterSessionCommand(
          sessionId,
          commandName,
          driver,
          {
            body: args,
            method: 'POST',
            path: `/${commandName}`,
            originalUrl: `/${commandName}`,
          } as any,
          {} as any,
          JSON.stringify({ value: response, sessionId }),
        );

        return response;
      } catch (error: any) {
        // Log the failed command
        await DASHBORD_EVENT_MANAGER.afterSessionCommand(
          sessionId,
          commandName,
          driver,
          {
            body: args,
            method: 'POST',
            path: `/${commandName}`,
            originalUrl: `/${commandName}`,
          } as any,
          {} as any,
          JSON.stringify({ value: { error: error.message || error }, sessionId }),
        );

        throw error;
      }
    }

    return await next();
  }

  async onUnexpectedShutdown(driver: any, _cause: any) {
    const sessionId = driver.sessionId;
    const deviceFilter = {
      session_id: sessionId ? sessionId : undefined,
      udid: driver.caps && driver.caps.udid ? driver.caps.udid : undefined,
    } as unknown as IDeviceFilterOptions;

    if (this.pluginArgs.hub !== undefined) {
      // send unblock request to hub. Should we unblock the whole devices from this node?
      await new NodeDevices(this.pluginArgs.hub).unblockDevice(deviceFilter);
    } else {
      await unblockDeviceMatchingFilter(deviceFilter);
    }

    log.info(
      `Unblocking device mapped with filter ${JSON.stringify(
        deviceFilter,
      )} onUnexpectedShutdown from server`,
    );

    if (XenonPlugin.IS_HUB && this.pluginArgs.enableDashboard && sessionId) {
      const sessionLog = this.xenonLog.withSession(sessionId, driver.caps?.udid);
      sessionLog.info(`Unexpected shutdown for session, updating dashboard...`);

      // Attempt to rescue video recording if in progress
      const session = SESSION_MANAGER.getSession(sessionId);
      if (session && session.isVideoRecordingInProgress()) {
        log.info(
          `[${sessionId}][xenon] rescue-video: Attempting to save video for crashed session (UDID: ${
            driver.caps?.udid || 'unknown'
          })...`,
        );
        try {
          const videoBase64 = await session.stopVideoRecording(driver);
          if (videoBase64) {
            const videoPath = saveVideoRecording(sessionId, videoBase64);
            await updateSessionDetails(sessionId, { video_recording: videoPath });
            log.info(`[${sessionId}][xenon] rescue-video: ✅ Video saved for crashed session`);
          }
        } catch (err: any) {
          log.debug(
            `[${sessionId}][xenon] rescue-video: ❌ Failed to rescue video: ${err.message}`,
          );
        }
      }

      await DASHBORD_EVENT_MANAGER.onSessionStoped(
        sessionId,
        SessionStatus.FAILED,
        'Driver shut down unexpectedly',
      );
    }
  }

  public static async updateServer(
    expressApp: any,
    httpServer: any,
    cliArgs: ServerArgs,
  ): Promise<void> {
    // cliArgs are here is not pluginArgs yet as it contains the whole CLI argument for Appium! Different case for our plugin constructor
    log.debug(`📱 Update server with CLI Args: ${JSON.stringify(cliArgs)}`);
    const pluginConfigs = cliArgs.plugin as PluginConfig;
    let pluginArgs: IPluginArgs;
    if (pluginConfigs['xenon'] !== undefined) {
      pluginArgs = Object.assign(
        {},
        DefaultPluginArgs,
        pluginConfigs['xenon'] as unknown as IPluginArgs,
      );
    } else {
      pluginArgs = Object.assign({}, DefaultPluginArgs);
    }
    XenonPlugin.NODE_ID = uuidv4();
    const { version } = await import('../package.json');
    log.banner(version, XenonPlugin.NODE_ID);
    log.debug('Cli Args: ' + JSON.stringify(cliArgs));

    // I'm transferring the CLI Args to pluginArgs here.
    XenonPlugin.nodeBasePath = cliArgs.basePath;
    XenonPlugin.port = cliArgs.port;

    if (pluginArgs.bindHostOrIp === undefined) {
      pluginArgs.bindHostOrIp = ip.address();
    }

    log.debug(`📱 Update server with Plugin Args: ${JSON.stringify(pluginArgs)}`);
    await initializeStorage();
    await DeviceStoreFactory.getStore().clearStorage();
    platform = pluginArgs.platform;
    androidDeviceType = pluginArgs.androidDeviceType;
    iosDeviceType = pluginArgs.iosDeviceType;
    if (pluginArgs.proxy !== undefined) {
      log.info(`Adding proxy for axios: ${JSON.stringify(pluginArgs.proxy)}`);
      proxy = pluginArgs.proxy;
    } else {
      log.info('proxy is not required for axios');
    }
    hasEmulators = pluginArgs.emulators && pluginArgs.emulators.length > 0;

    expressApp.use('/xenon', createRouter(pluginArgs));
    registerProxyMiddlware(expressApp, cliArgs);

    if (!platform)
      throw new Error(
        '🔴 🔴 🔴 Specify --plugin-xenon-platform from CLI as android,iOS or both or use appium server config. Please refer 🔗 https://github.com/appium/appium/blob/master/packages/appium/docs/en/guides/config.md 🔴 🔴 🔴',
      );

    if (hasEmulators && pluginArgs.platform.toLowerCase() === 'android') {
      log.info('Emulators will be booted!!');
      const adb = await ADB.createADB({});
      const array = pluginArgs.emulators || [];
      const promiseArray = array.map(async (arr: any) => {
        await Promise.all([await adb.launchAVD(arr.avdName, arr)]);
      });
      await Promise.all(promiseArray);
    }

    const chromeDriverManager =
      pluginArgs.skipChromeDownload === false ? await ChromeDriverManager.getInstance() : undefined;
    iosDeviceType = XenonPlugin.setIncludeSimulatorState(pluginArgs, iosDeviceType);
    const deviceTypes = { androidDeviceType, iosDeviceType };
    const deviceManager = new XenonManager(
      platform,
      deviceTypes,
      cliArgs.port,
      pluginArgs,
      XenonPlugin.NODE_ID,
    );
    Container.set(XenonManager, deviceManager);
    if (chromeDriverManager) Container.set(ChromeDriverManager, chromeDriverManager);

    await addCLIArgs(cliArgs);

    log.info(
      `🚀 Xenon will be served at http://${pluginArgs.bindHostOrIp}:${cliArgs.port}/xenon with id ${XenonPlugin.NODE_ID}`,
    );

    const hubArgument = pluginArgs.hub;

    if (hubArgument !== undefined) {
      log.info(`📡 I'm a node and my hub is ${hubArgument}`);
      // hub may have been restarted, so let's send device list regularly
      await setupCronUpdateDeviceList(
        pluginArgs.bindHostOrIp,
        hubArgument,
        pluginArgs.sendNodeDevicesToHubIntervalMs,
      );

      // Handle graceful shutdown
      ['SIGINT', 'SIGTERM'].forEach((signal) => {
        process.once(signal, async () => {
          log.info(`Received ${signal}, unregistering node from hub...`);
          try {
            await new NodeDevices(hubArgument).unRegisterNode(pluginArgs.bindHostOrIp);
          } catch (err) {
            log.error(`Error during node unregistration: ${err}`);
          }
          process.kill(process.pid, signal);
        });
      });
    } else {
      XenonPlugin.IS_HUB = true;
      log.info(`🌐 I'm a hub and I'm listening on ${pluginArgs.bindHostOrIp}:${cliArgs.port}`);
    }
    if (pluginArgs.cloud == undefined) {
      // check for stale nodes
      await setupCronCheckStaleDevices(
        pluginArgs.checkStaleDevicesIntervalMs,
        pluginArgs.bindHostOrIp,
      );
      // and release blocked devices
      await setupCronReleaseBlockedDevices(
        pluginArgs.checkBlockedDevicesIntervalMs,
        pluginArgs.newCommandTimeoutSec,
      );
      // and clean up pending sessions
      await setupCronCleanPendingSessions(
        pluginArgs.checkBlockedDevicesIntervalMs,
        pluginArgs.deviceAvailabilityTimeoutMs + 10000,
      );
      // clean up expired reservations every 1 minute
      await setupCronCleanExpiredReservations(60000);
      // unblock all devices on node/hub restart
      await unblockDeviceMatchingFilter({});

      // Start Health Monitor Service
      const { HealthMonitorService } = await import('./device-managers/HealthMonitorService');
      HealthMonitorService.getInstance().start();

      // Principal Cleaning: Mark all pre-existing "running" sessions as Interrupted

      const { cleanupZombieSessions } = await import('./dashboard/services/session-service');
      await cleanupZombieSessions();

      // remove stale devices
      await removeStaleDevices(pluginArgs.bindHostOrIp);
    } else {
      log.info('📣📣📣 Cloud runner sessions dont require constant device checks');
    }

    const devicesUpdates = await updateDeviceList(pluginArgs.bindHostOrIp, hubArgument);
    if (isIOS(pluginArgs) && deviceType(pluginArgs, 'simulated')) {
      await setSimulatorState(devicesUpdates);
      await refreshSimulatorState(pluginArgs, cliArgs.port);
    }
  }

  private static setIncludeSimulatorState(pluginArgs: IPluginArgs, deviceTypes: string) {
    if (hasCloudArgument(pluginArgs)) {
      deviceTypes = 'real';
      log.info('ℹ️ Skipping Simulators as per the configuration ℹ️');
    }
    return deviceTypes;
  }

  static async waitForRemoteXenonToBeRunning(host: string) {
    await spinWith(
      `Waiting for Xenon server ${host} to be up and running\n`,
      async () => {
        return await isXenonRunning(host);
      },
      (msg: any) => {
        throw new Error(`Failed: ${msg}`);
      },
    );
  }

  async createSession(
    next: () => any,
    driver: any,
    jwpDesCaps: any,
    jwpReqCaps: any,
    caps: ISessionCapability,
  ) {
    log.debug(`📱 pluginArgs: ${JSON.stringify(this.pluginArgs)}`);
    log.debug(`Receiving session request at host: ${this.pluginArgs.bindHostOrIp}`);
    const pendingSessionId = uuidv4();
    log.debug(`📱 Creating temporary session capability_id: ${pendingSessionId}`);
    const {
      alwaysMatch: requiredCaps = {}, // If 'requiredCaps' is undefined, set it to an empty JSON object (#2.1)
      firstMatch: allFirstMatchCaps = [{}], // If 'firstMatch' is undefined set it to a singleton list with one empty object (#3.1)
    } = caps;
    stripAppiumPrefixes(requiredCaps);
    stripAppiumPrefixes(allFirstMatchCaps);

    // Resolve app ID if provided from the App Repository
    const app = requiredCaps['app'] || allFirstMatchCaps[0]['app'];
    if (app && typeof app === 'string' && !app.includes('/') && !app.includes('\\')) {
      const { APP_SERVICE } = await import('./dashboard/services/app-service');
      const appDetails = await APP_SERVICE.getAppById(app);
      if (appDetails) {
        const appUrl = `http://${this.pluginArgs.bindHostOrIp}:${XenonPlugin.port}/xenon/api/apps/${appDetails.id}/download`;
        log.info(`📱 Resolved app ID ${app} to ${appUrl}`);
        if (requiredCaps['app']) requiredCaps['app'] = appUrl;
        if (allFirstMatchCaps[0]['app']) allFirstMatchCaps[0]['app'] = appUrl;

        // Also update the original caps alwaysMatch/firstMatch to ensure consistency
        if (caps.alwaysMatch && caps.alwaysMatch['app']) caps.alwaysMatch['app'] = appUrl;
        if (caps.alwaysMatch && caps.alwaysMatch['appium:app'])
          caps.alwaysMatch['appium:app'] = appUrl;
        if (caps.firstMatch && caps.firstMatch[0]) {
          if (caps.firstMatch[0]['app']) caps.firstMatch[0]['app'] = appUrl;
          if (caps.firstMatch[0]['appium:app']) caps.firstMatch[0]['appium:app'] = appUrl;
        }
      }
    }

    await addNewPendingSession({
      ...Object.assign({}, caps.firstMatch[0], caps.alwaysMatch),
      capability_id: pendingSessionId,
      // mark the insertion date
      createdAt: new Date().getTime(),
    });

    /**
     *  Wait untill a free device is available for the given capabilities
     */
    const lockName = this.getLockName(caps);
    log.debug(`📱 Acquiring lock: ${lockName}`);
    const device = await commandsQueueGuard.acquire(lockName, async (): Promise<IDevice> => {
      //await refreshDeviceList();
      try {
        return await allocateDeviceForSession(
          caps,
          this.pluginArgs.deviceAvailabilityTimeoutMs,
          this.pluginArgs.deviceAvailabilityQueryIntervalMs,
          this.pluginArgs,
        );
      } catch (err) {
        await removePendingSession(pendingSessionId);
        throw err;
      }
    });

    let session: CreateSessionResponseInternal | W3CNewSessionResponseError | Error;
    const isRemoteOrCloudSession = !device.nodeId || device.nodeId !== XenonPlugin.NODE_ID;

    log.debug(
      `device.host: ${device.host} and pluginArgs.bindHostOrIp: ${this.pluginArgs.bindHostOrIp}`,
    );
    // if device is not on the same node, forward the session request. Unless hub is not defined then create session on the same node
    if (isRemoteOrCloudSession) {
      log.debug(`📱 Forwarding session request to ${device.host}`);
      session = await this.forwardSessionRequest(device, caps);
    } else {
      log.debug('📱 Creating session on the same node');

      // Technical Optimization: If real iOS device and WDA IPA exists in repository (e.g. wda-resign.ipa), use it as priority
      if (device.platform === 'ios' && device.realDevice) {
        const { APP_SERVICE } = await import('./dashboard/services/app-service');
        const wdaApp = await APP_SERVICE.getWDAApp();
        if (wdaApp && (await import('fs-extra')).existsSync(wdaApp.filepath)) {
          log.info(
            `📱 Artisan WDA: Found pre-signed artifact "${wdaApp.name}" at ${wdaApp.filepath}. Provisioning ${device.udid}...`,
          );
          try {
            const deviceManager = Container.get(XenonManager);
            const manager = (await deviceManager.deviceInstances()).find(
              (m) => m instanceof IOSDeviceManager,
            ) as IOSDeviceManager;
            if (manager) {
              await manager.installApp(device.udid, wdaApp.filepath);
              log.info(`📱 Artisan WDA: Artifact provisioned successfully to ${device.udid}`);
              // Reinforce capability to bypass Appium's WDA building logic
              if (caps.alwaysMatch) caps.alwaysMatch['appium:usePrebuiltWDA'] = true;
              if (caps.firstMatch && caps.firstMatch[0])
                caps.firstMatch[0]['appium:usePrebuiltWDA'] = true;
            }
          } catch (err: any) {
            log.warn(
              `⚠️ Artisan WDA: Provisioning failed: ${err.message}. Proceeding with standard XCUITest boot.`,
            );
          }
        }
      }

      session = await next();
    }

    // non-forwarded session can also be an error
    log.debug('📱 Session response: ', JSON.stringify(session));

    log.debug(`📱 Removing pending session with capability_id: ${pendingSessionId}`);
    await removePendingSession(pendingSessionId);

    // Do we have valid session response?
    if (this.isCreateSessionResponseInternal(session)) {
      log.debug('📱 Session response is CreateSessionResponseInternal');

      const sessionId = (session as CreateSessionResponseInternal).value[0];
      const sessionResponse = (session as CreateSessionResponseInternal).value[1];

      // Add the original requested capabilities to sessionResponse.desired
      // This matches appium-dashboard-plugin behavior
      const requestedCaps = Object.assign({}, caps.firstMatch?.[0] || {}, caps.alwaysMatch || {});
      (sessionResponse as any).desired = requestedCaps;

      const xenonCapabilities = getXenonCapabilities(caps);

      log.info(`📱 Device UDID ${device.udid} blocked for session ${sessionId}`);
      await updatedAllocatedDevice(device, {
        busy: true,
        session_id: sessionId,
        lastCmdExecutedAt: new Date().getTime(),
        sessionStartTime: new Date().getTime(),
      });
      if (isRemoteOrCloudSession) {
        addProxyHandler(sessionId, device.host);
      }

      let sessionInstance: XenonSession;
      const sessionOptions: XenonSessionOptions = {
        sessionId,
        device,
        sessionResponse,
        xenonOption: xenonCapabilities,
      };
      const nodeWebdriverUrl = nodeUrl(device, XenonPlugin.nodeBasePath);
      if (device.nodeId === XenonPlugin.NODE_ID) {
        sessionInstance = new LocalSession({
          ...sessionOptions,
          driver,
        });
      } else if (device.cloud) {
        sessionInstance = new CloudSession({
          ...sessionOptions,
          baseUrl: nodeWebdriverUrl,
        });
      } else {
        sessionInstance = new RemoteSession({
          ...sessionOptions,
          baseUrl: nodeWebdriverUrl,
        });
      }

      const isDashboardEnabled = !!this.pluginArgs.enableDashboard;
      const shouldSaveLogs = sessionInstance.getType() !== SessionType.CLOUD;
      const isVideoRecordingEnabled = xenonCapabilities[XENON_CAPABILITIES.VIDEO_RECORDING];

      const sessionLog = this.xenonLog.withSession(sessionId, device.udid);

      // Start video recording if enabled, regardless of dashboard status
      if (isVideoRecordingEnabled) {
        const resolution = xenonCapabilities[XENON_CAPABILITIES.VIDEO_RESOLUTION] || undefined;
        try {
          sessionLog.info(`📹 Starting video recording`);
          await sessionInstance.startVideoRecording({ resolution });
          sessionLog.info(`✅ Video recording started`);
        } catch (err) {
          sessionLog.warn(`⚠️ Failed to start video recording:`, err);
        }
      }

      // Add session to SESSION_MANAGER if dashboard is enabled OR video recording is enabled
      const shouldAddToSessionManager =
        (isDashboardEnabled && shouldSaveLogs) || (isVideoRecordingEnabled && shouldSaveLogs);

      if (shouldAddToSessionManager) {
        sessionLog.debug(
          `Adding the session with type ${sessionInstance.getType()} to session map`,
        );
        SESSION_MANAGER.addSession(sessionInstance.getId(), sessionInstance);

        if (XenonPlugin.IS_HUB && isDashboardEnabled) {
          await DASHBORD_EVENT_MANAGER.onSessionStarted(xenonCapabilities, sessionInstance, device);
        }
      } else {
        sessionLog.debug(
          `Not adding the session with type ${sessionInstance.getType()} to session map. DashboardEnabled: ${isDashboardEnabled}, shouldSaveLogs: ${shouldSaveLogs}`,
        );
      }

      sessionLog.info(`📱 Session established on device`);
    } else {
      // assume session is an error
      await unblockDevice(device.udid, device.host);
      this.xenonLog.info(
        `📱 Device UDID ${device.udid} unblocked. Reason: Failed to create session`,
      );

      this.throwProperError(session, device.host);
    }

    return session;
  }

  throwProperError(session: any, host: string) {
    if (session instanceof Error) {
      throw session;
    } else if (session.hasOwnProperty('error')) {
      const errorMessage = (session as W3CNewSessionResponseError).error;
      if (errorMessage) {
        throw new Error(errorMessage);
      } else {
        throw new Error(
          `Unknown error while creating session: ${JSON.stringify(
            session,
          )}. \nBetter look at appium log on the node: ${host}`,
        );
      }
    } else {
      throw new Error(
        `Unknown error while creating session: ${JSON.stringify(
          session,
        )}. \nBetter look at appium log on the node: ${host}`,
      );
    }
  }

  // type guard for CreateSessionResponseInternal
  private isCreateSessionResponseInternal(
    something: any,
  ): something is CreateSessionResponseInternal {
    return (
      something.hasOwnProperty('value') &&
      something.value.length === 3 &&
      something.value[0] &&
      something.value[1] &&
      something.value[2]
    );
  }

  private async forwardSessionRequest(
    device: IDevice,
    caps: ISessionCapability,
  ): Promise<CreateSessionResponseInternal | Error> {
    const remoteUrl = `${nodeUrl(device, XenonPlugin.nodeBasePath)}/session`;
    let capabilitiesToCreateSession = { capabilities: caps };

    if (device.cloud && device.cloud.toLowerCase() === Cloud.LAMBDATEST) {
      capabilitiesToCreateSession = Object.assign(capabilitiesToCreateSession, {
        desiredCapabilities: capabilitiesToCreateSession.capabilities.alwaysMatch,
      });
    }

    log.info(
      `Creating session with desiredCapabilities: "${JSON.stringify(capabilitiesToCreateSession)}"`,
    );

    const config: any = {
      method: 'post',
      url: remoteUrl,
      httpAgent: new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 120000,
      }),
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
        keepAlive: true,
        keepAliveMsecs: 120000,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      data: capabilitiesToCreateSession,
    };

    //log.info(`Add proxy to axios config only if it is set: ${JSON.stringify(proxy)}`);
    if (proxy != undefined) {
      log.info(`Added proxy to axios config: ${JSON.stringify(proxy)}`);
      config.httpsAgent = new HttpsProxyAgent(proxy);
      config.httpAgent = new HttpProxyAgent(proxy);
      config.proxy = false;
    }

    log.info(`With axios config: "${JSON.stringify(config)}"`);
    const createdSession: W3CNewSessionResponse | Error = await this.invokeSessionRequest(config);

    if (createdSession instanceof Error) {
      return createdSession;
    } else {
      return {
        protocol: 'W3C',
        value: [createdSession.value.sessionId, createdSession.value.capabilities, 'W3C'],
      };
    }
  }

  async invokeSessionRequest(config: any): Promise<W3CNewSessionResponse | Error> {
    let sessionDetails: W3CNewSessionResponse | null = null;
    let errorMessage: string | null = null;
    const maxRetries = 2; // Total 3 attempts
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const response = await axios({ ...config, timeout: 60000 }); // 60s timeout for session creation
        log.debug('remote node response', JSON.stringify(response.data));

        // Appium endpoint returns session details w3c format: https://github.com/jlipps/simple-wd-spec?tab=readme-ov-file#new-session
        sessionDetails = response.data as unknown as W3CNewSessionResponse;

        // check if we have error in response by checking sessionDetails.value type
        if ('error' in sessionDetails.value) {
          log.error(`Error while creating session: ${sessionDetails.value.error}`);
          errorMessage = sessionDetails.value.error as string;
          // If it's a known error from the other node, we shouldn't retry
          break;
        } else {
          return sessionDetails;
        }
      } catch (error: AxiosError<any> | any) {
        log.warn(
          `Received error from remote node (Attempt ${attempt + 1}/${maxRetries + 1}): ${
            error.message || error
          }`,
        );
        if (error instanceof AxiosError) {
          errorMessage = JSON.stringify(error.response?.data || error.message);
          const status = error.response?.status;
          if (status && status < 500) {
            // Client error (4xx), don't retry
            break;
          }
        } else {
          errorMessage = error.toString();
        }
      }

      attempt++;
      if (attempt <= maxRetries) {
        const backoff = attempt * 1000;
        log.info(`Retrying session creation in ${backoff}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }

    // Actually errorMessage will be empty when axios is getting peer connection error/disconnected.
    // So, let's invert the situation and return error when sessionDetails is null
    if (_.isNil(sessionDetails)) {
      log.error(`Error while creating session after ${attempt} attempts: ${errorMessage}`);
      if (_.isNil(errorMessage)) {
        errorMessage = 'Unknown error while creating session';
      }
      return new Error(errorMessage);
    } else {
      log.debug(
        `📱 Session received with details: ${JSON.stringify(
          !sessionDetails ? {} : sessionDetails,
        )}`,
      );

      if (this.isW3CNewSessionResponse(sessionDetails)) {
        return sessionDetails as W3CNewSessionResponse;
      } else {
        return new Error(`Unknown error while creating session: ${JSON.stringify(sessionDetails)}`);
      }
    }
  }

  private isW3CNewSessionResponse(something: any): something is W3CNewSessionResponse {
    return (
      something.hasOwnProperty('value') &&
      something.value.hasOwnProperty('sessionId') &&
      something.value.hasOwnProperty('capabilities')
    );
  }

  async deleteSession(next: () => any, driver: any, sessionId: any) {
    await unblockDeviceMatchingFilter({ session_id: sessionId });
    const sessionLog = this.xenonLog.withSession(sessionId);
    sessionLog.info(`📱 Unblocking the device that is blocked for session`);

    // Stop video recording BEFORE session is deleted and save it immediately
    const session = SESSION_MANAGER.getSession(sessionId);

    // Stop iOS profiling BEFORE session is deleted (must happen while driver is still alive)
    if (session) {
      const device = session.getDevice();
      if (device && device.platform?.toLowerCase() === 'ios') {
        sessionLog.info(`Stopping iOS profiling before session deletion`);
        try {
          const traceBase64 = await session.stopPerformanceRecording();
          if (traceBase64) {
            const { savePerformanceTrace } = await import('./dashboard/asset-manager');
            const tracePath = savePerformanceTrace(sessionId, traceBase64);
            await updateSessionDetails(sessionId, { performance_trace: tracePath });
            sessionLog.info(`✅ iOS profiling trace saved at ${tracePath}`);
          }
        } catch (err: any) {
          sessionLog.warn(`⚠️ iOS profiling capture failed: ${err.message}`);
        }
      }
    }

    if (session && session.isVideoRecordingInProgress()) {
      sessionLog.info(`Stopping video recording before session deletion`);
      try {
        const videoBase64 = await session.stopVideoRecording();
        sessionLog.info(
          `Video data received: ${videoBase64 ? `${videoBase64.length} bytes` : 'empty'}`,
        );

        if (videoBase64) {
          try {
            const videoPath = saveVideoRecording(sessionId, videoBase64);
            sessionLog.info(`✅ Video saved at ${videoPath}`);
            await updateSessionDetails(sessionId, { video_recording: videoPath });
            sessionLog.info(`✅ Database updated with video path`);
          } catch (saveErr: any) {
            sessionLog.error(`❌ Failed to save video: ${saveErr.message}`);
          }
        } else {
          sessionLog.warn(`⚠️ Video recording returned empty`);
        }
      } catch (error: any) {
        sessionLog.warn(`Failed to stop video recording: ${error.message}`);
      }
    }

    try {
      const result = await next();
      return result;
    } finally {
      await DASHBORD_EVENT_MANAGER.onSessionStoped(sessionId);

      // Notify on failure
      try {
        const { getSessionById } = await import('./dashboard/services/session-service');
        const sessionData = await getSessionById(sessionId);
        if (sessionData && (sessionData.status === 'failed' || sessionData.failure_reason)) {
          const { default: NotificationService } = await import('./services/NotificationService');
          await NotificationService.dispatchEvent('session_failed', sessionData);
        }
      } catch (err) {
        /* ignore notification errors */
      }
    }
  }

  /**
   * Execute a dashboard command directly
   * Similar to appium-dashboard-plugin's executeCommand method
   */
  private async executeDashboardCommand(
    sessionId: string,
    commandName: string,
    commandArgs: any,
  ): Promise<void> {
    log.info(`[XenonPlugin] Executing dashboard command: ${commandName} for session ${sessionId}`);

    try {
      switch (commandName) {
        case 'setSessionName':
          await this.setSessionName(sessionId, commandArgs);
          break;
        case 'setSessionStatus':
          await this.setSessionStatus(sessionId, commandArgs);
          break;
        case 'debug':
          await this.addDebugLog(sessionId, commandArgs);
          break;
        default:
          log.warn(`[XenonPlugin] Unknown dashboard command: ${commandName}`);
      }
    } catch (error: any) {
      log.error(`[XenonPlugin] Error executing dashboard command ${commandName}: ${error.message}`);
      throw error;
    }
  }

  private async setSessionName(sessionId: string, args: any): Promise<void> {
    const { updateSessionDetails } = await import('./dashboard/services/session-service');
    const name = typeof args === 'object' && args.name ? args.name : args;
    await updateSessionDetails(sessionId, { name });
    log.info(`[XenonPlugin] Updated session name for ${sessionId}: ${name}`);
  }

  private async setSessionStatus(sessionId: string, args: any): Promise<void> {
    const { updateSessionDetails } = await import('./dashboard/services/session-service');
    if (args.status && ['success', 'failed'].indexOf(args.status) >= 0) {
      await updateSessionDetails(sessionId, {
        status: args.status,
        failure_reason: args.reason || undefined,
      });
      log.info(`[XenonPlugin] Updated session status for ${sessionId}: ${args.status}`);
    }
  }

  private async addDebugLog(sessionId: string, args: any): Promise<void> {
    const { prisma } = await import('./prisma');
    const message = typeof args === 'string' ? args : args.message || JSON.stringify(args);

    await prisma.log.create({
      data: {
        session_id: sessionId,
        log_type: 'DEBUG',
        message: message,
      },
    });
    log.info(`[XenonPlugin] Added debug log for session ${sessionId}`);
  }
}

Object.assign(XenonPlugin.prototype, commands);
export { XenonPlugin };
