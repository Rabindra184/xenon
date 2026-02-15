import storage from 'node-persist';
import { Service } from 'typedi';
import { cachePath } from '../helpers';
import { IPluginArgs } from '../interfaces/IPluginArgs';
import log from '../logger';
import path from 'path';
import fs from 'fs';

const CONFIG_DIR = cachePath('config');

@Service()
export class ConfigService {
  private storage?: storage.LocalStorage;

  constructor() {}

  public async init() {
    if (!this.storage) {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      this.storage = storage.create({ dir: CONFIG_DIR });
      await this.storage.init();
    }
  }

  public async loadConfig(): Promise<Partial<IPluginArgs>> {
    await this.init();
    const config = await this.storage?.getItem('pluginArgs');
    return config || {};
  }

  public async updateConfig(newConfig: Partial<IPluginArgs>): Promise<void> {
    await this.init();
    const currentConfig = await this.loadConfig();
    const updatedConfig = { ...currentConfig, ...newConfig };
    await this.storage?.setItem('pluginArgs', updatedConfig);
    log.info(`Updated plugin configuration: ${JSON.stringify(updatedConfig)}`);
  }

  public async resetConfig(): Promise<void> {
    await this.init();
    await this.storage?.clear();
  }
}
