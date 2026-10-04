/**
 * What each webhook event carries.
 *
 * One shape per event, documented here and nowhere else. A webhook turns it
 * into a message in three ways, and all three read these names:
 *
 * - the built-in Slack message (`type: slack`, `NotificationService`);
 * - the generic JSON body, `{ "event": "<event>", "payload": { ... } }`;
 * - a custom template, where `{{name}}` stands for a name below, `{{eventType}}`
 *   for the event itself, and `{{a.b}}` or `{{list.0.b}}` reaches inside.
 *
 * The dashboard offers the names below as template chips
 * (`web/src/components/webhook-settings/webhookEvents.ts`; a spec keeps the two
 * lists equal). A device event also carries the device's other fields, which
 * may change: only the names listed are promised.
 */

export type EventType =
  | 'device_offline'
  | 'session_failed'
  | 'device_new'
  | 'selector_health_digest';

export interface WebhookVariable {
  name: string;
  description: string;
}

export interface WebhookEventDef {
  /** When Xenon sends it. */
  when: string;
  /** The names a template can use, besides `eventType`. */
  variables: WebhookVariable[];
  /** A realistic example, which "Send test" delivers. */
  sample: () => Record<string, any>;
}

const DEVICE_VARIABLES: WebhookVariable[] = [
  { name: 'udid', description: "The device's id" },
  { name: 'name', description: "The device's name" },
  { name: 'host', description: 'The machine it is plugged into' },
  { name: 'platform', description: 'android or ios' },
];

const sampleDevice = () => ({
  udid: 'test-device-udid',
  name: 'Test Device',
  host: '127.0.0.1',
  platform: 'android',
});

export const WEBHOOK_EVENTS: Record<EventType, WebhookEventDef> = {
  device_offline: {
    when: 'A device is no longer reported by its machine (unplugged, or its machine stopped).',
    variables: DEVICE_VARIABLES,
    sample: sampleDevice,
  },
  device_new: {
    when: 'A device is detected for the first time.',
    variables: DEVICE_VARIABLES,
    sample: sampleDevice,
  },
  session_failed: {
    when:
      'A session ends as failed, once per session: the test marked it failed, a command failed, ' +
      'it timed out for inactivity, its driver crashed, or its heartbeat stopped. Not when the ' +
      'server itself shuts down, and not for a session that was already failed when the server ' +
      'started.',
    variables: [
      { name: 'sessionId', description: "The session's id" },
      { name: 'sessionName', description: "The session's name, if the test gave it one" },
      { name: 'failureReason', description: 'Why it failed' },
      { name: 'udid', description: "The device's id" },
      { name: 'deviceName', description: "The device's name" },
      { name: 'platform', description: 'android or ios' },
      { name: 'osVersion', description: "The device's OS version" },
      { name: 'startTime', description: 'When it started (ISO 8601)' },
      { name: 'endTime', description: 'When it ended (ISO 8601)' },
    ],
    sample: () => ({
      sessionId: 'test-session-id',
      sessionName: 'Checkout flow',
      failureReason: 'Test message: element not found',
      udid: 'test-device-udid',
      deviceName: 'Test Device',
      platform: 'android',
      osVersion: '14',
      startTime: new Date(Date.now() - 150_000).toISOString(),
      endTime: new Date().toISOString(),
    }),
  },
  selector_health_digest: {
    when:
      'The Selector Health digest is sent. `hotspots` lists the most healed selectors, each ' +
      'with `healCount`, `originalSelector` and, when there is one, `suggestedRewrite`; reach ' +
      'into it with `{{hotspots.0.originalSelector}}`.',
    variables: [
      { name: 'windowDays', description: 'How many days the digest covers' },
      { name: 'totalHeals', description: 'Heals in that time' },
      { name: 'distinctSelectors', description: 'Selectors that were healed' },
    ],
    sample: () => ({
      windowDays: 30,
      totalHeals: 12,
      distinctSelectors: 3,
      hotspots: [
        {
          healCount: 7,
          originalSelector: "//*[@text='Log in']",
          suggestedRewrite: '~login-button',
        },
      ],
    }),
  },
};

export const EVENT_TYPES = Object.keys(WEBHOOK_EVENTS) as EventType[];

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as string[]).includes(value);
}

/** The columns of a Session row `session_failed` is built from. */
export interface SessionRow {
  id: string;
  name?: string | null;
  failure_reason?: string | null;
  device_udid: string;
  device_name?: string | null;
  device_platform: string;
  device_version: string;
  startTime: Date | string;
  endTime?: Date | string | null;
}

/**
 * `session_failed`'s payload. Not the row: a row has the session's
 * capabilities, the keys that created it and its AI analysis, and its names
 * are the database's (`failure_reason`). Unknown values are empty text, never
 * missing, so a template never shows "undefined" or "null".
 */
export function sessionFailedPayload(session: SessionRow) {
  const iso = (value: Date | string | null | undefined) =>
    value ? new Date(value).toISOString() : '';
  return {
    sessionId: session.id,
    sessionName: session.name ?? '',
    failureReason: session.failure_reason ?? '',
    udid: session.device_udid,
    deviceName: session.device_name ?? '',
    platform: session.device_platform,
    osVersion: session.device_version,
    startTime: iso(session.startTime),
    endTime: iso(session.endTime),
  };
}

function lookup(data: unknown, path: string): unknown {
  let value: any = data;
  for (const key of path.trim().split('.')) {
    value = value === null || value === undefined ? undefined : value[key];
  }
  return value;
}

const asText = (value: unknown) =>
  typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);

/** `{{name}}` filled in from `data` as text; a name `data` doesn't have stays as written. */
function fill(text: string, data: unknown): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const value = lookup(data, path);
    return value === undefined ? match : asText(value);
  });
}

function fillStrings(node: unknown, data: unknown): unknown {
  if (typeof node === 'string') return fill(node, data);
  if (Array.isArray(node)) return node.map((item) => fillStrings(item, data));
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, fillStrings(value, data)]),
    );
  }
  return node;
}

/**
 * The body a custom template sends for an event.
 *
 * A template that is JSON as written is filled in string by string, so a
 * value with a quote, a backslash or a line break (an error message, say)
 * cannot break it. Any other template, such as `{"n": {{totalHeals}}}` or
 * plain text, is filled in as text, then sent as JSON if the result parses,
 * and as `{ "text": "<result>" }` if not.
 */
export function renderTemplate(template: string, data: Record<string, unknown>): unknown {
  let written: unknown;
  try {
    written = JSON.parse(template);
  } catch {
    written = undefined;
  }
  if (written !== null && typeof written === 'object') return fillStrings(written, data);

  const text = fill(template, data);
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
