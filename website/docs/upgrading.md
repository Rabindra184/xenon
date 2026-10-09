---
title: Upgrading
description: How to update the Xenon plugin, what happens to the database, how to upgrade a hub with nodes, what changes when moving from 2.16 to 2.17, from 2.15 to 2.16, from 2.14 to 2.15, from 2.13 to 2.14, and from 1.x to 2.x.
---

Upgrading Xenon is updating the plugin and restarting Appium. This page covers what to read first, the update itself, database changes, hubs with nodes, what changes when moving from 2.16 to 2.17, 2.15 to 2.16, 2.14 to 2.15 and 2.13 to 2.14, and what test clients must change when moving from 1.x to 2.x.

## Before you upgrade

- **Read the [release notes](./release-notes.md)** for every version between yours and the one you are moving to. Each release says whether it brings a database migration, whether a hub and its nodes must be upgraded in a particular order, and what behaves differently. A release that needs something from you says so near the top, often under "Changed — operator action may be needed".
- **Find your version.** `appium plugin list --installed` lists it, and so does the account menu at the top right of the dashboard, under **Version**.
- **Back up the database and the signing key**: `~/.cache/xenon/xenon.db` and `~/.cache/xenon/xenon-jwt-private.pem`. Copy them while Xenon is stopped.
- **Mind running sessions.** Restarting a server ends the sessions running on its own devices. Sessions on a node's devices keep running when the hub restarts, and the hub routes them again once it is back. Wait for tests to finish, or tell people to expect a restart.

## Update the plugin

```bash
appium plugin update xenon
```

Then restart Appium. `appium plugin list --installed --updates` shows whether a newer version is available. By default Appium updates only within the version's major number: to move to a new major version, such as 1.x to 2.x, add `--unsafe`:

```bash
appium plugin update xenon --unsafe
```

- **Xenon Control:** the **Health** tab's **Install plugin + drivers** button runs `appium plugin update xenon` on a plugin that is already installed, so it stays within the major version. For a move to a new major version, run `appium plugin update xenon --unsafe` in a terminal first, with `APPIUM_HOME` set to the folder the app uses (the **APPIUM_HOME** button in the app's header opens it). Then restart the server from the app.
- **A source checkout:** run `git pull`, `npm install` and `npm run build:all`, then `npm run dev`, which also applies database changes.

## Database changes

Xenon applies pending database changes when it starts, so a normal upgrade needs nothing from you. The database itself decides how:

