---
title: Devices and allocation
description: How Xenon finds your phones, what the Devices page's states mean, how a session gets a device, and how reservations, maintenance, tags and health checks fit in.
---

This page explains how devices get into Xenon and how tests get them. It covers what Xenon discovers, the states you see on the **Devices** page, the rules a session follows to be given a phone, what happens when none is free, and the tools for keeping a phone out of the pool: reservations, maintenance, tags and health checks.

## What Xenon discovers

At startup, and again whenever a phone is plugged in or out, Xenon lists the devices its server can reach. Which ones it looks for is set by these options. Each has a flag, `--plugin-xenon-` followed by its name in kebab-case, and a full description in [Configuration](./configuration.md).

| Option | What it does |
|---|---|
| `platform` | `android`, `ios` or `both` (the default). Xenon only looks for the platforms you name. |
| `androidDeviceType` | `real`, `simulated` (emulators) or `both` (the default). |
| `iosDeviceType` | `real`, `simulated` (simulators) or `both` (the default). |
| `bootedEmulators` | `true` lists only emulators that are already running. |
| `bootedSimulators` | `true` lists only iOS simulators that are already booted. Set it on a Mac with many simulators installed, so that Xenon lists only the ones that are running. |
| `simulators` | A list of `{ name, sdk }` entries. When it isn't empty, only simulators matching one of them are listed. |
| `emulators` | A list of `{ avdName }` entries. Xenon starts these Android virtual devices when the server starts, unless `platform` is `ios` or `androidDeviceType` is `real`, when it logs a warning and starts none. An entry can carry launch options such as `args`, `env` and `language`. It's a boot list, not a filter: it doesn't hide other emulators. A device that fails to boot is logged, and the server starts anyway. |
| `adbRemote` | A list of `host:port` addresses of other machines' adb servers (the port is optional and defaults to 5037), to list the Android devices plugged in there. |

How each kind is found:

