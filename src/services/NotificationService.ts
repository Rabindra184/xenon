import axios from 'axios';
import log from '../logger';
import { PrismaService } from '../data-service/prisma-service';
import { WebhookConfig } from '../generated/client';
import { Service } from 'typedi';
import {
  EventType,
  WEBHOOK_EVENTS,
  renderTemplate,
  sessionFailedPayload,
  SessionRow,
} from './webhookEvents';

// The payload of each event is documented in webhookEvents.ts.
export type { EventType } from './webhookEvents';

/** How many sessions' failure notices are remembered, so a session ending twice sends once. */
const NOTIFIED_SESSIONS_KEPT = 2000;

@Service()
export class NotificationService {
  /** Sessions whose failure was sent, oldest first (a Set keeps insertion order). */
  private readonly notifiedSessions = new Set<string>();

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
        log.error(`Webhook ${config.id} (${config.url}) failed for ${eventType}: ${err}`);
      }
    }
  }

  /**
   * Tells the webhooks subscribed to `session_failed` that a session failed.
   *
   * Once per session however many times it ends: a driver crash and the
   * client's own delete both end it, as do a heartbeat timeout and a delete.
   * Remembered by id in memory, so a restart forgets it, which is harmless:
   * a session does not end again after one.
   */
  async notifySessionFailed(session: SessionRow): Promise<void> {
    if (this.notifiedSessions.has(session.id)) return;
    this.notifiedSessions.add(session.id);
    if (this.notifiedSessions.size > NOTIFIED_SESSIONS_KEPT) {
      const oldest = this.notifiedSessions.values().next().value as string;
      this.notifiedSessions.delete(oldest);
    }
    await this.dispatchEvent('session_failed', sessionFailedPayload(session));
  }

  /**
   * Sends a sample of `event` to a webhook the way a real one would be sent,
   * and fails if the delivery does: "Send test" used to say it worked
   * whatever happened, and ignored the webhook's type and template.
   */
  async sendTest(
    url: string,
    type = 'slack',
    payloadTemplate?: string | null,
    event: EventType = 'device_new',
  ): Promise<void> {
    await this.sendToWebhook(
      { url, type, payloadTemplate: payloadTemplate ?? null } as WebhookConfig,
      event,
      WEBHOOK_EVENTS[event].sample(),
    );
  }

  /** Delivers one event. Throws when the webhook refuses or can't be reached. */
  private async sendToWebhook(config: WebhookConfig, eventType: EventType, payload: any) {
    // A custom template, if there is one, replaces the built-in message.
    if (config.payloadTemplate) {
      const body = renderTemplate(config.payloadTemplate, { eventType, ...payload });
      await axios.post(config.url, body);
      return;
    }

    if (config.type === 'slack') {
      await this.sendSlackMessage(config.url, eventType, payload);
    } else {
      // Generic webhook
      await axios.post(config.url, { event: eventType, payload });
    }
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
        text =
          `❌ *Session Failed*: ${payload.sessionId}\n` +
          `Reason: ${payload.failureReason || 'no reason recorded'}\n` +
          `Device: ${payload.deviceName || payload.udid} (${payload.udid})`;
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
        const summary = `🩺 *Selector Health digest* — last ${windowDays}d\n${totalHeals} heals across ${distinctSelectors} selectors`;
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
        await axios.post(url, body);
        log.info(`Selector Health digest sent to ${url}`);
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

    // A failure is the caller's: dispatchEvent logs it and goes on to the
    // next webhook; sendTest reports it.
    await axios.post(url, body);
    log.info(`Slack notification sent to ${url}`);
  }
}
