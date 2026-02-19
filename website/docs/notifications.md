---
title: Notifications
---

# Webhook Notifications

Xenon can send real-time notifications to Slack channels or generic HTTP endpoints when important events occur in your device lab. Notifications are configured and managed through the Dashboard Settings UI.

---

## Event Types

| Event | Trigger | Payload |
|-------|---------|---------|
| `device_offline` | A previously online device goes offline | `udid`, `host`, `name` |
| `session_failed` | A test session ends with a failure | `sessionId`, `failureReason`, `device` |
| `device_new` | A new device is detected and registered | `udid`, `name`, `platform` |

---

## Webhook Types

### Slack Webhooks

Xenon sends rich Slack messages with color-coded attachments:

- **Green** — `device_new` (new device connected)
- **Red** — `device_offline`, `session_failed` (alerts)

Each message includes structured fields for all payload attributes, plus a timestamp and "Xenon Device Farm" footer.

**Setup:**
1. Create a [Slack Incoming Webhook](https://api.slack.com/messaging/webhooks)
2. In Dashboard → Settings → Notifications, add the webhook URL
3. Select the events you want to receive
4. Save

### Generic HTTP Webhooks

For non-Slack integrations (PagerDuty, Teams, custom endpoints), Xenon sends a JSON POST:

```json
{
  "event": "device_offline",
  "payload": {
    "udid": "00008110-001A...",
    "host": "lab-node-01",
    "name": "iPhone 15 Pro"
  }
}
```

---

## Custom Payload Templates

For advanced integrations, you can define a custom payload template using `{{variable}}` substitution:

```json
{
  "text": "Alert: {{eventType}} on device {{udid}}",
  "device": "{{name}}",
  "host": "{{host}}"
}
```

**Supported variables:**
- `{{eventType}}` — The event name (`device_offline`, etc.)
- Any key from the event payload (`{{udid}}`, `{{sessionId}}`, `{{failureReason}}`, etc.)
- Nested access via dot notation: `{{device.name}}`

:::tip
If your template produces valid JSON, it will be sent as a JSON body. Otherwise, it's wrapped in a `{ "text": "..." }` envelope — compatible with Slack, Microsoft Teams, and most webhook receivers.
:::

---

## Dashboard Configuration

1. Navigate to **Settings → Notifications**
2. Click **Add Webhook**
3. Enter the webhook URL
4. Select events to subscribe to
5. Optionally define a custom payload template
6. Toggle **Active** on/off to enable or disable without deleting

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/xenon/api/webhooks` | `GET` | List all webhook configurations |
| `/xenon/api/webhooks` | `POST` | Create a new webhook |
| `/xenon/api/webhooks/:id` | `DELETE` | Delete a webhook configuration |
