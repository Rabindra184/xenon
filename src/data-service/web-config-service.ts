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

/** How each saved setting is read back: they are all stored as text. */
const SETTINGS: Record<keyof IWebConfig, 'number' | 'text' | 'boolean'> = {
  healthCheckIntervalMs: 'number',
  healthCheckSchedule: 'text',
  buildCleanupDays: 'number',
  buildCleanupMaxCount: 'number',
  buildCleanupSchedule: 'text',
  deleteBuildAssets: 'boolean',
};

/**
 * The lab settings the dashboard saves, one `WebConfig` row each, keyed by the
 * setting's name.
 *
 * A row's `id` is the table's primary key, and used to be written as 'global'
 * for every setting, so the table held one: the first setting saved was kept,
 * and saving a second failed with "Unique constraint failed on the fields
 * (`id`)". A setting's row now has its own name as its id, as the metrics
 * counters kept in the same table do. A row an earlier version saved under
 * 'global' is still read, and still the one the next save of that setting
 * updates.
 */
@Service()
export class WebConfigService {
  public async getConfig(): Promise<IWebConfig> {
    const rows = await prisma.webConfig.findMany({
      where: { name: { in: Object.keys(SETTINGS) } },
    });

    const result: Record<string, number | string | boolean> = {};
    for (const row of rows) {
      const kind = SETTINGS[row.name as keyof IWebConfig];
      if (kind === 'number') result[row.name] = parseInt(row.value);
      else if (kind === 'boolean') result[row.name] = row.value === 'true';
      else if (kind === 'text') result[row.name] = row.value;
    }
    return result as IWebConfig;
  }

  public async setConfig(config: IWebConfig): Promise<void> {
    const writes = (Object.keys(SETTINGS) as Array<keyof IWebConfig>)
      .filter((name) => config[name] !== undefined && config[name] !== null)
      .map((name) => {
        const value = String(config[name]);
        return prisma.webConfig.upsert({
          where: { name },
          update: { value },
          create: { id: name, name, value },
        });
      });

    await Promise.all(writes);
  }
}
