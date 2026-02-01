import { IDevice } from '../interfaces/IDevice';
import { IDeviceFilterOptions } from '../interfaces/IDeviceFilterOptions';
import { IDeviceStore, IPendingSessionStore, ICLIArgsStore } from './device-store.interface';
import { PrismaService } from './prisma-service';
import { Device, PendingSession, CLIArgs, PrismaClient } from '@prisma/client';
import * as semver from 'semver';

export class SQLiteDeviceStore implements IDeviceStore {
  private prisma: PrismaClient = PrismaService.instance;

  private toIDevice(device: Device): IDevice {
    return {
      ...device,
      cloud: device.cloud ? JSON.parse(device.cloud) : undefined,
      capability: device.capability ? JSON.parse(device.capability) : undefined,
      chromeDriverPath: device.chromeDriverPath ? JSON.parse(device.chromeDriverPath) : undefined,
      platform: (device.platform || 'android') as any,
      name: device.name || 'unknown',
      state: device.state || 'available',
      sdk: device.sdk || 'unknown',
      deviceType: device.deviceType || 'real',
      busy: device.busy ?? false,
      userBlocked: device.userBlocked ?? false,
      realDevice: device.realDevice ?? true,
      lastHealthCheckAt: device.lastHealthCheckAt ?? undefined,
      healthStatus: device.healthStatus ?? 'Healthy',
      healthCheckError: device.healthCheckError ?? undefined,
    } as IDevice;
  }

  private fromIDevice(device: Partial<IDevice>): any {
    const data: any = { ...device };
    if (data.cloud && typeof data.cloud === 'object') data.cloud = JSON.stringify(data.cloud);
    if (data.capability && typeof data.capability === 'object')
      data.capability = JSON.stringify(data.capability);
    if (data.chromeDriverPath && typeof data.chromeDriverPath === 'object')
      data.chromeDriverPath = JSON.stringify(data.chromeDriverPath);
    return data;
  }

  async getAllDevices(): Promise<IDevice[]> {
    const devices = await this.prisma.device.findMany();
    return devices.map((d: Device) => this.toIDevice(d));
  }

  async getDevices(filterOptions: IDeviceFilterOptions): Promise<IDevice[]> {
    const all = await this.getAllDevices();
    let results = all.filter((d) => d.host !== undefined && d.userBlocked !== undefined);

    if (filterOptions.platform) {
      results = results.filter((d) => d.platform === filterOptions.platform);
    }

    if (filterOptions.platformVersion) {
      const coercedPlatformVersion = semver.coerce(filterOptions.platformVersion);
      results = results.filter((obj: IDevice) => {
        const coercedSDK = semver.coerce(obj.sdk);
        return !!(
          coercedSDK &&
          coercedPlatformVersion &&
          semver.eq(coercedSDK, coercedPlatformVersion)
        );
      });
    }

    if (filterOptions.name?.trim()) {
      results = results.filter((d) => d.name.includes(filterOptions.name!.trim()));
    }

    if (filterOptions.busy !== undefined) {
      results = results.filter((d) => d.busy === filterOptions.busy);
    }

    if (filterOptions.offline !== undefined) {
      results = results.filter((d) => d.offline === filterOptions.offline);
    }

    if (filterOptions.userBlocked !== undefined) {
      results = results.filter((d) => d.userBlocked === filterOptions.userBlocked);
    }

    if (filterOptions.udid && filterOptions.udid.length > 0) {
      results = results.filter((d) => filterOptions.udid.includes(d.udid));
    }

    if (filterOptions.deviceType) {
      results = results.filter((d) => d.deviceType === filterOptions.deviceType);
    }

    if (filterOptions.session_id) {
      results = results.filter((d) => d.session_id === filterOptions.session_id);
    }

    if (filterOptions.filterByHost) {
      results = results.filter((d) => d.host.includes(filterOptions.filterByHost!));
    }

    if (filterOptions.minSDK) {
      const coercedMinSDK = semver.coerce(filterOptions.minSDK);
      if (coercedMinSDK) {
        results = results.filter((obj: IDevice) => {
          const coercedSDK = semver.coerce(obj.sdk);
          return !!(coercedSDK && semver.gte(coercedSDK, coercedMinSDK));
        });
      }
    }

    if (filterOptions.maxSDK) {
      const coercedMaxSDK = semver.coerce(filterOptions.maxSDK);
      if (coercedMaxSDK) {
        results = results.filter((obj: IDevice) => {
          const coercedSDK = semver.coerce(obj.sdk);
          return !!(coercedSDK && semver.lte(coercedSDK, coercedMaxSDK));
        });
      }
    }

    return results;
  }

