import variables from './webhookEventVariables.json';

/**
 * What each webhook event offers a custom payload template: the names that
 * `{{name}}` fills in, besides `{{eventType}}`. The server defines them
 * (src/services/webhookEvents.ts) and a spec keeps the JSON list equal to
 * it, so a chip never offers a name that stays unfilled.
 */
export type WebhookEventId =
  | 'device_offline'
  | 'device_new'
  | 'session_failed'
  | 'selector_health_digest';

export const WEBHOOK_EVENT_VARIABLES: Record<WebhookEventId, string[]> = variables;

/** What a chip stands for, shown when pointing at it. */
export const WEBHOOK_VARIABLE_HELP: Record<string, string> = {
  eventType: 'The event: device_offline, session_failed, ...',
  udid: "The device's id",
  name: "The device's name",
  host: 'The machine it is plugged into',
  platform: 'android or ios',
  sessionId: "The session's id",
  sessionName: "The session's name, if the test gave it one",
  failureReason: 'Why it failed',
  deviceName: "The device's name",
  osVersion: "The device's OS version",
  startTime: 'When it started (ISO 8601)',
  endTime: 'When it ended (ISO 8601)',
  windowDays: 'How many days the digest covers',
  totalHeals: 'Heals in that time',
  distinctSelectors: 'Selectors that were healed',
};

/** The chips for the events a webhook is subscribed to: `eventType`, then each name once. */
export function templateVariables(events: string[]): string[] {
  const names = ['eventType'];
  for (const event of events) {
    for (const name of WEBHOOK_EVENT_VARIABLES[event as WebhookEventId] ?? []) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}
