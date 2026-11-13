import { Request, Response } from 'express';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { IDevice } from '../interfaces/IDevice';
import { prisma } from '../prisma';
import log, { redactSecrets } from '../logger';
import {
  getOrCreateNewBuild,
  getSessionById,
  updateSessionDetails,
} from './services/session-service';
import { XENON_CAPABILITIES } from '../XenonCapabilityManager';
import _ from 'lodash';
import { safeParseJson } from '../helpers';
import { prepareDirectory, savePerformanceTrace, saveScreenShot } from './asset-manager';
import { dashboardCommands, sessionDetailsCommandOf } from './commands';
import { SessionStatus } from '../types/SessionStatus';
import { SessionLog, Session, Prisma } from '../generated/client';
import { XenonSession } from '../sessions/XenonSession';
import { config } from '../config';
import { takeScreenshot } from '../helpers';
import { Container } from 'typedi';
import IOSStreamService from '../device-managers/ios/IOSStreamService';
import AndroidStreamService from '../device-managers/android/AndroidStreamService';
import { SocketServer, type EventPhone } from '../services/SocketServer';
import { TracingService } from '../services/TracingService';
import { MetricsService } from '../services/MetricsService';
import { SocketEvents } from '../enums/SocketEvents';
import { healingTierLabel } from '../services/healing/types';
import { SelectorStateService } from '../services/SelectorStateService';
import { RecordingStore } from '../services/recording/recording-store';
import { NotificationService, announce } from '../services/NotificationService';
import { SessionMetricsService } from '../services/metrics/SessionMetricsService';
import { SessionDeviceLogs } from '../services/logcat/SessionDeviceLogs';
import { nodeMetricsSourceOf } from '../services/metrics/nodeMetrics';
import { nodeDeviceLogsSourceOf } from '../services/logcat/nodeDeviceLogs';
import { sessionCommandSummary } from './sessionCommandSummary';
import { commandLogFields } from './commandLogFields';
import { PluginContext } from '../PluginContext';
import { CommandPrivacy, inputMasked } from './commandPrivacy';
import { hasSensitiveMark, isInsideSensitiveCommand } from '../gateway/sensitiveCommand';
import { sessionLeaseIdOf } from '../services/lease/leaseSessionCaps';
import { Service } from 'typedi';
import { sessionEventPhone } from './sessionEventPhone';

/**
 * What a Session row keeps of the capabilities the driver returned. The row
 * is served to the dashboard and the session API, so any secret-named value
 * is redacted. createSession already takes Xenon's own credentials out of
 * xe:options and xenon:options before the driver sees them; this also covers
 * a token a client put where Xenon doesn't read it, which the driver hands
 * back in its response. The response itself is not changed.
 */
export function storedSessionCapabilities(sessionResponse: Record<string, any>): {
  desired_capabilities: string;
  session_capabilities: string;
} {
  const redacted = redactSecrets(sessionResponse);
  return {
    desired_capabilities: JSON.stringify(redacted.desired || {}),
    session_capabilities: JSON.stringify(_.omit(redacted, 'desired')),
  };
}

@Service()
export class DashboardEventManager {
  // private SCREENSHOT_FOR_COMMANDS = ['click', 'setUrl', 'setValue', 'performActions'];

  // Map session ID to device info
  private sessionToDevice: Map<string, IDevice> = new Map();
  // Track start time for each command to calculate duration
  private commandStartTime: Map<string, number> = new Map();
  // Idempotency Guard: Prevents double-invocation of onSessionStopped by racing actors
  private stoppingSessionIds: Set<string> = new Set();

