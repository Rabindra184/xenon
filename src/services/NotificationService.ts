import axios from 'axios';
import log from '../logger';
import { PrismaService } from '../data-service/prisma-service';
import { WebhookConfig } from '../generated/client';
import { Service } from 'typedi';

export type EventType =
  | 'device_offline'
  | 'session_failed'
  | 'device_new'
  | 'selector_health_digest';

@Service()
export class NotificationService {
  constructor(private prisma: PrismaService) {}

  async getConfigs(): Promise<WebhookConfig[]> {
    return this.prisma.client.webhookConfig.findMany();
  }

  async saveConfig(
    url: string,
    events: string[],
    type = 'slack',
    payloadTemplate?: string,
  ): Promise<WebhookConfig> {
    return this.prisma.client.webhookConfig.create({
      data: {
        url,
        events: JSON.stringify(events),
        type,
        payloadTemplate,
        active: true,
      },
    });
  }

  async deleteConfig(id: string): Promise<void> {
    await this.prisma.client.webhookConfig.delete({ where: { id } });
  }

  async dispatchEvent(eventType: EventType, payload: any) {
    const configs = await this.getConfigs();

    for (const config of configs) {
      if (!config.active) continue;

      try {
        const events = JSON.parse(config.events) as string[];
        if (events.includes(eventType)) {
          await this.sendToWebhook(config, eventType, payload);
        }
      } catch (err) {
        log.error(`Failed to process webhook config ${config.id}: ${err}`);
      }
    }
  }

  private async sendToWebhook(config: WebhookConfig, eventType: EventType, payload: any) {
    // Principal Logic: Use custom template if defined
    if (config.payloadTemplate) {
      const substitutedBody = this.substituteTemplate(config.payloadTemplate, {
        eventType,
        ...payload,
      });

      try {
        // Try to parse as JSON first
        const jsonBody = JSON.parse(substitutedBody);
        await axios.post(config.url, jsonBody);
      } catch (e) {
        // Fallback to sending as plain text or simple object
        await axios.post(config.url, { text: substitutedBody });
      }
      return;
    }

    if (config.type === 'slack') {
      await this.sendSlackMessage(config.url, eventType, payload);
    } else {
      // Generic webhook fallback
      try {
        await axios.post(config.url, { event: eventType, payload });
      } catch (err) {
        log.error(`Webhook failed for ${config.url}: ${err}`);
      }
    }
  }

  // Principal Logic: Recursive variable substitution with {{key}} support
  private substituteTemplate(template: string, data: any): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const keys = key.trim().split('.');
      let value = data;
      for (const k of keys) {
        value = value ? value[k] : undefined;
      }
      return value !== undefined ? String(value) : match;
    });
  }

  private async sendSlackMessage(url: string, eventType: EventType, payload: any) {
    let text = '';
    let color = '#36a64f'; // green

    switch (eventType) {
      case 'device_offline':
        text = `🚨 *Device Offline*: ${payload.udid} (${payload.host})`;
        color = '#ff0000';
        break;
      case 'session_failed':
        text = `❌ *Session Failed*: ${payload.sessionId}\nReason: ${payload.failureReason}`;
        color = '#ff0000';
        break;
      case 'device_new':
        text = `📱 *New Device Connected*: ${payload.name} (${payload.udid})`;
        break;
      case 'selector_health_digest': {
        // Render the digest as a Slack message rather than a flat key/value
        // dump. Skip the generic field renderer below so we control the
        // formatting end-to-end.
        const totalHeals = payload.totalHeals ?? 0;
        const distinctSelectors = payload.distinctSelectors ?? 0;
        const estCostUsd = payload.estCostUsd ?? 0;
        const windowDays = payload.windowDays ?? 30;
        const top: Array<any> = Array.isArray(payload.hotspots) ? payload.hotspots : [];
        const lines = top
          .slice(0, 5)
          .map(
            (h, i) =>
              `${i + 1}. *${h.healCount}× healed* — \`${h.originalSelector}\`` +
              (h.suggestedRewrite ? `\n   ↳ rewrite: \`${h.suggestedRewrite}\`` : ''),
          )
          .join('\n');
        const summary = `🩺 *Selector Health digest* — last ${windowDays}d\n${totalHeals} heals across ${distinctSelectors} selectors · est. $${estCostUsd.toFixed(2)}`;
        const body = {
          text: summary,
          attachments: [
            {
              color: top.length > 0 ? '#f59e0b' : '#36a64f',
              text: top.length > 0 ? lines : 'No hotspots to flag — locator hygiene is clean.',
              footer: 'Xenon · Selector Health',
              ts: Math.floor(Date.now() / 1000),
            },
          ],
        };
        try {
          await axios.post(url, body);
          log.info(`Selector Health digest sent to ${url}`);
        } catch (err) {
          log.error(`Failed to send digest to ${url}: ${err}`);
        }
        return;
      }
      default:
        text = `Event: ${eventType}\nPayload: ${JSON.stringify(payload)}`;
    }

    const body = {
      attachments: [
        {
          color,
          text,
          fields: Object.keys(payload).map((k) => ({
            title: k,
            value: typeof payload[k] === 'object' ? JSON.stringify(payload[k]) : String(payload[k]),
            short: true,
          })),
          footer: 'Xenon Device Farm',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    try {
      await axios.post(url, body);
      log.info(`Slack notification sent to ${url}`);
    } catch (err) {
      log.error(`Failed to send Slack notification: ${err}`);
    }
  }
}
