---
title: Notifications and webhooks
description: Send Slack messages or JSON to your own endpoints when a phone goes offline, a new phone appears, a session fails, or a selector digest is sent. Also the email setting for password resets.
---

Xenon can tell your tools when something happens in the lab. A **webhook** is a URL that Xenon POSTs to when an event you chose occurs: a Slack channel, a chat or paging tool, or an endpoint of your own. This page covers the events, how to add a webhook, how to shape its message, and the one other thing Xenon notifies about, which is email for password resets.

Managing webhooks needs the Admin role. Over the API it also needs a token with the `admin` scope.

## The events

| Event | When it fires | What the event carries |
|---|---|---|
| `device_offline` | A phone is removed from the device list: it was unplugged, adb reports it as `offline` or `unauthorized`, or its node stopped answering or shut down. | `udid` and `host`. |
| `device_new` | A phone is added to the list. A server lists its own phones again each time it starts, so each counts as new then. | The phone's record, including `udid`, `name`, `platform`, `sdk` and `host`. |
| `session_failed` | A session is ended, by the client's delete or by Xenon's heartbeat check, and is marked failed or has a failure reason. A session that times out idle or whose driver crashes doesn't fire it, and neither does one with no session record. | The session's record, including `id`, `name`, `status`, `failure_reason`, `device_udid`, `device_name`, `device_platform` and `build_id`. |
| `selector_health_digest` | An admin sends the digest: see [The selector digest](#the-selector-digest). | `windowDays`, `totalHeals`, `distinctSelectors` and `hotspots`, a list whose entries have `healCount`, `originalSelector` and `suggestedRewrite`. |

## Add a webhook

In the dashboard, open **Notifications** in the sidebar.

1. For Slack, create an [incoming webhook](https://api.slack.com/messaging/webhooks) in your workspace and copy its URL.
2. Under **Add a new webhook**, paste the URL.
3. Choose the **Trigger events**: **Device offline**, **New device**, **Session failed** and **Selector health digest**. **Device offline** and **Session failed** are on to start with.
4. Choose **Test payload** to check the URL, then **Save webhook**.

The list above the form shows each webhook with the events it sends. A webhook can't be edited or switched off: to change one, **Remove** it and add it again.

### What is sent

The dashboard sets webhooks up for Slack. Slack gets a message with a coloured attachment: red for `device_offline` and `session_failed`, green for `device_new`. The attachment lists every field of the event, and has the footer "Xenon Device Farm". The digest is a summary line with the top selectors under it.

Over the API you can choose a plain JSON message instead, by giving the webhook a `type` that is not `slack`:

```json
{ "event": "device_offline", "payload": { "udid": "00008110-001A...", "host": "http://192.168.1.101:4723" } }
```

Each delivery is a single POST, never retried. A webhook that refuses it or can't be reached doesn't stop the event: Xenon logs the failure on the server and goes on to the other webhooks. Xenon doesn't sign what it sends, so treat the URL as a secret, as Slack's is.

## Shape the message

A custom payload replaces the built-in message, for any event and any webhook type. In the form, open **Use custom payload (optional)** and write a template. Each `{{name}}` is replaced by the event's field of that name, and `{{eventType}}` is the event's name:

```json
{
  "text": "{{eventType}}: {{udid}} went offline on {{host}}"
}
```

- Use dots to reach inside a field: `{{hotspots.0.originalSelector}}` is the first hotspot's selector in a digest.
- A name the event doesn't have is left as written, `{{name}}` and all.
- If the result is valid JSON, it is sent as JSON. If not, Xenon sends `{ "text": "<the result>" }`, which is the shape Slack's incoming webhooks take.

Use the field names in the table above. The variable buttons in the dashboard offer `sessionId` and `failureReason`, but a `session_failed` event names them `id` and `failure_reason`, so write those. A template for failures could be:

```json
{ "text": "Session {{id}} failed on {{device_name}}: {{failure_reason}}" }
```

## Test a webhook

**Test payload** sends a sample `device_new` event, for a phone called `Test Device`, and tells you whether the URL accepted it. A refused or unreachable URL is reported with the reason, not passed off as a success. The dashboard's test uses Slack's format and ignores a custom payload. To test the real thing, use the API, with the `type` and template you intend to save:

```bash
curl -X POST http://localhost:4723/xenon/api/webhook/test \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/hooks/xenon","type":"generic"}'
```

It answers `200` when the URL took the delivery, and `502` with `delivery_failed` and the reason when it didn't.

## Over the API

The routes are under `/xenon/api/webhook`, and all four need the Admin role and the `admin` scope:

```bash
# Add a webhook that posts JSON, for two events
curl -X POST http://localhost:4723/xenon/api/webhook \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/hooks/xenon","events":["device_offline","session_failed"],"type":"generic"}'

# List them: the URLs are secrets, which is why this needs the admin scope too
curl http://localhost:4723/xenon/api/webhook \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN"

# Remove one
curl -X DELETE http://localhost:4723/xenon/api/webhook/<id> \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN"
```

`type` is `slack` (the default) or anything else for the plain JSON message. `payloadTemplate` takes the template as a string. A webhook is active as soon as it's added. The [API reference](/api) has every field.

### The selector digest

The digest is a summary of the selectors that needed healing most. It isn't sent on a timer. An admin sends it with **Send digest** on the Selector Health page, which uses the period shown there, or a scheduler of yours calls the API:

```bash
curl -X POST http://localhost:4723/xenon/api/healing/digest/send \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"windowDays":7,"limit":5,"minHealCount":2}'
# {"sent":1,"windowDays":7,"hotspotsIncluded":3}
```

`windowDays` is how far back to look (7 by default), `limit` how many selectors to list (5 by default, at most 20), and `minHealCount` how often a selector must have healed to be listed (2 by default). It counts every team's heals, and goes to every webhook that chose the digest. See [Selector Health](./selector-health.md).

## Email for password resets

Xenon sends email for one thing: a link to reset a forgotten password. Set the connection in the server's environment before it starts:

| Variable | What it does |
|---|---|
| `XENON_SMTP_URL` | The mail server, as a connection URL such as `smtps://user:password@smtp.example.com:465` or `smtp://user:password@smtp.example.com:587`. |
| `XENON_SMTP_FROM` | The sender address. It is `noreply@xenon.local` when you don't set it. |

With the mail server set, the sign-in page's forgotten-password form emails the person a link, and an admin who chooses **Reset password** for someone on the **Users** page sends it too. The link works once and expires after an hour, and the email says so. Xenon builds it from the address the request came to, and from `x-forwarded-proto` if a proxy sets it, so a reverse proxy has to pass the original host: see [Production deployment](./deployment.md).

Without it, nobody can email themselves a link, and the sign-in page tells people to ask an administrator. An admin chooses **Reset password** on the **Users** page, and Xenon shows the link once, to copy and pass on. An Admin can do this only for a Member, and a super admin for anyone else but themselves.

`XENON_PASSWORD_RESET_LOG_FALLBACK=true` writes links to the server log instead. A link is a credential for the account, so anyone who can read the log can use it: leave this off.

## Related

- [Selector Health](./selector-health.md)
- [Devices and allocation](./devices.md)
- [Environment variables](./environment-variables.md)
- [Roles and scopes](./roles-and-scopes.md)