  async onSessionStarted(
    capabilities: Record<string, any>,
    session: XenonSession,
    device: IDevice,
  ) {
    // Store device info for this session
    this.sessionToDevice.set(session.getId(), device);

    const createOptions = {
      id: session.getId(),
    } as Record<string, any>;

    // create directory to store screenshots, videos and log files for the session
    prepareDirectory(session.getId());

    // CPU and memory for the session page's Performance panel; sampling
    // starts once the session's row exists, since the samples point at it.
    const metrics = Container.get(SessionMetricsService);
    const source = nodeMetricsSourceOf(session);
    const sampled = metrics.appliesTo(device, source);

    // If iOS real device, start performance recording (Time Profiler)
    // Note: This only works on real devices with XCUITest driver 4.5+
    let isIosProfilingStarted = false;
    if (device.platform.toLowerCase() === 'ios' && device.realDevice === true) {
      log.info(`[Profiling] Starting iOS performance recording for session ${session.getId()}`);
      try {
        await session.startPerformanceRecording();
        isIosProfilingStarted = true;
        log.info(`[Profiling] ✅ iOS performance recording started for ${session.getId()}`);
      } catch (err: any) {
        log.warn(`[Profiling] Failed to start iOS performance recording: ${err.message}`);
        // Not a fatal error - profiling is optional
      }
    }

    // start video recording is now handled in plugin.ts createSession to avoid double calls
    const videoMsg = `📹 Video recording capability for session ${session.getId()}: ${capabilities[XENON_CAPABILITIES.VIDEO_RECORDING]}`;
    log.info(videoMsg);

    const buildName = capabilities[XENON_CAPABILITIES.BUILD_NAME] || 'Default Build';
    const build = await getOrCreateNewBuild(buildName);

    const sessionResponse = _.assign({}, session.getCapabilities());

    const tracingService = Container.get(TracingService);
    const traceId = tracingService.getTraceId(session.getId());

    const createData: any = {
      id: session.getId(),
      build: build.id ? { connect: { id: build.id } } : undefined,
      name: capabilities[XENON_CAPABILITIES.SESSION_NAME] || undefined,
      ...storedSessionCapabilities(sessionResponse),
      node_id: device.nodeId || '',
      has_live_video: session.getLiveVideoUrl() !== null,
      video_recording_enabled: capabilities[XENON_CAPABILITIES.VIDEO_RECORDING] === true,
      is_profiling_available: sampled || isIosProfilingStarted,
      device_udid: device.udid || '',
      device_platform: device.platform || '',
      device_version: device.sdk || '',
      device_name: device.name,
      trace_id: traceId,
      status: 'running', // Principal Polish: Set status explicitly
      api_key_id: session.apiKeyId ?? null,
      user_id: session.userId ?? null,
      // The lease it runs on, so a group lease's sessions can be found together.
      lease_id: sessionLeaseIdOf(sessionResponse),
    };

    const created = await prisma.session.create({
      data: createData,
    });
    // ENH-07: once the session has its row, which is what it is built from.
    announce('session_started', created.id, () =>
      Container.get(NotificationService).notifySessionStarted(created),
    );
    if (sampled) {
      metrics.start({
        sessionId: session.getId(),
        device,
        capabilities: session.getCapabilities(),
        ...(source ? { source } : {}),
      });
    }
    // The device's log, from about when the phone was given to the session,
    // once its row exists (the lines point at it), unless the session turned
    // it off: an Android phone's stream, or the log an iPhone's or
    // simulator's driver captures. Not waited for: an Android phone's clock
    // and log stream are read in the background. A node's phone's lines are
    // collected from the node, through the session.
    const deviceLogs = Container.get(SessionDeviceLogs);
    if (capabilities[XENON_CAPABILITIES.SAVE_DEVICE_LOGS] === false) {
      void deviceLogs.noteOff(session.getId());
    } else {
      const deviceLogSource = nodeDeviceLogsSourceOf(session);
      void deviceLogs.start({
        sessionId: session.getId(),
        device,
        since: session.allocatedAt,
        driverLog: (session as { deviceLog?: () => unknown }).deviceLog?.(),
        appUnderTest: (session as { appUnderTest?: () => string | undefined }).appUnderTest?.(),
        ...(deviceLogSource ? { source: deviceLogSource } : {}),
      });
    }

    // Emit session started event
    void Container.get(SocketServer).emitToDashboardForDevices(
      SocketEvents.SESSION_STARTED,
      {
        ...createData,
        // Which server's phone: the Session row has no host column, so the
        // event carries it beside device_udid.
        device_host: device.host,
        status: 'running', // Principal Polish: Ensure frontend gets status
        build_name: buildName,
      },
      { udid: device.udid, host: device.host },
    );

    // Increment Metrics
    Container.get(MetricsService).incrementSessionStart();
  }

