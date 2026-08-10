import { Container, Service } from 'typedi';
import * as os from 'os';
import * as path from 'path';
import { OrphanSweeper } from './OrphanSweeper';
import { v4 as uuidv4 } from 'uuid';
import { redactSecrets } from '../helpers';
import {
  listReachableBaseUrls,
  resolveAdvertisedBindHost,
  shouldAutoResolveBindHost,
} from '../helpers/networkAddresses';
import log from '../logger';
import { attachH264Ws } from '../app/ws/h264StreamWs';
import { attachLogcatWs } from '../app/ws/logcatWs';
import { StreamTicketService } from './token/StreamTicketService';
import AndroidH264StreamService from '../device-managers/android/AndroidH264StreamService';
import { LogcatStreamService } from '../device-managers/android/LogcatStreamService';
import { SessionOwnerResolver } from './device-access/SessionOwnerResolver';
import { makeTicketActorAuthorizer } from './device-access/ticketActorAccess';
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
  setupCronReconcileDevices,
  setupCronSelectorVerification,
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
import { config as xenonConfig } from '../config';
import { SocketServer } from './SocketServer';
import { SocketClient } from './SocketClient';
import { EventLogService } from './EventLogService';
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
    await this.initializeCoreSubsystems(pluginArgs, cliArgs.port);

    this.registerRoutes(expressApp, cliArgs, pluginArgs);
    await this.bootEmulators(pluginArgs);
    this.registerDependenciesInContainer(pluginArgs, cliArgs, nodeId);

    await this.setupHubOrNode(pluginArgs, cliArgs, httpServer, nodeId);
    await this.setupMaintenanceCrons(pluginArgs);

    // Live H.264 preview WebSocket (Android; feature-flagged in the frontend).
    // Only claims /stream/h264 — socket.io keeps its own upgrades. Ticket-auth'd.
    if (httpServer) {
      attachH264Ws(httpServer, {
        redeem: (ticket, udid) => Container.get(StreamTicketService).redeem(ticket, udid),
        // No source opt on purpose: start() resolves the capture source from the
        // streaming.androidH264 config itself, so this WS auto-start honours a
        // { source: 'screenrecord' } rollback just like the REST stream/start.
        startStream: (udid) => Container.get(AndroidH264StreamService).start(udid),
      });

      // Continuous logcat WebSocket (Android; replaces the 3s dump-poll).
      // Only claims /logcat — socket.io and the h264 WS keep their own
      // upgrades. Ticket-auth'd like h264, plus an ownership check h264
      // doesn't need: logcat routinely carries auth tokens and PII from
      // whatever app is under test, so it's an ownership-checked read, not
      // an open one — see docs/superpowers/specs/2026-08-09-logcat-stream-design.md
      // "Authorisation". The decision itself lives in
      // makeTicketActorAuthorizer so it is tested directly rather than
      // through a hand-written near-copy in a spec; the ticket carries the
      // caller's admin flag and api-key id (captured from resolveActor at
      // mint time) so this reaches the same verdict /control does.
      attachLogcatWs(httpServer, {
        redeem: (ticket, udid) => Container.get(StreamTicketService).redeem(ticket, udid),
        authorize: makeTicketActorAuthorizer({
          findDevice: (udid) => DeviceStoreFactory.getStore().findDevice({ udid }),
          resolveSessionOwner: (sessionId) =>
            Container.get(SessionOwnerResolver).ownerOf(sessionId),
        }),
        startStream: (udid) => Container.get(LogcatStreamService).start(udid),
      });
    }

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

    // Sweep prior-PID orphans on this host BEFORE the broad zombie cleanup,
    // so heartbeat_pid/host scoping can protect other nodes' running sessions.
    try {
      await Container.get(OrphanSweeper).sweep({
        heartbeatIntervalMs: pluginArgs.sessionHeartbeatIntervalMs || 30_000,
        hostScope: { host: os.hostname(), excludePid: process.pid },
      });
    } catch (err: any) {
      this.logger.warn(`Startup orphan reconciliation failed: ${err.message}`);
    }

    // Heartbeat-based lease orphan sweep (Phase 2): reaps leases that miss
    // 3 × heartbeatSeconds, cascades to PortLease delete + device unlock.
    const { LeaseOrphanSweeper } = await import('./lease/LeaseOrphanSweeper');
    const leaseSweeper = Container.get(LeaseOrphanSweeper);
    setInterval(() => {
      leaseSweeper.sweep().catch((err: any) => {
        log.warn(`LeaseOrphanSweeper tick failed: ${err?.message ?? err}`);
      });
    }, 30_000);

    // Daily EventLog prune (transactional-outbox seed): keeps the append-only
    // log from growing unbounded. Fire-and-forget interval, unref'd so it
    // never keeps the process alive on its own.
    const eventLog = Container.get(EventLogService);
    setInterval(
      () => {
        const rawRet = Number(process.env.XENON_EVENT_LOG_RETENTION_DAYS);
        const retentionDays = Number.isFinite(rawRet) && rawRet > 0 ? rawRet : 30;
        eventLog
          .prune(retentionDays)
          .catch((err: any) => log.warn(`EventLog prune failed: ${err?.message ?? err}`));
      },
      24 * 60 * 60 * 1000,
    ).unref();

    // Cleanup any remaining zombie sessions (cross-node fallback)
    const { cleanupZombieSessions } = await import('../dashboard/services/session-service');
    await cleanupZombieSessions(recoveredSessionIds);

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
    this.logger.info('You can provide the following URLs to access Xenon:');
    for (const url of listReachableBaseUrls(cliArgs.port)) {
      const note = url.includes('127.0.0.1') ? ' (only accessible from the same host)' : '';
      this.logger.info(`  ${url}${note}`);
    }
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

    if (shouldAutoResolveBindHost(pluginArgs.bindHostOrIp)) {
      const resolved = resolveAdvertisedBindHost(pluginArgs.bindHostOrIp);
      if (resolved !== pluginArgs.bindHostOrIp) {
        this.logger.info(
          `Resolved bindHostOrIp ${JSON.stringify(pluginArgs.bindHostOrIp)} -> ${resolved}`,
        );
      }
      pluginArgs.bindHostOrIp = resolved;
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

  private async initializeCoreSubsystems(pluginArgs: IPluginArgs, port: number) {
    await initializeStorage();
    const { runMigrations } = await import('../scripts/run-migrations');
    await runMigrations();
    await DeviceStoreFactory.getStore().clearStorage();

    const { bootstrapIdentity } = await import('./identity/bootstrap');
    await bootstrapIdentity();

    const { startUserSessionCleanupCron } = await import('./identity/sessionCleanupCron');
    startUserSessionCleanupCron();

    // Hub-issued JWT signing key (REST/MCP tokens, stream tickets) — key
    // material lives next to the SQLite db file so it survives restarts
    // without a new DB migration. Must finish before /auth/token or
    // /auth/jwks.json can be mounted (registerRoutes runs right after this).
    // Non-disruptive by design: a key-material failure (permissions, disk
    // full, corrupt PEM) only degrades the two token routes — sign()/verify()
    // throw "not initialized" and jwks() serves an empty set — it must never
    // abort server boot.
    try {
      const { JwtKeyService } = await import('./token/JwtKeyService');
      const jwtKeyDir = process.env.XENON_JWT_KEY_DIR || path.dirname(xenonConfig.databasePath);
      await Container.get(JwtKeyService).init(jwtKeyDir);
    } catch (err: any) {
      log.error(
        `JWT key init failed — /auth/token and /auth/jwks.json will be unavailable: ${err?.message}`,
      );
    }

    // ARB foreclosure guard #2: every recording/proof-bundle artifact path
    // flows through ArtifactStore so an S3/object-store backend later is an
    // implementation swap, not a call-site migration. FsArtifactStore is
    // byte-identical to the legacy path.join(recordingsAssetsPath, ...)
    // concatenation it replaces.
    const { FsArtifactStore, ARTIFACT_STORE } = await import('./artifacts/ArtifactStore');
    Container.set(ARTIFACT_STORE, new FsArtifactStore(xenonConfig.recordingsAssetsPath));
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
            await new NodeDevices(hubArgument, {
              tlsRejectUnauthorized: pluginArgs.tlsRejectUnauthorized,
              hubAccessKey: xenonConfig.hubAccessKey,
              hubToken: xenonConfig.hubToken,
            }).unRegisterNode(pluginArgs.bindHostOrIp as string);
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
      tracingService.initialize({ isHub: !pluginArgs.hub });
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

      // 9. Reconcile device-store busy flags against SESSION_MANAGER every
      //    60s to catch devices orphaned mid-allocation (driver crash before
      //    session registration, etc.)
      setupCronReconcileDevices(60_000);

      // 10. Start event-loop lag sampler so xenon_process_event_loop_lag_ms
      //     has real values by first scrape. Memory gauges are read on
      //     demand; lag needs a running sampler.
      const { ProcessMetricsService } = await import('./ProcessMetricsService');
      Container.get(ProcessMetricsService).start(1000);

      // 11. Promote Pending SelectorState rows to Resolved after enough
      //     clean CI builds. Cron-driven, hub-side only.
      await setupCronSelectorVerification();
    }
  }
}
