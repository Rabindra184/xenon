import axios from 'axios';
import log from '../logger';
import { PrismaService } from '../data-service/prisma-service';
import { WebhookConfig } from '@prisma/client';

export type EventType = 'device_offline' | 'session_failed' | 'device_new';

class NotificationService {
  private prisma = PrismaService.instance;
  private static instance: NotificationService;

  private constructor() {}

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  async getConfigs(): Promise<WebhookConfig[]> {
    return this.prisma.webhookConfig.findMany();
  }

  async saveConfig(
    url: string,
    events: string[],
    type: string = 'slack',
    payloadTemplate?: string,
  ): Promise<WebhookConfig> {
    return this.prisma.webhookConfig.create({
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
    await this.prisma.webhookConfig.delete({ where: { id } });
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

export default NotificationService.getInstance();