  /**
   * #150: on session teardown, stop a stream the session left running (e.g. the
   * WDA/MJPEG stream started during iOS provisioning) so it doesn't linger after
   * the device is released. Guarded by `viewerCount === 0`: if a developer is
   * actively watching the same physical device via the Device Panel (shared-WDA
   * coexistence), the stream is left alone — the device is already released here,
   * and once the last viewer leaves the stream watchdog reclaims it. Best-effort:
   * any failure is logged and swallowed so it never blocks session teardown.
   */
  private async stopIdleStreamForDevice(device: IDevice): Promise<void> {
    try {
      const isApple = device.platform === 'ios' || device.platform === 'tvos';
      // A real iPhone's stream kept for the next session, where the server
      // asks (keepIosStreamBetweenSessions): the next session starts on its
      // running WebDriverAgent (SessionLifecycleService's reuse) instead of
      // starting one, and the watchdog stops it after 10 idle minutes.
      if (
        isApple &&
        device.realDevice &&
        Container.get(PluginContext).pluginArgs?.keepIosStreamBetweenSessions === true &&
        Container.get(IOSStreamService).keepForNextSession(device.udid)
      ) {
        log.info(`🎥 [${device.udid}] Kept the session's stream for the next session.`);
        return;
      }
      const svc = isApple ? Container.get(IOSStreamService) : Container.get(AndroidStreamService);
      const status = svc.getStreamStatus(device.udid);
      if (status && status.viewerCount === 0) {
        await svc.stopStream(device.udid);
        log.info(`🎥 [${device.udid}] Stopped idle session stream on teardown.`);
      }
    } catch (err) {
      log.debug(`Non-fatal: idle-stream stop for ${device.udid} failed: ${err}`);
    }
  }

