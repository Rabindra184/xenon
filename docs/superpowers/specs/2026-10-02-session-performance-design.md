# CPU and memory for every session: a Performance view

Date: 2026-10-02
Status: direction approved in conversation ("go"). Awaiting review of this
written spec.

## Why

The session page has no CPU or memory view for either platform, and what
little exists doesn't work.

- **Android.** `AndroidAppProfiler` (`src/profiling/`) is started by
  `EventManager.onSessionStarted` only when the session's capabilities name an
  `appPackage`. None of the lab's five Android sessions did. When it does run,
  it saves nothing in practice:
  - It reads `adb shell top -o %CPU,RSS,ARGS -s 1 -d 2 -m 20`. `-m 20` lists
    only the 20 busiest processes. On the S9+ those were system processes, so
    an app under test at 0% CPU never appears.
  - It expects each batch of output lines to start at the top of a `top`
    frame (line 1 memory, line 3 CPU). Batches don't line up with frames, so
    most are discarded as "not in proper format".
  - Both logged runs that started ended with "No profiling data to save".
  - What it does save is shown as a raw list in the "System profiling" log
    tab, with no chart.
- **iOS.** `EventManager` starts XCUITest's performance recording on a real
  iPhone, and the session's Instruments trace is offered as a download
  ("Performance trace"). The page shows no figures.

## What the tools can give

- **Android, from `adb shell`** (checked on the S9+, Android 10):
  - `/proc/stat` line 1, `MemTotal` and `MemAvailable` from `/proc/meminfo`,
    `pidof <package>`, `/proc/<pid>/stat` (utime, stime) and `VmRSS` from
    `/proc/<pid>/status` are all readable.
  - One `adb shell` call printing all of them took 310 ms.
  - The foreground app (`dumpsys activity activities`, `mResumedActivity`)
    took 210 ms.
- **iOS, from the go-ios Xenon bundles (1.2.1).** `ios sysmontap` streams
  whole-device CPU load about twice a second (`cpu_total_load`, with
  `cpu_count` and `enabled_cpus`).
  - It gives no memory and nothing per app, despite its help text.
  - On iOS 17+ it needs the phone's tunnel, and Xenon now keeps one per
    iPhone (`IOSTunnels`).
  - On an idle 6-core iPhone 14 Plus it read 77 to 125, so it looks like
    load summed over cores. The implementation confirms this on a loaded
    phone before dividing by `enabled_cpus`.

## Decisions (for review)

1. **Android records the app and the device.** Its figures are:
   - app CPU %, as a share of the whole device, so it shares a scale with
     device CPU;
   - app memory (resident, `VmRSS`);
   - device CPU %;
   - device memory used and total.

   The app is the session's `appPackage` capability, else the app in the
   foreground, looked up every 10 s.
2. **iOS records device CPU only.** That's all go-ios 1.2.1 offers. The
   Instruments trace download stays as it is.
3. **A sample every 2 s**, buffered and written every 10 s. A running
   session's chart then fills in as it runs, and a crash loses at most 10 s.
4. **A new table** (`SessionMetric`), with typed columns:
   - Nothing writes `Profiling` any more, and `AndroidAppProfiler` is removed.
   - The old route and the "System profiling" tab stay, read-only, for
     sessions that have such rows. The tab is already hidden when empty.
5. **Charts drawn as SVG in the dashboard**, with no new dependency. The
   dashboard has no chart library today.
6. **On by default** wherever the dashboard is on, since it is
   `EventManager` that runs per session. An optional plugin argument,
   `sessionMetrics: false`, turns it off. It is not `required` and has a
   default, so older configs still validate.
7. **This server's own sessions only.** The hub's session page has never
   read a node session's data from the node. (Corrected after the final
   review: a node never samples either, since only a hub or standalone server
   runs `EventManager.onSessionStarted`. A node's phones get no figures, and
   the hub's panel shows such a session as not recorded.)

## Design

### `SessionMetricsService` (new, `src/services/metrics/`)

- **`start(session, device)`** is called from
  `EventManager.onSessionStarted`, in place of `startAppProfiling`.
  - It picks the platform's sampler.
  - It does nothing when the setting is off, for a simulator or emulator
    where a sampler has nothing to read, or for another server's phone.
- **`stop(sessionId)`** is called from `onSessionStopped`, in place of
  `saveAppProfilingData`. It stops the sampler and writes what is buffered.
  It is idempotent.
- A sampler never fails a session:
  - a failed sample is skipped;
  - five failures in a row stop that session's sampler, with one warning.
- Server shutdown stops every sampler, and the iOS sampler's child process
  is killed in the `exit` hook with the others (`killAllSync`).

### Android sampler

- **Every 2 s, one `adb shell` call** through the resolved adb
  (`AndroidDeviceManager.getAdbForDevice`, never a bare `adb`). It prints:
  - `/proc/stat` line 1;
  - `MemTotal` and `MemAvailable`;
  - for the app, `pidof <package>`, then its `/proc/<pid>/stat` and
    `VmRSS`.
- **CPU comes from the change between two samples:**
  - device CPU % = 1 − (idle + iowait jiffies) / all jiffies;
  - app CPU % = (utime + stime) of the app / all jiffies, both as a share of
    the whole device.
  - The first sample sets the baseline and records no CPU.
- **Memory:** device used = `MemTotal − MemAvailable`, and app memory =
  `VmRSS`. Both are stored in MB.