- **Android phones and emulators** come from adb. Xenon needs `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) set when it starts, as [Installation and requirements](./installation.md#android-needs-android_home) says. Only devices adb reports as ready are listed. A phone that adb reports as `offline` or `unauthorized` is left out, or taken off the list if it was already there.
- **iPhones** that are plugged in are found through the Mac's connection to them. Starting WebDriverAgent on them, for the live preview, recordings and sessions, needs go-ios, as [Installation and requirements](./installation.md#iphones-and-go-ios) says.
- **iOS simulators** come from Xcode's `simctl`, so they need a Mac.

A phone that is unplugged, or whose node stops answering, is removed from the list, not shown as unavailable. Xenon also tells your webhooks, if you have set up the `device_offline` event: see [Notifications and webhooks](./notifications.md).

### What a phone keeps when it goes

A phone's team, tags, maintenance flag and reservation are saved apart from its record in the device list, under its UDID and the address of the server that lists it. The record goes whenever the phone does:

- the phone is unplugged, or reboots (Xenon's own recovery reboot included), or adb reports it as `offline` or `unauthorized`;
- an iPhone is detached;
- the server restarts, because a server lists its own phones afresh as it starts;
- discovery stops listing it, such as a simulator that is shut down on a server with `bootedSimulators` on;
- on a hub, a node unregisters or misses a single health probe.

The phone comes back with its team, tags and maintenance flag as they were. A reservation comes back too, as long as its time hasn't run out: one that ended while the phone was away isn't restored. A phone that comes back under a different server address counts as a new phone, such as a node whose address changed.

To make a server forget what was set for its own phones at startup, set `removeDevicesFromDatabaseBeforeRunningThePlugin` to `true`. A hub or a standalone server then forgets the settings of its own phones, a node forgets those of every phone it has, and a hub keeps the settings of its nodes' phones either way. Each phone then comes back as a new one, in the shared pool.

## The states on the Devices page

The **Devices** page shows each phone as a card, or as a table row. Every phone has exactly one state, and when several apply the first in this list wins.

| State | What it means |
|---|---|
| **Offline** | The phone is marked as unreachable. Sessions and leases skip it. |
| **Maintenance** | An admin has put it into maintenance. No new session or lease is given the phone. A test already running on it carries on, and shows the phone as Maintenance until it ends. |
| **Busy** | Something holds the phone: a test session is running on it, someone has it open in device control or on the Live devices page, an SDK lease holds it, or a session is still being set up on it. On a hub, a phone that its node reports as busy is Busy too. The card says which: "Test session", or "Live control by you" or "by another user". |
| **Reserved** | Someone has reserved it until a set time, and nothing else holds it. See [Reservations](#reservations). |
| **Ready** | Free: sessions can be given it. |

Above the cards you can filter by state, platform and kind (real or virtual), and search by name, model, version, team or UDID. The filters and search are kept in the page's address, so you can share a view. A card's **Control** button opens [device control](./device-control.md), and its **⋯** menu copies the UDID, the server URL, the address and the capabilities for a session on that phone. For an admin, the menu also has **Manage tags…**, **Assign team…** and **Enter maintenance**. The table rows have the same menu.

## How a session gets a device

When a test creates a session, Xenon picks a phone for it. A phone is offered only if all of these hold:

- Its platform matches `platformName`.
- It is not busy, not in maintenance and not reserved, and no SDK lease holds it.
- It is not marked unhealthy by the [health checks](#health-checks).
- The caller can see it. A member sees the shared pool and their teams' phones; an admin sees all of them. See [Teams](./teams.md).
- On a hub, its node hasn't just failed several session creates in a row. A node that fails three in a row is left out for a minute.

Capabilities narrow the choice further:

| Capability | Keeps only |
|---|---|
| `appium:udid`, `appium:udids` | The phone with that UDID. `appium:udids` takes a comma-separated list, such as `"R58M123ABC,00008110-001A"`. |
| `appium:platformVersion` | Phones whose OS version equals it. |
| `appium:minSDK`, `appium:maxSDK` | Phones whose OS version is at least, or at most, the value. This compares the OS version (Android 13 is `13`), not the Android API level. |
| `appium:tags` | Phones that carry every tag listed, as a comma-separated string. See [Tags](#tags). |
| `appium:filterByHost` | Phones whose server address contains the text. On a hub, use it to pick one node, such as `"192.168.1.20"`. |

`appium:iPhoneOnly` and `appium:iPadOnly` keep only iPhones, or only iPads. [Capabilities](./capabilities.mdx#choosing-a-device) says how Xenon tells them apart.

For iOS, the file in `appium:app` also chooses the kind of device: a path ending in `.app` or `.zip` means a simulator, anything else a real iPhone. A path that disagrees with `iosDeviceType` fails the session with an error saying so.

A session that names a lease with `xe:options.leaseId` doesn't go through this: it uses the phone its lease holds. See [Leases for CI](./leases.md).

```js
const capabilities = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:minSDK': '12',
  'appium:tags': 'pixel,lab-row-3',
  'xe:options': {
    accessKey: process.env.XENON_ACCESS_KEY,
    token: process.env.XENON_TOKEN,
  },
};
```

Before it hands over a real iPhone, Xenon checks that WebDriverAgent answers. When it doesn't, Xenon starts it and checks again. If WebDriverAgent still doesn't answer, the session is refused with an error saying the phone is unhealthy.

A simulator is handed over as it is. The XCUITest driver builds, installs and starts WebDriverAgent on it, as it does without Xenon, and boots the simulator first if it is shut down. The first session on a simulator waits while WebDriverAgent is built, which can take a few minutes; later sessions start much faster.

## When no phone is free

A request that finds no phone waits for one. By default it looks again every second, and gives up after five minutes with an error that names the reason: no phone matches the request, the matching phones are busy or in maintenance, or the matching phone is reserved by someone.

| Setting | Where | Default |
|---|---|---|
| `deviceAvailabilityTimeoutMs` | Server option | `300000` (5 minutes) |
| `deviceAvailabilityQueryIntervalMs` | Server option | `1000` (1 second) |
| `appium:deviceAvailabilityTimeout` | Capability, in milliseconds | The server option |
| `appium:deviceRetryInterval` | Capability, in milliseconds | The server option |

Waiting requests form a queue for each platform and are served in the order they arrived. Each one gets its full wait from the moment it reaches the front. A session that names a lease doesn't join the queue, because its phone is already its own.

`maxSessions` (default `8`) also holds requests back: while that many Appium sessions are running or being started, a new session waits until fewer are. Only sessions count. A live preview, a recording and an SDK lease with no session on it make a phone busy but don't use a slot, so someone watching phones can't stop tests running on others. A session started on a leased phone does count, and is never held back itself. On a hub the count includes its nodes' phones. A value below `1` means no limit.

The **Overview** page shows how many requests are queued. `GET /xenon/api/queue/summary` gives the counts by platform, and `GET /xenon/api/queue` lists the waiting requests. A member sees in detail the requests from their own teams and for phones they can see, and the rest only as a count.

### When a phone is freed

A phone goes back to the pool when its session ends. A session that sends no command for its idle time is ended and its phone released. The idle time is the session's own `appium:newCommandTimeout`, or `newCommandTimeoutSec` (default `60`) when it doesn't set one. Xenon looks every `checkBlockedDevicesIntervalMs` (default `30000`). Two things are left alone: a phone being set up for a session that hasn't started yet, which gets 10 minutes, and a phone held by an SDK lease with no session on it, which the lease's own timeout frees.

## Reservations

A reservation keeps a phone for one person, for a while. Test sessions and SDK leases skip a reserved phone, so nothing from CI takes it. A reservation doesn't stop anyone from opening the phone in device control, which shows who reserved it.

On the Devices page, open a Ready phone's card and choose **Reserve**. Enter who it is for, how long (1, 2, 4 or 8 hours) and, if you like, a reason. **Release** on the card ends it early. Reservations also end by themselves when their time is up. A reservation survives its phone being unplugged or restarted, until that time.

The same is available over the API, at `/xenon/api/reservation`, for a role of Member or above and a token with the `devices` scope. A member's own tokens carry only `sessions` and `read`, so members reserve from the dashboard, and a script needs an admin's token:

```bash
# Reserve for two hours
curl -X POST http://localhost:4723/xenon/api/reservation \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"udid":"emulator-5554","host":"http://192.168.1.100:4723","reservedBy":"priya","duration":"2h","reason":"Debugging checkout"}'

