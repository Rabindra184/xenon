import { prisma } from '../prisma';
import { Service } from 'typedi';

export interface IWebConfig {
  healthCheckIntervalMs?: number;
  healthCheckSchedule?: string;
  buildCleanupDays?: number;
  buildCleanupMaxCount?: number;
  buildCleanupSchedule?: string;
  deleteBuildAssets?: boolean;
}

@Service()
export class WebConfigService {
  private readonly CONFIG_ID = 'global';

  public async getConfig(): Promise<IWebConfig> {
    const configs = await prisma.webConfig.findMany({
      where: { id: this.CONFIG_ID },
    });

    const result: IWebConfig = {};
    for (const config of configs) {
      if (config.name === 'healthCheckIntervalMs') {
        result.healthCheckIntervalMs = parseInt(config.value);
      } else if (config.name === 'healthCheckSchedule') {
        result.healthCheckSchedule = config.value;
      } else if (config.name === 'buildCleanupDays') {
        result.buildCleanupDays = parseInt(config.value);
      } else if (config.name === 'buildCleanupMaxCount') {
        result.buildCleanupMaxCount = parseInt(config.value);
      } else if (config.name === 'buildCleanupSchedule') {
        result.buildCleanupSchedule = config.value;
      } else if (config.name === 'deleteBuildAssets') {
        result.deleteBuildAssets = config.value === 'true';
      }
    }
    return result;
  }

  public async setConfig(config: IWebConfig): Promise<void> {
    const promises = [];

    if (config.healthCheckIntervalMs !== undefined) {
      promises.push(
        prisma.webConfig.upsert({
          where: { name: 'healthCheckIntervalMs' },
          update: { value: config.healthCheckIntervalMs.toString() },
          create: {
            id: this.CONFIG_ID,
            name: 'healthCheckIntervalMs',
            value: config.healthCheckIntervalMs.toString(),
          },
        }),
      );
    }

    if (config.healthCheckSchedule !== undefined) {
      promises.push(
        prisma.webConfig.upsert({
          where: { name: 'healthCheckSchedule' },
          update: { value: config.healthCheckSchedule },
          create: {
            id: this.CONFIG_ID,
            name: 'healthCheckSchedule',
            value: config.healthCheckSchedule,
          },
        }),
      );
    }

    if (config.buildCleanupDays !== undefined) {
      promises.push(
        prisma.webConfig.upsert({
          where: { name: 'buildCleanupDays' },
          update: { value: config.buildCleanupDays.toString() },
          create: {
            id: this.CONFIG_ID,
            name: 'buildCleanupDays',
            value: config.buildCleanupDays.toString(),
          },
        }),
      );
    }

    if (config.buildCleanupMaxCount !== undefined) {
      promises.push(
        prisma.webConfig.upsert({
          where: { name: 'buildCleanupMaxCount' },
          update: { value: config.buildCleanupMaxCount.toString() },
          create: {
            id: this.CONFIG_ID,
            name: 'buildCleanupMaxCount',
            value: config.buildCleanupMaxCount.toString(),
          },
        }),
      );
    }

    if (config.buildCleanupSchedule !== undefined) {
      promises.push(
        prisma.webConfig.upsert({
          where: { name: 'buildCleanupSchedule' },
          update: { value: config.buildCleanupSchedule },
          create: {
            id: this.CONFIG_ID,
            name: 'buildCleanupSchedule',
            value: config.buildCleanupSchedule,
          },
        }),
      );
    }

    if (config.deleteBuildAssets !== undefined) {
      promises.push(
        prisma.webConfig.upsert({
          where: { name: 'deleteBuildAssets' },
          update: { value: config.deleteBuildAssets.toString() },
          create: {
            id: this.CONFIG_ID,
            name: 'deleteBuildAssets',
            value: config.deleteBuildAssets.toString(),
          },
        }),
      );
    }

    await Promise.all(promises);
  }
}
