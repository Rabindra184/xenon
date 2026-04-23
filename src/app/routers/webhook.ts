import { Router, Request, Response } from 'express';
import { NotificationService } from '../../services/NotificationService';
import { Container } from 'typedi';
import log from '../../logger';
import { scopeGuard } from '../../middleware/scopeGuard';

async function getConfigs(req: Request, res: Response) {
  try {
    const configs = await Container.get(NotificationService).getConfigs();
    res.json(configs);
  } catch (err) {
    log.error(`Failed to get webhook configs: ${err}`);
    res.status(500).json({ error: 'Failed to fetch configurations' });
  }
}

async function addConfig(req: Request, res: Response) {
  const { url, events, type, payloadTemplate } = req.body;

  if (!url || !events || !Array.isArray(events)) {
    return res.status(400).json({ error: 'Invalid parameters: url and events array required' });
  }

  try {
    const config = await Container.get(NotificationService).saveConfig(
      url,
      events,
      type || 'slack',
      payloadTemplate,
    );
    res.json(config);
  } catch (err) {
    log.error(`Failed to save webhook config: ${err}`);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
}

async function deleteConfig(req: Request, res: Response) {
  const { id } = req.params;
  try {
    await Container.get(NotificationService).deleteConfig(id);
    res.json({ success: true });
  } catch (err) {
    log.error(`Failed to delete webhook config: ${err}`);
    res.status(500).json({ error: 'Failed to delete configuration' });
  }
}

async function testWebhook(req: Request, res: Response) {
  const { url, type } = req.body;
  try {
    await (Container.get(NotificationService) as any).sendSlackMessage(url, 'device_new', {
      udid: 'test-device-udid',
      name: 'Test Device',
      host: '127.0.0.1',
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Test failed: ${err}` });
  }
}

function register(router: Router) {
  router.get('/webhook', getConfigs);
  // Webhook mutations are admin-only: adding / removing / test-firing global
  // webhooks is a fleet-wide config change.
  router.post('/webhook', scopeGuard(['admin']), addConfig);
  router.delete('/webhook/:id', scopeGuard(['admin']), deleteConfig);
  router.post('/webhook/test', scopeGuard(['admin']), testWebhook);
}

export default {
  register,
};