# Add an hour
curl -X POST "http://localhost:4723/xenon/api/reservation/emulator-5554/http%3A%2F%2F192.168.1.100%3A4723/extend" \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -H 'Content-Type: application/json' -d '{"duration":"1h"}'
```

- `duration` is `1h`, `2h`, `4h` or `8h`, or a number of milliseconds. A reservation lasts at least a minute, and ends no more than 24 hours from now. An extension adds its time to the current end, with the same limits.
- A phone that is running a test session can't be reserved, and neither can a phone someone else has reserved.
- Only the person who made a reservation, or an admin, can release or extend it. Anyone else gets `403` with `not_reservation_holder`.
- `udid` and `host` are as `GET /xenon/api/devices` shows them. A phone you can't see answers `404`.

The reservation API is deprecated in favour of leases, which also hand you the capabilities for the session: see [Leases for CI](./leases.md). Its responses carry `Deprecation` and `Sunset` headers, and the sunset date is 1 January 2027.

## Maintenance

Putting a phone into maintenance keeps new sessions and leases off it, for a repair, a charge or an OS update. It only needs an admin. A test already running on the phone isn't interrupted.

On the Devices page, open the **⋯** menu on the phone's card or table row and choose **Enter maintenance**; **Exit maintenance** puts it back. A phone in maintenance stays there when it disconnects and comes back. Over the API, send both the `udid` and the `host`:

```bash
curl -X POST http://localhost:4723/xenon/api/block \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"udid":"emulator-5554","host":"http://192.168.1.100:4723"}'
```

`POST /xenon/api/unblock` takes the same body. Both need role `ADMIN` and a token with the `devices` scope. Without both fields they answer `400`, and for a phone Xenon doesn't have, `404`. The same UDID can be on two servers, such as an emulator on two nodes, which is why the host is needed.

## Tags

Tags are labels you give a phone, such as `pixel`, `lab-row-3` or `flaky`, so that tests can ask for a kind of phone with `appium:tags`. A phone must carry every tag a session asks for.

Admins set them from the **⋯** menu on a card or a table row, with **Manage tags…**. Over the API, `POST /xenon/api/device/tags` with `{ "udid": "...", "host": "...", "tags": ["pixel", "lab-row-3"] }` replaces the phone's tags with that list. It needs role `ADMIN` and the `devices` scope, and answers `404` for a phone Xenon doesn't have. A phone keeps its tags when it disconnects and comes back: see [What a phone keeps when it goes](#what-a-phone-keeps-when-it-goes).

## Health checks

Xenon checks the health of its own phones in the background. A phone that fails is marked unhealthy, and sessions and leases skip it until a later check passes. A server checks only the phones it drives itself: a hub leaves its nodes' phones to the nodes.

| Phone | Unhealthy when |
|---|---|
| Android | It hasn't finished booting, its battery is under 10%, or its temperature is above 55 °C. Battery level, temperature and free storage are shown on the card. |
| Real iPhone | WebDriverAgent doesn't answer while the phone is busy, for any of the reasons in the **Busy** row of [the states above](#the-states-on-the-devices-page), or while its live preview is running. A free iPhone with no preview running isn't unhealthy for having no WebDriverAgent. |
| Simulator | It is in neither the Booted nor the Shutdown state. |

When a phone is unhealthy Xenon tries to recover it: it reboots an Android phone that is stuck booting, and restarts WebDriverAgent on an iPhone.

The first check runs 30 seconds after the server starts. After that, `healthCheckIntervalMs` sets how often (default `300000`, five minutes), and `healthCheckSchedule`, a cron expression such as `0 * * * *`, replaces the interval when it is set. A super admin can also change both on the dashboard's **Settings** page, as **Idle health frequency** and **Deep diagnostic schedule**. The server picks up the change within a minute.

## Related

- [Teams](./teams.md): which phones each person can see.
- [Hub and nodes](./hub-and-nodes.md): phones on other machines.
- [Live device control](./device-control.md): driving a phone from the dashboard.
- [Leases for CI](./leases.md): holding a phone for a test run.
- [Configuration](./configuration.md): every option, with its default.
