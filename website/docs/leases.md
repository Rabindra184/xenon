---
title: Leases for CI
description: "How a pipeline reserves a phone before its tests start, keeps it for the whole run and gives it back, with the routes, the request and answer, and a complete curl example."
---

A lease reserves one phone for a pipeline. You ask Xenon for a phone that matches what you need, and it either hands you one, held for you, or says right away that none is free. The answer includes the capabilities for the session, so your test starts on exactly that phone. This page explains the routes, what a lease skips, and how it ends.

## Why lease

Without a lease, each test session asks for a phone when it starts. If every matching phone is busy, the session waits in a queue, and after five minutes by default it fails. A lease moves that decision to the start of the run:

- **You know at once.** A lease request answers immediately: with a phone, or with `404` or `409`. A pipeline can retry, or stop, before any test has run.
- **Nobody takes the phone between tests.** A phone under a lease isn't offered to other sessions or leases until the lease ends.
- **Sessions skip the queue.** A session that names its lease uses the lease's phone and doesn't wait behind other requests.
- **It stays yours.** While the lease is live, device control, the live preview and recordings of the phone are open to the person who took the lease, and refused to everyone else but admins.

## What you need

Every lease route needs a role of Member or above and a credential with the `devices` scope. A member's own API tokens carry only `sessions` and `read`, so a member's key and token can't lease. Give a pipeline an Admin's access key and a token made on their **Profile** page, which carries `devices`, `sessions` and `read`, rather than a key with the `admin` scope, which is for scripts that manage the lab. Send them as headers, as in the examples below. A member signed in to the dashboard does have the `devices` scope, and the one-hour bearer token they get from `POST /xenon/api/auth/token` carries it too. [Roles and scopes](./roles-and-scopes.md) explains the roles and scopes.

