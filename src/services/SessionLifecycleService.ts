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
import { PortAllocator } from './PortAllocator';
import {
  extractAccessKeyTokenPair,
  extractSessionToken,
  extractTeamCap,
  getXenonCapabilities,
  XENON_CAPABILITIES,
} from '../XenonCapabilityManager';
import { JwtKeyService } from './token/JwtKeyService';
import { resolveSessionIdentity } from './session/sessionIdentity';
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
import { SessionStatus } from '../types/SessionStatus';
import SessionType from '../enums/SessionType';
import AsyncLock from 'async-lock';
import { errors as appiumErrors } from '@appium/base-driver';

const commandsQueueGuard = new AsyncLock();
// Serializes concurrent deleteSession cleanup for the same sessionId so
// that onSessionStopped events don't fire twice if two clients race.
const sessionCleanupLock = new AsyncLock();

@Service()
export class SessionLifecycleService {
  private logger = log.scope('SessionLifecycleService');

  async createSession(next: () => any, driver: any, caps: ISessionCapability) {
    // Fail fast during graceful shutdown so clients get a clear error instead
    // of their request hanging until the process dies. Lazy import to avoid
    // a cycle (ShutdownCoordinator -> SessionLifecycleService -> this file).
    const { ShutdownCoordinator } = await import('./ShutdownCoordinator');
    if (Container.get(ShutdownCoordinator).isDraining) {
      this.logger.warn('Rejecting new session: hub is draining for shutdown');
      throw new Error('Hub is shutting down; please retry against a different node');
    }

    const authResult = await this.authorizeSessionRequest(caps);

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
          authResult.scoped ? authResult.callerTeamIds : undefined,
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

    try {
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
    } catch (err: any) {
      // A THROWN error from the driver's createSession (next()) or the remote
      // forward leaves the device locked: allocateDeviceForSession already set
      // busy=true, and on the throw path neither finalizeSession nor
      // handleSessionFailure runs — so without this the device gets stuck busy
      // with no session. Release it, then rethrow the original error.
      // (handleSessionFailure below covers the separate case where next()
      // RETURNS a W3C error object rather than throwing.)
      this.logger.error(
        `❌ Session creation failed for device ${device.udid}: ${err?.message ?? err}. Unblocking device.`,
      );
      try {
        await removePendingSession(pendingSessionId);
        await unblockDevice(device.udid, device.host);
        await updateDeviceProgress(device.udid, device.host, '');
        if (isRemoteOrCloudSession) {
          (Container.get(CircuitBreaker) as CircuitBreaker).recordFailure(device.host);
        }
      } catch (cleanupErr: any) {
        this.logger.warn(
          `Cleanup after failed session creation had issues: ${cleanupErr?.message ?? cleanupErr}`,
        );
      }
      throw err;
    }

    this.logger.debug('📱 Session response: ', JSON.stringify(session));
    this.logger.debug(`📱 Removing pending session with capability_id: ${pendingSessionId}`);
    await removePendingSession(pendingSessionId);

    if (this.isCreateSessionResponseInternal(session)) {
      await this.finalizeSession(
        session,
        device,
        caps,
        driver,
        isRemoteOrCloudSession,
        authResult.apiKeyId,
        authResult.userId,
      );
    } else {
      await this.handleSessionFailure(session, device, isRemoteOrCloudSession);
    }

    return session;
  }

