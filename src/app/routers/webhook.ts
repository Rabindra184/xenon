import { Router, Request, Response } from 'express';
import { NotificationService } from '../../services/NotificationService';
import { EVENT_TYPES, isEventType } from '../../services/webhookEvents';
import { Container } from 'typedi';
import log from '../../logger';
import { scopeGuard } from '../../middleware/scopeGuard';
import { roleGuard } from '../../middleware/roleGuard';

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
  } catch (err: any) {
    // Prisma's "record to delete does not exist".
    if (err?.code === 'P2025') {
      return res.status(404).json({ error: 'not_found', message: 'Webhook not found' });
    }
    log.error(`Failed to delete webhook config: ${err}`);
    res.status(500).json({ error: 'Failed to delete configuration' });
  }
}

// Sends a sample of an event the way the webhook's real events go out (its
// type and template), and says whether it was delivered.
async function testWebhook(req: Request, res: Response) {
  const { url, type, payloadTemplate, event } = req.body ?? {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }
  if (event !== undefined && !isEventType(event)) {
    return res.status(400).json({ error: `event must be one of: ${EVENT_TYPES.join(', ')}` });
  }
  try {
    await Container.get(NotificationService).sendTest(url, type || 'slack', payloadTemplate, event);
    res.json({ success: true });
  } catch (err: any) {
    res.status(502).json({ error: 'delivery_failed', message: err?.message ?? String(err) });
  }
}

function register(parentRouter: Router) {
  const webhookRouterInstance = Router();
  webhookRouterInstance.use(roleGuard('ADMIN'));

  // The list holds every webhook's URL, which is often its secret (Slack's
  // are), so reading it needs the admin scope too. Through 2.12 an admin's
  // `read`-only key could list them.
  webhookRouterInstance.get('/', scopeGuard(['admin']), getConfigs);
  // Webhook mutations are admin-only: adding / removing / test-firing global
  // webhooks is a fleet-wide config change.
  webhookRouterInstance.post('/', scopeGuard(['admin']), addConfig);
  webhookRouterInstance.delete('/:id', scopeGuard(['admin']), deleteConfig);
  webhookRouterInstance.post('/test', scopeGuard(['admin']), testWebhook);

  parentRouter.use('/webhook', webhookRouterInstance);
}

export default {
  register,
};
