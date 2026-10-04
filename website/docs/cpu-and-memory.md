---
title: CPU and memory
description: How Xenon records a session's CPU and memory, what Android phones and iPhones report, how a hub collects it from its nodes, what the Performance card says when nothing is recorded, and how to turn it off.
---

While a test runs, Xenon reads the phone's CPU and memory every 2 seconds and charts them on the session's page, under **Performance**. Use it to see whether a slow or failing step lines up with a spike, whether the app's memory keeps climbing, or whether the phone itself was overloaded. This page explains what is recorded for each kind of phone, how the figures get to the page, what the card says in each state, and how to turn recording off.

## What is recorded

| Phone | What Xenon records |
|---|---|
| **Android phone or emulator** | The device's CPU, the device's memory (used, and the total), the app's CPU and the app's memory. |
| **iPhone** | The device's CPU only. |
| **iOS simulator, a phone from a cloud provider** | Nothing. |

- **CPU** is a percentage of the whole device, from 0 to 100. The app's CPU is a share of the whole device too, not of one core.
- **Memory** is in megabytes. The app's memory is what it holds in the phone's RAM.
- The first reading has no CPU, because CPU needs the reading before it. The chart starts with the second.
- The card needs the server's dashboard turned on, because the figures belong to the session's record. See [Sessions and builds](./sessions.md#what-you-need).

### Which app Android reports

Xenon charts one app at a time:

- the session's `appium:appPackage` capability, when it is a package name such as `com.example.shop`;
- otherwise the app in the foreground, looked up again every 10 seconds. When the foreground app changes, the line breaks where it changed and is labelled **Foreground app**. Hover over the chart to see which app each point belongs to.

When the app isn't running, it has no figure. An app that restarts shows no CPU for one reading, not a spike.

### iPhones

Xenon reads an iPhone's CPU with go-ios, for as long as the session runs. The figure is the device's overall CPU, not the app's, and there is no memory. The card says so: "On iPhones, only the device's overall CPU is recorded." For more detail on a real iPhone, a session can have a **Performance trace**, which is on the session's **Details** card when Xenon recorded one.

## How it is recorded

- **Every 2 seconds** the server reads the phone. On Android that is one `adb` call per reading, plus a lookup of the foreground app every 10 seconds when the session has no `appium:appPackage`. On an iPhone it is a go-ios process that runs for the session.
- **Every 10 seconds** the readings are written to the session's record, so a crash loses at most the last 10 seconds. A running session's page asks again every 10 seconds, so its newest figures can be up to 10 seconds behind.
- **A session never fails because of it.** A reading that fails is skipped. After five failures in a row, Xenon stops recording that session, and the card says "Recording stopped: the device stopped responding." The figures up to then stay on the card.
- **The figures belong to the session.** The nightly cleanup deletes them with it. See [Data retention](./retention.md).

## On a hub with nodes

A session on a node's phone is recorded by the node, and the hub collects it:

- The **node** records its own phones for the sessions its hub creates, whatever its own dashboard setting. It has no record of those sessions, so it keeps the figures in memory for its hub to collect: at most the newest 30 minutes of each session, and for 10 minutes after the session ends.
- The **hub** asks the node every 10 seconds, so the chart fills in as the test runs, and asks once more when the session ends, so the last seconds are kept. Collecting needs the hub's dashboard to be on. After a hub restart it carries on from the newest figure it stored.
- Both the hub and the node need Xenon 2.11 or later. When a node is older, its sessions show "Performance isn't recorded", and the hub logs that once for the node and asks it again after 10 minutes.

The figures are the same as for the hub's own phones. A phone from a cloud provider is never collected. See [Hub and nodes](./hub-and-nodes.md).

## What the Performance card says

| What you see | What it means |
|---|---|
| **Collecting… The first figures appear within 10 seconds.** | A running session that has too few figures yet to draw a chart. |
| **CPU**, **App memory** and **Device memory** charts | Each line says its peak and average. The device's memory also shows its total, as a dashed line. |
| **Performance isn't recorded for this session** | A running session that nothing records: for example, it runs on an iOS simulator or on a node that needs updating, or recording is turned off. |
| **No performance data for this session** | A session that ended with no figures, for one of the same reasons, or because it ran before recording existed. |
| **Recording stopped: the device stopped responding.** | The phone didn't answer five readings in a row. The data ends there. |
| **Too few figures were recorded to draw a chart.** | A session that ended before it had two readings. |

## Turn it off

Recording is on by default. To stop it for every session on this server, set `sessionMetrics` to `false`:

```yaml
server:
  use-plugins: [xenon]
  plugin:
    xenon:
      sessionMetrics: false
```

Its flag is `--plugin-xenon-session-metrics`. See [Configuration](./configuration.md). After a restart, new sessions have no figures: a running session's card says "Performance isn't recorded", and an ended one's says "No performance data for this session". Sessions already recorded keep theirs.

## Read the figures over the API

The card reads `GET /xenon/api/session/<session id>/metrics`:

```bash
curl "http://localhost:4723/xenon/api/session/$SESSION_ID/metrics" \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN"
```

The answer, shortened to two readings:

```json
{
  "platform": "android",
  "intervalMs": 2000,
  "appId": "com.example.shop",
  "series": { "deviceCpu": true, "deviceMem": true, "appCpu": true, "appMem": true },
  "recording": "sampling",
  "samples": [
    { "t": 1759501213000, "deviceCpu": 23.4, "deviceMemMb": 3120.5, "deviceMemTotalMb": 7680,
      "appCpu": 8.1, "appMemMb": 212.7, "app": "com.example.shop" },
    { "t": 1759501215000, "deviceCpu": 31.9, "deviceMemMb": 3134.2, "deviceMemTotalMb": 7680,
      "appCpu": 14.6, "appMemMb": 219.3, "app": "com.example.shop" }
  ]
}
```

- `t` is the time of the reading, in milliseconds since 1970. `samples` are oldest first.
- `series` says what the platform can record: an iPhone has `deviceCpu` only, and any other platform has none.
- `recording` is set only while the session runs: `sampling`, `stopped` (Xenon gave up after repeated failures) or `off` (nothing records it). It is `null` once the session has ended.
- A reading's figure is `null` when it isn't known, such as the CPU of the first reading.
- Anyone who may see the session can call it. A session you can't see answers `404`, like an unknown one. See [Who sees which sessions](./sessions.md#who-sees-which-sessions).

## Related

- [Sessions and builds](./sessions.md#a-sessions-page): the rest of a session's page.
- [Hub and nodes](./hub-and-nodes.md): how a hub works with its nodes.
- [Configuration](./configuration.md): every option, with its flag.
