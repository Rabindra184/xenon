# Teams & Access Control

Xenon has two complementary access-control axes:

- **Scopes** on an API key decide *which verbs* you can call (`read`, `sessions`, `devices`, `admin`). See [API Keys](#api-keys-recap).
- **Teams** decide *which devices* a given API key can reach. Introduced in v1.4.

The two are orthogonal: an `admin`-scoped key can see all devices regardless of team; a `sessions`-scoped key scoped to a team can only start sessions on that team's devices plus the shared pool.

## Model

```
Team  ─── has many ──►  Device      (Device.teamId, nullable)
 │
 └──── has many ──►  ApiKey       (ApiKey.teamId, nullable)
```

- A **device with `teamId = null`** is in the **shared pool** — visible to every authenticated key.
- A **device with `teamId = <uuid>`** is team-exclusive — only keys in that team (or admins) can use it.
- An **API key with `teamId = null`** can use shared-pool devices only.
- An **API key with `teamId = <uuid>`** can use its team's devices plus the shared pool.
- A key with the `admin` scope bypasses team filtering and can reach every device.

## When to use teams

| Scenario | Recommended setup |
|---|---|
| Single-tenant lab, one team | Skip teams. Every device stays in the shared pool. |
| Multiple projects sharing devices | Create a team per project. Leave general-purpose devices in the shared pool. |
| Isolated client tenants | Create a team per tenant; no shared pool. New devices should be manually assigned. |
| Compliance / hardware rotation | Team per compliance zone; auditors get an admin key for full visibility. |

## Creating a team

### Dashboard (recommended)

Settings sidebar → **Teams** → **New team**. Click a team to see its members and devices.

### API

```bash
curl -X POST http://host:4723/xenon/api/teams \
  -H "X-Xenon-Access-Key: <admin-access-key>" -H "X-Xenon-Token: <admin-token>" \
  -H 'Content-Type: application/json' \
  -d '{"name":"android-qa"}'
# → { "id": "3acef541-…", "name": "android-qa", "createdAt": "…" }
```

Team names must be unique; duplicates return `409`.

## Assigning a device to a team

Device assignment is an admin-only operation.

### Dashboard

Open the Team detail panel → **Devices** section → pick a shared-pool device from the dropdown → **Assign**. Devices already in a team can be returned to the shared pool with **Return to shared pool**.

### API

```bash
# Claim a device for a team
curl -X PUT http://host:4723/xenon/api/device/<udid>/team \
  -H "X-Xenon-Access-Key: <admin-access-key>" -H "X-Xenon-Token: <admin-token>" \
  -H 'Content-Type: application/json' \
  -d '{"teamId":"3acef541-…"}'

# Return to shared pool
curl -X PUT http://host:4723/xenon/api/device/<udid>/team \
  -H "X-Xenon-Access-Key: <admin-access-key>" -H "X-Xenon-Token: <admin-token>" \
  -H 'Content-Type: application/json' \
  -d '{"teamId":null}'
```

New devices discovered by the plugin always arrive in the shared pool (`teamId = null`). Admins claim them into a team explicitly — the system never guesses.

## Assigning a key to a team

### Dashboard

Settings → **API Keys** → **Create new key** → pick a team in the **Default team** dropdown. Or open a team's detail panel and add an existing key from the **Members** section.

### API

```bash
# Create a team-bound key directly
curl -X POST http://host:4723/xenon/api/apikeys \
  -H "X-Xenon-Access-Key: <admin-access-key>" -H "X-Xenon-Token: <admin-token>" \
  -H 'Content-Type: application/json' \
  -d '{"name":"alice-ci", "scopes":["read","sessions"], "teamId":"3acef541-…"}'

# Or move an existing key into a team
curl -X POST http://host:4723/xenon/api/teams/<team-id>/members \
  -H "X-Xenon-Access-Key: <admin-access-key>" -H "X-Xenon-Token: <admin-token>" \
  -H 'Content-Type: application/json' \
  -d '{"apiKeyId":"<key-id>", "role":"member"}'
```

Removing a key from a team sends it back to the shared pool:

```bash
curl -X DELETE http://host:4723/xenon/api/teams/<team-id>/members/<key-id> \
  -H "X-Xenon-Access-Key: <admin-access-key>" -H "X-Xenon-Token: <admin-token>"
```

## Using teams from a test client

Test clients authenticate at session-create time via two capabilities:

| Capability | Required? | Purpose |
|---|---|---|
| `xenon:accessKey` | Recommended (not yet required) | The API key whose scopes/team govern this session. |
| `xenon:team` | Optional | Forces the allocator to pick from this team's devices. |

### Typical CI setup

```js
// alice's CI job, key is bound to team "android-qa"
const caps = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'xenon:accessKey': process.env.ANDROID_QA_KEY,
  // xenon:team is optional — the allocator already restricts alice to her
  // team + shared pool. Setting it only narrows further.
};
```

### Admin overriding team at session-create

An `admin`-scoped key can create sessions in any team by setting the cap:

```js
const caps = {
  'xenon:accessKey': process.env.ADMIN_KEY,
  'xenon:team': '3acef541-…',        // pick from this team's devices
};
```

### Back-compat

A session request with **no** `xenon:accessKey` still succeeds today (a WARN is logged). This is temporary to avoid breaking pre-v1.4 test clients. A future major release will require the capability.

### Error cases

| Condition | HTTP | Response body |
|---|---|---|
| `xenon:accessKey` invalid / revoked / lacks `sessions` scope | `400` | `invalid argument — xenon:accessKey is invalid, revoked, or lacks the sessions scope` |
| `xenon:team` value is a team the key isn't in (non-admin) | `400` | `invalid argument — xenon:team '<id>' is not allowed for this API key` |
| No device matches caps + caller's team | `500` | `No device matching request` (standard allocator timeout) |

## Deleting a team

A team with **active** members or **any** devices cannot be deleted — you'll see:

```
{"error":"Team still has N device(s) and M active member(s). Reassign them before deleting."}
```

Reassign devices back to the shared pool and remove active members first. Revoked keys that still point to the team are cleared automatically on delete.

## Audit: which key created which session?

Every `Session` row now carries `api_key_id` (nullable — null for auth-disabled runs and pre-v1.4 back-compat). Queries:

```sql
-- Sessions launched by a specific key in the last day
SELECT id, device_udid, createdAt
FROM Session
WHERE api_key_id = '<key-id>' AND createdAt > datetime('now','-1 day');

-- Which team's keys have been active today?
SELECT k.teamId, COUNT(*) as sessions
FROM Session s JOIN ApiKey k ON s.api_key_id = k.id
WHERE s.createdAt > datetime('now','-1 day')
GROUP BY k.teamId;
```

## API Keys recap

Scopes control the HTTP verb matrix independently of teams:

| Scope | Grants |
|---|---|
| `read` | All `GET /xenon/api/*` |
| `sessions` | Create / delete WebDriver sessions + session-scoped routes |
| `devices` | Block, unblock, reassign tags on devices |
| `admin` | Everything above, plus `/apikeys`, `/teams`, `PUT /device/:udid/team`. Bypasses team filtering. |

An admin can revoke any key via the dashboard or:

```bash
curl -X DELETE http://host:4723/xenon/api/apikeys/<id> \
  -H "X-Xenon-Access-Key: <admin-access-key>" -H "X-Xenon-Token: <admin-token>"
```

## Related

- [Authentication](../README.md#-authentication) — first-run bootstrap admin user, dashboard login, pair-auth tokens
- [`docs/server-args.md`](./server-args.md) — full CLI flag reference
- [`docs/retention.md`](./retention.md) — how session rows (including `api_key_id`) get pruned