- **Which app:**
  - The app is `appPackage` if given; otherwise the foreground app,
    re-read every 10 s.
  - A sample where the app has no process (not started, or crashed) records
    device figures only.
  - A new pid (the app restarted) resets the app's CPU baseline.
- The parsing is a pure function of the command's output, so it is tested
  on recorded output.

### iOS sampler

- **Tunnel.** It asks `IOSTunnels.borrow(udid)` for the phone's tunnel, and
  asks again every 30 s so the tunnel lives through the session. It ends the
  usual 2 minutes after the last ask, or never if a preview owns it. Below
  iOS 17 it runs without one.
- **Process.** It runs `ios sysmontap --udid <phone>` with `envFor(udid)`.
  - It's a long-running child, registered with `ProcessRegistry` for the
    session, so the session's end kills it.
  - It is restarted with a backoff if it exits while the session runs.
- **Readings.** It reads `cpu_total_load` and `enabled_cpus` from each JSON
  line, and keeps the latest per 2 s slot.
- A simulator gets no sampler.

### Storage

```prisma
model SessionMetric {
  id               Int     @id @default(autoincrement())
  session_id       String
  at               Float   // epoch ms
  device_cpu_pct   Float?
  device_mem_mb    Float?
  device_mem_total Float?
  app_cpu_pct      Float?
  app_mem_mb       Float?
  app_id           String? // package or bundle id the app figures are for
  session          Session @relation(fields: [session_id], references: [id], onDelete: Cascade)

  @@index([session_id, at])
}
```

- The migration only adds a table.
- `CleanupService` deletes a session's metrics in the same transaction as
  its other rows, beside `profiling.deleteMany`.
- Size: 1,800 rows per session-hour.

### API

`GET /xenon/api/session/:sessionId/metrics`, under `isValidSession` like
every `/session/:sessionId/*` route, so a hidden session gets the
unknown-id answer.

```json
{
  "platform": "android",
  "intervalMs": 2000,
  "appId": "com.acme.shop",
  "series": { "deviceCpu": true, "deviceMem": true, "appCpu": true, "appMem": true },
  "samples": [{ "t": 1790000000000, "deviceCpu": 23.4, "deviceMemMb": 2850, "deviceMemTotalMb": 5620, "appCpu": 6.1, "appMemMb": 214 }]
}
```

`series` says what this session can have (on iOS only `deviceCpu`), so the
page can tell "not recorded on this platform" from "no samples yet".

### The Performance panel (session page)

- **Placement.** A full-width panel under the healing panel,
  `web/src/components/session-detail/performance-panel.tsx`.
- **Summary.** A header with peak and average for each recorded series.
- **Two charts** on the session's elapsed-time axis:
  - CPU %, from 0 to 100, with device and app lines;
  - Memory, with app MB and device used (device total as a reference line).
- **Hover.** A vertical crosshair, plus a tooltip with the elapsed time and
  every value at that moment.
- **Styling.** Colours from role tokens only, since `color-literals` is a
  ratchet, and correct in both the light and dark themes.
- **While the session runs** it refreshes with the page's existing poll.
- **States:**
  - no samples, and no recordable series (a simulator, another server's
    phone, an older session, or the setting off): one line saying which;
  - iOS: "iPhone: device CPU only", with the trace download noted;
  - fewer than two samples: a "collecting…" note instead of a chart.
- **Code split.** The chart is its own small component (`line-chart.tsx`),
  so Selector Health's trend chart can reuse it later.

## Out of scope

- An iPhone's per-app CPU and memory: go-ios 1.2.1 can't give them.
- Showing a node session's figures on the hub.
- Network, battery, frame rate, and alerts on thresholds.
- Comparing sessions.

## Testing

- **Unit (server):**
  - the Android parser on recorded outputs: normal, no app process, a pid
    change, a first sample;
  - the CPU delta maths;
  - the iOS line parser;
  - sampler lifecycle with fakes: start, skip a failed sample, stop after
    five failures, flush every 10 s and on stop, idempotent stop;
  - `EventManager` starts and stops the service, and no longer touches
    `Profiling`;
  - the route answers visible sessions and gives a hidden one the
    unknown-id answer;
  - `CleanupService` deletes metrics with the session.
- **Unit (web, vitest):**
  - the chart's scales and paths for known data;
  - the panel's empty states;
  - the iOS note;
  - the tooltip values at a hovered time.
- **Hardware (scratch server):**
  - an S9+ session with `appPackage`, and one without, which uses the
    foreground app;
  - an iPhone session, with device CPU only;
  - charts checked on the session page in dark and light themes at 1280 and
    1440 px;
  - `adb shell` sample duration checked under load.
- **Checks:**
  - `npm run test:all` and `web` vitest;
  - the viewport overflow spec, with the session route's mocks extended with
    metrics;
  - the colour-literal ratchet.

## Risks

- **Two Instruments clients.** sysmontap runs beside XCUITest's own
  performance recording on the same iPhone, and two Instruments clients
  might conflict. The hardware check runs both. If they conflict, the trace
  is dropped in favour of the live figures, or the reverse, and you decide
  which.
- **`cpu_total_load`'s scale** is inferred from idle readings. It is
  confirmed on a loaded phone before it ships.
- **Sampling cost** is one `adb shell` call every 2 s per Android session,
  plus one go-ios child per iOS session. A lab running many sessions can
  turn it off with `sessionMetrics: false`.
