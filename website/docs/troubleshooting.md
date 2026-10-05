---
title: Troubleshooting
description: What to check when Xenon finds no Android phones, an iPhone won't stream, a session waits or is refused, the preview isn't H.264, the API refuses a request, the dashboard can't save behind a proxy, or the server won't start.
---

This page lists the problems people run into most, each with what you see, why it happens and what to do. Start with the server's log: [Where the logs are](#where-the-logs-are) says where to find it. If your problem isn't here, the [release notes](./release-notes.md) list what each version fixed and what it still has open.

## No Android devices

**What you see.** The Devices page shows no Android phones, though `adb devices` lists them. The server's log has one of these:

- `Error while getting android devices. Error: Neither ANDROID_HOME nor ANDROID_SDK_ROOT environment variable was exported.`
- `The Android SDK root folder '<path>' does not exist on the local file system.`
- `Could not find ADB`, then `adb is not available. So, returning empty list` at every look.

**Why.** Xenon doesn't take `adb` from your `PATH`. It reads `ANDROID_HOME`, or `ANDROID_SDK_ROOT` when `ANDROID_HOME` isn't set, and runs `platform-tools/adb` inside that folder. The variable has to be set in the environment of the process that runs Appium, to a folder that exists and has `platform-tools/adb` in it. A shell where `adb` works can still start Appium without the variable, and so can a process manager or a service.

**What to do.**

1. Point the variable at the SDK, and check that `adb` is where Xenon looks:

   ```bash
   export ANDROID_HOME=~/Library/Android/sdk   # the usual place on a Mac with Android Studio
   ls "$ANDROID_HOME/platform-tools/adb"
   ```

2. Restart Appium. After `Could not find ADB`, Xenon doesn't look for adb again until it restarts.

