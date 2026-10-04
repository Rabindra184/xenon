---
title: Upgrading
description: How to update the Xenon plugin, what happens to the database, how to upgrade a hub with nodes, and what changes when moving from 1.x to 2.x.
---

Upgrading Xenon is updating the plugin and restarting Appium. This page covers what to read first, the update itself, database changes, hubs with nodes, and what test clients must change when moving from 1.x to 2.x.

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

- **Xenon Control:** the **Health** tab's **Install plugin + drivers** button updates a plugin that is already installed. Then restart the server from the app.
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
- [Capabilities](./capabilities.md): everything a test can send in `xe:options`.
- [Authentication](./authentication.md)
