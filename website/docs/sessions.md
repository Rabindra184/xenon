---
title: Sessions and builds
description: Name and group your test sessions, read the Sessions page and a session's page, set the result from a test, copy a build's failed tests, download a bug report, and see who can see which sessions.
---

Every test session Xenon runs leaves a record: its result, its commands, a video, screenshots, device logs and any selectors that self-healing fixed. This page explains how to name and group sessions, how to read the **Sessions** page and a session's own page, how to set the result from a test, how to take a build's failed tests or a session's evidence to a ticket, and who can see which sessions.

## What you need

- **The dashboard on.** Start the server with `--plugin-xenon-enable-dashboard`. Without it Xenon keeps no record of the sessions on this server's own phones, so they don't appear on the **Sessions** page. See the [Quick start](./quick-start.mdx#2-start-appium-with-xenon-and-its-dashboard).
- **On a hub,** the hub's own dashboard records the sessions that run on its nodes' phones. A node keeps no record of a session its hub created. See [Hub and nodes](./hub-and-nodes.md).
- **Time.** The nightly cleanup deletes builds and sessions older than 30 days by default, and their videos and screenshots with them. It also keeps only the newest 100 builds by default (`buildCleanupMaxCount`), so a busy lab can lose a build sooner than that. See [Data retention](./retention.md).

Any signed-in user can open **Sessions** in the sidebar.

## Name and group sessions

A test names itself, and the run it belongs to, in its capabilities:

```js
const capabilities = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'xe:options': {
    accessKey: process.env.XENON_ACCESS_KEY,
    token: process.env.XENON_TOKEN,
    name: 'Checkout: pay by card',
    build: 'nightly-2026-10-04',
  },
};
```

- **`name`** is the test's name. It is the row's title in the **Test** column and the heading of the session's page. A session with no name shows, in grey, the app it ran: its package name or bundle id, else its app file's name, else the browser. With none of those it shows `Session` and the first eight characters of its id.
- **`build`** groups sessions into a build. Sessions with the same build name join the same build while it stays active: a session that starts within 30 minutes of the start of the build's latest session joins it, and after a longer gap Xenon starts a new build with the same name. So a run whose sessions follow one another splits after a session that lasts longer than 30 minutes: the next session starts a new build. Sessions with no `build` go into a build called `Default Build`, which the dashboard shows by its start time, as `Build · Sep 29, 07:30`.
- `xe:name` and `xe:build` work too, and so do the older spellings `xe:sessionName` and `xe:buildName`. [Capabilities](./capabilities.mdx#session-settings) lists them, with the other settings a session can carry.
- The `accessKey` and `token` say who is running the test. The session's page then shows the person under **Run by**, and [who can see the session](#who-sees-which-sessions) depends on it.

A test can also name its session while it runs, with `xenon: setSessionName`. See [Execute commands](./execute-commands.md#session-details).

## The Sessions page

**Sessions** lists every test session, newest first, with its build, device and outcome.

### The numbers at the top

Four tiles summarise the period you have chosen:

| Tile | What it shows |
|---|---|
| **Pass rate** | The share of finished sessions that passed, and how it changed from the period before, as `+2 pts vs prior 7 days`. Sessions that are still running, or that have no pass or fail result, don't count. When there is nothing to compare, the tile says how many of the finished sessions passed. |
| **Failed** | How many sessions failed, out of all the sessions in the period. |
| **Running now** | How many sessions are running at this moment, and on how many devices. This doesn't depend on the period. |
| **Median duration** | The median time of the sessions that have ended, with their 90th percentile (`p90`). It comes from the newest 10,000 ended sessions of the period. |

A session counts as passed when its status is `success`, `passed` or `ended`, and as failed when it is `failed`, `error` or `timeout`.

The tiles follow what you choose below. With **All sessions** selected they cover the period. With a build selected they cover that build alone, with no comparison.

### Period

The period menu at the top right shows the period you have chosen: **All time**, **Last 24 hours**, **Last 7 days** (the default) or **Last 30 days**. With **All sessions** selected, it sets the period of the tiles and of the list, and it chooses which builds the builds column lists. A build you open shows all its sessions, whatever the period.

### Builds

The column on the left starts with **All sessions**, then lists the builds that started in the period, newest first. Each build shows its name, its start time, its number of sessions and a thin bar of how they ended: passed, failed, running, or without a result. **Find builds…** searches the list by name. Choose a build to see only its sessions. See [A build's page](#a-builds-page).

### The session list

Each row is one session:

| Column | What it shows |
|---|---|
| **Status** | **Passed**, **Failed** or **Running**. A failed row has a red edge. |
| **Test** | The session's [name](#name-and-group-sessions). Under it, a failed session shows why it failed, and otherwise, in the **All sessions** view, its build. |
| **Device** | The phone's name, platform and OS version. Under it, where the session ran (`This server`, or the address of the node that ran it) and who ran it. |
| **Started** | The time, for today's sessions, or the date. Hover for the full time. |
| **Duration** | How long it ran, or has run. |

Open a session by clicking its row, or by focusing it and pressing Enter.

The **All**, **Passed**, **Failed** and **Running** buttons above the list show how many of the loaded sessions are in each state, and filter the list. **Search tests, devices, people…** matches a session's id, its test or app name, its failure reason, its device's name, platform and OS version, where it ran and who ran it. Next to them, `3 of 40 sessions` says how many rows match out of the ones loaded.

### Loading more sessions

The page loads the newest 200 sessions of the period, or of the build. When there are more, a line below the list says `Showing the newest 200 of 412 sessions`, and **Show 200 more** loads the next 200. The status buttons and the search work on the sessions that are loaded, so load more first when the one you want is older.

The page follows sessions as they start and finish, so you don't need to reload it.

## A session's page

The top of the page says how the session ended. It shows the result, the test's name, and under it the phone, where it ran, who ran it, when it started and how long it took. **Download bug report** at the right is described [below](#bug-reports). A trail above it (**Sessions**, the build, the session's short id) leads back.

### Result and why

Four tiles come first:

| Tile | What it shows |
|---|---|
| **Result** | **Passed**, **Failed** or **Running**. For a failed session, the note is the [failure category](./failure-analysis.md), such as `Element Not Found`. Otherwise it says how long the session ran, or has been running. |
| **Commands** | How many commands the session sent, and how many failed. |
| **Self-healing** | How many commands were healed, and by which tiers. `None` when no selector needed healing. |
| **Slowest command** | The longest command, with its name. |

For a failed session, a **Why it failed** card follows:

- **Reason**, the failure reason the session ended with.
- **First failed command**, the first command that got an error, with its message.
- **AI analysis**, when an AI provider is set up. See [AI failure analysis](./failure-analysis.md).
- **Stack trace**, when the reason holds one.

**Copy** puts a short failure report on the clipboard, ready for a ticket: the session, build, device, duration, category, reason, first failed command and AI analysis. **Open runbook** opens a short guide for the failure category in a new tab. Only some categories have a guide of their own. The others open a general page, which says there is no runbook for that category.

### Self-healing

When self-healing fixed selectors in the session, a **Self-healing** card lists each one: its **Time** and **Command**, the selector the test **Asked for**, what it **Healed to**, the **Tier** that found it and its **Confidence**. Change the test to the selector it healed to, so the next run doesn't need healing. See [Self-healing](./self-healing.md) and [Selector health](./selector-health.md).

### Performance

The **Performance** card charts the phone's CPU and memory over the session. See [CPU and memory](./cpu-and-memory.md).

### Commands, timeline, screenshots and logs

A panel with tabs holds the session's evidence. A number on a tab counts what it holds.

| Tab | What it shows |
|---|---|
| **Commands** | Every command the session sent, newest first, with its time, its duration and a coloured dot for how it went. Open a row to see the command's request. |
| **Timeline** | Every command on one time axis, oldest first, so you can see where the time went. Failed commands are red and healed ones amber. |
| **Screenshots** | The screenshots the commands kept. Click one to open it full size. A failed command's screenshot has a red edge. |
| **Device logs** | The phone's system log: logcat on Android, the system log on iOS. Xenon saves it after every command. |
| **Debug logs** | The messages the test sent with `xenon: debug`. |

**Errors only**, on the lists, hides every row but the errors.

- Xenon takes a screenshot after commands that change the screen, such as `click`, `setValue` and `swipe`, and after a command that fails. `xe:screenshot_on_failure` and `xe:screenshot_on_every_command` change that. See [Capabilities](./capabilities.mdx#session-settings).
- Device logs are saved for each session on this server's own phones while the dashboard is on, whatever `xe:save_device_logs` says. A session on a node's phone, through a hub, gets none.

### Recording, details and capabilities

Three cards sit beside the panel:

- **Recording.** While the session runs, a live view of the phone, when it has one. After it ends, the session's video. When there is none, the card says why: the session failed before recording started, recording was turned off for it (`xe:record_video`), or none was captured.
- **Details.** The session id (with a copy button), build, device UDID, platform, where it ran, who ran it, when it started and ended, its tags, and, for an iPhone with one, the **Performance trace** to download.
- **Capabilities.** What the test asked for (**Requested**) beside what the driver ran with (**Actual**). Credentials are not kept in either: Xenon removes them before it stores anything. See [Capabilities](./capabilities.mdx#how-xenon-sees-your-credentials).

### Network

An Android session that captured its network traffic shows it in a **Network** card, with a **HAR** download. Captured requests can carry sign-in details and personal data, so only admins can open them. A member sees "Only admins can see network requests". See [Network interceptor](./network-interceptor.md).

## Set the result from a test

Xenon decides a session's result when it ends: **Failed** if any command got an error response, otherwise **Passed**. A test that handles an error on purpose, such as looking for an element that may be absent, still has that command counted as failed. To set the result yourself, send `xenon: setSessionStatus` before the session ends:

```js
await driver.executeScript('xenon: setSessionStatus', [
  { status: 'failed', reason: 'Payment was declined' },
]);
```

- `status` is `passed`, `success` (the same thing) or `failed`, in any case.
- `reason` is optional. For a failed session, it appears under the test's name on the **Sessions** page and in **Why it failed**.
- A status you set stays when the test ends the session: Xenon doesn't change it. When Xenon ends the session itself, because the driver crashed, the session stopped answering or sat idle too long, or the server shut down or restarted, it records **Failed** with its own reason instead.
- The command never fails your test. It answers `{ recorded: true }`, or `{ recorded: false, message }` when nothing was saved. That happens when the server keeps no record of the session, because its dashboard is off or it is a node, and when `status` is none of the three values above.
- On a hub with its dashboard on, the hub answers for a session on a node's phone and writes to its own record.

`setSessionName`, `addTag`, `debug` and `captureEvidence` work the same way. [Execute commands](./execute-commands.md#session-details) lists them all, with their arguments.

## A build's page

Choose a build in the builds column, or open its address, `/xenon/builds/<build id>`. The top of the page shows `Build #A70AC97A`, when it started and its name. The tiles above now cover this build alone, and a checkbox on each row lets you pick sessions.

### Copy failed tests

**Copy failed tests** puts the build's failed sessions on the clipboard as text, for a re-run in your CI or for a ticket. Each one has the test's name, why it failed, its phone and its session id, and the oldest comes first:

```text
Failed tests in nightly-2026-10-04: 2 of 14 sessions

- Checkout: pay by card
  NoSuchElementError: An element could not be located
  Pixel 8 Pro · Android 15 · session 6f1c2a8e-3b4d-4e5f-9a7b-1c2d3e4f5a6b
- Search: filter by price
  Payment was declined
  iPhone 14 Plus · iOS 18.1 · session 0b7e4d21-55c6-4c0b-8f0e-6a1d9c3b2e10
```

- Tick sessions first to copy only the failed ones among them.
- The button is off, with the hint "No failed tests to copy", when none failed.
- It copies the sessions the page has loaded. For a build of more than 200 sessions, choose **Show 200 more** first.
- Xenon can't re-run a test for you, since the tests belong to your runner. This list is what you take there.

### Export

**Export** downloads **Export as JSON**, the stored session records, or **Export as CSV**, with one row per session and the columns `id`, `build_id`, `status`, `failure_category`, `failure_reason`, `device_platform`, `device_version`, `device_name`, `node_id`, `startTime`, `endTime` and `name`. With sessions ticked, it exports those. With none ticked, it exports the whole build, up to its newest 5,000 sessions.

## Bug reports

**Download bug report** at the top of a session's page downloads a zip of the session's evidence, named `bugreport-<session id>-<time>.zip`. It works for a running session and an ended one. It holds:

| File | What it holds |
|---|---|
| `README.md` | A short summary: the session, its device, when the report was made, the AI summary, the failure reason, the files, and any warnings. |
| `manifest.json` | The same details as data: the session and its device, the capabilities it asked for, the time window, the files and the warnings. A value under a name that looks like a secret, such as `token` or `password`, is masked. |
| `logs.txt` | The session's commands, one line each: the time, the command and its response. Xenon masks only values that look like AI provider keys in it, so read it before you attach it anywhere public. |
| `video.mp4` | The session's video. Only when the session has a recorded video on disk. |
| `ai-summary.txt` | The [AI analysis](./failure-analysis.md). Only when the session has one. |
| `network.har` | The traffic the session captured. Only for admins, and only when it captured any. |

The screenshots and the device logs are not in the bundle. A report made by a member leaves the network capture out and says so in the manifest's warnings, because a capture can carry sign-in details and personal data.

On a phone that is running a test, the device control page also has a **Bug report** button, which captures the last 60 seconds of the session. Over the API, `mode=slice` covers the last `windowSec` seconds (5 to 600, 60 by default) of the session, video and commands included, and `mode=full` the whole session:

```bash
curl -X POST "http://localhost:4723/xenon/api/sessions/$SESSION_ID/bug-report?mode=slice&windowSec=120" \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -o bugreport.zip
```

## Who sees which sessions

A session follows its phone, by the same rule as [teams](./teams.md):

- **Admins** see every session. So does everyone on a server with sign-in turned off.
- **Members** see a session when its phone is in the shared pool or in one of their teams.
- A session whose phone no longer has a record in Xenon, because it was unplugged and removed, is visible to the person who ran it only.

The rule covers the **Sessions** page and its numbers, a session's page, its bug report, and the builds. A build is listed when a member can see at least one of its sessions, and its counts cover only the sessions they can see, since builds are shared by name, and two teams can use the same build name. A member's export of a build also leaves out the sessions whose phone no longer has a record, even their own.

A session you can't see answers like one that doesn't exist. Opening its address takes you back to **Sessions**, with the message "Session not available — it may belong to a team you are not on."

The network capture is hidden from members even on a session they can see. See [Network interceptor](./network-interceptor.md).

## Over the API

The dashboard reads the same routes you can call. [The API reference](/api) lists each with its parameters.

```bash
# The newest 50 failed sessions of a period
curl "http://localhost:4723/xenon/api/session?status=failed&since=2026-10-03T00:00:00.000Z&limit=50" \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN"

# The numbers at the top of the Sessions page
curl "http://localhost:4723/xenon/api/session-summary?since=2026-09-27T00:00:00.000Z" \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN"

# A build's sessions as a CSV file
curl -X POST "http://localhost:4723/xenon/api/build/$BUILD_ID/export" \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"format":"csv"}' -o build.csv
```

- `GET /xenon/api/session` answers up to 500 sessions by default and at most 2,000. To read the next page, pass the `createdAt` and `id` of the last session as `before` and `beforeId`.
- `GET /xenon/api/build` lists the builds with their session counts. `GET /xenon/api/session/<id>` is one session, and `GET /xenon/api/session/<id>/session_log` its commands.
- A status in the API is the stored one: `success`, `failed`, `running` and so on. The failure category is upper case, such as `ELEMENT_NOT_FOUND`.

## Related

- [CPU and memory](./cpu-and-memory.md): the **Performance** card.
- [AI failure analysis](./failure-analysis.md): the category and the AI analysis in **Why it failed**.
- [Execute commands](./execute-commands.md): the commands a test can send to set a session's name, status and tags.
- [Capabilities](./capabilities.mdx): `xe:name`, `xe:build`, video and screenshot settings.
- [Teams](./teams.md): who sees which phones, and so which sessions.
- [Data retention](./retention.md): how long builds, sessions and their files are kept.
