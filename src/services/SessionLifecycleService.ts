import { Container, Service } from 'typedi';
import { v4 as uuidv4 } from 'uuid';
import _ from 'lodash';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import http from 'http';
import https from 'https';
import log from '../logger';
import { stripAppiumPrefixes, nodeUrl } from '../helpers';
import { InternalHttpClient } from '../InternalHttpClient';
import { PluginContext } from '../PluginContext';
import { CapabilityValidator } from '../validators/CapabilityValidator';
import {
  unblockDevice,
  unblockDeviceMatchingFilter,
  updatedAllocatedDevice,
  updateDeviceProgress,
} from '../data-service/device-service';
import {
  addNewPendingSession,
  removePendingSession,
} from '../data-service/pending-sessions-service';
import { allocateDeviceForSession } from '../device-utils';
import {
  CreateSessionResponseInternal,
  ISessionCapability,
  W3CNewSessionResponse,
  W3CNewSessionResponseError,
} from '../interfaces/ISessionCapability';
import { IDevice } from '../interfaces/IDevice';
import { TracingService } from './TracingService';
import { getXenonCapabilities, XENON_CAPABILITIES } from '../XenonCapabilityManager';
import { CircuitBreaker } from '../data-service/CircuitBreaker';
import { addProxyHandler } from '../proxy/wd-command-proxy';
import { DeviceStoreFactory } from '../data-service/device-store';
import { XenonSession, XenonSessionOptions } from '../sessions/XenonSession';
import { LocalSession } from '../sessions/LocalSession';
import { CloudSession } from '../sessions/CloudSession';
import { RemoteSession } from '../sessions/RemoteSession';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { DASHBORD_EVENT_MANAGER } from '../dashboard/event-manager';
import { updateSessionDetails } from '../dashboard/services/session-service';
import SessionType from '../enums/SessionType';
import AsyncLock from 'async-lock';

const commandsQueueGuard = new AsyncLock();

@Service()
export class SessionLifecycleService {
  private logger = log.scope('SessionLifecycleService');

  async createSession(next: () => any, driver: any, caps: ISessionCapability) {
    const context = Container.get(PluginContext);
    const pluginArgs = context.pluginArgs;

    this.logger.debug(`📱 pluginArgs: ${JSON.stringify(pluginArgs)}`);
    this.logger.debug(`Receiving session request at host: ${pluginArgs.bindHostOrIp}`);

    const pendingSessionId = uuidv4();
    this.logger.debug(`📱 Creating temporary session capability_id: ${pendingSessionId}`);

    const { alwaysMatch: requiredCaps = {}, firstMatch: allFirstMatchCaps = [{}] } = caps;

    const strippedRequiredCaps = stripAppiumPrefixes(requiredCaps);
    const strippedFirstMatchCaps = stripAppiumPrefixes(allFirstMatchCaps[0]);

    try {
      const mergedCaps = Object.assign({}, strippedFirstMatchCaps, strippedRequiredCaps);
      Container.get(CapabilityValidator).validate(mergedCaps);
    } catch (err: any) {
      this.logger.error(`❌ Session validation failed: ${err.message}`);
      throw err;
    }

    const app = strippedRequiredCaps['app'] || strippedFirstMatchCaps['app'];
    if (app && typeof app === 'string' && !app.includes('/') && !app.includes('\\')) {
      const { APP_SERVICE } = await import('../dashboard/services/app-service');
      const appDetails = await APP_SERVICE.getAppById(app);
      if (appDetails) {
        const appUrl = `http://${pluginArgs.bindHostOrIp}:${context.port}/xenon/api/apps/${appDetails.id}/download`;
        this.logger.info(`📱 Resolved app ID ${app} to ${appUrl}`);
        if (requiredCaps['app']) requiredCaps['app'] = appUrl;
        if (allFirstMatchCaps[0]['app']) allFirstMatchCaps[0]['app'] = appUrl;

        if (caps.alwaysMatch && caps.alwaysMatch['app']) caps.alwaysMatch['app'] = appUrl;
        if (caps.alwaysMatch && caps.alwaysMatch['appium:app'])
          caps.alwaysMatch['appium:app'] = appUrl;
        if (caps.firstMatch && caps.firstMatch[0]) {
          if (caps.firstMatch[0]['app']) caps.firstMatch[0]['app'] = appUrl;
          if (caps.firstMatch[0]['appium:app']) caps.firstMatch[0]['appium:app'] = appUrl;
        }
      }
    }

    const firstMatch =
      Array.isArray(caps.firstMatch) && caps.firstMatch.length > 0 ? caps.firstMatch[0] : {};

    await addNewPendingSession({
      ...Object.assign({}, firstMatch, caps.alwaysMatch),
      capability_id: pendingSessionId,
      createdAt: new Date().getTime(),
    });

    const lockName = this.getLockName(caps);
    this.logger.debug(`📱 Acquiring lock: ${lockName}`);

    const device = await commandsQueueGuard.acquire(lockName, async (): Promise<IDevice> => {
      try {
        return await allocateDeviceForSession(
          caps,
          pluginArgs.deviceAvailabilityTimeoutMs,
          pluginArgs.deviceAvailabilityQueryIntervalMs,
          pluginArgs,
        );
      } catch (err) {
        await removePendingSession(pendingSessionId);
        throw err;
      }
    });

    await updateDeviceProgress(device.udid, device.host, 'Allocating node resources...');

    let session: CreateSessionResponseInternal | W3CNewSessionResponseError | Error;
    const isRemoteOrCloudSession = !device.nodeId || device.nodeId !== context.nodeId;

    this.logger.debug(
      `device.host: ${device.host} and pluginArgs.bindHostOrIp: ${pluginArgs.bindHostOrIp}`,
    );

    if (isRemoteOrCloudSession) {
      this.logger.debug(`📱 Forwarding session request to ${device.host}`);
      await updateDeviceProgress(device.udid, device.host, 'Forwarding to remote node...');
      session = await this.forwardSessionRequest(device, caps);
    } else {
      this.logger.debug('📱 Creating session on the same node');
      await this.handleLocalWDAProvisioning(device, caps);

      await updateDeviceProgress(device.udid, device.host, 'Finalizing session bootstrap...');
      session = await next();
    }

    this.logger.debug('📱 Session response: ', JSON.stringify(session));
    this.logger.debug(`📱 Removing pending session with capability_id: ${pendingSessionId}`);
    await removePendingSession(pendingSessionId);

    if (this.isCreateSessionResponseInternal(session)) {
      await this.finalizeSession(session, device, caps, driver, isRemoteOrCloudSession);
    } else {
      await this.handleSessionFailure(session, device, isRemoteOrCloudSession);
    }

    return session;
  }

