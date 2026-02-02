import { Container } from 'typedi';
import { XenonManager } from './index';
import { DeviceStoreFactory } from '../data-service/device-store';
import log from '../logger';
import { IDevice } from '../interfaces/IDevice';
import * as schedule from 'node-schedule';
import { IPluginArgs } from '../interfaces/IPluginArgs';
import { WebConfigService } from '../data-service/web-config-service';

export class HealthMonitorService {
  private static instance: HealthMonitorService;
  private log = log.scope('HealthMonitor');
  private interval: NodeJS.Timeout | undefined;
  private job: schedule.Job | undefined;
  private configPollInterval: NodeJS.Timeout | undefined;
  private recoveringDevices: Set<string> = new Set();
  private pluginArgs: IPluginArgs | undefined;
  private lastWebConfig: any = {};

  public static getInstance(): HealthMonitorService {
    if (!HealthMonitorService.instance) {
      HealthMonitorService.instance = new HealthMonitorService();
    }
    return HealthMonitorService.instance;
  }

  public start(pluginArgs: IPluginArgs) {
    this.pluginArgs = pluginArgs;
    this.stop();

    this.setupMonitor(pluginArgs);

    // Initial config poll and setup polling
    this.pollWebConfig();
    this.configPollInterval = setInterval(() => this.pollWebConfig(), 60000); // Poll every minute
  }

  private async pollWebConfig() {
    try {
      const webConfig = await WebConfigService.getConfig();
      if (JSON.stringify(webConfig) !== JSON.stringify(this.lastWebConfig)) {
        this.log.info('Detected web configuration changes, restarting monitor...');
        this.lastWebConfig = webConfig;

        // Merge web config with plugin args, web config takes precedence
        const effectiveArgs = {
          ...this.pluginArgs,
          ...webConfig,
        } as IPluginArgs;

        this.setupMonitor(effectiveArgs);
      }
    } catch (err: any) {
      this.log.error(`Failed to poll web config: ${err.message}`);
    }
  }

  private setupMonitor(args: IPluginArgs) {
    if (this.interval) clearInterval(this.interval);
    if (this.job) this.job.cancel();

    if (args.healthCheckSchedule) {
      this.log.info(`Scheduling Health Monitor (Cron: ${args.healthCheckSchedule})`);
      this.job = schedule.scheduleJob(args.healthCheckSchedule, () => this.checkAllDevices());
    } else {
      const intervalMs = args.healthCheckIntervalMs || 30000;
      this.log.info(`Starting Health Monitor Service (Interval: ${intervalMs}ms)`);
      this.interval = setInterval(() => this.checkAllDevices(), intervalMs);
    }

    // Run immediately
    this.checkAllDevices();
  }

  public stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    if (this.job) {
      this.job.cancel();
      this.job = undefined;
    }
    if (this.configPollInterval) {
      clearInterval(this.configPollInterval);
      this.configPollInterval = undefined;
    }
  }

  private async checkAllDevices() {
    try {
      const store = DeviceStoreFactory.getStore();
      const devices = await store.getAllDevices();
      const manager = Container.get(XenonManager);
      const instances = await manager.deviceInstances();

      for (const device of devices) {
        // Only check devices managed by this node
        if (device.cloud) continue;

        // TECHNICAL OPTIMIZATION: Skip health checking for devices with an active session
        // This prevents resource contention (ADB/XCUITest lockups) and accidental recovery-kills
        // during CI execution.
        if (device.busy) {
          log.debug(
            `[HealthMonitor] Skipping check for busy device ${device.udid} (Active Session)`,
          );
          continue;
        }

        const deviceManager = instances.find((inst) => {
          if (device.platform === 'android')
            return inst.constructor.name === 'AndroidDeviceManager';
          if (['ios', 'tvos'].includes(device.platform))
            return inst.constructor.name === 'IOSDeviceManager';
          return false;
        });

        if (deviceManager && deviceManager.checkHealth) {
          try {
            const health = await deviceManager.checkHealth(device);
            await store.updateDevice(device.udid, device.host, {
              ...health,
              lastHealthCheckAt: Date.now(),
            });

            if (health.healthStatus !== 'Healthy') {
              this.log.warn(`Device ${device.udid} is UNHEALTHY: ${health.healthCheckError}`);

              const key = `${device.udid}-${device.host}`;
              if (!this.recoveringDevices.has(key)) {
                this.recoveringDevices.add(key);
                this.log.info(`🛠️ Triggering background recovery for ${device.udid}...`);

                // Fire and forget recovery to not block the monitor loop
                if (deviceManager.recoverHealth) {
                  deviceManager
                    .recoverHealth(device)
                    .then((success) => {
                      if (success) {
                        this.log.info(`✅ Recovery successful for ${device.udid}`);
                      } else {
                        this.log.error(`❌ Recovery failed for ${device.udid}`);
                      }
                      this.recoveringDevices.delete(key);
                    })
                    .catch((e) => {
                      this.log.error(
                        `Critical error during recovery for ${device.udid}: ${e.message}`,
                      );
                      this.recoveringDevices.delete(key);
                    });
                } else {
                  this.log.warn(`No recovery method implemented for ${device.udid}`);
                  this.recoveringDevices.delete(key);
                }
              }
            }
          } catch (err: any) {
            this.log.error(`Health check failed for ${device.udid}: ${err.message}`);
          }
        }
      }
    } catch (err: any) {
      this.log.error(`Global health check loop failed: ${err.message}`);
    }
  }
}