  /**
   * Closes a session's record: its end time, its final status, the device's
   * release. Every way a session ends comes here (the client's delete, an
   * inactivity timeout, a driver crash, a heartbeat timeout, a shutdown), so
   * this is where a failed one is announced to the `session_failed` webhooks.
   * `notify: false` records the failure without announcing it: a server
   * shutting down fails the sessions it drains, which no test caused.
   */
  /**
   * Records a session's end, and says the status it ended with: the one it
   * was given, else the one decided here from its failed commands (a test's
   * own delete gives none), else undefined when there is no row to decide
   * from. deleteSession ends the session's span with it.
   */
  async onSessionStopped(
    sessionId: string,
    status?: SessionStatus,
    failureReason?: string,
    options: { notify?: boolean } = {},
  ): Promise<SessionStatus | undefined> {
    // Idempotency Guard: If this session is already being stopped by another actor
    // (heartbeat, stream watchdog, plugin.deleteSession), skip to avoid double-cleanup.
    if (this.stoppingSessionIds.has(sessionId)) {
      log.info(
        `⏭️ onSessionStopped already in progress for ${sessionId}. Skipping duplicate call.`,
      );
      return undefined;
    }
    this.stoppingSessionIds.add(sessionId);

    try {
      log.info(`🟢 onSessionStopped called for session ${sessionId}`);
      // However the session ended, in memory or not, its sampler stops here,
      // and its device log is written to the end.
      await Container.get(SessionMetricsService).stop(sessionId);
      await Container.get(SessionDeviceLogs).stop(sessionId);

      // Video recording is now handled in plugin.ts deleteSession() before the session is deleted
      // This ensures we can call stop_recording_screen while the session is still active
      // Here we just handle the session status update

      const session: XenonSession | undefined = SESSION_MANAGER.getSession(sessionId);
      // The phone the session held, for its session_stopped event's scope:
      // read now, before the release below forgets it.
      const heldPhone = this.sessionToDevice.get(sessionId) ?? session?.getDevice();
      if (session) {
        log.info(`Session ${sessionId} found in SESSION_MANAGER`);

        // iOS profiling is now handled in plugin.ts deleteSession() before the session is deleted
        // This ensures we can call mobile: stopPerfRecord while the driver is still alive

        // Principal Resource Management: Unblock device immediately
        const device = this.sessionToDevice.get(sessionId);
        if (device) {
          const { releaseSessionDevice } = await import('../data-service/device-service');
          try {
            // This session's claim only: the phone may have gone on to another.
            await releaseSessionDevice(device.udid, device.host, sessionId);
            log.info(`🔓 [${sessionId}] Device ${device.udid} released.`);
          } catch (unblockErr: any) {
            const msg = unblockErr?.message ?? String(unblockErr);
            log.error(
              `⚠️ Failed to unblock device ${device.udid} for session ${sessionId}: ${msg}`,
              unblockErr,
            );
          }
          // #150: reclaim a stream the session left running so it doesn't linger
          // after the device is released (only if nobody is watching — see method).
          await this.stopIdleStreamForDevice(device);
        } else {
          const { releaseSessionDevices } = await import('../data-service/device-service');
          try {
            await releaseSessionDevices(sessionId);
            log.info(`🔓 [${sessionId}] Device released via session_id fallback.`);
          } catch (unblockErr: any) {
            const msg = unblockErr?.message ?? String(unblockErr);
            log.error(`⚠️ Failed to unblock device for session ${sessionId}: ${msg}`, unblockErr);
          }
        }

        // Final local cleanup to prevent state leaks
        this.sessionToDevice.delete(sessionId);
      } else {
        log.warn(`⚠️ Session ${sessionId} not found in SESSION_MANAGER`);
        // Fallback: If session not in manager, attempt to unblock by session_id in store
        const { releaseSessionDevices } = await import('../data-service/device-service');
        try {
          await releaseSessionDevices(sessionId);
          log.info(`🔓 [${sessionId}] Orphaned device released via session_id fallback.`);
        } catch (unblockErr: any) {
          const msg = unblockErr?.message ?? String(unblockErr);
          log.error(
            `⚠️ Failed to unblock device for orphaned session ${sessionId}: ${msg}`,
            unblockErr,
          );
        } finally {
          this.sessionToDevice.delete(sessionId);
        }
      }

      const sessionEntry = await getSessionById(sessionId);
      if (sessionEntry) {
        log.info(`Session ${sessionId} current status: ${sessionEntry.status}`);
        const updateData: any = {
          endTime: new Date(),
          has_live_video: false,
        };
        // Principal Intelligence: Determined final status based on command history
        if (status) {
          updateData['status'] = status;
          if (failureReason) updateData['failure_reason'] = failureReason;
        } else if (
          sessionEntry.status === SessionStatus.RUNNING ||
          !sessionEntry.status ||
          sessionEntry.status === SessionStatus.UNMARKED
        ) {
          // Check if any command failed in this session
          const failedCommand = await prisma.sessionLog.findFirst({
            where: { session_id: sessionId, is_error: true },
            orderBy: { createdAt: 'desc' },
          });

          if (failedCommand) {
            updateData['status'] = SessionStatus.FAILED;
            updateData['failure_reason'] =
              failedCommand.response && failedCommand.response.includes('error')
                ? safeParseJson(failedCommand.response).value?.error ||
                  `Command failed: ${failedCommand.command_name}`
                : `Command failed: ${failedCommand.command_name}`;
            log.info(
              `Session ${sessionId} marked as FAILED due to error in command: ${failedCommand.command_name}`,
            );
          } else {
            updateData['status'] = SessionStatus.SUCCESS;
            log.info(`Session ${sessionId} marked as SUCCESS`);
          }
        } else {
          // Principal Reliability: If the session already has a terminal status,
          // ensure we still use that status for metrics and events below.
          updateData['status'] = sessionEntry.status;
        }
        await updateSessionDetails(sessionId, updateData);
        log.info(`✅ Session ${sessionId} updated successfully`);

        // 🟢 Socket Events must happen AFTER DB update and MUST include a status
        // to ensure the UI row changes from 'RUNNING' to its final state.
        // Scoped by the exact phone: the one it held, else its row on the
        // session's node (sessionEventPhone).
        const stoppedPhone = await sessionEventPhone(sessionId, sessionEntry, {
          held: heldPhone,
        });
        void Container.get(SocketServer).emitToDashboardForDevices(
          SocketEvents.SESSION_STOPPED,
          {
            id: sessionId,
            status: updateData.status || sessionEntry.status || SessionStatus.SUCCESS,
            failure_reason: updateData.failure_reason || sessionEntry.failure_reason,
          },
          stoppedPhone,
        );

        // Principal Analytics: Increment Metrics AFTER emission
        if (updateData.status === SessionStatus.SUCCESS) {
          Container.get(MetricsService).incrementSessionSuccess();
        } else if (updateData.status === SessionStatus.FAILED) {
          Container.get(MetricsService).incrementSessionFailure();
        }

        // Webhooks: not awaited, since a slow or dead webhook must not hold up
        // the end of the session. The service sends once per session even
        // though a session can end twice (a crash, then the client's delete).
        if (updateData.status === SessionStatus.FAILED && options.notify !== false) {
          this.announceFailure({ ...sessionEntry, ...updateData });
        }
        // Every outcome (ENH-07), under the same rule as session_failed.
        if (options.notify !== false) {
          const ended = { ...sessionEntry, ...updateData };
          announce('session_stopped', sessionId, () =>
            Container.get(NotificationService).notifySessionStopped(ended),
          );
        }

        // Principal Triage: If session failed, perform intelligent failure analysis.
        // The category now; the AI's analysis is not awaited, since every way
        // a session ends waits for this method (the client's quit, a hub's
        // DELETE) and an AI call can take minutes. It is saved when it comes.
        if (updateData.status === SessionStatus.FAILED) {
          try {
            const { categorizeSessionFailure, explainSessionFailure } =
              await import('./services/failure-analysis-service');
            await categorizeSessionFailure(sessionId);
            void explainSessionFailure(sessionId);
          } catch (analysisErr: any) {
            log.warn(`⚠️ Failure analysis skipped for ${sessionId}: ${analysisErr.message}`);
          }
        }
        return updateData.status;
      } else {
        log.warn(`⚠️ Session ${sessionId} not found in database`);
      }
      return status;
    } finally {
      // Always release the idempotency lock so future cleanup calls
      // (e.g., manual recovery) can proceed if needed.
      this.stoppingSessionIds.delete(sessionId);
    }
  }

