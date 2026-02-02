import { prisma } from '../prisma';

export interface IWebConfig {
  healthCheckIntervalMs?: number;
  healthCheckSchedule?: string;
}

export class WebConfigService {
  private static readonly CONFIG_ID = 'global';

  public static async getConfig(): Promise<IWebConfig> {
    const configs = await prisma.webConfig.findMany({
      where: { id: this.CONFIG_ID },
    });

    const result: IWebConfig = {};
    for (const config of configs) {
      if (config.name === 'healthCheckIntervalMs') {
        result.healthCheckIntervalMs = parseInt(config.value);
      } else if (config.name === 'healthCheckSchedule') {
        result.healthCheckSchedule = config.value;
      }
    }
    return result;
  }

  public static async setConfig(config: IWebConfig): Promise<void> {
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

    await Promise.all(promises);
  }
}