- **A database with no migration history,** which is every database Xenon makes with its default settings, is updated with `prisma db push`.
- **A database that keeps a migration history** (Prisma's `_prisma_migrations` table) matching its tables is updated with `prisma migrate deploy`. One whose tables differ from its history, or whose history records a failed migration, is updated with `prisma db push` too.

The log says `Syncing database schema (<command>) at <database>: <why>` and then `Database schema in sync`. `databaseProvider` plays no part. Each server has its own database, so a hub and each node apply their own changes when they start.

On a database with a migration history, `db push` doesn't delete a table or column that holds data. If an update would, the server stops instead and prints the commands to run, with its own paths: a backup, the command that lets the listed changes go, and, when no failed migration is recorded, how to try the migrations on a copy first. See [The server doesn't start](./troubleshooting.md#the-server-doesnt-start).

If your pipeline applies database changes instead, set `XENON_AUTO_MIGRATE=false`. Xenon then skips them at startup, and you must apply them before you start the new version, with the command Xenon would run. Back up the database first. For the default SQLite database, which has no migration history:

```bash
cd "${APPIUM_HOME:-$HOME/.appium}/node_modules/@xenon-device-management/xenon"
DATABASE_URL="file:$HOME/.cache/xenon/xenon.db" node_modules/.bin/prisma db push --skip-generate --accept-data-loss
```

For a database whose migration history matches its tables, run `node_modules/.bin/prisma migrate deploy` there instead. Use your own `DATABASE_URL` if you changed it. From a source checkout, `npm run db:migrate` chooses the command for you.

## A hub and its nodes

Upgrade each server the same way. Whether the order matters is up to the release: its notes say. The 2.12 and 2.13 releases say a hub and its nodes can be upgraded in any order, and some earlier ones asked for the nodes or the hub first. If you skip several releases, read the notes for each one.

[Hub and nodes](./hub-and-nodes.md) explains how the two kinds of server work together.

## From 2.16 to 2.17

Version 2.17.0 brings no database migration. Upgrade the hub and its nodes together: a node's phones' Device logs need both, and the network capture certificate is made on the server a phone is plugged into.

What a lab may have to do:

- **Startup no longer rewrites a database's migration history.** 2.16.0 could record migrations as applied, mark a failed one rolled back, and try migrations on a copy beside the database. 2.17.0 does none of that: it follows [the rule above](#database-changes). A history 2.16.0 changed is read like any other, and needs nothing from you.
- **Leftover copies from 2.16.0.** If a 2.16.0 start was stopped while it tried migrations on a copy, delete any `<database file>.xenon-trial-<number>` file left beside the database, with its `-journal`, `-wal` or `-shm` files, once no 2.16.0 server is running. That happened only to a SQLite database with a migration history whose tables had been changed by hand.
- **A node's phones' Device logs need the hub and the node on 2.17.0.** With an older node, the hub logs it once and those sessions keep an empty **Device logs** tab. See [What goes through the hub](./hub-and-nodes.md#what-goes-through-the-hub).
- **A new network capture certificate.** The certificate authority an earlier version made had an invalid serial number, which OpenSSL 3, Go and BoringSSL-based clients refuse, and Android didn't find it under the file name Xenon gave it. It is replaced the first time a session uses the interceptor. An emulator gets the new one by itself; on a real phone, install the new file by hand, as you did the old one. See [The certificate](./network-interceptor.md#the-certificate).

Other changes:

- **Device logs for a node's phones.** On a hub with the dashboard on, a session on a node's phone keeps the same Device logs as one on the hub's own phone, and its failure analysis reads them. See [Sessions and builds](./sessions.md#commands-timeline-screenshots-and-logs).
- **A hub no longer checks a node's iPhone before a session.** The node checks it when it starts the session. A session on a node's iPhone used to be refused as unhealthy when the node ran on another machine. See [How a session gets a device](./devices.md#how-a-session-gets-a-device).

## From 2.15 to 2.16

Version 2.16.0 brings no database migration. Upgrade the hub and its nodes: iOS sessions, their Device logs and the `proxy` option run on the server a phone is plugged into.

What a lab may have to do:

- **The database decides how it is updated at startup,** not `databaseProvider`, which has no effect. See [Database changes](#database-changes). `databaseProvider: postgresql` no longer stops the server.
- **Failure categories come from what Appium and the drivers report.** Two are new, **Session Lost** and **Stale Element**. **Wda Failure** and **Xenon Command Failure** are no longer given to new sessions, and a session ended by the server shutting down is **Hub Restart**. A webhook template or a report that filters on the two retired categories needs the new ones. See [The category](./failure-analysis.md#the-category).
- **OpenTelemetry follows Xenon's own settings with tracing on.** Metrics go only to `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, never to the trace URL + `/v1/metrics`, so a collector that received them there needs the metrics URL set. In JSON log mode, Xenon's lines go out at their own level, so `--log-level` applies and errors go to stderr. See [Turn on OpenTelemetry](./observability.md#turn-on-opentelemetry).
- **The `proxy` option applies to every call to another server,** not only a session's create. Without it, those calls follow `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`. See [If the servers reach each other through a proxy](./hub-and-nodes.md#if-the-servers-reach-each-other-through-a-proxy).
- **A live connection to the event stream is closed when its sign-in stops being accepted.** A client of your own on a bearer token must fetch a fresh token for each connection. See [Real-time events](./real-time-events.md#connect).
- **`xe:save_device_logs: false` keeps a session's device log off.** Through 2.15 it was read nowhere. See [Session settings](./capabilities.mdx#session-settings).
- **The first session on an iOS simulator takes a few minutes,** while the XCUITest driver builds WebDriverAgent. See [How a session gets a device](./devices.md#how-a-session-gets-a-device).

Security changes to check:

- **Network capture stays with admins.** Captured requests go live to Admins and Super admins only. A session's command log no longer keeps a test's `exportHar`, `getRequests` and `getMocks` answers, or `addMock`'s mock, which everyone who could see the session could read, and whose first 500 characters went to the AI provider when the session's failure was analysed. Rows earlier versions saved stay until their session is cleaned up.
- **Selector Health's live events follow the page's rule:** a Member's dashboard gets a selector's events only if they may see the selector. See [Real-time events](./real-time-events.md#who-receives-which-event).
- **A live dashboard connection follows its user.** A change of role or team applies to an open dashboard at once, and a connection whose user is made Inactive or deleted, whose sign-in is signed out, or whose key or token is revoked or runs out, is closed. See [Real-time events](./real-time-events.md#connect).

Other changes:

- **Sessions on iOS simulators start again,** end as they ran, and keep their video.
- **iPhone and simulator sessions' Device logs hold the whole run.** See [Sessions and builds](./sessions.md#commands-timeline-screenshots-and-logs).

## From 2.14 to 2.15

Version 2.15.0 adds one database column, refuses old session tokens and changes a few answers. Check these before you upgrade, and upgrade the hub and its nodes: healing, selector learning and the H.264 preview run on the server a phone is plugged into.

What a lab may have to do:

- **A new column, `LocatorEtalon.path`,** which the Resilio healing tier uses. Xenon adds it when it starts. If you set `XENON_AUTO_MIGRATE=false`, apply it first with the [command above](#database-changes). Selectors learnt before get their path the next time they are found. See [How healing works](./self-healing.md#resilio).
- **Mint new session tokens.** A session token made by 2.14 or earlier carries no scopes, and a session create refuses a session token without `sessions`, whether or not `XENON_REQUIRE_SESSION_TOKEN` is on. `POST /xenon/api/auth/token` now gives one only to a credential with `sessions` or `admin`, for MCP scopes that include `appium:use`. See [Credentials in a test session](./authentication.md#credentials-in-a-test-session).
- **Set `XENON_PUBLIC_URL` to the server's address,** such as `https://xenon.example.com` or `http://lab-mac:4723`. The dashboard's own address, ending in `/xenon/`, works too; a value with any other path, a query or a user name in it is ignored, with a warning at startup. Password reset links point there, never at the address a request came to, and without it Xenon emails none: the sign-in page sends people to an administrator. Each device's `dashboard_link`, its link to the appium-dashboard-plugin when that plugin runs on the server, uses it too; without it the link is a bare `/dashboard` path. See [A forgotten password](./authentication.md#a-forgotten-password).
- **Node.js 20.19+, 22.12+ or 24+, with npm 10+.** The plugin's `engines` now states Appium 3's range. See [Installation and requirements](./installation.md#requirements).
- **`POST /xenon/api/apikeys` refuses an unknown scope** with `400`, where it used to store any name. A script that creates keys with a scope other than `read`, `sessions`, `devices` or `admin` now fails. See [On the API keys page](./authentication.md#on-the-api-keys-page).
- **`healingTiers` holds for every session.** `[]` now turns healing off for that session, and a value that isn't a list of tier numbers from 1 to 5 runs tiers 1, 2 and 3 only, with a warning in the server log. `[]`, and a value that wasn't a list or had no numbers in it, used to run every tier; a list that held some numbers ran those and skipped the rest (`[1, 6]` ran tier 1, `[6]` none). See [Choose tiers for one session](./self-healing.md#choose-tiers-for-one-session).
- **The live `session_command` event is a summary.** It no longer carries `body`, `response`, `screenshot`, `url`, `title` or `subtitle`. A client of your own that read them should read `GET /xenon/api/session/<id>/session_log`. See [Real-time events](./real-time-events.md#sessions).
- **The AI engine page's choices win and are kept.** A provider, model or base URL saved on the page or with `POST /xenon/api/config` now replaces the option or variable the server starts with, and survives a restart. `POST /config` refuses a value that can't work with `400 invalid_setting`. See [AI providers](./ai-providers.md#change-them-while-the-server-runs).
- **A failed session's end doesn't wait for the AI.** The category is saved before `driver.quit()` returns; the analysis follows, and Xenon gives up on the call after 2 minutes, so `ai_analysis` may still be empty when `driver.quit()` returns. **Test Connection** fails on a rate limit. See [AI failure analysis](./failure-analysis.md#when-it-runs).
- **A session Appium ends for being idle is filed as Timeout,** with Appium's own reason, and the `session_failed` webhook's `failureReason` changes with it. See [Notifications and webhooks](./notifications.md#when-session_failed-is-sent).
- **Elements found in a screenshot answer like real ones.** A `-custom:ai-text` or `-custom:ai-icon` find that matches nothing fails with `no such element`, and isn't healed. `getText` on an element AI vision found fails with `unsupported operation`. An element belongs to the session that found it, and goes when the session ends. See [Omni-Vision](./omni-vision.md#what-works-on-a-virtual-element).
- **An Android session keeps far more device log lines,** up to 12,000 rows in the database where it kept about 100. Build cleanup removes them with their session. See [Sessions and builds](./sessions.md#commands-timeline-screenshots-and-logs).
- **Every server stores selector fingerprints,** nodes and servers with `enableDashboard` off included, in their own database. On an iPhone, learning a new selector can delay the test's next command, once per selector. See [Fingerprints](./self-healing.md#fingerprints).

Security changes to check:

- **`healingTiers` keeps healing away from the AI provider.** Through 2.14 it was ignored for a session with video off on a server with `enableDashboard` off, a node's for its hub included. If you ran such sessions with an AI provider set up, their screenshots, and for the LLM tier their page source, may have gone to it. See [Choose tiers for one session](./self-healing.md#choose-tiers-for-one-session).
- **An Inactive or deleted user's credentials no longer create sessions as them,** a bearer token's `admin` scope lapses when its user becomes a Member, nothing a credential mints outlives it, and rotating an access key needs a dashboard sign-in or the `admin` scope. See [Authentication](./authentication.md).
- **A long `XENON_USER_SESSION_TTL_MS` now holds.** A value longer than a day keeps people signed in that long after their last request, where the browser used to drop the sign-in after a day without a request. If you set one, check it is the time you want. See [Sign-in and passwords](./authentication.md#sign-in-and-passwords).
- **The event log no longer keeps a session's own data.** Older versions wrote every command's request and answer, and every captured request, to the `EventLog` table, for `XENON_EVENT_LOG_RETENTION_DAYS` (30 by default). To remove them now, stop the server and run this against the file your `DATABASE_URL` names; backups taken before still hold them. See [The event log](./observability.md#the-event-log).

  ```bash
  sqlite3 ~/.cache/xenon/xenon.db "DELETE FROM \"EventLog\" WHERE type IN ('session_command', 'interceptor_request'); VACUUM;"
  ```

Other changes:

- **OCR's language data comes with the plugin.** The `eng.traineddata` an older version left in the directory the server was started from can be deleted. See [Omni-Vision](./omni-vision.md#ocr-and-ai-vision).
- **The H.264 preview on a node's phone.** With `streaming.androidH264` on, a node on 2.13 or older keeps its H.264 capture running beside a Live devices tile's MJPEG until its idle stop. See [Live preview](./device-control.md#live-preview).

## From 2.13 to 2.14

Version 2.14.0 adds one database table and changes some answers a test or a receiver may depend on. Check these before you upgrade.

- **A new table, `DeviceSetting`.** Xenon adds it when it starts, with the rest of the [database changes](#database-changes). If you set `XENON_AUTO_MIGRATE=false`, apply it before you start 2.14.0. The first start saves the team, tags, maintenance flag and reservation each phone has now, so upgrading loses none of them. From then on a phone keeps them when it disconnects: see [Devices and allocation](./devices.md#what-a-phone-keeps-when-it-goes).
- **The `session_failed` webhook has new field names.** A generic JSON webhook used to get the session's database row, with fields such as `id` and `failure_reason`. It now gets `sessionId`, `sessionName`, `failureReason`, `udid`, `deviceName`, `platform`, `osVersion`, `startTime` and `endTime`. A receiver or a custom template that reads the old names, `{{id}}` or `{{failure_reason}}` for example, must change to the new ones. The event is also sent when a session times out for inactivity, its driver crashes or its heartbeat stops. See [Notifications and webhooks](./notifications.md#the-events).
- **An unknown `xenon:` or `xe:` command fails.** A script such as `xenon: setNetworkProfile`, which Xenon has never had, used to answer `null`. It now fails with `unknown command`, and the message lists the commands Xenon has. Check your tests for names Xenon doesn't have: see [Execute commands](./execute-commands.md).
- **`assertVisualState` can fail.** It used to pass whenever the AI gave no answer. It now asks the AI provider for a true or false verdict about the screenshot, and fails when it can't get one: no AI provider, a failed or rate-limited call, or an answer that isn't clear. A test that passed only because nothing was checked will fail until the provider is set up. A plain string works as the condition. `visualTap`, and `smartTap` with an icon or a description, fail too when they can't look.
- **The session-details commands never fail.** `setSessionName`, `setSessionStatus`, `debug`, `addTag` and `captureEvidence` answer `{ recorded: true }` or `{ recorded: false, message }`. With the dashboard off, a test no longer gets the error it used to get from some of them.
- **The `interceptor` server option now works.** It used to be ignored. It is now the default for every session on the server's own Android phones, so a config that lists `interceptor: { enabled: true }` starts capturing every Android session. Remove it, or set `enabled: false` in the sessions that should not be captured. See [Network interceptor](./network-interceptor.md#turn-it-on).
- **`maxSessions` counts sessions only.** It counts the Appium sessions that are running or being started, not live previews, recordings or SDK leases with no session on them, and a new session waits whenever that many are running. A lab that ran past its limit now stops at it, and a value below `1` means no limit.

Some options and settings that did nothing now work as documented, so check the values you have set:

- **Maintenance page values.** A retention window, build cap, asset purge or schedule saved on the page now replaces the option the server started with, and the cleanup job acts on it. `POST /xenon/api/config` refuses a value that can't work, such as a retention window of 0, a bad cron expression or a switch that isn't true or false, with `400 invalid_setting`. See [Data retention](./retention.md#the-maintenance-page).
- **`emulators`.** With the default `platform` of `both`, the Android virtual devices you list are now started when the server starts. See [Devices and allocation](./devices.md#what-xenon-discovers).
- **`appium:iPhoneOnly` and `appium:iPadOnly`** keep only iPhones, or only iPads. See [Capabilities](./capabilities.mdx#choosing-a-device).
- **`maxConcurrentRecordings` and `recordingsAssetsPath`** are read, ahead of their environment variables. **`XENON_JSON_LOGGING`** now takes effect when the `enableJsonLogging` option isn't set. See [Recordings](./recordings.md#limits-storage-and-cleanup) and [Production deployment](./deployment.md#logs).
- **The AI self-healing switch** on the Settings page is saved, and applies from the next command. See [Self-healing](./self-healing.md).
- **The Shell tab** in device control runs only the commands it lists, exactly as listed, in plain words. A command that chained others or took other arguments is refused, and on iOS `list`, `syslog`, `deviceinfo`, `diagnostics`, `top` and `netstat` are gone. See [Live device control](./device-control.md#shell).

Other changes:

- **The phone's network is put back.** Xenon restores Wi-Fi, mobile data and the phone's own proxy however a session ends, and a hub no longer changes the network of a node's phone. See [Network conditioning](./network-conditioning.md#when-the-session-ends).
- **The Network panel's wording for a Member.** The Network panel and the capture routes were always for admins. A Member now sees "Only admins can see network requests" where the panel used to say there was no capture.
- **A team with a phone that is away can't be deleted,** and `POST /xenon/api/device/tags` answers `404` for a phone Xenon doesn't have. See [Teams](./teams.md#deleting-a-team).
- **A `postgresql://` database URL stops the server.** Xenon stores its data in SQLite only. Leave `databaseProvider` unset: set to `postgresql`, it logs a warning that it has no effect, but then a database made with the default setting stops the server at startup. See [Installation and requirements](./installation.md#the-database).
- **Upgrade the hub and its nodes.** The network, Shell and iPhone tap fixes run on the server a phone is plugged into, and the team, webhook and script-forwarding fixes run on the hub.

## From 1.x to 2.x

Version 2.0.0 changed what test clients send, so update them as well as the server.

- **Capabilities move to `xe:options`.** It is Xenon's one capability namespace: credentials (`accessKey` and `token`, or `sessionToken`), a lease (`leaseId` and `leaseToken`) and Xenon's other options such as `healingTiers`. `xenon:options` is still read as an alias. When a session sends both, `xe:options` wins field by field.
- **`df:options` is no longer read.** Neither are `xenon:df:options` or `appium:df:options`. A session that sends its credentials only there counts as having none: Xenon admits it with a warning, but it has no owner, so the device ownership guard denies its phone to every non-admin, including whoever started it. With `XENON_REQUIRE_SESSION_TOKEN` on, Xenon refuses the session.

Before, in WebdriverIO:

```js
'df:options': { accessKey: process.env.XENON_ACCESS_KEY, token: process.env.XENON_TOKEN },
'xenon:options': { healingTiers: [1, 2] },
```

After:

```js
'xe:options': {
  accessKey: process.env.XENON_ACCESS_KEY,
  token: process.env.XENON_TOKEN,
  healingTiers: [1, 2],
},
```

In Java:

```java
options.setCapability("xe:options", Map.of("accessKey", accessKey, "token", token));
```

In Python:

```python
options.set_capability("xe:options", {"accessKey": access_key, "token": token})
```

A client that uses a session token sends `"xe:options": {"sessionToken": ...}` instead.

Also for this move:

- **Upgrade the nodes before the hub.** A node still on 1.x reads only `df:options` and `xenon:options`, so a client on `xe:options` would lose its owner and its lease there.
- **Rotate API tokens that clients sent in `df:options`**, if you keep session rows, queue history or debug logs from before the upgrade. Until 2.0.0 those tokens reached the driver, were stored and were logged, and old rows are not rewritten.
- **The database gains a column** that Xenon adds at startup, as above. If you set `XENON_AUTO_MIGRATE=false`, apply it before starting 2.0.0.

The [2.0.0 release notes](./release-notes.md) also cover team rules for members' Appium sessions, uploaded apps that belong to a team, and the new `XENON_REQUIRE_COMMAND_AUTH` setting.

## Related

- [Release notes](./release-notes.md)
- [Installation and requirements](./installation.md)
- [Capabilities](./capabilities.mdx): everything a test can send in `xe:options`.
- [Authentication](./authentication.md)