  /** Starts the `session_failed` webhooks; never throws and never waits for them. */
  private announceFailure(session: Session) {
    try {
      void Container.get(NotificationService)
        .notifySessionFailed(session)
        .catch((err: any) =>
          log.warn(`session_failed webhook for ${session.id} not sent: ${err?.message ?? err}`),
        );
    } catch (err: any) {
      log.warn(`session_failed webhook for ${session.id} not sent: ${err?.message ?? err}`);
    }
  }

  async beforeSessionCommand(
    sessionId: string,
    commandName: string | undefined,
    request: Request,
    response: Response,
  ): Promise<boolean> {
    if (commandName) {
      this.commandStartTime.set(`${sessionId}:${commandName}`, Date.now());
      log.debug(
        `[EventManager] beforeSessionCommand: sessionId=${sessionId}, commandName=${commandName}`,
      );
    }

    // The session-details commands (`xenon: setSessionName`, ...) are answered
    // here, from this server's record of the session, whether or not the
    // session is in memory. Every other `xenon:` script goes on: to the
    // plugin's CommandInterceptor on the server that drives the phone, which
    // a hub reaches by forwarding it. Taking them all here answered a node
    // phone's autowait, Omni-Vision and network-capture scripts with null on
    // the hub, and they never reached the node.
    if (commandName === 'execute') {
      const script =
        request.body?.script || (Array.isArray(request.body) ? request.body[0] : undefined);
      if (sessionDetailsCommandOf(script)) {
        log.info(`[EventManager] Intercepting Xenon command: ${script} for session ${sessionId}`);
        await dashboardCommands.process(sessionId, request, response);
        return false;
      } else if (typeof script === 'string' && script.includes(':')) {
        log.debug(
          `[EventManager] Script ${script} is not a session-details command; passing it on.`,
        );
      }
    }

    const session: XenonSession | undefined = SESSION_MANAGER.getSession(sessionId);

    if (!session) {
      log.debug(
        `[EventManager] No session object found in memory for ${sessionId}. Allowing command ${commandName} to proceed.`,
      );
      return true;
    }

    if (commandName === 'deleteSession') {
      // Video recording is handled in onSessionStoped() called after deleteSession
      // No need to handle it here to avoid race conditions
    }

    return true;
  }

