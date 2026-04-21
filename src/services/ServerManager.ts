import { Container, Service } from 'typedi';
import { OrphanSweeper } from './OrphanSweeper';
import { v4 as uuidv4 } from 'uuid';
import { redactSecrets } from '../helpers';
import ip from 'ip';
import log from '../logger';
// enable resolveJsonModule in tsconfig must be true for this to work
import pkg from '../../package.json';
import { IPluginArgs, DefaultPluginArgs, EmulatorConfig } from '../interfaces/IPluginArgs';
import { ConfigService } from '../data-service/config-service';
import { PluginContext } from '../PluginContext';
import { DeviceStoreFactory } from '../data-service/device-store';
import {
  initializeStorage,
  setupCronCheckStaleDevices,
  setupCronCleanupBuilds,
  setupCronCleanExpiredReservations,
  setupCronCleanPendingSessions,
  setupCronReleaseBlockedDevices,
  setupCronSweepOrphanSessions,
  setupCronUpdateDeviceList,
  removeStaleDevices,
  updateDeviceList,
} from '../device-utils';
import { createRouter } from '../app';
import { registerProxyMiddlware } from '../proxy/wd-command-proxy';
import { ADB } from 'appium-adb';
import ChromeDriverManager from '../device-managers/ChromeDriverManager';
import AndroidDeviceManager from '../device-managers/AndroidDeviceManager';
import IOSDeviceManager from '../device-managers/IOSDeviceManager';
import { XenonManager } from '../device-managers';
import { addCLIArgs } from '../data-service/pluginArgs';
import NodeDevices from '../device-managers/NodeDevices';
import { SocketServer } from './SocketServer';
import { SocketClient } from './SocketClient';
import { TracingService } from './TracingService';
import { ServerArgs, PluginConfig } from '@appium/types';
import { XenonPlugin } from '../plugin';

@Service()
export class ServerManager {
  private logger = log.scope('ServerManager');
  public static IS_HUB = false;

  async updateServer(expressApp: any, httpServer: any, cliArgs: ServerArgs): Promise<void> {
    this.logger.debug(
      `📱 Update server with CLI Args: ${JSON.stringify(redactSecrets(cliArgs as any))}`,
    );

    const pluginArgs = await this.resolvePluginArgs(cliArgs);
    const nodeId = uuidv4();

    log.banner(pkg.version, nodeId);

    // Standardize static variable initialization
    XenonPlugin.NODE_ID = nodeId;
    XenonPlugin.port = cliArgs.port;
    XenonPlugin.nodeBasePath = cliArgs.basePath || '';

    const context = Container.get(PluginContext);
    context.setContext(pluginArgs, cliArgs.port, nodeId, cliArgs.basePath || '');

    await this.syncDatabaseAndAIConfig(pluginArgs);
    await this.initializeCoreSubsystems(pluginArgs);

    this.registerRoutes(expressApp, cliArgs, pluginArgs);
    await this.bootEmulators(pluginArgs);
    this.registerDependenciesInContainer(pluginArgs, cliArgs, nodeId);

    await this.setupHubOrNode(pluginArgs, cliArgs, httpServer, nodeId);
    await this.setupMaintenanceCrons(pluginArgs);

    // Principal Cleaning: Attempt to recover remote sessions before marking as failed
    const { SessionManager } = await import('../sessions/SessionManager');
    const sessionManager = Container.get(SessionManager);
    const recoveredCount = await sessionManager.recoverActiveSessions(
      nodeId,
      XenonPlugin.nodeBasePath,
    );

    const recoveredSessionIds = sessionManager.getAllSessions().map((s) => s.getId());

    if (recoveredCount > 0) {
      log.info(`🔄 Successfully recovered ${recoveredCount} remote sessions`);
    }

    // Cleanup any remaining zombie sessions
    const { cleanupZombieSessions } = await import('../dashboard/services/session-service');
    await cleanupZombieSessions(recoveredSessionIds);

    // Reconcile orphans left by a prior PID on this host
    try {
      await Container.get(OrphanSweeper).sweep({
        heartbeatIntervalMs: pluginArgs.sessionHeartbeatIntervalMs || 30_000,
      });
    } catch (err: any) {
      this.logger.warn(`Startup orphan reconciliation failed: ${err.message}`);
    }

    // Initial device discovery poll to start managers and trackers
    await updateDeviceList(
      pluginArgs.bindHostOrIp as string,
      pluginArgs.hub,
      pluginArgs.tlsRejectUnauthorized,
    );

    // remove stale devices
    await removeStaleDevices(pluginArgs.bindHostOrIp as string, pluginArgs.tlsRejectUnauthorized);

    this.logger.info(
      `🚀 Xenon will be served at http://${pluginArgs.bindHostOrIp}:${cliArgs.port}/xenon with id ${nodeId}`,
    );
  }