  // Verify a WebDriver session request against an API key supplied via the
  // `xenon:accessKey` capability. Today this is best-effort: if no cap is
  // supplied we log a warning and let the request through to avoid breaking
  // pre-existing test clients. A supplied key that is invalid / revoked / has
  // insufficient scope is rejected. Respects the global `authDisabled` flag.
  //
  // Returns the caller's { apiKeyId, callerTeamIds } so allocation can filter
  // devices by team. `apiKeyId` is null when auth is disabled or no key was
  // presented (back-compat path); `callerTeamIds` is an empty array when the
  // caller has no team (sees the shared pool only) and a single-element
  // array when the apiKey is narrowed to one team. The widening to a set is
  // for Phase 4A's multi-team membership; today an apiKey can bind to at
  // most one team, so this is always 0- or 1-element.
  private async authorizeSessionRequest(caps: ISessionCapability): Promise<{
    apiKeyId: string | null;
    userId: string | null;
    callerTeamIds: string[] | undefined;
    scoped: boolean;
  }> {
    const { config: xenonConfig } = await import('../config');
    // `scoped` tells the allocator whether to restrict device candidates by
    // team. False = see everything (admin, authDisabled, back-compat path);
    // true = filter to { null, ...callerTeamIds }; when callerTeamIds is
    // empty, only the shared pool is visible.
    if (xenonConfig.authDisabled === true) {
      return { apiKeyId: null, userId: null, callerTeamIds: undefined, scoped: false };
    }

    const { ApiKeyService } = await import('./ApiKeyService');
    const svc = Container.get(ApiKeyService);

    // df:options.{accessKey, token} pair — the only supported credential shape.
    const pair = extractAccessKeyTokenPair(caps);
    const row = pair ? await svc.verifyPair(pair.accessKey, pair.token) : null;

    const { assertSessionTokenGate, sessionTokenGateEnabled } = await import('./sessionTokenGate');
    try {
      await assertSessionTokenGate({
        enabled: sessionTokenGateEnabled(),
        hasValidKeyPair: !!row,
        token: extractSessionToken(caps),
        verify: (t) =>
          Container.get(JwtKeyService).verify(t, { audience: 'xenon-session' }),
      });
    } catch (err: any) {
      this.logger.error(`❌ ${err.message}`);
      throw new appiumErrors.InvalidArgumentError(err.message);
    }

    if (!row) {
      // No key pair. A xenon:options.sessionToken still identifies the caller,
      // so read it for attribution even when the gate is off — otherwise the
      // ownership guard fails closed on a session whose owner we actually know.
      // Enforcement is assertSessionTokenGate's job and is unchanged.
      const identity = await resolveSessionIdentity({
        row: null,
        sessionToken: extractSessionToken(caps),
        verify: (t) => Container.get(JwtKeyService).verify(t, { audience: 'xenon-session' }),
      });
      if (!identity.userId) {
        this.logger.warn(
          'Session created without valid credentials. Pass `df:options.accessKey` + `df:options.token`.',
        );
      }
      return { ...identity, callerTeamIds: undefined, scoped: false };
    }
    if (!svc.hasScope(row, ['sessions'])) {
      this.logger.error('Rejecting session: credentials lack the `sessions` scope');
      throw new appiumErrors.InvalidArgumentError(
        'credentials are invalid, revoked, or lack the `sessions` scope',
      );
    }

    const isAdmin = svc.hasScope(row, ['admin']);
    // Empty array (apiKey not bound to a team) preserves the previous
    // shared-pool-only filter for member-tier callers; single-element
    // array preserves the previous team-binding narrow.
    const callerTeamIds: string[] = row.teamId ? [row.teamId] : [];

    const requestedTeam = extractTeamCap(caps);
    if (requestedTeam) {
      if (!isAdmin && !callerTeamIds.includes(requestedTeam)) {
        this.logger.error(
          `Rejecting session: xenon:team=${requestedTeam} but caller key is bound to team ${row.teamId ?? '(none)'}`,
        );
        throw new appiumErrors.InvalidArgumentError(
          `xenon:team '${requestedTeam}' is not allowed for this API key`,
        );
      }
      return {
        apiKeyId: row.id,
        userId: row.userId,
        callerTeamIds: [requestedTeam],
        scoped: !isAdmin,
      };
    }

    return { apiKeyId: row.id, userId: row.userId, callerTeamIds, scoped: !isAdmin };
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
        // The bundle id matters as much here as on the branch above, and this
        // is the branch that runs in the ordinary case — a preview already
        // open when a test starts. Omitting it told Appium to manage "the
        // preinstalled WDA" without saying which, and it removed ours.
        const bundleId = await streamService.detectWDABundleId(device.udid);
        this.injectWDAUrl(caps, wdaUrl, bundleId);
      }

