---
title: Notifications
---

# Webhook Notifications

Xenon can send real-time notifications to Slack channels or generic HTTP endpoints when important events occur in your device lab. Notifications are configured and managed through the Dashboard Settings UI.

---

## Event Types

| Event | When it is sent | What it carries |
|-------|-----------------|-----------------|
| `device_offline` | A device is no longer reported by its machine (unplugged, or its machine stopped) | `udid`, `name`, `host`, `platform` |
| `device_new` | A device is detected for the first time | `udid`, `name`, `host`, `platform` |
| `session_failed` | A session ends as failed (see below) | `sessionId`, `sessionName`, `failureReason`, `udid`, `deviceName`, `platform`, `osVersion`, `startTime`, `endTime` |
| `selector_health_digest` | The [Selector Health](selector-health.md) digest is sent | `windowDays`, `totalHeals`, `distinctSelectors`, `hotspots` |

These names are the same in the Slack message, the generic JSON and a custom payload. A device event also carries the device's other fields; they may change, so rely only on the names above. `startTime` and `endTime` are ISO 8601 text, and a value Xenon doesn't know is empty text, never missing.

### When `session_failed` is sent

Once per session, when it ends as failed, however it ends:

- the test marked it failed (`xenon: setSessionStatus`), or a command in it failed, and then the session ended;
- it timed out because no command arrived within `newCommandTimeoutSec`;
- its driver crashed;
- its heartbeat stopped.

A session that ends twice (a crash, then the client's own delete) is still sent once. It is **not** sent when the server itself shuts down (no test failed), for a session that was already failed when the server started (it was cut off by a restart or a crash), or when the dashboard is off, since the session's dashboard record is what the message is built from.

---

## Webhook Types

### Slack Webhooks

Xenon sends rich Slack messages with color-coded attachments:

- **Green** — `device_new` (new device connected)
- **Red** — `device_offline`, `session_failed` (alerts)

Each message includes structured fields for all payload attributes, plus a timestamp and "Xenon Device Farm" footer.

**Setup:**
1. Create a [Slack Incoming Webhook](https://api.slack.com/messaging/webhooks)
2. In the dashboard's **Notifications** page, add the webhook URL
3. Select the events you want to receive
4. Save

### Generic HTTP Webhooks

For non-Slack integrations (PagerDuty, Teams, custom endpoints), choose the **JSON** format and Xenon sends a JSON POST:

```json
{
  "event": "session_failed",
  "payload": {
    "sessionId": "a1b2c3d4-0000-4000-8000-000000000001",
    "sessionName": "Checkout flow",
    "failureReason": "Element not found: ~pay-now",
    "udid": "R58M123",
    "deviceName": "Galaxy S9+",
    "platform": "android",
    "osVersion": "10",
    "startTime": "2026-10-04T09:00:00.000Z",
    "endTime": "2026-10-04T09:02:30.000Z"
  }
}
```

---

## Custom Payload Templates

For advanced integrations, you can define a custom payload template using `{{name}}` substitution. A template replaces the Slack message and the JSON body, so the format doesn't matter once one is set:

```json
{
  "text": "{{eventType}}: session {{sessionId}} failed on {{deviceName}}: {{failureReason}}"
}
```

**Supported names:**
- `{{eventType}}` — The event name (`device_offline`, etc.)
- The names the event carries, from the table above.
- Dot notation reaches inside: `{{hotspots.0.originalSelector}}` is the first selector in the digest.

A name the event doesn't have is left as you wrote it, so a typo shows up in the message instead of vanishing. The dashboard lists the names for the events you selected.

:::tip
A template that is JSON as written is filled in string by string, so a failure reason with quotes or line breaks can't break it. A template that is not JSON (for example `Failed: {{failureReason}}`, or `{"heals": {{totalHeals}}}`) is filled in as text, sent as JSON if the result parses, and otherwise wrapped in a `{ "text": "..." }` envelope — compatible with Slack, Microsoft Teams, and most webhook receivers.
:::

---

## Dashboard Configuration

1. Open **Notifications** in the dashboard's sidebar
2. Enter the webhook URL
3. Choose the **message format**: a Slack message, or JSON (`event` and `payload`)
4. Select the events to subscribe to
5. Optionally define a custom payload. It is sent as written, whatever the format
6. Click **Send test**. Xenon sends a sample of each selected event, filled into your format and payload exactly as a real event would be, and tells you which one failed and why
7. Click **Save webhook**

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/xenon/api/webhook` | `GET` | List all webhook configurations |
| `/xenon/api/webhook` | `POST` | Create a new webhook |
| `/xenon/api/webhook/:id` | `DELETE` | Delete a webhook configuration |
| `/xenon/api/webhook/test` | `POST` | Send a sample of an event (`event`, `device_new` by default) to a URL, with a `type` and `payloadTemplate` |

Every route needs the `ADMIN` role and the `admin` scope. The full request and response shapes are in your server's API reference at `/xenon/api-docs`.