  async afterSessionCommand(
    sessionId: string,
    commandName: string | undefined,
    driver: any | null,
    request: Request,
    response: Response,
    responseBody: string,
    healingInfo?: {
      originalSelector: string;
      originalStrategy?: string;
      healedSelector: string;
      healedStrategy?: string;
      confidence: number;
      tier?: number;
    },
  ) {
    const session: XenonSession | undefined = SESSION_MANAGER.getSession(sessionId);
    if (session) {
      try {
        // Save command log
        const parsedResponse: any = safeParseJson(responseBody) as any;
        const isSuccessResponse = !parsedResponse?.value?.error;

        // The command's own trace and span ids (TracingService.commandTraceIds):
        // its span's, else the trace context it was sent with, else its
        // session's.
        const { traceId, spanId } = Container.get(TracingService).commandTraceIds(session.getId());

        const startTime = this.commandStartTime.get(`${sessionId}:${commandName}`);
        const duration = startTime ? Date.now() - startTime : null;

        // A network-capture script keeps neither its arguments nor its answer,
        // a command marked sensitive neither, and typed text is masked where
        // the session or the server asks (commandPrivacy.ts).
        const privacy: CommandPrivacy = {
          sensitive: isInsideSensitiveCommand() || hasSensitiveMark((request as any)?.headers),
          maskInput: inputMasked(
            Container.get(PluginContext).pluginArgs?.maskInput,
            session.getXenonOption(XENON_CAPABILITIES.MASK_INPUT, false),
          ),
        };
        const recorded = commandLogFields(
          commandName,
          request.body,
          responseBody,
          isSuccessResponse,
          privacy,
        );
        const logEntry: any = {
          session_id: session.getId(),
          command_name: commandName || null,
          body: recorded.body,
          response: recorded.response,
          is_success: isSuccessResponse,
          is_error: !isSuccessResponse,
          method: request.method,
          title: this.getTitleFromCommandName(commandName),
          subtitle: '',
          screenshot: null,
          url: request.originalUrl,
          is_healed: !!healingInfo,
          original_selector: healingInfo?.originalSelector ?? null,
          healed_selector: healingInfo?.healedSelector ?? null,
          healing_confidence: healingInfo?.confidence ?? null,
          healing_tier: healingTierLabel(healingInfo?.tier),
          original_strategy: healingInfo?.originalStrategy ?? null,
          healed_strategy: healingInfo?.healedStrategy ?? null,
          span_id: spanId,
          trace_id: traceId,
          duration: duration,
        };

        // Smart Passive: capture strategy + selector on every findElement,
        // not just heals. CommandInterceptor synthesizes request.body = args
        // (the array [strategy, value]); a command a hub forwards to a node
        // has the client's own W3C body ({ using, value }). This gives the
        // verification job exact evidence of "selector ran and didn't heal"
        // per build.
        if (
          !privacy.sensitive &&
          (commandName === 'findElement' || commandName === 'findElements')
        ) {
          const body: any = request.body;
          const [strategy, selector] = Array.isArray(body)
            ? [body[0], body[1]]
            : [body?.using, body?.value];
          if (logEntry.original_strategy === null && typeof strategy === 'string') {
            logEntry.original_strategy = strategy;
          }
          if (logEntry.original_selector === null && typeof selector === 'string') {
            logEntry.original_selector = selector;
          }
        }

        // Increment Healing Metrics
        if (healingInfo) {
          Container.get(MetricsService).incrementHealingAttempt();
          if (isSuccessResponse) {
            Container.get(MetricsService).incrementHealingSuccess();
          }
        }

        if (startTime) {
          this.commandStartTime.delete(`${sessionId}:${commandName}`);
        }

        // Take screenshots for specific commands (like click, setValue, etc.)
        // OR on failure if SCREENSHOT_ON_FAILURE capability is enabled
        const shouldTakeScreenshotForCommand =
          commandName && config.takeScreenshotsFor.indexOf(commandName) >= 0;

        const screenShotCapability = session.getXenonOption(
          XENON_CAPABILITIES.SCREENSHOT_ON_FAILURE,
          false,
        );

        const screenshotEveryCommandCapability = session.getXenonOption(
          XENON_CAPABILITIES.SCREENSHOT_ON_EVERY_COMMAND,
          false,
        );

        const shouldTakeScreenshotOnFailure =
          !_.isNil(screenShotCapability) &&
          screenShotCapability.toString() === 'true' &&
          !isSuccessResponse;

        const shouldTakeScreenshotOnEveryCommand =
          !_.isNil(screenshotEveryCommandCapability) &&
          screenshotEveryCommandCapability.toString() === 'true';

        // No screenshot of a command marked sensitive: the screen may show
        // what it sent.
        if (
          !privacy.sensitive &&
          (shouldTakeScreenshotForCommand ||
            shouldTakeScreenshotOnFailure ||
            shouldTakeScreenshotOnEveryCommand)
        ) {
          let screenshotBase64: string | null = null;
          try {
            // Principal Intelligence: Always prefer session.getScreenShot() because it contains
            // platform-specific optimizations (like direct, high-speed ADB capture for Android).
            screenshotBase64 = await session.getScreenShot();
          } catch (err: any) {
            log.warn(
              `[Dashboard] Session-level screenshot failed for ${sessionId}: ${err.message}. Trying direct driver...`,
            );
            if (driver) {
              try {
                screenshotBase64 = await takeScreenshot(driver);
              } catch (driverErr: any) {
                log.error(`[Dashboard] Driver screenshot also failed: ${driverErr.message}`);
              }
            }
          }

          if (screenshotBase64) {
            logEntry['screenshot'] = saveScreenShot(session.getId(), screenshotBase64);
          }
        }

        const persistedLog = await prisma.sessionLog.create({
          data: logEntry as SessionLog,
        });

        // Emit command log event to dashboard. One per command: the phone's
        // team comes from DeviceTeamResolver's cache, not a query each time.
        // Its summary only: what the command typed and answered stays in the
        // SessionLog row above, which goes with the session.
        const device = session.getDevice();
        const phone = { udid: device?.udid, ...(device?.host ? { host: device.host } : {}) };
        void Container.get(SocketServer).emitToDashboardForDevices(
          SocketEvents.SESSION_COMMAND,
          sessionCommandSummary({ ...logEntry, session_id: session.getId() }),
          phone,
        );

        // Heal event broadcast — the shape returned by GET /healing/events,
        // so the Overview activity feed and Settings list can consume both
        // sources interchangeably without per-source field translation, plus
        // `deviceHost`, which only the live event carries: two servers can
        // have a phone of one udid. A reader of both must not count on it.
        if (logEntry.is_healed) {
          void Container.get(SocketServer).emitToDashboardForDevices(
            SocketEvents.HEALING_EVENT,
            {
              id: persistedLog.id,
              sessionId: session.getId(),
              deviceUdid: device?.udid ?? null,
              deviceHost: device?.host ?? null,
              deviceName: device?.name ?? null,
              devicePlatform: device?.platform ?? null,
              commandName: logEntry.command_name ?? null,
              originalSelector: logEntry.original_selector ?? null,
              healedSelector: logEntry.healed_selector ?? null,
              confidence: logEntry.healing_confidence ?? null,
              tier: logEntry.healing_tier ?? null,
              isSuccess: logEntry.is_success ?? null,
              createdAt: persistedLog.createdAt.toISOString(),
            },
            phone,
          );
        }

        // ENH-07: the heal to its webhooks, from its command's record, which
        // has a heal on this server's phone and a node's alike.
        if (logEntry.is_healed) {
          announce('healing_event', session.getId(), () =>
            Container.get(NotificationService).notifyHeal({
              sessionId: session.getId(),
              udid: device?.udid,
              deviceName: device?.name,
              platform: device?.platform,
              command: logEntry.command_name,
              originalStrategy: logEntry.original_strategy,
              originalSelector: logEntry.original_selector,
              healedStrategy: logEntry.healed_strategy,
              healedSelector: logEntry.healed_selector,
              tier: logEntry.healing_tier,
              confidence: logEntry.healing_confidence,
              time: persistedLog.createdAt,
            }),
          );
        }

        // Regression hook — fire-and-forget. Never block heal write on state lookup.
        // If the (original_strategy, original_selector) row is in pending/resolved,
        // SelectorStateService.onHealRecorded will flip it back to active with
        // regression_count++ and emit SELECTOR_REGRESSED.
        if (logEntry.is_healed && logEntry.original_strategy && logEntry.original_selector) {
          Container.get(SelectorStateService)
            .onHealRecorded({
              strategy: logEntry.original_strategy,
              selector: logEntry.original_selector,
              sessionId: session.getId(),
            })
            .catch((err: any) =>
              log.warn(
                `[SelectorState] regression hook failed for ${logEntry.original_strategy}:${logEntry.original_selector}: ${err.message}`,
              ),
            );
        }
      } catch (err: any) {
        log.error(
          `[Dashboard] Failed to process command telemetry for ${sessionId}: ${err.message}`,
        );
      }
    }
  }

