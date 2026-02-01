import { Container } from 'typedi';
import { XenonManager } from './index';
import { DeviceStoreFactory } from '../data-service/device-store';
import log from '../logger';
import { IDevice } from '../interfaces/IDevice';

export class HealthMonitorService {
  private static instance: HealthMonitorService;
  private log = log.scope('HealthMonitor');
  private interval: NodeJS.Timeout | undefined;
  private recoveringDevices: Set<string> = new Set();

  public static getInstance(): HealthMonitorService {
    if (!HealthMonitorService.instance) {
      HealthMonitorService.instance = new HealthMonitorService();
    }
    return HealthMonitorService.instance;
  }

  public start(intervalMs: number = 30000) {
    if (this.interval) return;
    this.log.info(`Starting Health Monitor Service (interval: ${intervalMs}ms)`);
    this.interval = setInterval(() => this.checkAllDevices(), intervalMs);
    // Run immediately on start
    this.checkAllDevices();
  }

  public stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
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