      const hasWdaUrl =
        _.has(caps.alwaysMatch, 'appium:webDriverAgentUrl') ||
        _.has(caps.firstMatch?.[0], 'appium:webDriverAgentUrl');
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
    // W3C capability rules forbid a property from appearing in BOTH alwaysMatch
    // and a firstMatch entry; appium rejects the session with "property
    // 'webDriverAgentUrl' should not exist on both primary and secondary object".
    // Write the injected WDA caps to exactly ONE bucket — prefer alwaysMatch,
    // which applies to every firstMatch entry — and scrub the keys from the
    // other so they can never collide.
    const target = caps.alwaysMatch ?? caps.firstMatch?.[0];
    if (!target) return;
    const other = target === caps.alwaysMatch ? caps.firstMatch?.[0] : caps.alwaysMatch;

    target['appium:webDriverAgentUrl'] = wdaUrl;

    // `usePreinstalledWDA` and `updatedWDABundleId` travel together or not at
    // all. On its own, the first one sends the driver down
    // `preparePreinstalled`, which calls `cleanupApps(driver,
    // [driver.wda.bundleIdForXctest])` — that removes every installed app
    // whose CFBundleName is WebDriverAgentRunner except the one bundle id it
    // was told to keep. Without `updatedWDABundleId` that keep-list is the
    // driver's own default, `com.facebook.WebDriverAgentRunner.xctrunner`, so
    // the WDA Xenon just launched (`com.qasecret.…` here) is not on it and is
    // uninstalled from the device mid-session. Observed twice on a real
    // iPhone: "Removing WebDriverAgent runner app
    // 'com.qasecret.WebDriverAgentRunner.xctrunner'", after which every iOS
    // feature fails with "WebDriverAgent is not installed" until someone
    // re-signs and reinstalls it by hand.
    //
    // `webDriverAgentUrl` alone is enough to reuse a running WDA, and it does
    // not enter that cleanup path — so when the bundle id is unknown, the safe
    // move is to say less, not more.
    if (bundleId) {
      target['appium:usePreinstalledWDA'] = true;
      target['appium:updatedWDABundleId'] = bundleId;
    } else {
      log.warn(
        `[Xenon] Could not identify the WebDriverAgent bundle on this device; reusing it by URL only. ` +
          `Sending usePreinstalledWDA without a bundle id would let the driver uninstall it.`,
      );
      delete target['appium:usePreinstalledWDA'];
      delete target['appium:updatedWDABundleId'];
    }