  async onSessionLog(sessionId: string, logEntry: { level: string; message: string }) {
    await prisma.log.create({
      data: {
        session_id: sessionId,
        log_type: logEntry.level.toUpperCase(),
        message: logEntry.message,
        timestamp: new Date(),
      },
    });
  }

  private getTitleFromCommandName(commandName: string | undefined) {
    if (commandName) {
      return commandName.replace(/([A-Z])/g, ' $1').replace(/^./, function (str: string) {
        return str.toUpperCase();
      });
    }
    return undefined;
  }

  // ─── Recording (free-form mosaic) events ─────────────────────────────────
  // Emitted by RecordingOrchestrator. Distinct namespace from SESSION_*; the
  // dashboard listens to both independently. Team-scoped: a group's started
  // and stopped events reach each dashboard cut down to the phones it can see.
  public emitRecordingStarted(payload: {
    groupId: string;
    recordings: Array<{ id: string; udid: string; host: string }>;
    startedAt: Date;
  }): void {
    void Container.get(SocketServer).emitToDashboardForDevices(
      SocketEvents.RECORDING_STARTED,
      payload,
      recordingsScope(payload),
    );
  }

  public emitRecordingStopped(payload: {
    groupId: string;
    recordings: Array<{
      id: string;
      udid: string;
      host: string;
      status: string;
      durationMs?: number;
      sizeBytes?: number;
    }>;
  }): void {
    void Container.get(SocketServer).emitToDashboardForDevices(
      SocketEvents.RECORDING_STOPPED,
      payload,
      recordingsScope(payload),
    );
  }

