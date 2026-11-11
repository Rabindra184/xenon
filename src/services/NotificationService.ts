import axios from 'axios';
import log from '../logger';
import { PrismaService } from '../data-service/prisma-service';
import { WebhookConfig } from '../generated/client';
import { Service } from 'typedi';
import {
  EventType,
  HealRecord,
  WEBHOOK_EVENTS,
  WEBHOOK_TIMEOUT_MS,
  healingEventPayload,
  renderTemplate,
  sessionFailedPayload,
  sessionStartedPayload,
  sessionStoppedPayload,
  SessionRow,
} from './webhookEvents';

// The payload of each event is documented in webhookEvents.ts.
export type { EventType } from './webhookEvents';

/** How many sessions each once-per-session event remembers, so a session ending twice sends once. */
const NOTIFIED_SESSIONS_KEPT = 2000;

/** Every post's options: a webhook that never answers fails its delivery after this. */
const POST_OPTIONS = { timeout: WEBHOOK_TIMEOUT_MS };

/**
 * Sends a webhook event in the background: whoever reports it (a session's
 * start or end, a heal) never waits for a webhook, and a failure is logged,
 * never thrown.
 */
export function announce(event: EventType, about: string, send: () => Promise<void>): void {
  const failed = (err: any) =>
    log.warn(`${event} webhook for ${about} not sent: ${err?.message ?? err}`);
  try {
    void send().catch(failed);
  } catch (err) {
    failed(err);
  }
}

@Service()
export class NotificationService {
  /** Per once-per-session event, the sessions it was sent for, oldest first. */
  private readonly notifiedSessions = new Map<EventType, Set<string>>();

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
    if (!this.firstFor('session_failed', session.id)) return;
    await this.dispatchEvent('session_failed', sessionFailedPayload(session));
  }

  /** `session_started`, once per session (ENH-07). */
  async notifySessionStarted(session: SessionRow): Promise<void> {
    if (!this.firstFor('session_started', session.id)) return;
    await this.dispatchEvent('session_started', sessionStartedPayload(session));
  }

  /**
   * `session_stopped`, once per session, whatever its outcome (ENH-07), sent
   * from where `session_failed` is: the end that decides the status.
   */
  async notifySessionStopped(session: SessionRow): Promise<void> {
    if (!this.firstFor('session_stopped', session.id)) return;
    await this.dispatchEvent('session_stopped', sessionStoppedPayload(session));
  }

  /** `healing_event`, once per heal (ENH-07). */
  async notifyHeal(heal: HealRecord): Promise<void> {
    await this.dispatchEvent('healing_event', healingEventPayload(heal));
  }

  /** Whether `event` is yet to be sent for `sessionId`; remembers that it now is. */
  private firstFor(event: EventType, sessionId: string): boolean {
    let sent = this.notifiedSessions.get(event);
    if (!sent) this.notifiedSessions.set(event, (sent = new Set()));
    if (sent.has(sessionId)) return false;
    sent.add(sessionId);
    if (sent.size > NOTIFIED_SESSIONS_KEPT) {
      sent.delete(sent.values().next().value as string);
    }
    return true;
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
      await axios.post(config.url, body, POST_OPTIONS);
      return;
    }

    if (config.type === 'slack') {
      await this.sendSlackMessage(config.url, eventType, payload);
    } else {
      // Generic webhook
      await axios.post(config.url, { event: eventType, payload }, POST_OPTIONS);
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
      case 'session_started':
        text =
          `▶️ *Session Started*: ${payload.sessionName || payload.sessionId}\n` +
          `Device: ${payload.deviceName || payload.udid} (${payload.udid})`;
        color = '#3b82f6';
        break;
      case 'session_stopped': {
        const failed = payload.status === 'failed' || payload.status === 'timeout';
        text =
          `${failed ? '❌' : '✅'} *Session Ended* (${payload.status || 'unknown'}): ` +
          `${payload.sessionName || payload.sessionId}` +
          (payload.failureReason ? `\nReason: ${payload.failureReason}` : '') +
          `\nDevice: ${payload.deviceName || payload.udid} (${payload.udid})`;
        color = failed ? '#ff0000' : '#36a64f';
        break;
      }
      case 'healing_event':
        text =
          `🩹 *Selector Healed* (${payload.tier || 'unknown tier'}): ` +
          `\`${payload.originalSelector}\` → \`${payload.healedSelector}\`\n` +
          `Session: ${payload.sessionId} on ${payload.deviceName || payload.udid}`;
        color = '#f59e0b';
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
        await axios.post(url, body, POST_OPTIONS);
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
    await axios.post(url, body, POST_OPTIONS);
    log.info(`Slack notification sent to ${url}`);
  }
}