  private async handleLocalWDAProvisioning(device: IDevice, caps: ISessionCapability) {
    if (device.platform === 'ios' && device.realDevice) {
      const { APP_SERVICE } = await import('../dashboard/services/app-service');
      const wdaApp = await APP_SERVICE.getWDAApp();
      const { default: IOSStreamService } = await import('../device-managers/ios/IOSStreamService');
      const streamService = Container.get(IOSStreamService);
      const streamStatus = streamService.getStreamStatus(device.udid);
      const isWdaActive =
        streamStatus && (streamStatus.status === 'running' || streamStatus.status === 'starting');

      if (!isWdaActive && wdaApp && (await import('fs-extra')).existsSync(wdaApp.filepath)) {
        this.logger.info(`📱 Artisan WDA: Signed artifact found for ${device.udid}`);
        await updateDeviceProgress(device.udid, device.host, 'Provisioning WDA artifact...');

        if (device.derivedDataPath) {
          try {
            const fs = await import('fs-extra');
            if (fs.existsSync(device.derivedDataPath)) {
              await fs.remove(device.derivedDataPath);
            }
          } catch (e: any) {
            this.logger.warn(`⚠️ Artisan WDA: Failed to clear cache: ${e.message}`);
          }
        }

        try {
          const streamInfo = await streamService.startStream(device.udid);
          const wdaUrl = `http://127.0.0.1:${streamInfo.wdaPort}`;
          await updateDeviceProgress(device.udid, device.host, 'WDA active, finalizing session...');
          await new Promise((resolve) => setTimeout(resolve, 2000));

          const bundleId = await streamService.detectWDABundleId(device.udid);
          this.injectWDAUrl(caps, wdaUrl, bundleId);
        } catch (err: any) {
          this.logger.warn(`⚠️ Artisan WDA: Pre-session boot failed: ${err.message}`);
          await updateDeviceProgress(
            device.udid,
            device.host,
            'Provisioning failed, falling back...',
          );
        }
      } else if (isWdaActive) {
        const wdaUrl = `http://127.0.0.1:${streamStatus!.wdaPort}`;
        this.injectWDAUrl(caps, wdaUrl);
      }

      const hasWdaUrl =
        _.has(caps.alwaysMatch, 'appium:webDriverAgentUrl') ||
        _.has(caps.firstMatch[0], 'appium:webDriverAgentUrl');
      if (!hasWdaUrl) {
        await updateDeviceProgress(
          device.udid,
          device.host,
          'Initializing WebDriverAgent (Xcode)...',
        );
      }
    } else if (device.platform === 'android') {
      await updateDeviceProgress(device.udid, device.host, 'Initializing UIAutomator2...');
    }
  }

