import { Router } from 'express';
import { IPluginArgs } from '../../interfaces/IPluginArgs';
import { ConfigService } from '../../data-service/config-service';
import { Container } from 'typedi';
import log, { redactSecrets } from '../../logger';

import { AI_SERVICE } from '../../services/AIService';

export default class ConfigRouter {
  public static register(router: Router, pluginArgs: IPluginArgs) {
    const configRouter = Router();

    function getMaskedConfig(args: IPluginArgs) {
      const masked = { ...args };
      // Boolean flags for secret status
      (masked as any).geminiSet = !!(process.env.XENON_GEMINI_API_KEY || process.env.GEMINI_API_KEY);
      (masked as any).openaiSet = !!(process.env.XENON_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
      (masked as any).anthropicSet = !!(
        process.env.XENON_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
      );

      // Remove actual keys from the response completely
      delete masked.geminiApiKey;
      delete masked.openaiApiKey;
      delete masked.anthropicApiKey;

      if (masked.databaseUrl) {
        masked.databaseUrl = '********';
      }

      return masked;
    }

    configRouter.get('/', async (req, res) => {
      res.json(getMaskedConfig(pluginArgs));
    });

    configRouter.post('/test-ai', async (req, res) => {
      const testConfig = (req as any).unredactedBody || req.body;
      try {
        const result = await AI_SERVICE.testConnection(testConfig);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

    configRouter.post('/', async (req, res) => {
      const newConfig = ((req as any).unredactedBody || req.body) as Partial<IPluginArgs>;
      if (!newConfig || Object.keys(newConfig).length === 0) {
        return res.status(400).json({ error: 'No configuration provided' });
      }

      // Environment-Only Enforcement: Ignore any keys sent via UI
      delete newConfig.geminiApiKey;
      delete newConfig.openaiApiKey;
      delete newConfig.anthropicApiKey;

      // Handle Database URL mask preservation
      if (newConfig.databaseUrl && newConfig.databaseUrl.includes('****')) {
        delete newConfig.databaseUrl;
      }

      try {
        log.debug(`Updating configuration with payload: ${JSON.stringify(redactSecrets(newConfig))}`);
        // 1. Persist (also updates global config singleton and env vars)
        await Container.get(ConfigService).updateConfig(newConfig);

        // 2. Update Runtime Object (for Appium Plugin lifecycle)
        Object.assign(pluginArgs, newConfig);

        log.info('Configuration updated via API');

        res.json({
          success: true,
          config: getMaskedConfig(pluginArgs),
          restartRequired: checkRestartRequired(newConfig),
          message:
            'Configuration updated. Some changes may require a server restart to take full effect.',
        });
      } catch (err: any) {
        log.error(`Failed to update config: ${err.message}`, err);
        res.status(500).json({ success: false, error: `Failed to update configuration: ${err.message}` });
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