    // These conflict with a pre-installed WDA URL — strip from both buckets.
    for (const bucket of [target, other]) {
      if (!bucket) continue;
      delete bucket['appium:derivedDataPath'];
      delete bucket['appium:usePrebuiltWDA'];
      delete bucket['appium:wdaLocalPort'];
      delete bucket['appium:mjpegServerPort'];
    }
    // The injected WDA keys must live in `target` only.
    if (other) {
      delete other['appium:webDriverAgentUrl'];
      delete other['appium:usePreinstalledWDA'];
      delete other['appium:updatedWDABundleId'];
    }
  }

  private async finalizeSession(
    session: any,
    device: IDevice,
    caps: ISessionCapability,
    driver: any,
    isRemote: boolean,
    apiKeyId: string | null = null,
    userId: string | null = null,
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
    sessionInstance.apiKeyId = apiKeyId;
    sessionInstance.userId = userId;

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

    if (caps[XENON_CAPABILITIES.INTERCEPTOR_ENABLED]) {
      try {
        const { InterceptorService } = await import('./InterceptorService');
        await Container.get(InterceptorService).start(session.getId(), device, {
          enabled: true,
          bufferSize: caps[XENON_CAPABILITIES.INTERCEPTOR_BUFFER_SIZE],
          captureBodies: caps[XENON_CAPABILITIES.INTERCEPTOR_CAPTURE_BODIES] !== false,
          mocks: caps[XENON_CAPABILITIES.INTERCEPTOR_MOCKS] || [],
          includeHosts: caps[XENON_CAPABILITIES.INTERCEPTOR_INCLUDE_HOSTS] || [],
          excludeHosts: caps[XENON_CAPABILITIES.INTERCEPTOR_EXCLUDE_HOSTS] || [],
        });
      } catch (err: any) {
        this.logger.warn(`🕸️ Failed to start interceptor for ${session.getId()}: ${err.message}`);
      }
    }

    const isDashboardEnabled = !!context.pluginArgs.enableDashboard;
    const shouldSaveLogs = session.getType() !== SessionType.CLOUD;
    const isVideoRecordingEnabled = caps[XENON_CAPABILITIES.VIDEO_RECORDING];
    this.logger.info(
      `📹 Video recording enabled for session ${session.getId()}: ${isVideoRecordingEnabled}`,
    );

    if (isVideoRecordingEnabled) {
      const resolution = caps[XENON_CAPABILITIES.VIDEO_RESOLUTION] || undefined;
      try {
        this.logger.info(`📹 Starting video recording for session ${session.getId()}...`);
        await session.startVideoRecording({ resolution });
        this.logger.info(`📹 Video recording started successfully for ${session.getId()}`);
      } catch (err: any) {
        this.logger.warn(
          `⚠️ Failed to start video recording for ${session.getId()}: ${err.message}`,
        );
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
      this.logger.info(`Added proxy to axios config: ${JSON.stringify(context.pluginArgs.proxy)}`);
      const proxyUrl =
        typeof context.pluginArgs.proxy === 'string'
          ? context.pluginArgs.proxy
          : `http://${(context.pluginArgs.proxy as any).host}:${(context.pluginArgs.proxy as any).port}`;
      config.httpsAgent = new HttpsProxyAgent(proxyUrl, {
        rejectUnauthorized: context.pluginArgs.tlsRejectUnauthorized,
      });
      config.httpAgent = new HttpProxyAgent(proxyUrl, {
        rejectUnauthorized: context.pluginArgs.tlsRejectUnauthorized,
      });
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
        `W3C session creation failed on ${device.host}: ${
          typeof errorDetail === 'object' ? JSON.stringify(errorDetail) : errorDetail
        }`,
      );
    }

    // Only build the success tuple for genuine W3C success payloads
    if (!val?.sessionId) {
      return new Error(`Invalid session response from ${device.host}: missing sessionId`);
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
      (something.value.length === 2 ||
        typeof something.value[2] === 'string' ||
        something.value[2] === undefined)
    );
  }

  throwProperError(session: any, host: string) {
    if (session instanceof Error) {
      throw session;
    } else if (
      session &&
      typeof session === 'object' &&
      Object.prototype.hasOwnProperty.call(session, 'error')
    ) {
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

  async deleteSession(
    next: () => any,
    sessionId?: string | null,
    status?: SessionStatus,
    reason?: string,
  ) {
    // Phase 1: device unblock + finalizeCleanup must be atomic. Without the lock,
    // two racing deletes both observe isStopping=false and both run finalizeCleanup,
    // which releases ports and archives video twice.
    if (sessionId) {
      await sessionCleanupLock.acquire(sessionId, async () => {
        await unblockDeviceMatchingFilter({ session_id: sessionId as any });
        this.logger.info(`📱 Unblocking the device that is blocked for session ${sessionId}`);

        const session = SESSION_MANAGER.getSession(sessionId);
        if (session && !session.isStopping) {
          session.isStopping = true;
          session.stoppedAt = Date.now();
          await this.finalizeCleanup(session, status, reason);
        }
      });
    }

    let timeoutId: any;
    try {
      // Principal Protection: Wrap the driver deletion with a timeout.
      // If the underlying driver (WDA/ADB) hangs during shutdown, we don't want
      // our session lifecycle to be stuck 'RUNNING' forever.
      const deletionTimeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Deletion timed out')), 30000);
      });

      const response = await Promise.race([next(), deletionTimeout]);
      clearTimeout(timeoutId);
      return response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      this.logger.warn(
        `⚠️ Internal deleteSession failed or timed out: ${err.message}. Continuing cleanup anyway.`,
      );
      return null;
    } finally {
      if (sessionId) {
        await sessionCleanupLock.acquire(sessionId, async () => {
          const session = SESSION_MANAGER.getSession(sessionId);
          if (!session) {
            // Another concurrent deleteSession already cleaned up.
            return;
          }
          const device = session.getDevice();
          try {
            const { NetworkConditioningService } = await import('./NetworkConditioningService');
            await Container.get(NetworkConditioningService).reset(sessionId, device);
          } catch (resetErr: any) {
            this.logger.warn(
              `⚠️ NetworkConditioningService.reset failed for session ${sessionId}: ${resetErr.message}`,
            );
          }

          try {
            const { InterceptorService } = await import('./InterceptorService');
            const interceptor = Container.get(InterceptorService);
            if (interceptor.isActive(sessionId)) await interceptor.stop(sessionId);
          } catch (interceptorErr: any) {
            this.logger.warn(
              `⚠️ InterceptorService.stop failed for session ${sessionId}: ${interceptorErr.message}`,
            );
          }

          await DASHBORD_EVENT_MANAGER.onSessionStopped(sessionId, status, reason);
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
        });
      }
    }
  }

  private async finalizeCleanup(session: XenonSession, status?: SessionStatus, reason?: string) {
    const sessionId = session.getId();
    const device = session.getDevice();

    // Release allocated ports for this device
    if (device?.udid) {
      try {
        await Container.get(PortAllocator).releaseForUdid(device.udid);
      } catch (err: any) {
        log.warn(`Port release failed: ${err.message}`);
      }
    }

    // 1. iOS Profiling Archival
    if (device && device.platform?.toLowerCase() === 'ios') {
      this.logger.info(`[${sessionId}] Stopping iOS profiling for asset archival`);
      try {
        const traceBase64 = await session.stopPerformanceRecording();
        if (traceBase64) {
          const { savePerformanceTrace } = await import('../dashboard/asset-manager');
          const tracePath = savePerformanceTrace(sessionId, traceBase64);
          await updateSessionDetails(sessionId, { performance_trace: tracePath });
          this.logger.info(`✅ [${sessionId}] iOS profiling trace saved at ${tracePath}`);
        }
      } catch (err: any) {
        this.logger.warn(`⚠️ [${sessionId}] iOS profiling capture failed: ${err.message}`);
      }
    }

    // 2. Intelligent Video Archival
    if (session.isVideoRecordingInProgress()) {
      this.logger.info(`[${sessionId}] Stopping video recording for asset archival`);
      try {
        const videoData = await session.stopVideoRecording();
        if (videoData) {
          try {
            const { saveVideoRecording } = await import('../dashboard/asset-manager');
            let videoPath = videoData;
            // Principal Efficiency: If it's a relative path from our pipeline, use it.
            // If it's base64 (older Appium drivers), save it to disk.
            if (videoData.length > 1000) {
              videoPath = saveVideoRecording(sessionId, videoData);
            }
            await updateSessionDetails(sessionId, { video_recording: videoPath });
            this.logger.info(`✅ [${sessionId}] Video recording archived at ${videoPath}`);
          } catch (saveErr: any) {
            this.logger.error(
              `❌ [${sessionId}] Failed to process video asset: ${saveErr.message}`,
            );
          }
        }
      } catch (error: any) {
        this.logger.warn(`⚠️ [${sessionId}] Failed to stop video recording: ${error.message}`);
      }
    }
  }

  // Shutdown-path counterpart to deleteSession. Runs the same cleanup (unblock
  // device, archive video, release ports, mark failed, emit stopped) WITHOUT
  // needing Appium's `next()` driver shutdown — during process shutdown we
  // don't have it, and any leftover driver state dies with the process
  // anyway. Shares sessionCleanupLock with deleteSession so a racing client
  // delete can't double-archive video.
  public async stopSessionForShutdown(sessionId: string, reason: string): Promise<void> {
    await sessionCleanupLock.acquire(sessionId, async () => {
      try {
        await unblockDeviceMatchingFilter({ session_id: sessionId as any });
      } catch (err: any) {
        this.logger.warn(`[shutdown] unblock failed for ${sessionId}: ${err.message}`);
      }

      const session = SESSION_MANAGER.getSession(sessionId);
      if (session && !session.isStopping) {
        session.isStopping = true;
        session.stoppedAt = Date.now();
        try {
          await this.finalizeCleanup(session, SessionStatus.FAILED, reason);
        } catch (err: any) {
          this.logger.warn(`[shutdown] finalizeCleanup failed for ${sessionId}: ${err.message}`);
        }
      }

      try {
        await DASHBORD_EVENT_MANAGER.onSessionStopped(sessionId, SessionStatus.FAILED, reason);
      } catch (err: any) {
        this.logger.warn(`[shutdown] onSessionStopped failed for ${sessionId}: ${err.message}`);
      }

      SESSION_MANAGER.removeSession(sessionId);
    });
  }

  private isHub(args: any) {
    return !args.hub;
  }
}