  private injectWDAUrl(caps: ISessionCapability, wdaUrl: string, bundleId?: string | null) {
    if (caps.alwaysMatch) {
      caps.alwaysMatch['appium:webDriverAgentUrl'] = wdaUrl;
      caps.alwaysMatch['appium:usePreinstalledWDA'] = true;
      if (bundleId) caps.alwaysMatch['appium:updatedWDABundleId'] = bundleId;
      delete caps.alwaysMatch['appium:derivedDataPath'];
      delete caps.alwaysMatch['appium:usePrebuiltWDA'];
      delete caps.alwaysMatch['appium:wdaLocalPort'];
      delete caps.alwaysMatch['appium:mjpegServerPort'];
    }
    if (caps.firstMatch && caps.firstMatch[0]) {
      caps.firstMatch[0]['appium:webDriverAgentUrl'] = wdaUrl;
      caps.firstMatch[0]['appium:usePreinstalledWDA'] = true;
      if (bundleId) caps.firstMatch[0]['appium:updatedWDABundleId'] = bundleId;
      delete caps.firstMatch[0]['appium:derivedDataPath'];
      delete caps.firstMatch[0]['appium:usePrebuiltWDA'];
      delete caps.firstMatch[0]['appium:wdaLocalPort'];
      delete caps.firstMatch[0]['appium:mjpegServerPort'];
    }
  }

  private async finalizeSession(
    session: any,
    device: IDevice,
    caps: ISessionCapability,
    driver: any,
    isRemote: boolean,
  ) {
    const sessionId = session.value[0];
    const sessionResponse = session.value[1];
    const requestedCaps = Object.assign({}, caps.firstMatch?.[0] || {}, caps.alwaysMatch || {});
    (sessionResponse as any).desired = requestedCaps;

    const xenonCapabilities = getXenonCapabilities(caps);
    const tracingService = Container.get(TracingService);
    const context = Container.get(PluginContext);

    if (this.isHub(context.pluginArgs)) {
      const sessionName = (xenonCapabilities[XENON_CAPABILITIES.SESSION_NAME] ||
        sessionId) as string;
      tracingService.startSessionSpan(sessionId, sessionName, {
        'xenon.build_name': xenonCapabilities[XENON_CAPABILITIES.BUILD_NAME] as string,
        'xenon.platform': device.platform,
        'xenon.udid': device.udid,
      });
    }

    await updatedAllocatedDevice(device, {
      busy: true,
      session_id: sessionId,
      lastCmdExecutedAt: new Date().getTime(),
      sessionStartTime: new Date().getTime(),
      sessionProgress: 'Session Active',
    });

    if (isRemote) {
      (Container.get(CircuitBreaker) as CircuitBreaker).recordSuccess(device.host);
      addProxyHandler(sessionId, device.host);
    }

    const freshDevice = await this.getFreshDevice(device);
    const sessionInstance = this.createSessionInstance(
      sessionId,
      freshDevice,
      sessionResponse,
      xenonCapabilities,
      driver,
    );

    await this.applyPostSessionLogic(sessionInstance, xenonCapabilities, freshDevice);
  }

  private async getFreshDevice(device: IDevice): Promise<IDevice> {
    try {
      const store = DeviceStoreFactory.getStore();
      const updatedDevice = await store.findDevice({ udid: device.udid, host: device.host });
      return updatedDevice || device;
    } catch (err: any) {
      this.logger.debug(`📱 Could not refresh device: ${err.message}`);
      return device;
    }
  }

  private createSessionInstance(
    sessionId: string,
    device: IDevice,
    response: any,
    caps: any,
    driver: any,
  ): XenonSession {
    const context = Container.get(PluginContext);
    const sessionOptions: XenonSessionOptions = {
      sessionId,
      device,
      sessionResponse: response,
      xenonOption: caps,
    };
    const nodeWebdriverUrl = nodeUrl(device, context.nodeBasePath);

    if (device.nodeId === context.nodeId) {
      return new LocalSession({ ...sessionOptions, driver });
    } else if (device.cloud) {
      return new CloudSession({ ...sessionOptions, baseUrl: nodeWebdriverUrl });
    } else {
      return new RemoteSession({ ...sessionOptions, baseUrl: nodeWebdriverUrl });
    }
  }

