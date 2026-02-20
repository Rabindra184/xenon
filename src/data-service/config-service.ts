import storage from 'node-persist';
import { Service } from 'typedi';
import { cachePath } from '../helpers';
import { IPluginArgs } from '../interfaces/IPluginArgs';
import { SecurityService } from '../services/SecurityService';
import log from '../logger';
import path from 'path';
import fs from 'fs';

const CONFIG_DIR = cachePath('config');

@Service()
export class ConfigService {
  private storage?: storage.LocalStorage;

  constructor(private securityService: SecurityService) {}

  public async init() {
    if (!this.storage) {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      this.storage = storage.create({ dir: CONFIG_DIR });
      await this.storage.init();
    }
  }

  private readonly sensitiveFields: (keyof IPluginArgs)[] = ['databaseUrl'];

  public async loadConfig(): Promise<Partial<IPluginArgs>> {
    await this.init();
    const config = (await this.storage?.getItem('pluginArgs')) || {};

    // Decrypt sensitive fields
    for (const field of this.sensitiveFields) {
      if (config[field]) {
        config[field] = await this.securityService.decrypt(config[field] as string);
      }
    }

    return config;
  }

  public async updateConfig(newConfig: Partial<IPluginArgs>): Promise<void> {
    await this.init();
    const currentConfig = await this.loadConfig();
    try {
      const mergedConfig = { ...currentConfig, ...newConfig };
      const toSave = { ...mergedConfig };

      // Encrypt sensitive fields before saving
      for (const field of this.sensitiveFields) {
        if (toSave[field]) {
          (toSave as any)[field] = await this.securityService.encrypt(toSave[field] as string);
        }
      }

      await this.storage?.setItem('pluginArgs', toSave);

      // Update runtime Global Config and Process.env for immediate effect
      const { updateConfig: updateGlobalConfig } = await import('../config');
      const runtimeUpdate: any = {};

      if (newConfig.aiProvider) runtimeUpdate.aiProvider = newConfig.aiProvider;
      if (newConfig.aiModel) runtimeUpdate.aiModel = newConfig.aiModel;
      if (newConfig.aiBaseUrl) runtimeUpdate.aiBaseUrl = newConfig.aiBaseUrl;

      // Sync Keys to both Global Config and legacy Process.env
      if (newConfig.geminiApiKey) {
        runtimeUpdate.geminiApiKey = newConfig.geminiApiKey;
        process.env.GEMINI_API_KEY = newConfig.geminiApiKey;
      }
      if (newConfig.openaiApiKey) {
        runtimeUpdate.openaiApiKey = newConfig.openaiApiKey;
        process.env.OPENAI_API_KEY = newConfig.openaiApiKey;
      }
      if (newConfig.anthropicApiKey) {
        runtimeUpdate.anthropicApiKey = newConfig.anthropicApiKey;
        process.env.ANTHROPIC_API_KEY = newConfig.anthropicApiKey;
      }

      if (Object.keys(runtimeUpdate).length > 0) {
        updateGlobalConfig(runtimeUpdate);
      }

      log.info('Updated plugin configuration (encrypted at rest)');
    } catch (err: any) {
      log.error(`Persistence failure in ConfigService: ${err.message}`);
      throw err;
    }
  }

  public async resetConfig(): Promise<void> {
    await this.init();
    await this.storage?.clear();
  }
}
