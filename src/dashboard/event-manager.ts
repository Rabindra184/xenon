import { Request, Response } from 'express';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { IDevice } from '../interfaces/IDevice';
import { prisma } from '../prisma';
import log from '../logger';
import {
  getOrCreateNewBuild,
  getSessionById,
  updateSessionDetails,
} from './services/session-service';
import { XENON_CAPABILITIES } from '../XenonCapabilityManager';
import _ from 'lodash';
import { safeParseJson } from '../helpers';
import { prepareDirectory, savePerformanceTrace, saveScreenShot } from './asset-manager';
import { dashboardCommands } from './commands';
import { SessionStatus } from '../types/SessionStatus';
import { SessionLog, Session, Prisma } from '@prisma/client';
import { XenonSession } from '../sessions/XenonSession';
import { services as iosDeviceServices } from 'appium-ios-device';
import { AndroidAppProfiler } from '../profiling/AndroidAppProfiler';
import { ADB } from 'appium-adb';
import { config } from '../config';
import { takeScreenshot } from '../helpers';
import { Container } from 'typedi';
import { XenonManager } from '../device-managers';
import AndroidDeviceManager from '../device-managers/AndroidDeviceManager';
import { SocketServer } from '../services/SocketServer';
import { TracingService } from '../services/TracingService';
import { MetricsService } from '../services/MetricsService';
import { SocketEvents } from '../enums/SocketEvents';
import { Service } from 'typedi';

@Service()
export class DashboardEventManager {
  // private SCREENSHOT_FOR_COMMANDS = ['click', 'setUrl', 'setValue', 'performActions'];

  // Store syslog services for real iOS devices
  private syslogServices: Map<string, any> = new Map();
  // Map session ID to UDID for cleanup
  private sessionToUdid: Map<string, string> = new Map();
  // Map session ID to device info
  private sessionToDevice: Map<string, IDevice> = new Map();
  // Store app profilers for Android sessions
  private appProfilers: Map<string, AndroidAppProfiler> = new Map();
  // Track last log line for each session (for device logs)
  private lastLogLine: Map<string, number> = new Map();
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