  private async applyPostSessionLogic(session: XenonSession, caps: any, device: IDevice) {
    const context = Container.get(PluginContext);
    const networkProfile = caps[XENON_CAPABILITIES.NETWORK_PROFILE];
    if (networkProfile) {
      const { NetworkConditioningService } = await import('./NetworkConditioningService');
      await Container.get(NetworkConditioningService).applyProfile(
        session.getId(),
        device,
        networkProfile,
      );
    }

    const isDashboardEnabled = !!context.pluginArgs.enableDashboard;
    const shouldSaveLogs = session.getType() !== SessionType.CLOUD;
    const isVideoRecordingEnabled = caps[XENON_CAPABILITIES.VIDEO_RECORDING];

    if (isVideoRecordingEnabled) {
      const resolution = caps[XENON_CAPABILITIES.VIDEO_RESOLUTION] || undefined;
      try {
        await session.startVideoRecording({ resolution });
      } catch (err) {
        this.logger.warn('⚠️ Failed to start video recording:', err);
      }
    }

    if ((isDashboardEnabled && shouldSaveLogs) || (isVideoRecordingEnabled && shouldSaveLogs)) {
      SESSION_MANAGER.addSession(session.getId(), session);
      if (this.isHub(context.pluginArgs) && isDashboardEnabled) {
        await DASHBORD_EVENT_MANAGER.onSessionStarted(caps, session, device);
      }
    }
  }

  private async handleSessionFailure(session: any, device: IDevice, isRemote: boolean) {
    await unblockDevice(device.udid, device.host);
    await updateDeviceProgress(device.udid, device.host, '');
    if (isRemote) {
      (Container.get(CircuitBreaker) as CircuitBreaker).recordFailure(device.host);
    }
    this.throwProperError(session, device.host);
  }

  async forwardSessionRequest(
    device: IDevice,
    caps: ISessionCapability,
  ): Promise<CreateSessionResponseInternal | Error> {
    const context = Container.get(PluginContext);
    const remoteUrl = `${nodeUrl(device, context.nodeBasePath)}/session`;

    const config: AxiosRequestConfig = {
      method: 'post',
      url: remoteUrl,
      headers: { 'Content-Type': 'application/json' },
      data: { capabilities: caps },
    };

    if (context.pluginArgs.proxy) {
      const rejectUnauthorized = context.pluginArgs.tlsRejectUnauthorized !== false;
      this.logger.info(`Added proxy to axios config: ${JSON.stringify(context.pluginArgs.proxy)}`);
      config.httpsAgent = new HttpsProxyAgent(context.pluginArgs.proxy as any, {
        rejectUnauthorized,
      } as any);
      config.httpAgent = new HttpProxyAgent(context.pluginArgs.proxy as any, {
        rejectUnauthorized,
      } as any);
      config.proxy = false;
    }

    const createdSession: W3CNewSessionResponse | Error = await this.invokeSessionRequest(
      config,
      context.pluginArgs.tlsRejectUnauthorized,
    );

    if (createdSession instanceof Error) {
      return createdSession;
    }

    // Detect W3C-style error payloads that invokeSessionRequest returned as data
    const val = createdSession?.value as any;
    if (
      Object.prototype.hasOwnProperty.call(createdSession, 'error') ||
      (val && val.error) ||
      (val && typeof val.message === 'string' && !val.sessionId)
    ) {
      const errorDetail =
        (createdSession as any).error || val?.error || val?.message || 'Unknown W3C error';
      return new Error(
        `W3C session creation failed on ${device.host}: ${typeof errorDetail === 'object' ? JSON.stringify(errorDetail) : errorDetail
        }`,
      );
    }

    // Only build the success tuple for genuine W3C success payloads
    if (!val?.sessionId) {
      return new Error(
        `Invalid session response from ${device.host}: missing sessionId`,
      );
    }

    return {
      protocol: 'W3C',
      value: [val.sessionId, val.capabilities, 'W3C'],
    };
  }