Under a process manager, set `ANDROID_HOME` in its environment, as the PM2 file in [Production deployment](./deployment.md#keep-it-running) does. [Xenon Control](./xenon-control.md) passes on the `ANDROID_HOME` and `ANDROID_SDK_ROOT` your login shell exports. When the shell exports neither, it uses the SDK folder around an `adb` found in a `platform-tools` folder on your `PATH`, then `~/Library/Android/sdk`. A Homebrew `adb` doesn't tell it where an SDK is: set `ANDROID_HOME` on the profile's **Secrets & Env** tab, which wins over what the app finds.

If the log has none of these lines, check that:

- **The platform includes Android.** The `platform` option is `android` or `both`, its default, and `androidDeviceType` includes the kind of device you have.
- **adb lists the phone as `device`.** A phone that adb lists as `unauthorized` is waiting for you to allow USB debugging on its screen. One listed as `offline` needs reconnecting. Xenon leaves out both.

## An iPhone doesn't stream, or WebDriverAgent doesn't start

An iPhone's live preview, recordings and sessions all need WebDriverAgent running on the phone, which Xenon starts with go-ios. Device control says **Stream unavailable**, and the reason is in the server's log and in the message the page shows.

| What you see | What to do |
|---|---|
| `go-ios binary not found` | Run the go-ios install script once, as [iPhones and go-ios](./installation.md#iphones-and-go-ios) shows, and again after each upgrade of Xenon. |
| `WebDriverAgent is not installed on <udid>` | Install WebDriverAgent on the phone. |
| `WebDriverAgent is installed on <udid> but would not start` | Unlock the phone, trust the developer certificate under **Settings**, **General**, **VPN & Device Management**, and check that the signing profile hasn't expired. |
| `WDA failed to start within 120s. Check logs.` | Retry once, after the pause in the next row. If it fails again, go-ios's own output for the start is in `xenon-logs/runwda-<udid>.log`, in the system's temporary folder (`$TMPDIR` on a Mac). |
| `Stream start is cooling down for <n>s after a failed attempt.` | Xenon waits 30 seconds after a failed start before it tries again, so a page retrying in a loop can't restart the phone over and over. Retry after the time it gives. |
| `The go-ios tunnel for <udid> exited before it was ready`, with go-ios's reason | On iOS 17 and later every iPhone needs its own go-ios tunnel. Reconnect the phone, unlock it, and retry. |
| `Port range for purpose 'tunnel' is exhausted` | The tunnels' 100 ports, 12100 to 12199, two per streaming iPhone, are all taken. Stop previews you don't need, or restart Xenon, which frees every tunnel's ports at startup. |
| `Stream for <udid> is not answering, but Appium session <id> holds the device` | Xenon won't restart WebDriverAgent under a running test, since the test may be using it. The preview can start again once the session ends. |
| A session is refused with `Device <udid> is unhealthy and could not be autonomously recovered.` | Xenon checks WebDriverAgent before it hands an iPhone to a session, and couldn't start it. The server's log says why. |

**Two Xenon servers on one Mac,** run by the same user, stop each other's iPhone previews. When either starts or stops, it ends every go-ios process on the Mac, the other server's included. Run one Xenon server per Mac for iPhones.

## A session waits in the queue

A session request that finds no phone it can use waits for one: by default it looks every second and gives up after five minutes. While it waits, the log repeats `Waiting for free device. Filter: ...`, or `Waiting for session available, already at max session count of: <n>`. When it gives up, the test's error says `No device matching request.`, `Device is busy or blocked.` or `Device is reserved by <name>.`, followed by the request.

Check, in this order:

- **Someone has the phone open.** A phone open in device control, or as a tile on the Live devices page, is held for that person, and tests wait for it. The Devices page shows it as **Busy**, "Live control by ...". The hold ends 3 seconds after the last viewer leaves the page. See [Holds](./device-control.md#holds-one-person-at-a-time).
- **The phone is reserved,** in maintenance, held by an SDK lease, or marked unhealthy. The Devices page shows each. See [Devices and allocation](./devices.md#how-a-session-gets-a-device).
- **You can't see the phone.** A Member's session gets phones in the shared pool and in their teams only, and a token bound to one team narrows that further. A session without credentials sees every phone. See [Teams](./teams.md).
- **The capabilities match nothing.** `platformVersion`, `udid`, `tags` and the other filters must all match one phone, and a request for a phone that doesn't exist waits the full five minutes before saying so.
- **The server is at `maxSessions`.** That many Appium sessions are running or starting; previews, recordings and idle leases don't count. Raise it, or wait.
- **Requests ahead of it.** Requests for one platform are served in the order they came, so a request waits behind those ahead of it.

The **Overview** page shows how many requests are waiting, and `GET /xenon/api/queue` lists them. [When no phone is free](./devices.md#when-no-phone-is-free) explains the wait and its settings.

## A session is refused when it starts

A test's session create fails with `400 invalid argument`, and the message says why:

- **``session rejected: xe:options.sessionToken carries no `sessions` scope``.** The session token was made by Xenon 2.14 or earlier, or for a credential without the `sessions` scope. Mint a new one with `POST /xenon/api/auth/token` and `{"audience":"xenon-mcp"}`, using a credential that has `sessions`. See [Credentials in a test session](./authentication.md#credentials-in-a-test-session).
- **``credentials are invalid, revoked, or lack the `sessions` scope``.** The access key and token check out but lack `sessions`. Use a token that has it.
- **`session rejected: XENON_REQUIRE_SESSION_TOKEN is enabled ...`** or **`... xe:options.sessionToken is invalid or expired ...`.** The server requires credentials, and the session sent none that check out: a wrong, revoked or expired key or token, or one whose user is Inactive or deleted. See [Refuse sessions without credentials](./authentication.md#refuse-sessions-without-credentials).

Without `XENON_REQUIRE_SESSION_TOKEN`, credentials that don't check out don't fail the create: the session runs with no owner, the server log says `Session created without valid credentials`, and only an admin can control its phone.

## The preview isn't H.264

With `streaming.androidH264` on, an Android phone's preview should be the faster H.264 stream, but it falls back to MJPEG when:

- **The browser has no WebCodecs.** Browsers offer it only on `https` pages and on `localhost`, so a dashboard opened as `http://hub:4723` gets MJPEG. Serve the dashboard over HTTPS, through a proxy that passes WebSocket upgrades: see [HTTPS behind a reverse proxy](./deployment.md#https-behind-a-reverse-proxy).
- **The stream fails to start, or shows no frame for 30 seconds.** The server's log says why scrcpy didn't start. Some phones work better with Android's own recorder: `androidH264: { source: screenrecord }`.
- **The phone is being recorded, or runs a test session.** Both use MJPEG.

iPhones always use MJPEG. [Live preview](./device-control.md#live-preview) describes both streams.

## What the API's answers mean

The REST API under `/xenon/api` answers errors as JSON, with an `error` field and often a `message`.

| Status | What it means here | What to do |
|---|---|---|
| `400` | The request is wrong: a body that isn't JSON, a missing field, or a setting that can't work (`invalid_setting`). | Read `message`, and the route in the [API reference](/api). |
| `401` | No credential, or one that doesn't check out: `unauthenticated` (none, or a dashboard sign-in that expired), `invalid credentials`, `invalid token`, `invalid session` (a user made Inactive) or `invalid ticket`. | Sign in again, or check the access key and token, and the token's expiry. See [Authentication](./authentication.md). |
| `403` | Signed in, but not allowed: `requires role >= ADMIN` (or the role needed), `insufficient scope`, or a CSRF refusal (see [below](#the-dashboard-behind-a-proxy-cant-save)). | Use a user or token with the role and scope the route needs: [Roles and scopes](./roles-and-scopes.md). |
| `404` | Not found. A phone, session, app or selector outside your teams answers exactly as one that doesn't exist. | Check the id, and whether you can see it: [Teams](./teams.md). |
| `409` | Someone else has it: `device_held_by_another_user` or `device_in_use_by_session`, with a message naming who; `device_recording` when you stop the preview of a phone being recorded; `conflict` for a value another record already has, naming the field. | Wait, ask the person named, or use an admin. Stop the recording first. |
| `429` | Too many requests, or too many sign-in attempts, with a `Retry-After` header in seconds. | Wait that long. See [Rate limits](./authentication.md#rate-limits). |
| `501` | Not available for this phone: `not_available_through_hub` for an action a hub doesn't pass on to its node, `not_available_for_cloud_phone` for a cloud provider's phone. | See [What goes through the hub](./hub-and-nodes.md#what-goes-through-the-hub). |
| `502`, `504` | On a hub, the node with the phone didn't answer: `node_unreachable` or `node_timeout`. | Check that the hub can reach the node at its address. |
| `503` | Xenon couldn't check something it needs, so it refused rather than let the request through: `device_ownership_unavailable`, or a hub's signing keys a node couldn't fetch. | Retry. If it persists, check the server's log, its database, and, on a node, that it can reach the hub. |
| `500` | `internal`: something failed on the server. | The details are only in the server's log. |

Test commands get WebDriver's own answers. With `XENON_REQUIRE_COMMAND_AUTH` on, a command without the session owner's or an admin's credentials gets `404 invalid session id`, exactly as for a session that doesn't exist, and the log says `Command refused:` and why. A client that sends no credentials with its commands, such as the Kotlin SDK, gets that for every command after the session is created. See [Check every command](./authentication.md#check-every-command).

## The dashboard behind a proxy can't save

**What you see.** Behind a reverse proxy, the dashboard shows the pages but every change fails, sign-in included, with `403` and `CSRF: Origin/Referer mismatch`. The server's log says `[csrf] Blocked POST /xenon/api/...: Origin/Referer host=<a> != Host=<b>`.

**Why.** A change made with the dashboard's sign-in is accepted only when the browser's `Origin` or `Referer` names the address the server was reached at, port included. A proxy that rewrites the `Host` header, to `127.0.0.1:4723` say, makes the two differ.

**What to do.** Keep the `Host` header in the proxy: in nginx, `proxy_set_header Host $http_host;`, since `$host` drops the port. Or list the address people use in `XENON_ALLOWED_ORIGINS`, such as `https://xenon.example.com`, and restart Xenon. [HTTPS behind a reverse proxy](./deployment.md#https-behind-a-reverse-proxy) has a complete nginx block. Scripts that send `x-xenon-access-key` or `Authorization: Bearer` aren't affected.

## A node's phones don't show on the hub

- **The node's credentials.** Without `XENON_HUB_ACCESS_KEY` and `XENON_HUB_TOKEN`, the node's log says `XENON_HUB_ACCESS_KEY + XENON_HUB_TOKEN not set`. A refused report says `Unable to push devices update to hub. Reason: ...`. The node's user must be an Admin, and its token must have the `devices` scope and not have expired. See [Give each node a user and a token](./hub-and-nodes.md#give-each-node-a-user-and-a-token).
- **The network.** The node must reach the hub, and the hub must reach the node at the address it reports, `http://<bindHostOrIp>:<port>`.
- **A direct create.** A test sent straight to a node with sign-in on is refused with `Create sessions through the hub`. Send tests to the hub.

## The server doesn't start

When Xenon can't set itself up, Appium logs `Could not configure Appium server. It's possible that a driver or plugin tried to update the server and failed. Original error: ...` and exits. Xenon's part of the message says why:

- **`[Database] Cannot start: the database URL (...) is a PostgreSQL database`**. Xenon stores its data in SQLite only. Set `DATABASE_URL`, or `databaseUrl`, to a `file:` path, or leave it unset for `~/.cache/xenon/xenon.db`.
- **`[DBMigrate] Cannot start: database schema sync failed`**, with the database tool's message. At each start Xenon brings the database's tables up to date. A change it can't make on an existing database, such as a required column added to a table that has rows, stops the server. Back up the database first. Then update it by hand, or start from a fresh database. The message names the database file.
- **`[DBMigrate] Cannot start: database schema sync failed for postgresql`**, with `P3005` and `The database schema is not empty`, means `databaseProvider` or `XENON_DB_PROVIDER` is set to `postgresql`. The message goes on to say that a required column can't be added to a table that has rows: that isn't the cause here. Remove the setting: Xenon then updates the database as SQLite. The failed start changed nothing in it.
- **`XENON_REQUIRE_COMMAND_AUTH is on, but ... Refusing to start`**. Xenon couldn't put its per-command check in front of Appium's routes, and won't serve sessions unchecked. Report it, with the Appium version, or turn the setting off.

With `XENON_AUTO_MIGRATE=false`, Xenon doesn't update the database at startup, so apply each version's changes yourself before starting it: [Upgrading](./upgrading.md#database-changes) has the command. When the startup update works, the log says `Syncing database schema` and then `Database schema in sync`.

## Where the logs are

- **The server's log** is Appium's standard output, where Xenon writes too. Give Appium `--log <file>` to also write it to a file. Under a process manager, it is in the manager's log files.
- **[Xenon Control](./xenon-control.md)** shows the log live and writes a file for each launch: **Log Folder** in the header opens the folder.
- **One API request:** every answer under `/xenon/api` carries an `X-Request-Id` header. With JSON logging on, the lines for that request carry it as `requestId`.
- **One session:** the session's page in the dashboard has its commands, the phone's logs and its screenshots, and a bug report bundles them: see [Sessions and builds](./sessions.md).
- **For a log system,** turn on JSON logs, or send the log over OpenTelemetry: see [Observability](./observability.md#logs).

## Related

- [Installation and requirements](./installation.md)
- [Devices and allocation](./devices.md)
- [Authentication](./authentication.md)
- [Production deployment](./deployment.md)