    // Initialize app profiling for Android sessions
    const { is_profiling_available, device_info } = await this.startAppProfiling(
      session.getId(),
      device,
      session.getCapabilities(),
    );

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
      desired_capabilities: JSON.stringify(sessionResponse.desired || {}),
      session_capabilities: JSON.stringify(_.omit(sessionResponse, 'desired')),
      node_id: device.nodeId || '',
      has_live_video: session.getLiveVideoUrl() !== null,
      video_recording_enabled: capabilities[XENON_CAPABILITIES.VIDEO_RECORDING] === true,
      is_profiling_available: is_profiling_available || isIosProfilingStarted,
      device_info: device_info ? JSON.stringify(device_info) : null,
      device_udid: device.udid || '',
      device_platform: device.platform || '',
      device_version: device.sdk || '',
      device_name: device.name,
      trace_id: traceId,
      status: 'running', // Principal Polish: Set status explicitly
    };

    await prisma.session.create({
      data: createData,
    });

    // Emit session started event
    Container.get(SocketServer).emitToDashboard(SocketEvents.SESSION_STARTED, {
      ...createData,
      status: 'running', // Principal Polish: Ensure frontend gets status
      build_name: buildName,
    });

    // Increment Metrics
    Container.get(MetricsService).incrementSessionStart();
  }

  async onSessionStopped(sessionId: string, status?: SessionStatus, failureReason?: string) {
    // Idempotency Guard: If this session is already being stopped by another actor
    // (heartbeat, stream watchdog, plugin.deleteSession), skip to avoid double-cleanup.
    if (this.stoppingSessionIds.has(sessionId)) {
      log.info(
        `⏭️ onSessionStopped already in progress for ${sessionId}. Skipping duplicate call.`,
      );
      return;
    }
    this.stoppingSessionIds.add(sessionId);

    try {
      log.info(`🟢 onSessionStopped called for session ${sessionId}`);

      // Video recording is now handled in plugin.ts deleteSession() before the session is deleted
      // This ensures we can call stop_recording_screen while the session is still active
      // Here we just handle the session status update

      const session: XenonSession | undefined = SESSION_MANAGER.getSession(sessionId);
      if (session) {
        log.info(`Session ${sessionId} found in SESSION_MANAGER`);

        // Save Android profiling data before cleanup
        await this.saveAppProfilingData(sessionId);

        // iOS profiling is now handled in plugin.ts deleteSession() before the session is deleted
        // This ensures we can call mobile: stopPerfRecord while the driver is still alive

        // Clean up syslog service for real iOS devices
        const udid = this.sessionToUdid.get(sessionId);
        if (udid) {
          try {
            this.syslogServices.delete(udid);
            this.sessionToUdid.delete(sessionId);
            log.info(`Cleaned up syslog service for device ${udid}`);
          } catch (err) {
            log.debug(`Error cleaning up syslog service info: ${err}`);
          }
        }

        // Clean up last log line tracking
        this.lastLogLine.delete(sessionId);

        // Principal Resource Management: Unblock device immediately
        const device = this.sessionToDevice.get(sessionId);
        if (device) {
          const { unblockDevice } = await import('../data-service/device-service');
          try {
            await unblockDevice(device.udid, device.host);
            log.info(`🔓 [${sessionId}] Device ${device.udid} released.`);
          } catch (unblockErr: any) {
            const msg = unblockErr?.message ?? String(unblockErr);
            log.error(
              `⚠️ Failed to unblock device ${device.udid} for session ${sessionId}: ${msg}`,
              unblockErr,
            );
          }
        } else {
          const { unblockDeviceMatchingFilter } = await import('../data-service/device-service');
          try {
            await unblockDeviceMatchingFilter({ session_id: sessionId });
            log.info(`🔓 [${sessionId}] Device released via session_id fallback.`);
          } catch (unblockErr: any) {
            const msg = unblockErr?.message ?? String(unblockErr);
            log.error(`⚠️ Failed to unblock device for session ${sessionId}: ${msg}`, unblockErr);
          }
        }

        // Final local cleanup to prevent state leaks
        this.sessionToDevice.delete(sessionId);
        this.lastLogLine.delete(sessionId);
        const orphanUdid = this.sessionToUdid.get(sessionId);
        if (orphanUdid) {
          this.sessionToUdid.delete(sessionId);
          this.syslogServices.delete(orphanUdid);
        }
      } else {
        log.warn(`⚠️ Session ${sessionId} not found in SESSION_MANAGER`);
        // Fallback: If session not in manager, attempt to unblock by session_id in store
        const { unblockDeviceMatchingFilter } = await import('../data-service/device-service');
        try {
          await unblockDeviceMatchingFilter({ session_id: sessionId });
          log.info(`🔓 [${sessionId}] Orphaned device released via session_id fallback.`);
        } catch (unblockErr: any) {
          const msg = unblockErr?.message ?? String(unblockErr);
          log.error(
            `⚠️ Failed to unblock device for orphaned session ${sessionId}: ${msg}`,
            unblockErr,
          );
        } finally {
          this.sessionToDevice.delete(sessionId);
          this.lastLogLine.delete(sessionId);
          const orphanUdid = this.sessionToUdid.get(sessionId);
          if (orphanUdid) {
            this.sessionToUdid.delete(sessionId);
            this.syslogServices.delete(orphanUdid);
          }
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
        Container.get(SocketServer).emitToDashboard(SocketEvents.SESSION_STOPPED, {
          id: sessionId,
          status: updateData.status || sessionEntry.status || SessionStatus.SUCCESS,
          failure_reason: updateData.failure_reason || sessionEntry.failure_reason,
        });

        // Principal Analytics: Increment Metrics AFTER emission
        if (updateData.status === SessionStatus.SUCCESS) {
          Container.get(MetricsService).incrementSessionSuccess();
        } else if (updateData.status === SessionStatus.FAILED) {
          Container.get(MetricsService).incrementSessionFailure();
        }

        // Principal Triage: If session failed, perform intelligent failure analysis
        if (updateData.status === SessionStatus.FAILED) {
          try {
            const { analyzeSessionFailure } = await import('./services/failure-analysis-service');
            await analyzeSessionFailure(sessionId);
          } catch (analysisErr: any) {
            log.warn(`⚠️ Failure analysis skipped for ${sessionId}: ${analysisErr.message}`);
          }
        }
      } else {
        log.warn(`⚠️ Session ${sessionId} not found in database`);
      }
    } finally {
      // Always release the idempotency lock so future cleanup calls
      // (e.g., manual recovery) can proceed if needed.
      this.stoppingSessionIds.delete(sessionId);
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

    // Principal Interception: Handle Xenon-specific commands regardless of session state in memory
    if (commandName === 'execute') {
      const script =
        request.body?.script || (Array.isArray(request.body) ? request.body[0] : undefined);
      if (script && dashboardCommands.isDashboardCommand(script)) {
        log.info(`[EventManager] Intercepting Xenon command: ${script} for session ${sessionId}`);
        await dashboardCommands.process(sessionId, request, response);
        return false;
      } else if (script && script.includes(':')) {
        log.debug(
          `[EventManager] Custom command ${script} not handled by Xenon. Passing to driver.`,
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
      healedSelector: string;
      confidence: number;
    },
  ) {
    const session: XenonSession | undefined = SESSION_MANAGER.getSession(sessionId);
    if (session) {
      try {
        // Save device logs (only if driver is available)
        if (driver) {
          await this.saveDeviceLogs(sessionId, driver);
        }

        // Save command log
        const parsedResponse: any = safeParseJson(responseBody) as any;
        const isSuccessResponse = !parsedResponse?.value?.error;

        const tracingService = Container.get(TracingService);
        const spanId = tracingService.getSpanId(`${session.getId()}:${commandName}`);
        const traceId = tracingService.getTraceId(session.getId());

        const startTime = this.commandStartTime.get(`${sessionId}:${commandName}`);
        const duration = startTime ? Date.now() - startTime : null;

        const logEntry: any = {
          session_id: session.getId(),
          command_name: commandName || null,
          body: JSON.stringify(request.body),
          response: responseBody,
          is_success: isSuccessResponse,
          is_error: !isSuccessResponse,
          method: request.method,
          title: this.getTitleFromCommandName(commandName),
          subtitle: '',
          screenshot: null,
          url: request.originalUrl,
          is_healed: !!healingInfo,
          original_selector: healingInfo?.originalSelector || null,
          healed_selector: healingInfo?.healedSelector || null,
          healing_confidence: healingInfo?.confidence || null,
          span_id: spanId,
          trace_id: traceId,
          duration: duration,
        };

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

        if (
          shouldTakeScreenshotForCommand ||
          shouldTakeScreenshotOnFailure ||
          shouldTakeScreenshotOnEveryCommand
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

        await prisma.sessionLog.create({
          data: logEntry as SessionLog,
        });

        // Emit command log event to dashboard
        Container.get(SocketServer).emitToDashboard(SocketEvents.SESSION_COMMAND, {
          session_id: session.getId(),
          ...logEntry,
        });
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

  private async getDeviceLogs(driver: any, sessionId: string): Promise<any[]> {
    try {
      if (!driver || !driver.caps || !driver.caps.automationName) {
        return [];
      }

      const automationName = driver.caps.automationName.toLowerCase();

      // Get device info for this session
      const device = this.sessionToDevice.get(sessionId);

      // Use Appium driver's extractLogs method for proper log extraction
      if (automationName === 'xcuitest' && typeof driver.extractLogs === 'function') {
        try {
          // Check if this is a real iOS device using device.realDevice property
          const isRealDevice = device?.realDevice === true;

          log.debug(
            `Device info for session ${sessionId} - isRealDevice: ${isRealDevice}, deviceType: ${device?.deviceType}, UDID: ${device?.udid}`,
          );

          if (isRealDevice) {
            // For real iOS devices, use appium-ios-device syslog service
            const udid = driver.caps.udid;

            // Track session to UDID mapping for cleanup
            this.sessionToUdid.set(sessionId, udid);

            // If we don't have a syslog service for this device yet, start one
            if (!this.syslogServices.has(udid)) {
              try {
                const syslogService = await iosDeviceServices.startSyslogService(udid);
                const logs: string[] = [];

                // Start listening to logs and buffer them
                syslogService.start((logLine: string) => {
                  logs.push(logLine);
                });

                // Store the service and logs
                this.syslogServices.set(udid, { service: syslogService, logs });
                log.info(`Started syslog service for real iOS device ${udid}`);
              } catch (err) {
                log.debug(`Could not start syslog service for real device: ${err}`);
                return [];
              }
            }

            // Return the buffered logs
            const deviceData = this.syslogServices.get(udid);
            if (deviceData && deviceData.logs) {
              const currentLogs = [...deviceData.logs];
              // Clear the buffer after retrieving
              deviceData.logs.length = 0;
              return currentLogs.map((logLine) => ({ message: logLine, timestamp: Date.now() }));
            }

            return [];
          }

          // For iOS simulators, extract syslog
          const logs = await driver.extractLogs('syslog');
          return Array.isArray(logs) ? logs : [];
        } catch (err) {
          log.debug(`Could not extract syslog: ${err}`);
          return [];
        }
      } else if (automationName === 'uiautomator2' || device?.platform === 'android') {
        try {
          if (typeof driver.extractLogs === 'function') {
            const logs = await driver.extractLogs('logcat');
            if (Array.isArray(logs) && logs.length > 0) {
              return logs;
            }
          }
        } catch (err) {
          log.debug(`Could not extract logcat via driver: ${err}. Trying direct ADB...`);
        }

        // Principal Intelligence: Fallback to direct ADB logs if driver fails or returns nothing
        if (device?.udid) {
          try {
            const deviceManager = Container.get(XenonManager);
            const androidManager = (await deviceManager.deviceInstances()).find(
              (m) => m instanceof AndroidDeviceManager,
            ) as AndroidDeviceManager;

            if (androidManager) {
              const rawLogs = await androidManager.getLogs(device.udid);
              if (rawLogs && typeof rawLogs === 'string') {
                const logLines = rawLogs.split('\n').filter((l) => l.trim().length > 0);
                // Convert string lines to expected format (last 100 lines to avoid DB bloat)
                return logLines.slice(-100).map((line) => ({
                  message: line,
                  timestamp: Date.now(),
                  level: 'INFO',
                }));
              }
            }
          } catch (adbErr: any) {
            log.debug(`Direct ADB log fetch failed for ${device.udid}: ${adbErr.message}`);
          }
        }
      }

      return [];
    } catch (error) {
      log.error(`Error getting device logs: ${error}`);
      return [];
    }
  }
  private async saveDeviceLogs(sessionId: string, driver: any) {
    try {
      const logs = await this.getDeviceLogs(driver, sessionId);
      if (!logs || logs.length === 0) {
        return;
      }

      const lastLine = this.lastLogLine.get(sessionId) || 0;
      const newLogs = logs.slice(lastLine);

      if (newLogs.length === 0) {
        return;
      }

      this.lastLogLine.set(sessionId, logs.length);

      // Save device logs to database
      const logEntries = newLogs.map((logItem: any) => ({
        session_id: sessionId,
        log_type: 'DEVICE',
        message: typeof logItem === 'string' ? logItem : logItem.message || JSON.stringify(logItem),
        timestamp: logItem.timestamp ? new Date(logItem.timestamp) : new Date(),
      }));

      if (logEntries.length > 0) {
        for (const logEntry of logEntries) {
          await prisma.log.create({
            data: logEntry,
          });
        }
      }
    } catch (error: any) {
      log.error(`Error saving device logs: ${error.message}`);
    }
  }

  private async startAppProfiling(
    sessionId: string,
    device: IDevice,
    sessionCapabilities: any,
  ): Promise<{ is_profiling_available: boolean; device_info?: any }> {
    // Only support Android profiling
    if (device.platform.toLowerCase() !== 'android') {
      return { is_profiling_available: false };
    }

    // Check if we have an app package
    const appPackage =
      sessionCapabilities?.appPackage || sessionCapabilities?.['appium:appPackage'];
    if (!appPackage) {
      log.info(`[Profiling] No app package found for session ${sessionId}, skipping profiling`);
      return { is_profiling_available: false };
    }

    try {
      // Principal Intelligence: Use the Properly configured ADB from the manager
      // instead of a naked instance, to avoid 'defaultArgs not iterable' crashes.
      const deviceManager = Container.get(XenonManager);
      const androidManager = (await deviceManager.deviceInstances()).find(
        (m) => m instanceof AndroidDeviceManager,
      ) as AndroidDeviceManager;

      let adb: ADB;
      if (androidManager) {
        adb = await androidManager.getAdbForDevice(device.udid);
      } else {
        adb = await ADB.createADB({});
      }

      // Create app profiler
      const profiler = new AndroidAppProfiler({
        adb,
        deviceUDID: device.udid,
        appPackage,
      });

      // Get device info and start capture
      const device_info = await profiler.getDeviceInfo();
      await profiler.startCapture();

      // Store profiler for this session
      this.appProfilers.set(sessionId, profiler);

      log.info(`[Profiling] Started app profiling for session ${sessionId}`);
      return {
        is_profiling_available: true,
        device_info,
      };
    } catch (err: any) {
      log.error(
        `[Profiling] Error initializing app profiler for session ${sessionId}: ${err.message}`,
      );
      return { is_profiling_available: false };
    }
  }

  private async saveAppProfilingData(sessionId: string): Promise<void> {
    const profiler = this.appProfilers.get(sessionId);
    if (!profiler) {
      return;
    }

    try {
      // Stop capture
      await profiler.stopCapture();

      // Get logs
      const logs = profiler.getLogs();
      if (logs.length === 0) {
        log.info(`[Profiling] No profiling data to save for session ${sessionId}`);
        return;
      }

      // Save to database
      const profilingEntries = logs.map((log) => ({
        session_id: sessionId,
        cpu: log.cpu,
        memory: log.memory,
        total_cpu_used: log.total_cpu_used.toString(),
        total_memory_used: log.total_memory_used.toString(),
        raw_cpu_log: log.raw_cpu_log,
        raw_memory_log: log.raw_memory_log,
        timestamp: new Date(log.timestamp),
      }));

      // Batch insert profiling data
      for (const entry of profilingEntries) {
        await prisma.profiling.create({
          data: entry,
        });
      }

      log.info(
        `[Profiling] Saved ${profilingEntries.length} profiling entries for session ${sessionId}`,
      );
    } catch (err: any) {
      log.error(`[Profiling] Error saving profiling data for session ${sessionId}: ${err.message}`);
    } finally {
      // Clean up profiler
      this.appProfilers.delete(sessionId);
    }
  }
}

export const DASHBORD_EVENT_MANAGER = Container.get(DashboardEventManager);