  private async resolvePluginArgs(cliArgs: ServerArgs): Promise<IPluginArgs> {
    const pluginConfigs = cliArgs.plugin as PluginConfig;
    const pluginArgs: IPluginArgs = Object.assign(
      {},
      DefaultPluginArgs,
      (pluginConfigs?.['xenon'] || {}) as any,
    );

    try {
      const persistedConfig = await Container.get(ConfigService).loadConfig();
      if (persistedConfig && Object.keys(persistedConfig).length > 0) {
        this.logger.info('Loading persisted configuration', persistedConfig);
        Object.assign(pluginArgs, persistedConfig);
      }
    } catch (err) {
      this.logger.warn(`Failed to load persisted config: ${err}`);
    }

    if (pluginArgs.bindHostOrIp === undefined) {
      pluginArgs.bindHostOrIp = ip.address();
    }

    return pluginArgs;
  }

  private async syncDatabaseAndAIConfig(pluginArgs: IPluginArgs) {
    const { updateConfig } = await import('../config');
    const update: any = {};

    if (pluginArgs.databaseProvider) {
      update.databaseProvider = pluginArgs.databaseProvider;
      process.env.XENON_DB_PROVIDER = pluginArgs.databaseProvider;
    }
    if (pluginArgs.databaseUrl) {
      update.databaseUrl = pluginArgs.databaseUrl;
      process.env.DATABASE_URL = pluginArgs.databaseUrl;
    }
    if (pluginArgs.aiProvider) {
      update.aiProvider = pluginArgs.aiProvider;
      process.env.XENON_AI_PROVIDER = pluginArgs.aiProvider;
    }
    if (pluginArgs.aiModel) {
      update.aiModel = pluginArgs.aiModel;
      process.env.XENON_AI_MODEL = pluginArgs.aiModel;
    }
    if (pluginArgs.aiBaseUrl) {
      update.aiBaseUrl = pluginArgs.aiBaseUrl;
      process.env.XENON_AI_BASE_URL = pluginArgs.aiBaseUrl;
    }
    if (pluginArgs.geminiApiKey) {
      update.geminiApiKey = pluginArgs.geminiApiKey;
      process.env.GEMINI_API_KEY = pluginArgs.geminiApiKey;
    }
    if (pluginArgs.openaiApiKey) {
      update.openaiApiKey = pluginArgs.openaiApiKey;
      process.env.OPENAI_API_KEY = pluginArgs.openaiApiKey;
    }
    if (pluginArgs.anthropicApiKey) {
      update.anthropicApiKey = pluginArgs.anthropicApiKey;
      process.env.ANTHROPIC_API_KEY = pluginArgs.anthropicApiKey;
    }

    if (Object.keys(update).length > 0) {
      this.logger.info('[Plugin] Synchronizing database config', update);
      updateConfig(update);
    }
  }

  private async initializeCoreSubsystems(pluginArgs: IPluginArgs) {
    await initializeStorage();
    const { runMigrations } = await import('../scripts/run-migrations');
    await runMigrations();
    await DeviceStoreFactory.getStore().clearStorage();
  }

  private registerRoutes(expressApp: any, cliArgs: ServerArgs, pluginArgs: IPluginArgs) {
    expressApp.use('/xenon', createRouter(pluginArgs));
    registerProxyMiddlware(expressApp, cliArgs);
  }

  private async bootEmulators(pluginArgs: IPluginArgs) {
    if (
      pluginArgs.emulators &&
      pluginArgs.emulators.length > 0 &&
      (pluginArgs.platform as string).toLowerCase().includes('android')
    ) {
      this.logger.info('Emulators will be booted!!');
      const adb = await ADB.createADB({});
      const array = pluginArgs.emulators || [];
      await Promise.all(array.map((arr: EmulatorConfig) => adb.launchAVD(arr.avdName, arr as any)));
    }
  }

