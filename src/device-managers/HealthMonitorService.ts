import { Container, Service } from 'typedi';
import { XenonManager } from './index';
import { DeviceStoreFactory } from '../data-service/device-store';
import log from '../logger';
import { IDevice } from '../interfaces/IDevice';
import * as schedule from 'node-schedule';
import { IPluginArgs } from '../interfaces/IPluginArgs';
import { WebConfigService } from '../data-service/web-config-service';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { EVENT_BUS } from '../services/EventBus';

@Service()
export class HealthMonitorService {
  private log = log.scope('HealthMonitor');
  private interval: NodeJS.Timeout | undefined;
  private job: schedule.Job | undefined;
  private configPollInterval: NodeJS.Timeout | undefined;
  private recoveringDevices: Set<string> = new Set();
  private pluginArgs: IPluginArgs | undefined;
  private lastWebConfig: any = {};
  private healthHistory: Map<string, Array<{ time: number, battery?: number, thermal?: string }>> = new Map();

  constructor(private webConfigService: WebConfigService) { }

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
      const webConfig = await this.webConfigService.getConfig();
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

        // Principal Intelligence: Health monitor must detect "Zombie Busy" devices.
        // A device is a Zombie if it's marked busy in DB but NOT found in Hub's session map
        // AND not currently streaming to a manual viewer.
        if (device.busy) {
          const hasActiveSession = SESSION_MANAGER.isValidSession(device.session_id || '');

          // NEW: Check for active manual streams (dashboard viewers)
          let hasActiveManualStream = false;
          try {
            if (['ios', 'tvos'].includes(device.platform)) {
              const IOSStreamService = (await import('./ios/IOSStreamService')).default;
              const iosStream = Container.get(IOSStreamService);
              const streamStatus = iosStream.getStreamStatus(device.udid);
              hasActiveManualStream = !!(streamStatus && (streamStatus.status === 'running' || streamStatus.status === 'starting'));
            } else if (device.platform === 'android') {
              const AndroidStreamService = (await import('./android/AndroidStreamService')).default;
              const androidStream = Container.get(AndroidStreamService);
              const streamStatus = androidStream.getStreamStatus(device.udid);
              hasActiveManualStream = !!(streamStatus && (streamStatus.status === 'running' || streamStatus.status === 'starting'));
            }
          } catch (e) { /* Stream service not available */ }

          if (hasActiveSession || hasActiveManualStream) {
            log.debug(
              `[HealthMonitor] Skipping check for busy device ${device.udid} (Active: Session=${!!hasActiveSession}, Stream=${hasActiveManualStream})`,
            );
            continue;
          } else {
            this.log.info(
              `[HealthMonitor] 🧟 Zombie busy device detected ${device.udid}. Last session ${device.session_id} is not in memory. Proceeding with health check.`
            );
          }
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
            const updateData: Partial<IDevice> = {
              ...health,
              lastHealthCheckAt: Date.now(),
            };

            // Principal Fix: If this was a zombie busy device, reset its busy status
            // so it can be recovered and utilized again.
            if (device.busy && !SESSION_MANAGER.isValidSession(device.session_id || '')) {
              this.log.info(`[HealthMonitor] Reclaiming zombie device ${device.udid}`);
              updateData.busy = false;
              updateData.session_id = undefined;
            }

            await store.updateDevice(device.udid, device.host, updateData);

            // Principal Intelligence: Predictive Failure Analysis
            // Track trends and emit anomalies before they become critical failures.
            this.trackAndAnalyzeAnomaly(device, health);

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

  /**
   * Predictive Intelligence: Analyzes health trends to detect anomalies.
   * Emits 'device:anomaly' event if a potential failure is predicted.
   */
  private trackAndAnalyzeAnomaly(device: IDevice, currentHealth: Partial<IDevice>) {
    const key = `${device.udid}-${device.host}`;
    const history = this.healthHistory.get(key) || [];

    // Add current entry to history
    history.push({
      time: Date.now(),
      battery: currentHealth.batteryLevel,
      thermal: currentHealth.thermalStatus
    });

    // Keep last 10 entries (~5 minutes if checking every 30s)
    if (history.length > 10) history.shift();
    this.healthHistory.set(key, history);

    if (history.length < 2) return;

    const previous = history[history.length - 2];
    const current = history[history.length - 1];

    // 1. Thermal Anomaly: Normal -> Hot or Hot -> Critical
    if (previous.thermal !== current.thermal && current.thermal !== 'Normal') {
      this.log.warn(`⚠️ [Anomaly] Thermal spike detected on ${device.udid}: ${previous.thermal} -> ${current.thermal}`);
      EVENT_BUS.emit('device:anomaly', {
        udid: device.udid,
        host: device.host,
        type: 'thermal_spike',
        previous: previous.thermal,
        current: current.thermal,
        severity: current.thermal === 'Critical' ? 'high' : 'medium'
      });
    }

    // 2. Battery Anomaly: Rapid drain (>5% since last check)
    if (previous.battery !== undefined && current.battery !== undefined) {
      const drain = previous.battery - current.battery;
      if (drain >= 5) {
        this.log.warn(`⚠️ [Anomaly] Rapid battery drain on ${device.udid}: -${drain}% since last check`);
        EVENT_BUS.emit('device:anomaly', {
          udid: device.udid,
          host: device.host,
          type: 'battery_drain',
          drainValue: drain,
          currentLevel: current.battery,
          severity: current.battery < 20 ? 'high' : 'medium'
        });
      }
    }
  }
}
