---
title: Upgrading
description: How to update the Xenon plugin, what happens to the database, how to upgrade a hub with nodes, what changes when moving from 2.13 to 2.14, and from 1.x to 2.x.
---

Upgrading Xenon is updating the plugin and restarting Appium. This page covers what to read first, the update itself, database changes, hubs with nodes, what changes when moving from 2.13 to 2.14, and what test clients must change when moving from 1.x to 2.x.

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

Xenon applies pending database changes when it starts, so a normal upgrade needs nothing from you. The log says `Syncing database schema` and then `Database schema in sync`. Each server has its own database, so a hub and each node apply their own changes when they start.

If your pipeline applies database changes instead, set `XENON_AUTO_MIGRATE=false`. Xenon then skips them at startup, and you must apply them before you start the new version. For the default SQLite database, this is the command Xenon runs itself. Back up the database first:

```bash
cd "${APPIUM_HOME:-$HOME/.appium}/node_modules/@xenon-device-management/xenon"
DATABASE_URL="file:$HOME/.cache/xenon/xenon.db" node_modules/.bin/prisma db push --skip-generate --accept-data-loss
```

Use your own `DATABASE_URL` if you changed it. From a source checkout, `npm run db:migrate` does the same.

## A hub and its nodes

Upgrade each server the same way. Whether the order matters is up to the release: its notes say. The 2.12 and 2.13 releases say a hub and its nodes can be upgraded in any order, and some earlier ones asked for the nodes or the hub first. If you skip several releases, read the notes for each one.

[Hub and nodes](./hub-and-nodes.md) explains how the two kinds of server work together.

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
- **The Network panel's wording for a Member.** Network requests were always for admins. A Member now sees "Only admins can see network requests" where the panel used to say there was no capture.
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