  async updatedAllocatedDevice(device: IDevice, updateData: Partial<IDevice>): Promise<void> {
    await this.updateDevice(device.udid, device.host, updateData);
  }

  async updateDevice(udid: string, host: string, update: Partial<IDevice>): Promise<void> {
    const data = this.fromIDevice(update);
    const result = await this.prisma.device.updateMany({
      where: { udid, host },
      data,
    });
    console.log(`[SQLiteStore] Update device ${udid} at ${host}: ${result.count} records affected`);
  }

  async updateDevices(
    filter: Partial<IDevice>,
    updateFn: (device: IDevice) => void,
  ): Promise<void> {
    const devices = await this.prisma.device.findMany({ where: filter as any });
    for (const d of devices) {
      const idv = this.toIDevice(d);
      updateFn(idv);
      await this.prisma.device.update({
        where: { udid_host: { udid: d.udid, host: d.host } },
        data: this.fromIDevice(idv),
      });
    }
  }

  async addDevices(devices: IDevice[]): Promise<IDevice[]> {
    const added: IDevice[] = [];
    for (const device of devices) {
      const data = this.fromIDevice(device);
      // Use upsert to avoid race conditions and unique constraint errors
      const d = await this.prisma.device.upsert({
        where: { udid_host: { udid: device.udid, host: device.host } },
        update: data,
        create: data,
      });
      added.push(this.toIDevice(d));
    }
    return added;
  }

  async removeDevices(filter: Partial<IDevice>): Promise<void> {
    // Principal Fix: Support partial host matching (e.g., "192.168.0.100" should match "http://192.168.0.100:4723")
    // This is necessary because the device tracker passes the raw IP, not the full URL.
    const whereClause: any = {};

    if (filter.udid) {
      whereClause.udid = filter.udid;
    }

    if (filter.host) {
      // Use Prisma's `contains` for partial matching if host doesn't look like a full URL
      if (filter.host.startsWith('http://') || filter.host.startsWith('https://')) {
        whereClause.host = filter.host;
      } else {
        whereClause.host = { contains: filter.host };
      }
    }

    await this.prisma.device.deleteMany({ where: whereClause });
  }

  async clearStorage(): Promise<void> {
    await this.prisma.device.deleteMany();
  }

  async findDevice(filter: Partial<IDevice>): Promise<IDevice | null> {
    const device = await this.prisma.device.findFirst({ where: filter as any });
    return device ? this.toIDevice(device) : null;
  }

  async findDevices(filter: Partial<IDevice>): Promise<IDevice[]> {
    const devices = await this.prisma.device.findMany({ where: filter as any });
    return devices.map((d) => this.toIDevice(d));
  }
}

export class SQLitePendingSessionStore implements IPendingSessionStore {
  private prisma = PrismaService.instance;

  async addPendingSession(capability: any): Promise<void> {
    await this.prisma.pendingSession.upsert({
      where: { capability_id: capability.capability_id },
      update: {
        capability: JSON.stringify(capability),
        createdAt: capability.createdAt || Date.now(),
      },
      create: {
        capability_id: capability.capability_id,
        capability: JSON.stringify(capability),
        createdAt: capability.createdAt || Date.now(),
      },
    });
  }

  async removePendingSession(sessionCapabilityId: string): Promise<void> {
    try {
      await this.prisma.pendingSession.delete({
        where: { capability_id: sessionCapabilityId },
      });
    } catch (e) {
      // ignore if not found
    }
  }

  async getAllPendingSessions(): Promise<any[]> {
    const sessions = await this.prisma.pendingSession.findMany();
    return sessions.map((s: PendingSession) => JSON.parse(s.capability));
  }

  async remove(session: any): Promise<void> {
    try {
      await this.prisma.pendingSession.delete({
        where: { capability_id: session.capability_id },
      });
    } catch (e) {
      // ignore if not found
    }
  }
}

export class SQLiteCLIArgsStore implements ICLIArgsStore {
  private prisma = PrismaService.instance;

  async addCLIArgs(args: any): Promise<void> {
    await this.prisma.cLIArgs.create({
      data: {
        args: JSON.stringify(args),
      },
    });
  }

  async getCLIArgs(): Promise<any[]> {
    const entries = await this.prisma.cLIArgs.findMany();
    return entries.map((e: CLIArgs) => JSON.parse(e.args));
  }
}
