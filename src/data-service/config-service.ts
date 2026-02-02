import storage from 'node-persist';
import { cachePath } from '../helpers';
import { IPluginArgs } from '../interfaces/IPluginArgs';
import log from '../logger';
import path from 'path';
import fs from 'fs';

const CONFIG_DIR = cachePath('config');

export class ConfigService {
    private static instance: ConfigService;
    private storage?: storage.LocalStorage;

    private constructor() { }

    public static getInstance(): ConfigService {
        if (!ConfigService.instance) {
            ConfigService.instance = new ConfigService();
        }
        return ConfigService.instance;
    }

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
