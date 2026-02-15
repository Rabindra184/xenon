/* eslint-disable no-prototype-builtins */
import 'reflect-metadata';
import commands from './commands/index';
import BasePlugin from '@appium/base-plugin';
import { IDevice } from './interfaces/IDevice';
import { ISessionCapability } from './interfaces/ISessionCapability';
import AsyncLock from 'async-lock';
import { unblockDeviceMatchingFilter } from './data-service/device-service';
import { Container } from 'typedi';
import log, { XenonLogger } from './logger';
import ip from 'ip';
import _ from 'lodash';
import { SessionStatus } from './types/SessionStatus';
import { HealingOrchestrator } from './services/healing/HealingOrchestrator';
import { HealEtalonService } from './services/healing/HealEtalonService';
import { OmniVisionService } from './services/omni-vision/OmniVisionService';
import { ConfigService } from './data-service/config-service';
import { AICommandService } from './services/AICommandService';
import { VisionAssertionService } from './services/omni-vision/VisionAssertionService';
import { TracingService } from './services/TracingService';
import { CommandInterceptor } from './interceptors/CommandInterceptor';
import { SessionLifecycleService } from './services/SessionLifecycleService';
import { ServerManager } from './services/ServerManager';
import { DefaultPluginArgs, IPluginArgs } from './interfaces/IPluginArgs';
import { ServerArgs } from '@appium/types';
import { IDeviceFilterOptions } from './interfaces/IDeviceFilterOptions';
import NodeDevices from './device-managers/NodeDevices';
import { SESSION_MANAGER } from './sessions/SessionManager';
import { DASHBORD_EVENT_MANAGER } from './dashboard/event-manager';
import { saveVideoRecording } from './dashboard/asset-manager';
import { updateSessionDetails } from './dashboard/services/session-service';

const DEVICE_MANAGER_LOCK_NAME = 'DeviceManager';

class XenonPlugin extends BasePlugin {
  static nodeBasePath = '';
  public static newMethodMap = {
    '/session/:sessionId/xenon/analyze': {
      POST: { command: 'analyzeScreen' },
    },
    '/session/:sessionId/xenon/assert': {
      POST: { command: 'assertVisualState' },
    },
    '/session/:sessionId/xenon/omni-scan': {
      GET: { command: 'omniScan' },
    },
    '/session/:sessionId/xenon/test-locator': {
      POST: { command: 'testAiLocator' },
    },
  };
  static port: number;
  private xenonLog = log.scope('Plugin');
  private pluginArgs: IPluginArgs = Object.assign({}, DefaultPluginArgs);
  public static NODE_ID: string;
  public static IS_HUB = false;
  private aiCommandService = Container.get(AICommandService);

  constructor(pluginName: string, cliArgs: any) {
    super(pluginName, cliArgs);
    this.xenonLog.debug(`📱 Plugin Args: ${JSON.stringify(cliArgs)}`);
    this.pluginArgs = Object.assign({}, DefaultPluginArgs, this.cliArgs as unknown as IPluginArgs);

    XenonLogger.configure({ enableJsonLogging: this.pluginArgs.enableJsonLogging });

    if (this.pluginArgs.bindHostOrIp === undefined) {
      this.pluginArgs.bindHostOrIp = ip.address();
    }
  }

  /**
   * Intercepts all commands for local sessions to capture logs
   */
  async handle(next: () => any, driver: any, commandName: string, ...args: any) {
    return await Container.get(CommandInterceptor).handle(
      next,
      driver,
      commandName,
      args,
      this.pluginArgs,
      XenonPlugin.IS_HUB,
    );
  }

  async onUnexpectedShutdown(driver: any, _cause: any) {
    const sessionId = driver.sessionId;
    const deviceFilter = {
      session_id: sessionId ? sessionId : undefined,
      udid: driver.caps && driver.caps.udid ? driver.caps.udid : undefined,
    } as unknown as IDeviceFilterOptions;

    if (this.pluginArgs.hub !== undefined) {
      await new NodeDevices(this.pluginArgs.hub, this.pluginArgs.tlsRejectUnauthorized).unblockDevice(
        deviceFilter as any,
      );
    } else {
      await unblockDeviceMatchingFilter(deviceFilter);
    }

    log.info(
      `Unblocking device mapped with filter ${JSON.stringify(deviceFilter)} onUnexpectedShutdown from server`,
    );

    if (XenonPlugin.IS_HUB && this.pluginArgs.enableDashboard && sessionId) {
      const sessionLog = this.xenonLog.withSession(sessionId, driver.caps?.udid);
      sessionLog.info('Unexpected shutdown for session, updating dashboard...');

      const session = SESSION_MANAGER.getSession(sessionId);
      if (session && session.isVideoRecordingInProgress()) {
        try {
          const videoBase64 = await session.stopVideoRecording(driver);
          if (videoBase64) {
            const videoPath = saveVideoRecording(sessionId, videoBase64);
            await updateSessionDetails(sessionId, { video_recording: videoPath });
          }
        } catch (err: any) {
          log.debug(`[${sessionId}] rescue-video: Failed: ${err.message}`);
        }
      }

      await DASHBORD_EVENT_MANAGER.onSessionStoped(
        sessionId,
        SessionStatus.FAILED,
        'Driver shut down unexpectedly',
      );
      Container.get(TracingService).endSpan(sessionId, 'ERROR', {
        'xenon.session.stop_reason': 'Unexpected shutdown',
      });
    }
  }

  public static async updateServer(
    expressApp: any,
    httpServer: any,
    cliArgs: ServerArgs,
  ): Promise<void> {
    await Container.get(ServerManager).updateServer(expressApp, httpServer, cliArgs);
    XenonPlugin.IS_HUB = ServerManager.IS_HUB;
  }

  async createSession(
    next: () => any,
    driver: any,
    jwpDesCaps: any,
    jwpReqCaps: any,
    caps: ISessionCapability,
  ) {
    return await Container.get(SessionLifecycleService).createSession(next, driver, caps);
  }

  async deleteSession(next: () => any, sessionId: string) {
    return await Container.get(SessionLifecycleService).deleteSession(next, sessionId);
  }

  async analyzeScreen(sessionId: string, driver: any) {
    return await this.aiCommandService.analyzeScreen(driver);
  }

  async assertVisualState(sessionId: string, driver: any, instruction: string) {
    return await this.aiCommandService.assertVisualState(driver, instruction);
  }

  async omniScan(sessionId: string, driver: any) {
    return await this.aiCommandService.omniScan(driver);
  }

  async testAiLocator(
    sessionId: string,
    driver: any,
    locator: { strategy: string; selector: string },
  ) {
    return await this.aiCommandService.testAiLocator(driver, locator);
  }
}

Object.assign(XenonPlugin.prototype, commands);
export { XenonPlugin };