  async invokeSessionRequest(
    config: AxiosRequestConfig,
    tlsRejectUnauthorized?: boolean,
  ): Promise<W3CNewSessionResponse | Error> {
    try {
      const client = InternalHttpClient.getClient(tlsRejectUnauthorized);
      const response = await client.request(config);
      return response.data as W3CNewSessionResponse;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response) {
          return axiosError.response.data as W3CNewSessionResponse;
        }
      }
      return error;
    }
  }

  isW3CNewSessionResponse(something: any): something is W3CNewSessionResponse {
    return (
      something &&
      typeof something === 'object' &&
      (Object.prototype.hasOwnProperty.call(something, 'value') ||
        Object.prototype.hasOwnProperty.call(something, 'error'))
    );
  }

  isCreateSessionResponseInternal(something: any): something is CreateSessionResponseInternal {
    return (
      something &&
      typeof something === 'object' &&
      Object.prototype.hasOwnProperty.call(something, 'value') &&
      Array.isArray(something.value) &&
      (something.value.length === 2 || something.value.length === 3) &&
      typeof something.value[0] === 'string' &&
      typeof something.value[1] === 'object' &&
      (something.value.length === 2 || typeof something.value[2] === 'string' || something.value[2] === undefined)
    );
  }

  throwProperError(session: any, host: string) {
    if (session instanceof Error) {
      throw session;
    } else if (session && typeof session === 'object' && Object.prototype.hasOwnProperty.call(session, 'error')) {
      let errorMessage = (session as W3CNewSessionResponseError).error;
      if (typeof errorMessage === 'object') {
        errorMessage = JSON.stringify(errorMessage);
      }
      throw new Error(`Failed to create session on node ${host}. Error: ${errorMessage}`);
    } else {
      throw new Error(`Failed to create session on node ${host}. Unknown error.`);
    }
  }

  getLockName(caps: ISessionCapability): string {
    const platform = (
      caps.alwaysMatch?.platformName || caps.firstMatch?.[0]?.platformName
    )?.toLowerCase();
    if (platform === 'ios') return 'ios-lock';
    if (platform === 'android') return 'android-lock';
    return 'default-lock';
  }

  async deleteSession(next: () => any, sessionId: string) {
    await unblockDeviceMatchingFilter({ session_id: sessionId as any });
    this.logger.info(`📱 Unblocking the device that is blocked for session ${sessionId}`);

    const session = SESSION_MANAGER.getSession(sessionId);

    if (session) {
      const device = session.getDevice();
      if (device && device.platform?.toLowerCase() === 'ios') {
        this.logger.info('Stopping iOS profiling before session deletion');
        try {
          const traceBase64 = await session.stopPerformanceRecording();
          if (traceBase64) {
            const { savePerformanceTrace } = await import('../dashboard/asset-manager');
            const tracePath = savePerformanceTrace(sessionId, traceBase64);
            await updateSessionDetails(sessionId, { performance_trace: tracePath });
            this.logger.info(`✅ iOS profiling trace saved at ${tracePath}`);
          }
        } catch (err: any) {
          this.logger.warn(`⚠️ iOS profiling capture failed: ${err.message}`);
        }
      }

      if (session.isVideoRecordingInProgress()) {
        this.logger.info('Stopping video recording before session deletion');
        try {
          const videoData = await session.stopVideoRecording();
          if (videoData) {
            try {
              const { saveVideoRecording } = await import('../dashboard/asset-manager');
              let videoPath = videoData;
              if (videoData.length > 1000) {
                videoPath = saveVideoRecording(sessionId, videoData);
              }
              await updateSessionDetails(sessionId, { video_recording: videoPath });
            } catch (saveErr: any) {
              this.logger.error(`❌ Failed to process video asset: ${saveErr.message}`);
            }
          }
        } catch (error: any) {
          this.logger.warn(`Failed to stop video recording: ${error.message}`);
        }
      }
    }

    try {
      return await next();
    } finally {
      const session = SESSION_MANAGER.getSession(sessionId);
      if (session) {
        const device = session.getDevice();
        const { NetworkConditioningService } = await import('./NetworkConditioningService');
        await Container.get(NetworkConditioningService).reset(sessionId, device);
      }

      await DASHBORD_EVENT_MANAGER.onSessionStoped(sessionId);
      SESSION_MANAGER.removeSession(sessionId);

      try {
        const { getSessionById } = await import('../dashboard/services/session-service');
        const sessionData = await getSessionById(sessionId);
        if (sessionData && (sessionData.status === 'failed' || sessionData.failure_reason)) {
          const { NotificationService } = await import('./NotificationService');
          await Container.get(NotificationService).dispatchEvent('session_failed', sessionData);
        }
      } catch (err) {
        /* ignore notification errors */
      }
    }
  }

  private isHub(args: any) {
    return !!args.hub;
  }
}
