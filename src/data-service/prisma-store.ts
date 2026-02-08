import { IDevice } from '../interfaces/IDevice';
import { IDeviceFilterOptions } from '../interfaces/IDeviceFilterOptions';
import { IDeviceStore, IPendingSessionStore, ICLIArgsStore, IHealEtalonStore } from './device-store.interface';
import { PrismaService } from './prisma-service';
import { Device, PendingSession, CLIArgs, PrismaClient } from '@prisma/client';
import { Container } from 'typedi';
import * as semver from 'semver';
import log from '../logger';

export class PrismaDeviceStore implements IDeviceStore {
  private prisma: PrismaClient = Container.get(PrismaService);

  private toIDevice(device: Device): IDevice {
    return {
      ...device,
      cloud: device.cloud ? JSON.parse(device.cloud) : undefined,
      capability: device.capability ? JSON.parse(device.capability) : undefined,
      chromeDriverPath: device.chromeDriverPath ? JSON.parse(device.chromeDriverPath) : undefined,
      tags: device.tags ? JSON.parse(device.tags) : undefined,
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
      batteryLevel: device.batteryLevel ?? undefined,
      thermalStatus: device.thermalStatus ?? undefined,
      storageFree: device.storageFree ?? undefined,
      sessionProgress: device.sessionProgress ?? '',
      totalHealedCount: device.totalHealedCount ?? 0,
    } as IDevice;
  }

  private fromIDevice(device: Partial<IDevice>): any {
    const data: any = { ...device };
    if (data.cloud && typeof data.cloud === 'object') data.cloud = JSON.stringify(data.cloud);
    if (data.capability && typeof data.capability === 'object')
      data.capability = JSON.stringify(data.capability);
    if (data.chromeDriverPath && typeof data.chromeDriverPath === 'object')
      data.chromeDriverPath = JSON.stringify(data.chromeDriverPath);
    if (data.tags && Array.isArray(data.tags)) data.tags = JSON.stringify(data.tags);
    return data;
  }

  async getAllDevices(): Promise<IDevice[]> {
    const devices = await this.prisma.device.findMany();
    return devices.map((d: Device) => this.toIDevice(d));
  }

  async getDevices(filterOptions: IDeviceFilterOptions): Promise<IDevice[]> {
    const where: any = {};

    if (filterOptions.platform) {
      where.platform = filterOptions.platform;
    }

    if (filterOptions.busy !== undefined) {
      where.busy = filterOptions.busy;
    }

    if (filterOptions.offline !== undefined) {
      where.offline = filterOptions.offline;
    }

    if (filterOptions.userBlocked !== undefined) {
      where.userBlocked = filterOptions.userBlocked;
    }

    if (filterOptions.udid) {
      if (Array.isArray(filterOptions.udid)) {
        if (filterOptions.udid.length > 0) {
          where.udid = { in: filterOptions.udid };
        }
      } else {
        where.udid = filterOptions.udid;
      }
    }

    if (filterOptions.deviceType) {
      where.deviceType = filterOptions.deviceType;
    }

    if (filterOptions.session_id) {
      where.session_id = filterOptions.session_id;
    }

    if (filterOptions.filterByHost) {
      where.host = { contains: filterOptions.filterByHost };
    }

    // 1. Fetch narrowed result set from Database
    const devices = await this.prisma.device.findMany({ where });
    let results = devices.map((d: Device) => this.toIDevice(d));

    // 2. Apply complex filters (Semver, Tags) in memory on the narrowed set
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

    if (filterOptions.tags && filterOptions.tags.length > 0) {
      results = results.filter((d) => {
        if (!d.tags) return false;
        return filterOptions.tags!.every((tag) => d.tags!.includes(tag));
      });
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
    console.log(`[PrismaStore] Update device ${udid} at ${host}: ${result.count} records affected`);
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

  async findAndLockDevice(filterOptions: IDeviceFilterOptions): Promise<IDevice | null> {
    // 1. Get candidate devices that match the filters and are NOT busy
    const candidates = await this.getDevices({ ...filterOptions, busy: false });

    // 2. Attempt to atomically lock them one by one
    for (const device of candidates) {
      const result = await this.prisma.device.updateMany({
        where: {
          udid: device.udid,
          host: device.host,
          busy: false, // Double check it's still free
          offline: false
        },
        data: {
          busy: true,
          lastCmdExecutedAt: Date.now(),
          sessionStartTime: Date.now()
        }
      });

      if (result.count === 1) {
        log.info(`[PrismaStore] Successfully locked device ${device.udid} atomically`);
        // Fetch the latest state to return
        const lockedDevice = await this.prisma.device.findUnique({
          where: { udid_host: { udid: device.udid, host: device.host } }
        });
        return lockedDevice ? this.toIDevice(lockedDevice) : null;
      }
    }

    return null;
  }

  async resetMetrics(): Promise<void> {
    await this.prisma.device.updateMany({
      data: {
        totalHealedCount: 0,
      },
    });
  }
}

export class PrismaPendingSessionStore implements IPendingSessionStore {
  private prisma = Container.get(PrismaService);

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

export class PrismaCLIArgsStore implements ICLIArgsStore {
  private prisma = Container.get(PrismaService);

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

export class PrismaHealEtalonStore implements IHealEtalonStore {
  private prisma = Container.get(PrismaService);

  async saveSignature(etalon: any): Promise<void> {
    await this.prisma.locatorEtalon.upsert({
      where: { selector: etalon.selector },
      update: {
        strategy: etalon.strategy,
        attributes: JSON.stringify(etalon.attributes),
        nodeName: etalon.nodeName,
        lastSeen: new Date(),
      },
      create: {
        selector: etalon.selector,
        strategy: etalon.strategy,
        attributes: JSON.stringify(etalon.attributes),
        nodeName: etalon.nodeName,
        lastSeen: new Date(),
      },
    });
  }

  async getSignature(selector: string): Promise<any | null> {
    const etalon = await this.prisma.locatorEtalon.findUnique({
      where: { selector },
    });
    if (!etalon) return null;
    return {
      ...etalon,
      attributes: JSON.parse(etalon.attributes),
      lastSeen: etalon.lastSeen.getTime(),
    };
  }
}