On a server with sign-in turned on, Xenon also needs its own admin credentials to reserve the phone's ports: `XENON_HUB_ACCESS_KEY` and `XENON_HUB_TOKEN` in the environment of the server that takes the lease request. The pair is an admin's access key and token with the `devices` scope. [Hub and nodes](./hub-and-nodes.md#give-each-node-a-user-and-a-token) shows how to make one. This applies on a single machine too. Without them, a lease answers `503` with `device_unhealthy`, and the details say that port allocation needs these two variables.

## Lease a phone

```
POST /xenon/api/sdk/leases
```

The body is JSON:

| Field | Type | What it does |
|---|---|---|
| `filters` | object | Which phone you want. Required, and it must have `platform`. |
| `durationMs` | number | How long the lease lasts from now. Default `1800000` (30 minutes). Xenon keeps it between 60000 (one minute) and 86400000 (24 hours). |
| `heartbeatSeconds` | number | How often you will send a heartbeat. Default `30`. Xenon keeps it between 10 and 300. |
| `reason` | string | Free text, stored with the lease. |
| `buildId` | string | Free text, stored with the lease and copied into `appiumCapabilities` as `xe:options.buildId`. To group sessions into a build on the dashboard, use `xe:build` in the session's capabilities. |

The `filters` that narrow the choice. A phone must match all that you send:

| Filter | Keeps only |
|---|---|
| `platform` | `android` or `ios`, in lowercase. Required. |
| `udid` | The phone with that UDID. |
| `deviceType` | `real`, `emulator` or `simulator`. |
| `tags` | Phones that carry every tag in the list. |
| `platformVersion`, or `sdk` | Phones whose OS version equals it. Both mean the same, and `platformVersion` wins if you send both. |
| `minSDK`, `maxSDK` | Phones whose OS version is at least, or at most, the value. |
| `deviceName` | Phones with that name, in any case. |

Only phones you can see are considered: the shared pool and your teams' phones, or every phone for an admin. A `teamId` in `filters` is ignored: the team rule comes from your credentials. See [Teams](./teams.md).

### What comes back

On success the answer is `201` with the lease:

```json
{
  "leaseId": "clxa1b2c30000s8k2f9d1e7aa",
  "leaseToken": "7f3c9a1e5b2d48f0a6c4e8b1d3f5a7c9e2b4d6f8a0c1e3b5d7f9a2c4e6b8d0f1",
  "device": {
    "udid": "emulator-5554",
    "host": "http://192.168.1.100:4723",
    "platform": "android",
    "sdk": "14",
    "name": "Pixel 7 API 34",
    "screen": { "width": "1080", "height": "2400" },
    "realDevice": false
  },
  "expiresAt": 1791113400000,
  "heartbeatSeconds": 30,
  "allocatedPorts": { "systemPort": 52311, "chromedriverPort": 52312, "mjpegServerPort": 52313 },
  "appiumCapabilities": {
    "platformName": "Android",
    "appium:automationName": "UiAutomator2",
    "appium:udid": "emulator-5554",
    "appium:newCommandTimeout": 120,
    "appium:deviceName": "Pixel 7 API 34",
    "appium:platformVersion": "14",
    "appium:systemPort": 52311,
    "appium:chromedriverPort": 52312,
    "appium:mjpegServerPort": 52313,
    "xe:options": {
      "leaseId": "clxa1b2c30000s8k2f9d1e7aa",
      "leaseToken": "7f3c9a1e5b2d48f0a6c4e8b1d3f5a7c9e2b4d6f8a0c1e3b5d7f9a2c4e6b8d0f1"
    }
  }
}
```

- `leaseToken` is shown only here. Xenon keeps just a hash of it, so keep it for the heartbeat, extend and release calls.
- `expiresAt` is in milliseconds since 1970. `allocatedPorts` are reserved for the phone until the lease ends. An iPhone gets `wdaLocalPort` and `mjpegServerPort`.
- `appiumCapabilities` is what your session needs. Pass it on as it is.

When there is no phone, the answer says why:

| Status | `error` | Meaning |
|---|---|---|
| `400` | `bad_request` | `filters.platform` is missing. |
| `404` | `no_matching_device` | No phone you can see matches the filters. A phone that belongs to another team looks the same as one that doesn't exist. |
| `409` | `all_matching_busy` | Phones match, but none is free. The answer has `retryAfterMs`, `2000`. Xenon doesn't queue a lease request, so retry after that. |
| `503` | `device_unhealthy` | A phone was found but its ports couldn't be reserved. The details say why: the phone's server didn't answer, or this server has no admin credentials for it. The phone is freed again. |
| `403` | `insufficient scope` | Your credential has no `devices` scope. |

## What a lease skips

A lease takes a phone only if a new session could: it is free, online and not in maintenance, not reserved, not failing its health check, and not held by another lease. A phone that matches the filters but fails any of these counts as busy, and gives `409`. See [Devices and allocation](./devices.md) for each of these states.

## Run a session on the lease

Create the session with the lease's `appiumCapabilities`, and add your own credentials to `xe:options` so that the session has an owner.

```js
import { remote } from 'webdriverio';

const xenon = 'http://localhost:4723/xenon/api';
const credentials = {
  'x-xenon-access-key': process.env.XENON_ACCESS_KEY,
  'x-xenon-token': process.env.XENON_TOKEN,
};

const response = await fetch(`${xenon}/sdk/leases`, {
  method: 'POST',
  headers: { ...credentials, 'content-type': 'application/json' },
  body: JSON.stringify({ filters: { platform: 'android' }, durationMs: 1800000 }),
});
if (!response.ok) throw new Error(`No lease: ${response.status} ${await response.text()}`);
const lease = await response.json();

const leaseCall = (path, method) =>
  fetch(`${xenon}/sdk/leases/${lease.leaseId}${path}`, {
    method,
    headers: { ...credentials, 'x-xenon-lease-token': lease.leaseToken },
  });

// Keep the lease alive while the tests run.
const heartbeat = setInterval(() => leaseCall('/heartbeat', 'POST').catch(() => {}), lease.heartbeatSeconds * 1000);

try {
  const driver = await remote({
    hostname: 'localhost',
    port: 4723,
    capabilities: {
      ...lease.appiumCapabilities,
      'xe:options': {
        ...lease.appiumCapabilities['xe:options'],
        accessKey: process.env.XENON_ACCESS_KEY,
        token: process.env.XENON_TOKEN,
      },
    },
  });
  // ...your tests...
  await driver.deleteSession();
} finally {
  clearInterval(heartbeat);
  await leaseCall('', 'DELETE');
}
```

The sample is an ES module, so save it as `.mjs`: it uses `import` and top-level `await`.

- `xe:options.leaseId` names the lease, and `xe:options.leaseToken` proves the session holds it. Xenon removes the token from the capabilities before the driver sees them, as [Capabilities](./capabilities.mdx#how-xenon-sees-your-credentials) describes.
- A session may also prove it holds the lease with the credentials that took it, or with a super admin's, a key with the `admin` scope, or the session token of an admin that carries `admin`. Without proof, the session fails with `lease <id> is not active, or this session did not prove it holds it`. It fails the same way when the lease has ended, so a lease you don't hold can't be told from one that doesn't exist.
- The phone must also be one your teams can see. A lease on a phone that has moved to another team since is refused.
- The session keeps its own `appium:newCommandTimeout`. The capabilities the lease returns set `120` seconds, and you may change it to a whole number of seconds from 0 to 1800.
- When the session ends, the phone goes back to the lease, not to the pool. It is freed when the lease ends.

## Keep it alive, extend it, release it

These three calls need your credentials and the lease token, in the header `x-xenon-lease-token`.

| Call | What it does |
|---|---|
| `POST /xenon/api/sdk/leases/<leaseId>/heartbeat` | Tells Xenon the pipeline is still there. Answers `{ "heartbeatedAt": ..., "expiresAt": ... }`. It doesn't move `expiresAt`. |
| `POST /xenon/api/sdk/leases/<leaseId>/extend` with `{ "durationMs": 1800000 }` | Sets the lease to end `durationMs` from now, not from its current end, and counts as a heartbeat. Answers `{ "expiresAt": ... }`. A lease never runs past 24 hours after it was created, and a `durationMs` shorter than the time left shortens the lease. |
| `DELETE /xenon/api/sdk/leases/<leaseId>` | Releases the lease and gives back its ports. Answers `204` with no body. |

Their errors:

| Status | `error` | Meaning |
|---|---|---|
| `403` | `missing_lease_token` | The header is missing. |
| `403` | `token_mismatch` | The token is wrong, or there is no such lease. The two look alike, so lease ids can't be probed. |
| `410` | `gone` | The lease has ended or passed `expiresAt`. Only the token's holder is told. |
| `404` | `not_found` | On release: the lease had already ended. |
| `400` | `bad_request` | On extend: `durationMs` is missing or not a number. |

## How a lease ends

A lease ends when you release it, when it misses three heartbeats in a row, or when it passes `expiresAt`, whichever comes first. With the default `heartbeatSeconds` of 30, a pipeline that stops sending heartbeats loses the lease after 90 seconds. A check runs every 30 seconds, so a lapsed lease may hold its phone a little longer. Heartbeat and extend refuse a lease past `expiresAt` at once, and release still works on it.

When a lease ends, its ports are given back and its lock on the phone is removed. The phone is freed unless something else still holds it: a session that outlived the lease keeps the phone until it ends, and so does a preview or a recording.

## A full example with curl

This shell script leases a phone, keeps the lease alive in the background, creates a session on it, and cleans up. It needs `curl` and `jq`, and your key and token in `XENON_ACCESS_KEY` and `XENON_TOKEN`. If Appium has a base path, add it to the session URLs.

```bash
XENON=http://localhost:4723
AUTH=(-H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN")

# Check that this server supports leases.
curl -s -f "${AUTH[@]}" "$XENON/xenon/api/sdk/version"

# Lease an Android phone that carries the tag lab-row-3.
LEASE=$(curl -s -f -X POST "$XENON/xenon/api/sdk/leases" "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"filters":{"platform":"android","tags":["lab-row-3"]},"durationMs":1800000,"heartbeatSeconds":30,"reason":"nightly checkout suite"}')
LEASE_ID=$(echo "$LEASE" | jq -r .leaseId)
LEASE_TOKEN=$(echo "$LEASE" | jq -r .leaseToken)
HEARTBEAT=$(echo "$LEASE" | jq -r .heartbeatSeconds)

# Send a heartbeat every heartbeatSeconds while the tests run.
( while sleep "$HEARTBEAT"; do
    curl -s -o /dev/null -X POST "$XENON/xenon/api/sdk/leases/$LEASE_ID/heartbeat" \
      "${AUTH[@]}" -H "x-xenon-lease-token: $LEASE_TOKEN"
  done ) &
BEAT_PID=$!

# Create a session on the lease: its capabilities, plus your credentials.
CAPS=$(echo "$LEASE" | jq --arg k "$XENON_ACCESS_KEY" --arg t "$XENON_TOKEN" \
  '{capabilities: {alwaysMatch: (.appiumCapabilities | .["xe:options"] += {accessKey: $k, token: $t})}}')
SESSION_ID=$(curl -s -f -X POST "$XENON/session" -H 'Content-Type: application/json' -d "$CAPS" \
  | jq -r .value.sessionId)

# ...run your tests against $XENON/session/$SESSION_ID...

# Finish: delete the session, stop the heartbeat and release the lease.
curl -s -X DELETE "$XENON/session/$SESSION_ID"
kill "$BEAT_PID"; wait "$BEAT_PID" 2>/dev/null
curl -s -f -X DELETE "$XENON/xenon/api/sdk/leases/$LEASE_ID" \
  "${AUTH[@]}" -H "x-xenon-lease-token: $LEASE_TOKEN"
```

## Check what the server supports

```
GET /xenon/api/sdk/version
```

Needs a role of Member or above. It answers with the plugin's version and the features this server offers, so a client can check before it leases:

```json
{ "pluginVersion": "2.15.0", "supports": ["leases", "ports", "heartbeat"] }
```

## Related

- [Devices and allocation](./devices.md): how phones are chosen, and what keeps one out of the pool.
- [Live device control](./device-control.md): what the lease holder may do with the phone.
- [Capabilities](./capabilities.mdx): `xe:options` and what a session sends.
- [Kotlin SDK](./kotlin-sdk.mdx): leasing from Kotlin and JVM tests.
- [API reference](/api): every lease route, with its schemas.
