/* eslint-disable no-prototype-builtins */
import {
  verifyLocator,
  type DriverLike,
  type VerifyAction,
} from './services/inspector/verifyLocator';
import 'reflect-metadata';
import commands from './commands/index';
import BasePlugin from '@appium/base-plugin';
import { IDevice } from './interfaces/IDevice';
import { ISessionCapability } from './interfaces/ISessionCapability';
import AsyncLock from 'async-lock';
import { releaseSessionDevices, unblockDeviceMatchingFilter } from './data-service/device-service';
import { Container } from 'typedi';
import log, { XenonLogger } from './logger';
import { resolveAdvertisedBindHost, shouldAutoResolveBindHost } from './helpers/networkAddresses';
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
import { SessionAllocation, SessionLifecycleService } from './services/SessionLifecycleService';
import { currentCreateHandoff } from './gateway/createHandoff';
import { ServerManager } from './services/ServerManager';
import { DefaultPluginArgs, IPluginArgs } from './interfaces/IPluginArgs';
import { ServerArgs } from '@appium/types';
import { IDeviceFilterOptions } from './interfaces/IDeviceFilterOptions';
import NodeDevices from './device-managers/NodeDevices';
import { AppiumUmbrella } from './sessions/appiumUmbrella';
import { LiveSessionOwners } from './services/device-access/LiveSessionOwners';
import { SessionMetricsService } from './services/metrics/SessionMetricsService';
import { PhoneNetworkRestore } from './services/network/PhoneNetworkRestore';
import { config as xenonConfig } from './config';
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
    // Verify a STANDARD Appium locator against the live driver. Distinct from
    // test-locator above, which only handles the -custom:ai-* strategies: this
    // is the one that answers "will Appium find this", because it asks Appium.
    '/session/:sessionId/xenon/verify-locator': {
      POST: {
        command: 'verifyLocator',
        // payloadParams is REQUIRED for Appium to map the JSON body onto the
        // command's arguments. Without it the command is called with none and
        // every request fails validation regardless of what was sent — which
        // is what `test-locator` above does today; it is unused, so nobody
        // hit it.
        payloadParams: {
          required: ['strategy', 'selector'],
          optional: ['action', 'text'],
        },
      },
    },
    // Xenon Omni-Interaction: Enterprise-grade AI/OCR actions
    '/session/:sessionId/xenon/omni-click': {
      POST: { command: 'omniClick' },
    },
    // Xenon Smart Interaction: clearer, primary name (alias of omniClick)
    '/session/:sessionId/xenon/smart-tap': {
      POST: { command: 'smartTap' },
    },
    // Xenon UI Scan: Rich OCR-driven UI metadata export
    '/session/:sessionId/xenon/ui-scan-export': {
      POST: { command: 'uiScanExport' },
    },
    // Xenon UI Inventory: clearer, primary name (alias of uiScanExport)
    '/session/:sessionId/xenon/ui-inventory': {
      POST: { command: 'uiInventory' },
    },

    // Compatibility aliases (Lens-style client code can keep working)
    // These do NOT change Xenon's public naming; they are optional shims.
    '/session/:sessionId/plugin/ai-appium-lens/aiClick': {
      POST: { command: 'smartTap' },
    },
    '/session/:sessionId/plugin/ai-appium-lens/fetchUIElementsMetadataJson': {
      POST: { command: 'uiInventory' },
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

    // The option as it was given, not the merged copy above: JSON logging is on
    // when the option says so, or when it isn't given and XENON_JSON_LOGGING does.
    // schema.json gives the option no default, so Appium leaves it out when
    // nobody set it; a default here (the merge above used to add `false`) would
    // overwrite the variable on every start. `configure` ignores undefined.
    const jsonLogging = (this.cliArgs as Partial<IPluginArgs> | undefined)?.enableJsonLogging;
    XenonLogger.configure({
      enableJsonLogging: typeof jsonLogging === 'boolean' ? jsonLogging : undefined,
    });

    if (shouldAutoResolveBindHost(this.pluginArgs.bindHostOrIp)) {
      this.pluginArgs.bindHostOrIp = resolveAdvertisedBindHost(this.pluginArgs.bindHostOrIp);
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
    Container.get(LiveSessionOwners).forget(sessionId);
    if (sessionId) await Container.get(SessionMetricsService).stop(sessionId);
    // Appium's new-command timeout ends a session here, not in deleteSession:
    // the phone's network (profile, interceptor proxy) and the capture are
    // put back before the phone is released.
    await Container.get(PhoneNetworkRestore).restoreSession(sessionId, 'driver shut down');
    const deviceFilter = {
      session_id: sessionId ? sessionId : undefined,
      udid: driver.caps && driver.caps.udid ? driver.caps.udid : undefined,
    } as unknown as IDeviceFilterOptions;

    if (this.pluginArgs.hub !== undefined) {
      await new NodeDevices(this.pluginArgs.hub, {
        tlsRejectUnauthorized: this.pluginArgs.tlsRejectUnauthorized,
        hubAccessKey: xenonConfig.hubAccessKey,
        hubToken: xenonConfig.hubToken,
      }).unblockDevice(deviceFilter as any);
    } else if (sessionId) {
      // Keyed on the session: its phone may be another session's by now.
      await releaseSessionDevices(sessionId);
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
          const videoData = await session.stopVideoRecording(driver);
          if (videoData) {
            let videoPath = videoData;
            // Principal Heuristic: If it's data (>1000 chars), save it. If it's short, it's a path.
            if (videoData.length > 1000) {
              videoPath = saveVideoRecording(sessionId, videoData);
            }
            await updateSessionDetails(sessionId, { video_recording: videoPath });
          }
        } catch (err: any) {
          log.debug(`[${sessionId}] rescue-video: Failed: ${err.message}`);
        }
      }

      await DASHBORD_EVENT_MANAGER.onSessionStopped(
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

    // Mark any orphan free-form recordings (from a previous process) FAILED
    // and release their manual blocks, mirroring the existing session cleanup.
    try {
      const { RecordingOrchestrator } = await import('./services/recording/RecordingOrchestrator');
      await Container.get(RecordingOrchestrator).recoverOnBoot();
    } catch (err: any) {
      log.warn(`[plugin] RecordingOrchestrator.recoverOnBoot failed: ${err?.message}`);
    }
    // Leftover go-ios is reaped by ServerManager.updateServer, before device
    // detection starts: here, the reap killed detection's own go-ios calls.
  }

  async createSession(
    next: () => any,
    driver: any,
    jwpDesCaps: any,
    jwpReqCaps: any,
    caps: ISessionCapability,
  ) {
    // W3C lets clients omit `firstMatch` (it defaults to [{}]). Normalize once at the
    // entry point so downstream code can rely on `firstMatch[0]` without guarding.
    if (caps && (!Array.isArray(caps.firstMatch) || caps.firstMatch.length === 0)) {
      caps.firstMatch = [{}];
    }
    // The umbrella: where a node answers the hub's "does this session exist"
    // without sending the session a command (gateway/nodeSessionStatus.ts).
    Container.get(AppiumUmbrella).note(driver);
    const lifecycle = Container.get(SessionLifecycleService);

    // The session gateway allocated this request's phone in front of Appium's
    // route (gateway/sessionCreate.ts) and handed it here through the
    // request's async context. It only ever hands over a phone this server
    // drives: it creates a node's session itself and answers it, so Appium
    // never has to hold a session it has no driver for.
    const handoff = currentCreateHandoff<SessionAllocation>();
    if (handoff) return await lifecycle.completeLocalSession(handoff.take(), next, driver, caps);

    // A create that did not come through the gateway (it could not be placed
    // ahead of Appium's routes). A phone this server drives is still created
    // here; one on another server is refused, since answering for Appium
    // without calling next() is what broke its umbrella driver.
    this.xenonLog.warn(
      "createSession reached the plugin without the session gateway's allocation; allocating " +
        'here. Sessions on phones other servers drive need the session gateway, and are refused.',
    );
    return await lifecycle.createSession(next, driver, caps, { localOnly: true });
  }

  async deleteSession(next: () => any, driver: any, sessionId?: string | null) {
    return await Container.get(SessionLifecycleService).deleteSession(
      next,
      sessionId || driver?.sessionId,
    );
  }

  async analyzeScreen(driver: any) {
    return await this.aiCommandService.analyzeScreen(driver);
  }

  async assertVisualState(driver: any, instruction: string) {
    return await this.aiCommandService.assertVisualState(driver, instruction);
  }

  async omniScan(driver: any) {
    return await this.aiCommandService.omniScan(driver);
  }

  async testAiLocator(driver: any, locator: { strategy: string; selector: string }) {
    return await this.aiCommandService.testAiLocator(driver, locator);
  }

  /**
   * Resolve a locator through the real driver and optionally act on what came
   * back. The inspector's own badges match a locator against captured XML,
   * which cannot evaluate `-android uiautomator` or `-ios predicate string` at
   * all and can disagree with Appium even when it can. This asks Appium.
   */
  async verifyLocator(
    _next: any,
    driver: any,
    strategy: string,
    selector: string,
    action?: VerifyAction,
    text?: string,
  ) {
    // Signature is (next, driver, ...payloadParams) — Appium invokes plugin
    // commands as `plugin[cmd](_next, driver, ...args)` (appium/lib/appium.js).
    // Taking the driver first silently binds `next` to it, and every driver
    // call then fails with "not a function".
    return await verifyLocator(driver as DriverLike, { strategy, selector, action, text });
  }

  /**
   * Omni-Click: OCR-driven smart click by visible text.
   * Accepts an object payload for compatibility with common plugin patterns.
   */
  async omniClick(
    driver: any,
    payload: { text?: string; index?: number; takeANewScreenShot?: boolean },
  ) {
    return await this.aiCommandService.omniClick(driver, payload);
  }

  /**
   * UI Scan Export: returns UI metadata JSON derived from screenshot OCR + lightweight heuristics.
   */
  async uiScanExport(driver: any, payload?: { takeANewScreenShot?: boolean; maxItems?: number }) {
    return await this.aiCommandService.uiScanExport(driver, payload);
  }

  /**
   * Smart Tap: Xenon-native, self-explanatory alias of omniClick.
   */
  async smartTap(
    driver: any,
    payload: { text?: string; index?: number; takeANewScreenShot?: boolean },
  ) {
    return await this.aiCommandService.smartTap(driver, payload);
  }

  /**
   * UI Inventory: Xenon-native, self-explanatory alias of uiScanExport.
   */
  async uiInventory(driver: any, payload?: { takeANewScreenShot?: boolean; maxItems?: number }) {
    return await this.aiCommandService.uiInventory(driver, payload);
  }
}

Object.assign(XenonPlugin.prototype, commands);
export { XenonPlugin };