  public emitRecordingBookmark(payload: { groupId: string; bookmark: unknown }): void {
    this.emitForRecording(SocketEvents.RECORDING_BOOKMARK_ADDED, payload, payload.bookmark);
  }

  public emitRecordingAnnotation(payload: { groupId: string; annotation: unknown }): void {
    this.emitForRecording(SocketEvents.RECORDING_ANNOTATION_ADDED, payload, payload.annotation);
  }

  /**
   * A mark is one phone's event: scoped by its recording's own udid and host,
   * looked up from the mark's `recording_id` (marks are occasional, so no
   * cache). A failed or empty lookup sends it with no udid, which reaches
   * admins only (fail closed).
   */
  private emitForRecording(event: string, payload: unknown, mark: unknown): void {
    const socket = Container.get(SocketServer);
    // Without a team-scoped dashboard (auth disabled) the udid would only be
    // looked up to be ignored: send it now, as the old broadcast did.
    if (!socket.hasScopedDashboard()) {
      void socket.emitToDashboardForDevices(event, payload, { udid: undefined });
      return;
    }
    const recordingId = (mark as { recording_id?: unknown } | null)?.recording_id;
    const phone: Promise<EventPhone | undefined> =
      typeof recordingId === 'string'
        ? Container.get(RecordingStore)
            .findVideo(recordingId)
            .then(
              (r) => (r ? { udid: r.device_udid, host: r.device_host } : undefined),
              () => undefined,
            )
        : Promise.resolve(undefined);
    void phone.then((p) =>
      socket.emitToDashboardForDevices(event, payload, p ?? { udid: undefined }),
    );
  }

  public emitRecordingFailed(payload: {
    groupId: string;
    recordingId: string;
    udid: string;
    host: string;
    reason: string;
  }): void {
    void Container.get(SocketServer).emitToDashboardForDevices(
      SocketEvents.RECORDING_FAILED,
      payload,
      { udid: payload.udid, host: payload.host },
    );
  }
}

/**
 * A group event's phones (each recording's udid and host), and how to cut its
 * payload down to the recordings of the visible ones, by udid and host: two
 * servers' emulator-5554 are two phones, each with its own team.
 */
function recordingsScope<T extends { recordings: Array<{ udid: string; host: string }> }>(
  payload: T,
) {
  return {
    phones: payload.recordings.map((r) => ({ udid: r.udid, host: r.host })),
    strip: (data: T, visible: EventPhone[]): T => ({
      ...data,
      recordings: data.recordings.filter((r) =>
        visible.some((p) => p.udid === r.udid && p.host === r.host),
      ),
    }),
  };
}

export const DASHBORD_EVENT_MANAGER = Container.get(DashboardEventManager);