  private registerDependenciesInContainer(
    pluginArgs: IPluginArgs,
    cliArgs: ServerArgs,
    nodeId: string,
  ) {
    Container.set('DeviceStore', DeviceStoreFactory.getStore());
    Container.set('PendingSessionStore', DeviceStoreFactory.getPendingSessionStore());
    Container.set('CLIArgsStore', DeviceStoreFactory.getCLIArgsStore());
    Container.set('HealEtalonStore', DeviceStoreFactory.getHealEtalonStore());

    Container.set('AndroidDeviceManager', Container.get(AndroidDeviceManager));
    Container.set('IOSDeviceManager', Container.get(IOSDeviceManager));

    const deviceManager = Container.get(XenonManager);
    deviceManager.init();

    // Optional Chrome Download
    if (pluginArgs.skipChromeDownload === false) {
      ChromeDriverManager.create()
        .then((mgr: ChromeDriverManager) => Container.set(ChromeDriverManager, mgr))
        .catch((err: any) => this.logger.error(`Failed to initialize ChromeDriverManager: ${err}`));
    }

    addCLIArgs(cliArgs);
  }

  private async setupHubOrNode(
    pluginArgs: IPluginArgs,
    cliArgs: ServerArgs,
    httpServer: any,
    nodeId: string,
  ) {
    const hubArgument = pluginArgs.hub;
    if (hubArgument !== undefined) {
      this.logger.info(`📡 I'm a node and my hub is ${hubArgument}`);
      await setupCronUpdateDeviceList(
        pluginArgs.bindHostOrIp as string,
        hubArgument,
        pluginArgs.sendNodeDevicesToHubIntervalMs as number,
        pluginArgs.tlsRejectUnauthorized,
      );

      // Handle graceful shutdown
      ['SIGINT', 'SIGTERM'].forEach((signal) => {
        process.once(signal, async () => {
          log.info(`Received ${signal}, unregistering node from hub...`);
          try {
            await new NodeDevices(hubArgument, pluginArgs.tlsRejectUnauthorized).unRegisterNode(
              pluginArgs.bindHostOrIp as string,
            );
          } catch (err) {
            log.error(`Error during node unregistration: ${err}`);
          }
          process.kill(process.pid, signal);
        });
      });

      // Initialize Socket Client to connect to Hub
      const socketClient = Container.get(SocketClient);
      socketClient.initialize(hubArgument, pluginArgs.bindHostOrIp as string);
    } else {
      ServerManager.IS_HUB = true;
      this.logger.info(
        `🌐 I'm a hub and I'm listening on ${pluginArgs.bindHostOrIp}:${cliArgs.port}`,
      );

      // Principal discovery: Background poll to prune stale/offline devices on the Hub itself
      (async () => {
        const { setupCronLocalDiscovery } = await import('../device-utils');
        await setupCronLocalDiscovery(
          pluginArgs.bindHostOrIp as string,
          pluginArgs.sendNodeDevicesToHubIntervalMs as number,
        );
      })();

      const socketServer = Container.get(SocketServer);
      socketServer.initialize(httpServer);

      const tracingService = Container.get(TracingService);
      tracingService.initialize();
    }
  }

  private async setupMaintenanceCrons(pluginArgs: IPluginArgs) {
    if (!pluginArgs.cloud?.cloudName) {
      // 1. Check for stale nodes
      await setupCronCheckStaleDevices(
        pluginArgs.checkStaleDevicesIntervalMs as number,
        pluginArgs.bindHostOrIp as string,
        pluginArgs.tlsRejectUnauthorized,
      );
      // 2. Release blocked devices
      await setupCronReleaseBlockedDevices(
        pluginArgs.checkBlockedDevicesIntervalMs,
        pluginArgs.newCommandTimeoutSec,
      );
      // 3. Clean up pending sessions
      await setupCronCleanPendingSessions(
        pluginArgs.checkBlockedDevicesIntervalMs as number,
        (pluginArgs.deviceAvailabilityTimeoutMs as number) + 10000,
      );
      // 4. Clean up expired reservations every 1 minute
      await setupCronCleanExpiredReservations(60000);
      // 5. Clean up older builds and sessions
      await setupCronCleanupBuilds(pluginArgs);

      // 6. Start Health Monitor Service
      const { HealthMonitorService } = await import('../device-managers/HealthMonitorService');
      Container.get(HealthMonitorService).start(pluginArgs);

      // 7. Start Session Heartbeat Service
      const { SessionHeartbeatService } = await import('./SessionHeartbeatService');
      Container.get(SessionHeartbeatService).start(pluginArgs);

      // 8. Sweep orphaned sessions on a 30s cron
      setupCronSweepOrphanSessions(pluginArgs.sessionHeartbeatIntervalMs || 30_000);
    }
  }
}
