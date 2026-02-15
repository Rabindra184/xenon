import { Router } from 'express';
import { IPluginArgs } from '../../interfaces/IPluginArgs';
import { ConfigService } from '../../data-service/config-service';
import { Container } from 'typedi';
import log from '../../logger';

import { AI_SERVICE } from '../../services/AIService';

export default class ConfigRouter {
  public static register(router: Router, pluginArgs: IPluginArgs) {
    const configRouter = Router();

    configRouter.get('/', async (req, res) => {
      // Return the current effective config (runtime)
      res.json(pluginArgs);
    });

    configRouter.post('/test-ai', async (req, res) => {
      const testConfig = req.body;
      try {
        const result = await AI_SERVICE.testConnection(testConfig);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    configRouter.put('/', async (req, res) => {
      const newConfig = req.body as Partial<IPluginArgs>;
      if (!newConfig || Object.keys(newConfig).length === 0) {
        return res.status(400).json({ error: 'No configuration provided' });
      }

      try {
        // 1. Persist
        await Container.get(ConfigService).updateConfig(newConfig);

        // 2. Update Runtime Object
        Object.assign(pluginArgs, newConfig);

        log.info(`Configuration updated via API: ${JSON.stringify(newConfig)}`);

        res.json({
          success: true,
          config: pluginArgs,
          restartRequired: checkRestartRequired(newConfig),
          message:
            'Configuration updated. Some changes may require a server restart to take full effect.',
        });
      } catch (err: any) {
        log.error(`Failed to update config: ${err.message}`);
        res.status(500).json({ error: 'Failed to update configuration' });
      }
    });

    router.use('/config', configRouter);
  }
}

function checkRestartRequired(newConfig: Partial<IPluginArgs>): boolean {
  // List of keys that definitely require restart
  const RESTART_KEYS = [
    'hub',
    'platform',
    'bindHostOrIp',
    'proxy',
    'cloud',
    'iosDeviceType',
    'androidDeviceType',
  ];
  return Object.keys(newConfig).some((key) => RESTART_KEYS.includes(key));
}
