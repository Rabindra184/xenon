# Changelog

All notable changes to `@xenon-device-management/xenon` (the Appium hub plugin).

This project follows [Semantic Versioning](https://semver.org/). Releases are
published to npm automatically when `package.json`'s `version` changes on `main`
(see `.github/workflows/npm-publish.yml`).

## 2.11.1

**The hub's collection of a node session's CPU and memory, made sturdier.**

No database migration, and nothing to configure. As for 2.11.0, upgrade the
hub and its nodes together.

### Fixed

- **One malformed figure from a node could stop a session's chart** (#428).
  A figure with no time, or a value that isn't a number, failed every later
  write of the session's figures for up to 30 minutes. The hub now keeps
  only well-formed figures.
- **An absurdly long `?after=` dropped a session's figures on the node**
  (#428). A 400-digit number read as Infinity on
  `GET /xenon/api/node/sessions/:id/metrics`, and the node dropped
  everything it held for the session. It now reads as no `after`.
- **Ending the sessions of a node that went dark was slower than it needed
  to be** (#428). Each waited up to 5 s more for a last answer about its
  figures. A node that wasn't answering isn't asked again.
- **Only sessions that run on a node are collected from** (#428). A cloud
  provider's session and this server's own were kept out by a device check
  alone; the session's type now decides.

## 2.11.0

**CPU and memory for sessions on a node's phones, live on the hub's session
page, and Deploy on the Apps page can be cancelled again.**

No database migration, and nothing to configure.

**Upgrade the hub and its nodes together.** The node samples its phones and
the hub collects the figures, so both need 2.11.0. Until a node is upgraded,
its sessions keep showing "Performance isn't recorded", and the hub logs that
once for that node. An older hub never collects, and a 2.11.0 node frees what
it held 10 minutes after each session ends.

### Added

- **The Performance panel for sessions on a node's phones** (#426). Until now
  the hub's session page said "isn't recorded" for every such session.
  - **The node** samples its own phones for the sessions the hub creates,
    whatever its dashboard setting, and holds the figures in memory: the
    newest 30 minutes per session.
  - **The hub** collects them every 10 s, so the chart fills in as the test
    runs. It asks once more when the session ends, so the last seconds are
    kept. After a hub restart it carries on from the last figures it stored.
  - The figures are the same as for the hub's own phones: device and app CPU
    and memory on Android, device CPU on an iPhone.
- **`GET /xenon/api/node/sessions/:id/metrics?after=`** on a node (#426),
  beside the session-status route and under the same rule: the hub's session
  token when per-command auth is on.

### Changed

- **The Performance panel's "isn't recorded" wording** (#426). It no longer
  blames a device connected to another machine, since such a device is now
  recorded unless its machine needs updating.

### Fixed

- **Deploy on the Apps page couldn't be cancelled** (#425). After **Deploy**,
  the device picker opened on top of the button, which by then read
  **CANCEL**, so the picker couldn't be closed. It now opens beside the
  button. The control sweep found it.

## 2.10.1

**Selector Health and the session page stay fast on a busy lab, and a fixed
selector that heals again always goes back to "To fix".**

Four indexes are added, on the commands, device logs and profiling tables
(#423). A server builds them itself at its next startup. On a database with
a million commands and 2.5 million log lines that took about 4.5 s and made
the file about a fifth larger. Nothing to configure.

### Fixed

- **Selector Health was slow on a busy lab** (#423). The commands table holds
  every command of every session and had one index, on the selector. On a
  million commands:
  - the "To fix" list over a year: 1.8 s to 0.2 s;
  - search: 0.9 s to 30 ms;
  - the panel of a selector healed 50,000 times in a year: 1 s to 0.35 s.
    It no longer attaches the session to every heal it reads.
- **The session page and cleanup read whole tables** (#423). A session's
  commands, device logs, debug logs and profiling had no index on their
  session. With 2.5 million log lines:
  - a session's device logs: 149 ms to 7 ms;
  - cleaning up a build of 100 sessions: 97 s to 4 s.

  The failed-command check at the end of every session is faster in the
  same way.
- **A fixed selector that healed again could stay fixed** (#423). The heal
  sends it back to "To fix" at once, but that step could fail, and nothing
  tried again. The verification job also counted only clean builds: a
  selector with three of them was promoted to fixed however often it healed
  in others. The job now checks for a heal since **Mark fixed** on every
  selector being verified or fixed, and sends such a selector back.
- **The "broke again" note reset the view** (#423). Its **Show selectors to
  fix** went back to the default period and order. It now keeps both, clears
  any search or filter that could hide the selector, and opens the selector
  when only one broke.

## 2.10.0

**CPU and memory for every session, and Selector Health rebuilt as a list
with a side panel.**

Two tables are added (`SessionMetric`, `SelectorEvent`); a SQLite server adds
them itself at startup. Nothing to configure: an optional `sessionMetrics`
setting (on by default) turns session sampling off.

### Added

- **A Performance panel on the session page** (#420). Every session on this
  server's own phones records CPU and memory every 2 seconds, and the page
  charts them as the session runs:
  - Android phones and emulators: device CPU and memory, and the app's CPU
    and memory (the session's `appPackage`, else the app in the foreground);
  - iPhones: device CPU.

  A node's phones get no figures, and the hub's panel says so. The figures
  come from `GET /session/:id/metrics`.
- **Selector Health as a list with a side panel** (#421).
  - **Summary:** selectors that needed healing, heals, sessions affected, and
    time spent healing, each compared with the period before, plus a
    heals-per-day trend with the heals that used AI.
  - **Tabs:** To fix, Being verified, Fixed and Muted, each with its count.
    Selectors and suggested fixes show in full. Search, platform and
    healing-method filters, three sorts, and pages of 50.
  - **Panel:** the status and actions, every suggested fix with Copy as,
    where the selector heals, its latest heals, and an Activity history of
    who did what. ↑/↓ move between selectors.
  - The view, including the open selector, is kept in the address. Old
    `/selector-health/detail` links open the panel.
- **`GET /healing/selectors` and `GET /healing/selectors/detail`** (#421),
  the list and the panel. They show a caller only selectors healed in
  sessions they can see; any other answers `404`, as an unknown one.
- **`GET /healing/summary` adds `timeSpentMs` and `trend`** (#421), the
  trend counted in the caller's time zone (`tz`).

### Changed

- **Members can mark selectors fixed and mute them** (#421).
  `POST /healing/selector/state` now needs role `MEMBER` and the `sessions`
  scope (was `ADMIN` and `admin`), on a selector healed in a session the
  caller can see.
  - A mute is lab-wide: it leaves the selector out of every team's list, CI
    gate and digest.
  - Every change is recorded with the person who made it and, for a mute,
    an optional reason (`reason`, up to 500 characters).
- **The Android app profiler is replaced by the session sampler** (#420). It
  ran only with an `appPackage` and in practice saved nothing. The "System
  profiling" tab still shows old sessions' rows.

### Removed

- **Cost estimates** (#421). `estCostUsd` is no longer in
  `/healing/summary`, `/healing/hotspots`, `/healing/hotspots/violations` or
  `/healing/selector`, and the digest drops its "est. $" line. A client that
  reads the field now gets `undefined`. The figure priced every heal the same
  whatever model ran, local ones included.

### Fixed

- **Selector Health's Pending and Resolved lists lost selectors** (#421). The
  server cut the list to the top 50 by heals before splitting it by status,
  and a fixed selector that stopped healing fell out of the period. Both tabs
  now start from each selector's status.
- **"To fix" stopped counting at 5,000 heals** (#421). It now counts in the
  database, with no cap.
- **The detail page never offered Mark fixed or Mute** (#421). The list
  opened it without the selector's strategy.
- **Selector actions from the dashboard were saved with no one as their
  actor** (#421). They were recorded by API key, and a dashboard user has
  none. They are now recorded by user.

## 2.9.2

**Xenon reaches WebDriverAgent only through a phone's own forwarded port.**

No database migration, and no configuration to change.

### Fixed

- **A simulator's WebDriverAgent commands can no longer reach an iPhone**
  (#418). When a command to WebDriverAgent failed, `WDAClient` retried it at
  the device's network address, port 8100. A simulator's address is this
  Mac's own, where 8100 can be an iPhone's forwarded WebDriverAgent, so a
  failing simulator could send taps and typing to an iPhone. The stream
  watchdog likewise took whatever answered there as the device's
  WebDriverAgent being alive. Both fallbacks are removed. A dead or hung
  forward is now "not responsive" and gets the watchdog's normal restart,
  as it always did on a real iPhone.

### Removed

- **The iPhone network-address lookup** (#418). Detection ran `ios info` on
  every iPhone at every pass to read an address go-ios never reports, so the
  address was always empty. Real iPhones behave as before, with one go-ios
  call fewer per phone per detection pass.

## 2.9.1

**Xenon's startup no longer kills its own iPhone detection, plus clean-ups to
the iPhone tunnels.**

No database migration, and no configuration to change.

### Fixed

- **Startup no longer kills Xenon's own go-ios calls** (#414). At boot Xenon
  kills whatever a previous run left of go-ios (tunnels, WebDriverAgent
  runners, log streams), matching every process running the go-ios binary.
  It did this at the end of startup, after device detection had begun, so it
  also killed the `ios info` call detection makes for each plugged-in
  iPhone, logged as "Failed to fetch IP via go-ios" at every boot. That call
  only looks up the phone's network address, which go-ios doesn't report for
  recent iPhones anyway, so nothing visible was lost. The clean-up now runs
  as soon as the database is ready, before anything starts go-ios.
- **A second error from a tunnel process no longer crashes the server**
  (#415). The tunnel listened for the process's `error` event once, so a
  second one was thrown as unhandled.
- **An iPhone tunnel's start waits at most 20 s** (#415). It counted 41
  checks half a second apart, but each check can take up to 1 s, so a tunnel
  that answered slowly could hold a stream start for about a minute.
- **A session ending on an iPhone leaves its tunnel's ports** (#415). It
  released every port lease the phone had, the tunnel's pair included, while
  the phone's preview and tunnel could still be running. Those ports were
  never handed out meanwhile, since a live listener blocks that. The tunnel
  gives its pair back when it stops.

### Changed

- **One go-ios path and one port-lease time** for the tunnels, streams and
  detection (#415), instead of a copy in each.
- **CI uses `actions/setup-node@v7`** (#416). v7 no longer sets a placeholder
  npm token for the publish job's install, which it doesn't need.

### Known issues

- **Two Xenon servers on one Mac kill each other's go-ios processes** when
  either starts or stops, if the same user runs both (a hub and node side by
  side). The startup and shutdown clean-ups find go-ios by its binary's path,
  which both servers share.

## 2.9.0

**A screenshot works on an iPhone that isn't streaming.** On iOS 17 and
later, go-ios reaches the screenshot service only through the phone's tunnel,
and only a preview, recording or Appium-driven stream opened one. So
`GET /xenon/api/control/:udid/screenshot` failed on an idle iPhone ("failed
to get tunnel info"), which hit API and SDK clients. The dashboard was
unaffected, since it starts a stream first.

No database migration, and no configuration to change.

### Added

- **A screenshot opens the iPhone's tunnel when it has none** (#412).
  - The first screenshot takes a few seconds longer while the tunnel starts.
    Later ones reuse it.
  - The tunnel stays while screenshots keep coming, and stops 2 minutes after
    the last one, freeing its two ports.
  - A preview or recording that starts meanwhile takes the tunnel over, and
    closing it ends the tunnel.
  - If the tunnel can't start, the screenshot's error gives go-ios's reason.
  - Logs never needed this: they work without a tunnel.

### Changed

- **A phone's iOS version is cached for 10 minutes** (#412), so screenshots
  on iPhones below iOS 17, and on simulators, don't each ask go-ios for it.

## 2.8.3

**A finished session stops showing "running" on the Sessions list, and an
iPhone's tunnel failures say what went wrong.**

No database migration, and no configuration to change.

### Fixed

- **A finished session in an older page of the Sessions list stops showing
  "running"** (#410). Older pages, loaded with **Show 200 more**, were fetched
  once, so a session running then kept showing "running" until the period or
  build was changed. This was a known issue since 2.7.0.
  - Each refresh now re-reads, by id, the older rows still running.
  - `GET /xenon/api/session` takes `ids`: up to 200 session ids,
    comma-separated, under the usual team-visibility rule. Otherwise it is
    `400 invalid_ids`.
- **A failed iPhone stream start stops its go-ios tunnel** (#409). A start
  whose tunnel came up and whose WebDriverAgent then failed left the tunnel
  running, holding its two ports, until the phone's next start. It is now
  stopped, except while an Appium session may be using it.
- **An iPhone tunnel failure says what went wrong** (#409). The dashboard
  showed "Lost the connection to the device tunnel. Reconnect the device,
  then retry." for every one. It now says when:
  - no tunnel ports are left;
  - the tunnel stopped while starting, with go-ios's own reason;
  - the tunnel came up on an unexpected port.

## 2.8.2

**An Android phone with H.264 preview is released when its tile closes.**
In 2.8.1, closing such a tile left the phone held, with "1 other viewer(s)"
and nothing connected. The same phantom viewer also blocked Android's idle
release, so the hold lasted until someone stopped the preview.

No database migration, and no configuration to change.

### Fixed

- **A viewer who hangs up while the stream starts is no longer counted**
  (#407).
  - The stream request counted its viewer only once the stream had started,
    which takes seconds on a cold start, and only then listened for the
    browser leaving. A browser that left during that wait was counted for
    good.
  - An Android tile with H.264 preview did this every time: it drops its
    MJPEG warm-up as soon as H.264 is ready. An iPhone tile closed during its
    start did the same.
  - 2.8.1's known issue tied this to recordings; it happened without one.

## 2.8.1

**Closing a preview releases the phone.** Closing a Live devices tile, or
leaving device control, used to leave the phone held for about 10 minutes.
The server logged "keeping the preview for 2 other viewer(s)", and Appium
sessions for that phone queued behind the hold until the idle watchdog
released it. Now the phone is released 3 s after the last view of it closes.

No database migration, and no configuration to change.

### Fixed

- **A closed or reconnected stream view no longer counts as a viewer**
  (#405). A browser keeps loading an MJPEG image after it leaves the page,
  until it is garbage collected, and the server counts each open stream as
  a viewer. Each tile close, and each tile reconnect (a recording start
  causes one), left a viewer that wasn't there.
  - The dashboard now closes the stream when its image goes: the Live
    devices tile, the device-control screen and the inspector's live view.

### Known issues

- **An Android phone with H.264 preview can stay held after it was
  recorded.** After a recording, its Android MJPEG viewer count can stay one
  too high, so closing its tile doesn't release it. Stop its preview to
  release it. iPhones, and Android phones without H.264 preview, are
  released.

## 2.8.0

**Several iOS 17+ iPhones stream at once on one Mac.** Until now only one
could preview or record at a time. Every iPhone's go-ios tunnel took the same
ports, 60105 and 60106. A second iPhone's stream start killed whatever listened
there, which was the first iPhone's live tunnel.

No database migration, and no configuration to change. Xenon now uses local
ports 12100–12199 for these tunnels, two per streaming iPhone, and no longer
uses 60105 or 60106.

### Fixed

- **A second iPhone's stream no longer takes down the first one's** (#403).
  Each iOS 17+ iPhone gets its own go-ios tunnel on its own leased pair of
  ports.
  - go-ios commands about a phone find that phone's own tunnel:
    WebDriverAgent's launch, the live logs pane, the logs request and
    screenshots.
  - Starting, stopping or restarting one iPhone's stream leaves every other
    iPhone's tunnel and stream alone.
  - Nothing is killed by port any more. A stream start clears only its own
    phone's leftovers, and still none while an Appium session holds the
    phone.
- **An unplugged iPhone's tunnel is stopped within seconds** (#403). go-ios
  keeps a tunnel running when its phone is unplugged, and restarts it one port
  up on the replug, where it would land on the next phone's ports. Xenon
  checks each tunnel every 5 s. It stops one whose phone has gone or whose
  port has moved, and frees its ports. The phone's next start gets a fresh
  tunnel.

### Known issues

- **Screenshots and logs don't open a tunnel for an iPhone that isn't
  streaming.** On iOS 17+ they work while its preview, recording or Appium
  session runs.
- **A stream start whose WebDriverAgent fails leaves that phone's tunnel
  running** until the phone's next start or stop.
- **A running session in an older, already loaded page keeps the status
  it had when loaded**, until the period or build is changed.
- **Install by path is refused for a node's phone**: a path names a file on
  one machine.
- **BiDi and session WebSockets aren't routed through a hub.** A session's
  `webSocketUrl` points at the node, so nodes must not sit on untrusted
  networks.

## 2.7.0

**The Sessions list pages through every session.** It used to stop at the
newest 500 sessions of a period or build, while the summary above it counted
them all. It now shows the newest 200, with **Show 200 more** for the next
page, and says how many are loaded of how many there are.

No database migration, and no configuration to change.

### Added

- **Paging on the Sessions list** (#401).
  - The newest 200 sessions are refreshed every 3 s.
  - **Show 200 more** loads the next page, once.
  - Rows loaded this way stay listed while new sessions arrive: nothing is
    skipped or repeated.
  - Under the table: "Showing the newest 400 of 2,340 sessions".
- **`GET /xenon/api/session` takes `limit` and a page cursor** (#401).
  - `limit`: 1 to 2000, default 500 as before. A larger limit gets 2000.
  - `before` and `beforeId`: the last row of the page before.
  - Sessions are now ordered by `createdAt`, then by `id`, so pages
    continue exactly where they stopped.
  - A `limit` or `before` it can't read is refused with `400`
    (`invalid_limit`, `invalid_before`).

### Changed

- **CI runs on Node 22** (#401). Node 20 reached end of life in April 2026.

### Known issues

- **A running session in an older, already loaded page keeps the status
  it had when loaded**, until the period or build is changed.
- **Install by path is refused for a node's phone**: a path names a file on
  one machine.
- **BiDi and session WebSockets aren't routed through a hub.** A session's
  `webSocketUrl` points at the node, so nodes must not sit on untrusted
  networks.
- **Only one iOS 17+ iPhone per Mac can stream at a time**, because every
  go-ios tunnel binds the same port.

## 2.6.2

**Copy a build's failed tests.** A build's page had a **Retry failed**
button that did nothing but say retry would come later. The server can't
re-run a client's tests, so the button now copies them instead, ready to
paste into a CI re-run or a ticket.

No database migration, and no configuration to change.

### Changed

- **"Retry failed" is now "Copy failed tests"** (#399). It copies each
  failed session (failed, error or timeout), oldest first, with:
  - its test;
  - the first line of why it failed;
  - its phone and its session id;
  - a header with the counts.

  With sessions selected, it copies the failed ones among them. When
  nothing failed, it is disabled and says so.
- **CI runs off the actions GitHub runs on deprecated Node 20.**
  `actions/checkout` is on v7 and `actions/setup-node` on v6, both Node 24.
  `setup-node` stays below v7 until the publish job's `npm install` is
  confirmed without v7's placeholder token.

### Known issues

- **The session list still returns at most the newest 500 sessions.**
- **Install by path is refused for a node's phone**: a path names a file on
  one machine.
- **BiDi and session WebSockets aren't routed through a hub.** A session's
  `webSocketUrl` points at the node, so nodes must not sit on untrusted
  networks.
- **Only one iOS 17+ iPhone per Mac can stream at a time**, because every
  go-ios tunnel binds the same port.

## 2.6.1

**A phone is free again seconds after its recording ends.** A recording
that started the phone's stream itself left the phone held for about ten
minutes after it stopped: any recording made without a preview open. That
was 642 s on the lab's S9+, and nobody else could use the phone meanwhile.

No database migration, and no configuration to change.

### Fixed

- **A recording lets go of its phone when it ends** (#397). The phone now
  goes the way a closed preview does: after a 3 s grace, its stream stops
  and its hold is released, unless someone is watching it or another
  recording reads it.
  - A phone with a preview open keeps its hold until that preview closes.
  - A node's phone is released at once, as before.
  - Before, the hold was kept whenever the phone's stream was running,
    taken for a preview's. But a recording starts that stream itself.

### Known issues

- **The session list still returns at most the newest 500 sessions.**
- **"Retry failed" is still a placeholder.**
- **Install by path is refused for a node's phone**: a path names a file on
  one machine.
- **BiDi and session WebSockets aren't routed through a hub.** A session's
  `webSocketUrl` points at the node, so nodes must not sit on untrusted
  networks.
- **Only one iOS 17+ iPhone per Mac can stream at a time**, because every
  go-ios tunnel binds the same port.

## 2.6.0

**A session's page leads with how it ended and why.** The page now opens
with the result and the test's name, then the phone, where it ran, who ran
it, when and for how long. Four tiles follow: the result, the commands, the
self-healing and the slowest command.

The page also shows:
- the reason a failed session failed, with the first failed command's own
  error and the AI analysis the server had stored but never shown;
- every selector self-healing fixed;
- a timeline of the commands and the screenshots they kept, in place of the
  two placeholder tabs.

A running session's page follows it live.

No database migration, and no configuration to change.

### Changed

- **The failure panel shows for `error` and `timeout` sessions too**, not
  only `failed` ones (#395).
- **Capabilities are labelled Requested and Actual** (they were "desired"
  and "session"), and long names wrap instead of being cut.
- **The breadcrumb shows a short session id.** The full id, with a copy
  button, is in the new Details card.

### Added

- **The session page's outcome header and tiles** (#395). The tiles share
  their look with the Sessions page's summary strip.
- **Why it failed:** the reason, the first failed command and its error,
  and the AI analysis.
  - Only `**bold**` and `` `code` `` are rendered in the analysis, never
    HTML, and a long analysis folds behind "Show all".
  - Copy includes the analysis.
- **Self-healing panel**, when something was healed: each selector the test
  asked for, what it healed to, the tier and the confidence.
- **Timeline and Screenshots tabs.**
  - Timeline places every command on one time axis, failed ones red and
    healed ones amber.
  - Screenshots shows the images commands kept, each opening full size.
  - Every command row shows its duration.
  - An empty tab is dimmed instead of showing "0".
- **Details card:** session id, build, UDID, platform, where it ran, who ran
  it, start and end, tags, and the iOS performance trace's download when the
  session kept one.
- **Live updates:**
  - A running session's page asks for its status and commands every 4 s.
  - When the session ends, the page loads its device and debug logs once
    more.
- **`GET /xenon/api/session/:id` carries `owner` and `ranOn`**, as the
  session list does since 2.5.0.

### Fixed

- **Healed commands are marked in the command list again.** The row read a
  `healed` field the server never writes; the server writes `is_healed`.
- **"Errors only" also keeps commands marked `is_error`.**

### Known issues

- **The session list still returns at most the newest 500 sessions.**
- **"Retry failed" is still a placeholder.**
- **Install by path is refused for a node's phone**: a path names a file on
  one machine.
- **BiDi and session WebSockets aren't routed through a hub.** A session's
  `webSocketUrl` points at the node, so nodes must not sit on untrusted
  networks.
- **Only one iOS 17+ iPhone per Mac can stream at a time**, because every
  go-ios tunnel binds the same port.

## 2.5.0

**The Sessions page opens on every session, with a summary.**
- **Every session, newest first:** the page no longer starts empty until a
  build is picked. It lists the chosen period's sessions across all builds.
- **Summary on top:** pass rate and its change from the period before,
  failures, what's running now, and median and p90 duration.
- **Names first:** rows show the test's name, its build, the device, where
  it ran and who ran it. Failures are marked, with the reason inline.
- **Builds column:** it now filters the table, and each build has an
  outcome bar.

No database migration, and no configuration to change.

### Changed — operator action may be needed

- **`GET /xenon/api/build` counts `error` and `timeout` sessions as failed,
  and `ended` as passed** (#393). This is the same verdict the session rows
  use. `failedCount` used to count only `failed`, and `passedCount` only
  `success` and `passed`, so a client reading those counts may see them
  change for the same builds.
- **The session detail page says Passed, not Success**, matching the list.

### Added

- **The Sessions page redesign** (#393).
  - `/builds` opens on all sessions of the period, which defaults to the
    last 7 days and is chosen in the page header.
  - The summary strip shows a chosen build's own numbers.
  - The builds column comes first with "All sessions", and each build shows
    a pass/fail bar. A build sent with no name reads "Build · Sep 29,
    07:30" instead of "Default Build".
  - An unnamed session shows its app (package, bundle id or file name). The
    page shows how to name tests and runs with the `xe:options.name` and
    `xe:options.build` capabilities.
  - Search covers what the rows show, the owner and node included.
  - Rows open with Enter or Space as well as a click.
- **`GET /xenon/api/session?since=<ISO date>`** lists only the sessions
  created since then. Each listed session also carries:
  - `owner`: `{ name, email }`, or null;
  - `ranOn`: `here`, a node's host, or null when that isn't known.
  A `since` that isn't a date is refused with `400 invalid_since`.
- **`GET /xenon/api/session-summary?since=&buildId=`**:
  - counts by outcome for the period and for the period of the same length
    before it;
  - median and p90 duration of the sessions that ended;
  - what runs now.

  It covers only the sessions the caller may see.

### Known issues

- **The session list still returns at most the newest 500 sessions.** When
  it stops there, the count says "(the newest)". The summary counts the
  whole period.
- **"Retry failed" is still a placeholder.**
- **The session detail page hasn't been redesigned yet.**
- **Install by path is refused for a node's phone**: a path names a file on
  one machine.
- **BiDi and session WebSockets aren't routed through a hub.** A session's
  `webSocketUrl` points at the node, so nodes must not sit on untrusted
  networks.
- **Only one iOS 17+ iPhone per Mac can stream at a time**, because every
  go-ios tunnel binds the same port.

## 2.4.0

**A hub records its nodes' phones.** Recording a node's phone, alone or
with others (across nodes too), now runs on the hub from the node's stream.
Per-phone videos, the combined video, marks and proof bundles work as they
do for the hub's own phones. With this, every device-control action works on
a node's phone except install by path.

No database migration. Only the hub needs this version: nodes on 2.1 or
later serve the stream it records.

### Changed — operator action may be needed

- **Recording a node's phone uses the hub's network while it runs** (#391):
  roughly 1–3 MB/s per phone, between the hub and the node. If the node
  restarts mid-recording, that phone's recording ends; the rest of the group
  carries on.
- **While the hub records a node's phone, stopping its preview is refused**
  (`409 device_recording`), as it is for the hub's own phones.

### Added

- **Record a node's phone from the hub** (#391).
  - The hub reads the node's stream through a relay on its own loopback, so
    the recording pipeline is unchanged.
  - The node's stream is signed again for each connection.
  - The recording starts once the phone's stream is live, as for a local
    phone, so marks line up.
  - You can record a node phone you're previewing.
  - A cloud provider's phone can't be recorded.

### Known issues

- **Install by path is refused for a node's phone**: a path names a file on
  one machine.
- **Installing an app on an iPhone through a hub wasn't checked on a phone**
  (no test app to install). It takes the same path to the node as Android,
  which was checked.
- **BiDi and session WebSockets aren't routed through a hub.** A session's
  `webSocketUrl` points at the node, so nodes must not sit on untrusted
  networks.
- **Only one iOS 17+ iPhone per Mac can stream at a time**, because every
  go-ios tunnel binds the same port.

## 2.3.0

**Device control works on a hub's node phones, end to end.** Installing apps,
by upload or from the app library, and Omni-Vision now go through the hub.
The hub shows who holds a node phone's preview and names them when it
refuses someone. Every device-control action works on a node's phone apart
from install by path and recording. Checked on an Android phone and an
iPhone, through a hub and an auth-enabled node. Device control's **Upload
file** also works now, on every server.

Includes a database migration, applied automatically at startup. **Read
"Changed — operator action may be needed" before upgrading.**

### Changed — operator action may be needed

- **Database migration: one column on `Device`** (#386): `nodeHold`, who
  holds a node's phone, from the node's report. `runMigrations` applies it
  at startup. If you run with `XENON_AUTO_MIGRATE=false`, apply
  `20261001120000_device_node_hold` yourself before starting this version.
- **Installing apps on a node's phone through a hub needs the node on 2.3**
  (#387, #388). An older node's own upload-install received no file, so the
  install fails there, with that node's error. Everything else in device
  control works with 2.1 and 2.2 nodes.
- **Uploads for install are limited to 4 GB** (#387) and written to a
  temporary file, not held in memory. A larger upload is answered `413`.

### Added

- **Install apps on a node's phone through the hub** (#388).
  - Upload and install: the hub streams the upload to the node without
    storing it.
  - Install from the app library: the hub checks the app's team as before,
    then sends the file from its library to the node.
  - The node gets 15 minutes to answer an install.
- **Omni-Vision on a node's phone through the hub** (#388): the scan and
  locator testing run on the hub, with the hub's AI settings, on a
  screenshot from the node.
- **Who holds a node phone's preview** (#386).
  - The device picker, the device cards ("Live control by you") and a
    reload's tile restore treat it like a local preview.
  - The hub fills the holder's name into a node's refusal, where the node
    could only say "another user".
  - Nodes of any 2.x version already report the holder.

### Fixed

- **Device control's Upload file never installed anything** (#387): every
  upload was answered "No files were uploaded." The uploaded file is now
  removed after the install, whether it worked or not.
- **An Android install that took longer than 20 seconds was reported as
  failed** (#388) though it had worked; adb's library stopped the command at
  its default limit. Installs now get 10 minutes.
- **A failed screenshot was never answered** (#389). On an iPhone with no
  live preview, the Screenshot tab spun forever; it now gets an error with
  the reason.

### Known issues

- **Recording a node's phone from the hub doesn't work yet:** it runs on the
  hub's own machine.
- **Install by path is refused for a node's phone**: a path names a file on
  one machine.
- **Installing an app on an iPhone through a hub wasn't checked on a phone**
  (no test app to install). It takes the same path to the node as Android,
  which was checked, and then the node's `ideviceinstaller`.
- **BiDi and session WebSockets aren't routed through a hub.** A session's
  `webSocketUrl` points at the node, so nodes must not sit on untrusted
  networks.
- **Only one iOS 17+ iPhone per Mac can stream at a time**, because every
  go-ios tunnel binds the same port.

## 2.2.0

**A hub's dashboard works on its nodes' phones.** Device control of a
node's phone now runs on the node: screenshots, clipboard, installed apps,
shell, logs, the inspector, and the live preview and live logs, relayed
through the hub. What the hub can't pass on yet, it refuses with a message
naming the node, instead of running it on the hub's own machine.

No database migration. Only the hub needs this version: a 2.2 hub works with
2.1 nodes, which need no change (checked on a phone with a 2.1.0 node).

### Changed — operator action may be needed

- **A node phone's live preview goes through the hub** (#383). Each viewer
  is one connection from the hub to the node, so plan for the hub's
  bandwidth: an MJPEG viewer is roughly 1–3 MB/s, H.264 much less. The node
  still holds the phone for the preview, refuses a second user and releases
  it when nobody watches, as it does for its own dashboard.
- **Actions the hub doesn't pass on to a node are refused** (#382) with
  `501 not_available_through_hub`, and the dashboard shows the reason:
  uploading an app, installing from the app library, `install` by path, and
  Omni-Vision. They used to run on the hub's own machine. That failed, or,
  with hub and node on one machine, worked by accident on the hub's adb.
- **A cloud provider's phone gets `501 not_available_for_cloud_phone`** for
  device control (#382), and nothing is sent to the provider.

### Added

- **Device control of a node's phone runs on the node** (#382): tap, swipe,
  text, key events, long press, screenshot, clipboard, lock and unlock,
  screen state, installed apps, uninstall, logs, shell and the inspector
  snapshot. The node's answer comes back unchanged. A node that can't be
  reached is `502`, and one that doesn't start answering in 60 s is `504`.
- **Live preview and live logs of a node's phone through the hub** (#383):
  device control's preview (MJPEG), the Live Devices tiles (H.264) and the
  Debug Logs tab. The viewer's ticket is the hub's, issued after its team
  check. The hub relays the node's stream with the node's own close codes,
  and a viewer that falls behind slows the node's stream rather than the
  hub's memory.
- **A node's phone shows as busy on the hub as soon as its preview starts**
  (#383), not a report interval (30 s) later, so the hub doesn't hand it to
  a session meanwhile.

### Security

- **Nothing is sent to a cloud provider for device control** (#382). The
  five input actions used to be sent to the provider's host, typed text
  included.

### Fixed

- **A server set to emulators only (or real phones only) listed a phone of
  the other kind for about 30 s after it was plugged in** (#384), and every
  such phone connected at startup, and could hand it to a session. A plugged
  phone now follows `androidDeviceType` as discovery does.
- **The lease sweeper logged an expired lease as "missed heartbeats"** (#381);
  it now says when the lease expired.
- **The unit test suite wrote to `~/.cache/xenon/xenon.db`** (#381), the
  database a developer's own server uses; it now runs against a throwaway
  one.

### Known issues

- **The hub doesn't show who holds a node phone's preview.** The picker
  shows such a phone as busy even to its holder until the preview ends, and
  Live Devices tiles for node phones aren't restored after a reload.
- **Recording a node's phone from the hub doesn't work yet:** it runs on
  the hub's own machine.
- **Uploads, installing from the app library and Omni-Vision are refused
  for a node's phone** (see above).
- **BiDi and session WebSockets aren't routed through a hub.** A session's
  `webSocketUrl` points at the node, so nodes must not sit on untrusted
  networks.
- **Only one iOS 17+ iPhone per Mac can stream at a time**, because every
  go-ios tunnel binds the same port.

## 2.1.0

**Hubs and nodes work on Appium 3.** A session through a hub is created,
driven and ended on its node, with auth enforced at the hub. Node sessions
survive a hub restart, a hub's device control reaches its nodes' phones, and
a node's reports no longer undo the hub's claim on a phone. Xenon's and
Appium's WebSockets now both work on every supported Node version.

Includes a database migration, applied automatically at startup. **Read
"Changed — operator action may be needed" before upgrading.**

### Changed — operator action may be needed

- **Database migration: three columns on `Device`** (#375): `claimSessionId`,
  `claimedAt` and `nodeBusy`. They let a hub keep its own claim on a node's
  phone apart from the node's report. `runMigrations` applies it at startup.
  If you run with `XENON_AUTO_MIGRATE=false`, apply
  `20260929120000_device_claims` yourself before starting this version.
- **Upgrade a hub and its nodes together if the nodes have auth on**
  (#373, #377). The hub no longer forwards a client's credentials to a node.
  It sends its own short-lived, signed token, which the node checks against
  the hub's public keys. So a 2.1 node with auth on refuses a create from an
  older hub, and an older node with auth on refuses a 2.1 hub's creates. A
  node with auth off is unaffected.
- **Create sessions on a node's phones through the hub** (#377). A node with
  auth on now refuses a session that didn't come from its hub, with "Create
  sessions through the hub", naming the hub. A node with auth off still
  accepts one, for local development.
- **Leases end at `expiresAt`** (#378). A client that kept heartbeating could
  hold its phone up to 15 minutes past the lease's end; the sweeper now ends
  the lease then. A session running on the lease keeps its phone until the
  session itself ends.
- **Keep passwords out of Appium's own request log** (#366). Appium logs the
  `[HTTP] -->` body of every request before any plugin runs, the dashboard's
  sign-in (`POST /xenon/api/auth/login`) included. Add this rule next to
  2.0.0's token rule, in the same list. With `--log-filters <file>`:

  ```json
  [{"pattern": "([Pp]assword\\\\?[\"']?\\s*:\\s*(\\\\?)([\"'`]))(?:\\2\\\\(?:\\2[\\s\\S]|[^\\\\])|(?!\\3)[^\\\\\\x00-\\x1f])*", "flags": "g", "replacer": "$1**REDACTED**"}]
  ```

  With an Appium config file (`--config`, which is how Xenon Control starts
  Appium):

  ```yaml
  server:
    log-filters:
      - pattern: '([Pp]assword\\?["'']?\s*:\s*(\\?)(["''`]))(?:\2\\(?:\2[\s\S]|[^\\])|(?!\3)[^\\\x00-\x1f])*'
        flags: g
        replacer: '$1**REDACTED**'
  ```
- **With `XENON_REQUIRE_COMMAND_AUTH` on, the session listing and session
  WebSockets are checked too** (#367). `GET /wd/hub/appium/sessions` lists
  only the caller's own sessions (an admin sees all). BiDi and drivers'
  `/ws/session/<id>/...` sockets need the owner's or an admin's credentials.
  Enable it on the hub; a node accepts the hub's token in its place.

### Added

- **A session gateway in front of Appium's routes** (#371, #373). On a hub,
  a session on a node's phone is created on the node and answered by the
  hub, and its commands and its end go to the node. Before, Appium 3 answered
  the create with a 500 while the node kept the session, and no later command
  reached the node. Every hub call to a node carries a short-lived token the
  hub signs, for that one session, create or device-control call.
- **Node sessions survive a hub restart** (#374, #377): a SIGTERM restart,
  an outage longer than 90 seconds, and a hub with the dashboard off.
- **The hub's device control reaches its nodes' phones with auth on** (#377):
  tap, swipe, text, key events and long press.
- **Hub and node health checks work with auth on** (#372). Each side used to
  call the other dead, so the hub dropped the node's phones and the node
  never registered.

### Security

- **Xenon's internal loopback calls need a per-process secret** (#371).
  The `/wd-internal` path alone used to mark a call as Xenon's own, which would
  have been a way around per-command auth.
- **A client's credentials never leave the hub** (#373). They used to be
  forwarded to the node.
- **An API key's access key is redacted** in stored capabilities and logs, and
  the token log rule covers every token field (#366).

### Fixed

- **An iPhone's live preview or recording could show another phone's
  screen** (#368). After a failed start and a retry, the iPhone's stream and
  an Android stream could end up on the same local port.
- **WebSockets depended on the Node version** (#369). On Node 22.21 and later,
  Appium closed Xenon's live-preview, logcat and dashboard sockets, so preview
  fell back to MJPEG and live events to polling. Before 22.21, BiDi and
  drivers' log sockets got no answer. A WebSocket URL with a malformed `%`
  escape could also crash the server.
- **A node's report could undo the hub's claim on its phone** (#375), letting
  a second session take a phone that was in use. It also reset the team, tags,
  reservation and block the hub had set for the phone.
- **A node's shutdown could remove the hub's own phones** (#377), and the hub
  ran its health checks against its nodes' phones.
- **A create through a hub could run twice** on a slow node, and the hub's
  health check kept abandoned node sessions alive (#377).
- **A refused session create answered "Error: {}"** instead of Appium's
  reason (#373).
- **A live preview could kill a running test session's WebDriverAgent or
  tunnel on the iPhone** (#378): when it started, restarted or was stopped
  while a session was using the phone.
- **Ending a lease freed a phone a session was still using** (#378).
- **A lab reached as `localhost` forwarded taps on its own phones to itself,
  and refused them with auth on** (#377).
- **A hub on the same machine as a node dropped the node's phones** (#365).
- **`extend` ignored a lease's `expiresAt`, and `xe:options.team` wasn't
  read** (#366).
- **An offline device's team name and team picker were hard to read** (#364).
- **The test suite no longer depends on file order, other suites running at
  the same time, or the developer's local database** (#370, #376, #379).

### Known issues

- **Most device-control actions on a node's phone still run on the hub's own
  machine:** screenshot, clipboard, app install, shell, live preview and
  logs. Tap, swipe, text, key events and long press reach the node.
- **BiDi and session WebSockets aren't routed through a hub.** A session's
  `webSocketUrl` points at the node, so nodes must not sit on untrusted
  networks.
- **Only one iOS 17+ iPhone per Mac can stream at a time**, because every
  go-ios tunnel binds the same port.

## 2.0.0

Major release. **Xenon's session capabilities move to `xe:options`, and
`df:options` is no longer read.** Update every test client before you
upgrade.

Session credentials no longer reach the Appium driver or anything Xenon
stores. Appium sessions now follow the same team rules as the rest of Xenon.
Uploaded apps belong to teams. An opt-in setting checks the caller on every
Appium command.

Includes a database migration, applied automatically at startup. **Read
"Changed — operator action may be needed" before upgrading.**

### Changed — operator action may be needed

- **Session capabilities move to `xe:options`** (#361). It is Xenon's one
  capability namespace:
  - credentials: `accessKey` + `token`, or `sessionToken`;
  - a lease: `leaseId`, `leaseToken`;
  - Xenon's other options: `healingTiers`, `interceptor`, `name`, and so on.

  `xenon:options` is still read as an alias. When a session sends both,
  `xe:options` wins field by field.
- **`df:options` is not read at all,** and neither are `xenon:df:options` or
  `appium:df:options`. It came from appium-device-farm and isn't Xenon's.
  - A session that sends its credentials only there counts as having no
    credentials. It's admitted with a warning but has no owner, so the device
    ownership guard denies its phone to every non-admin, including whoever
    started it.
  - With `XENON_REQUIRE_SESSION_TOKEN` on, it's refused with "pass
    `xe:options.accessKey` + `xe:options.token`, or `xe:options.sessionToken`".
  - The flat `xenon:accessKey` capability shown in older docs was never read.
    The `access_key` spelling is no longer read either.

  Before:

  ```js
  'df:options': { accessKey: process.env.XENON_ACCESS_KEY, token: process.env.XENON_TOKEN },
  'xenon:options': { healingTiers: [1, 2] },
  ```

  After (WebdriverIO):

  ```js
  'xe:options': {
    accessKey: process.env.XENON_ACCESS_KEY,
    token: process.env.XENON_TOKEN,
    healingTiers: [1, 2],
  },
  ```

  Java: `options.setCapability("xe:options", Map.of("accessKey", accessKey, "token", token));`.
  Python: `options.set_capability("xe:options", {"accessKey": access_key, "token": token})`.
  A client that uses a session token sends `"xe:options": {"sessionToken": ...}`.
- **The lease-create response** now carries `xe:options: { leaseId, leaseToken }`
  (#361). Clients that pass `appiumCapabilities` through unchanged need
  nothing.
- **Upgrade nodes before the hub** (#361). An older node reads only
  `df:options` and `xenon:options`, so a client on `xe:options` would lose
  attribution and its lease there.
- **Rotate API tokens that clients sent in `df:options`,** if you keep Session
  rows, queue history or debug logs from earlier releases (#361). Until now
  those tokens, and session JWTs sent in `xenon:options.sessionToken`, reached
  the driver and were stored and logged. Old rows are not rewritten.
- **Keep tokens out of Appium's own request log.** Appium logs the `POST
  /session` body before any plugin runs. This rule redacts `token`,
  `sessionToken` and `leaseToken` values, including in a body Appium cuts off
  inside the token. It replaces the lease-only rule from 1.29.0. With
  `--log-filters <file>`:

  ```json
  [{"pattern": "([Tt]oken\\\\?[\"']?\\s*:\\s*\\\\?[\"']?)[A-Za-z0-9._~+/=-]+", "flags": "g", "replacer": "$1**REDACTED**"}]
  ```

  With an Appium config file (`--config`, which is how Xenon Control starts
  Appium):

  ```yaml
  server:
    log-filters:
      - pattern: '([Tt]oken\\?["'']?\s*:\s*\\?["'']?)[A-Za-z0-9._~+/=-]+'
        flags: g
        replacer: '$1**REDACTED**'
  ```
- **Members' Appium sessions follow their teams** (#362). A session with a
  key pair or a session token is allocated phones, and resolves uploaded
  apps, by the same rule as REST. What that means per caller:
  - a member gets their teams' phones plus the shared pool;
  - a key or token narrowed to one team gets that team;
  - an ADMIN or SUPER_ADMIN owner, or an admin-scoped key, gets every phone.

  Until now, a member's ordinary key reached shared phones only, and a session
  token reached every team's phones. `xenon:team` may now pick any team the
  caller is in.
- **Uploaded apps belong to a team** (#360).
  - Upload stays admin-only and takes an optional team; the default is
    shared. `PUT /xenon/api/apps/:id/team` moves an app.
  - Members see shared apps and their teams' apps. A session names an app by
    id only if its owner can see it. Installing an app on a phone applies the
    same rule.
  - Existing apps stay shared.
  - A team that still owns apps can't be deleted.
- **Database migration: one nullable column, `App.teamId`** (#360).
  `runMigrations` applies it at startup. If you run with
  `XENON_AUTO_MIGRATE=false`, apply `20260928120000_app_team` yourself before
  starting this version.
- **A CI gate using a member's API key now counts only that key's teams**
  (#356). A build whose sessions ran on phones the key can't see gets
  `violationCount: 0` from `/healing/hotspots/violations`. For a lab-wide
  gate, use an admin-scoped key.
- **`GET /xenon/api/cliArgs` is admin-only, and redacts secret-looking
  values** (#358).

### Added

- **Opt-in per-command auth for Appium sessions** (#359). With
  `XENON_REQUIRE_COMMAND_AUTH=true`, every request under
  `/wd/hub/session/:sessionId` must carry credentials: the `x-xenon-access-key`
  + `x-xenon-token` header pair or a bearer token. The caller must be the
  session's owner or an admin.
  - A refusal is WebDriver's own "invalid session id" 404, so it can't be told
    apart from a session that doesn't exist.
  - A session with no owner is refused to everyone but admins.
  - Off by default. It never applies with auth disabled.
  - Pair it with credentials at session creation, and have clients send the
    headers on every request. `docs/server-args.md` shows how for WebdriverIO,
    Java, Python and curl.
- **A session's app is downloaded with a single-use link** (#360). When a
  session names an uploaded app by id, the driver downloads it with a ticket
  bound to that app, valid for 10 minutes. With auth on, the driver's
  credential-less download used to be refused, so a session naming an app
  failed.

### Security

- **Session credentials reached the driver and storage** (#361). An API token,
  a session JWT or a lease token sent in the capabilities reached:
  - the Appium driver;
  - the pending-session queue;
  - the Session row's stored capabilities;
  - a debug log line.

  Xenon now removes `accessKey`, `token`, `sessionToken` and `leaseToken` from
  the capabilities before anything else reads them. A peer Xenon node gets
  them back on the copy forwarded to it, and removes them itself; a cloud
  provider never does. A Session row also redacts any secret-named value the
  driver hands back.
- **The session queue showed other users' API tokens** (#357). `GET /queue`
  returned each waiting request's raw capabilities, credentials included, to
  any member. Credentials are now redacted for every caller.
- **Members saw other teams' data in:**
  - the session queue (#357). A member now sees their own and their teams'
    waiting requests, plus a count of the rest;
  - Selector Health's hotspots, CI violations and selector list, and a muted
    selector's last-healed time (#356).
- **A member's session token could reach another team's phone** (#362).
- **Lease heartbeat, extend and release revealed whether a lease was active**
  (#358). Any caller whose token doesn't verify now gets the same 403
  `token_mismatch`, whatever the lease's state. Only the token's holder learns
  that it's gone.

### Fixed

- **The annotated export misplaced a late phone's marks** (#354). A phone
  added more than 5 minutes into a recording had its annotations burned in at
  the wrong time, usually stuck at the end. They now land where the Recordings
  page shows them.
- **An offline device's tags were below readable contrast** (#355): about
  2.3–3.2:1. They now measure 5.0–5.8:1 in both themes, on the card and in the
  table.
- **The Devices table hid its sorted column** (#355). Filtering down to one
  host while sorting by Host left no header showing the sort. The column now
  stays while it's the sort.
- **Three test specs depended on the order they ran in** (#353).

### Known issues

- **Sessions through a hub fail on Appium 3.** The node creates the session,
  then Appium crashes on the hub while attaching plugins to a session with no
  local driver. The client gets a 500, and the node keeps the session open on
  the phone until it times out. A hub also forwards later commands through a
  proxy that Appium 3 places after its own routes, so they wouldn't reach the
  node either. Single-server setups are unaffected.
- **A hub treats a node's phones as stale when both run on the same
  machine,** because the stale-device filter compares the IP address and
  ignores the port.
- **The late-phone export fix (#354) is covered by unit tests only.** It
  hasn't been checked on a device yet.

## 1.29.1

Security patch. Session files (videos, screenshots, performance traces) could
be downloaded with no login at all, and several session routes still served
other teams' data. Session files now need a login and a team check. As a side
effect, the dashboard's session videos and screenshots load again. **Upgrade
promptly, and read "Changed — operator action may be needed".**

### Security

- **Session files were served with no login** (#351). `/xenon/session-recordings/`
  served the session folder straight from disk, outside the API's
  authentication. Anyone who could reach the server and knew an id could
  download:
  - a session's video, screenshots and performance trace;
  - its network capture, given the file name;
  - by default, a Live devices recording, which is stored under the same
    folder.

  The route is removed. Session files are served only by `GET
  /xenon/api/session/:sessionId/asset/:kind/:file`, which needs a login and
  the session's team.
- **Other teams' sessions were readable** (#351). A member could:
  - read another team's session log, device log, debug log, live video and
    profiling;
  - download a bug report (video, logs, network capture and summary) for any
    session;
  - see other teams' session ids and phones in healing events, the healing
    selector timeline and the internal request log.

  These now follow the session's phone, with the same rule as 1.29.0. A
  session on a phone you can't see answers exactly like one that doesn't
  exist.

### Changed — operator action may be needed

- **Anything that downloads `/xenon/session-recordings/...` directly must
  switch** to `GET /xenon/api/session/:sessionId/asset/:kind/:file`, with
  credentials. `kind` is `screenshots`, `video` or `performance`, and `file`
  is the file name, as stored in the session's `video_recording`,
  `performance_trace` or a log's `screenshot`: `<sessionId>/<kind>/<file>`.
  The route supports `Range`.
- **`GET /xenon/api/logs/requests` and `GET /xenon/api/node/status` are
  admin-only**, like `/processes`. The first lists every internal HTTP call,
  including text typed on remote phones and forwarded session ids. The second
  lists every attached phone. Neither the dashboard nor Xenon Control calls
  them.

### Fixed

- **Session videos and screenshots never loaded in the dashboard** (#351).
  Their links pointed at `/xenon/assets/`, which serves only the web app's own
  files. They now use the new route. On the lab, a session's Recording card
  that failed to load now plays.
- **A member's own session disappeared when its phone was unplugged** (#351).
  Its owner now still sees it in the list and can open it, as with
  recordings. Nobody else can.
- **A build shared by name across teams counted every team's sessions**
  (#351). A member now sees only their own sessions in its counts, and the
  session list's 500-row limit counts only sessions they can see.
- **The active recordings list included phones the caller can't see** (#351),
  when an admin added one to the group or a phone moved team. They're left
  out, with their marks.

### Notes

- A member's Selector Health summary counts heals from their own sessions
  only. Resolved and pending counts stay fleet-wide, because selector state
  has no team.
- Found by the same audit and not yet changed:
  - Appium commands are checked by session id alone, so anyone who has a
    session id can drive that session. Closing the id leaks above reduces the
    exposure.
  - `/cliArgs` shows the stored Appium arguments to any logged-in user.
  - Uploaded apps have no team.
  - The queue lists other teams' pending requests.
- No database or configuration changes.

## 1.29.0

Minor release. Teams are now a device boundary everywhere a phone can be
reached: device control, reservations, leases, recordings and the dashboard's
live events. Past recordings get a library where you can find, replay in sync,
download and delete them, and the Devices page gets a sortable table view.
Also fixes a device sync that could free a phone in use, and dashboards
signed in through `/login` now get live events. Includes a database migration
that is applied automatically at startup. **Read "Changed — operator action
may be needed" before upgrading.**

### Changed — operator action may be needed

- **Members can use only shared phones and their own teams' phones** (#345,
  #347). This covers device control, previews and stream tickets,
  reservations, SDK leases, recordings and live dashboard events.
  - **Anyone using a team's phone without being on that team loses access
    until an admin adds them on the Teams page.**
  - A phone they can't see looks exactly like one that doesn't exist.
  - Admins and servers with auth disabled are unchanged.
- **A session that names a lease must prove it holds it** (#346). A lease id
  alone no longer gets its phone. A session that sets
  `xenon:options.leaseId` must do one of these:
  - **Pass the lease token.** Pass the lease-create response's
    `appiumCapabilities` through unchanged: they now include
    `xenon:options.leaseToken`. A client that builds its own capabilities adds
    the `leaseToken` it already holds for heartbeat, next to `leaseId`.
  - **Use the credentials that created the lease.** A lease created with an
    access-key pair is matched only by that key's `df:options` pair. One
    created with a bearer token or the dashboard is matched by any of that
    user's keys, or by a `xenon:options.sessionToken` for that user.
  - **Be allowed to override:** a SUPER_ADMIN, an `admin`-scoped key, or an
    ADMIN or SUPER_ADMIN session token. An ADMIN's ordinary key may not.

  The phone must also be one your teams can see, and servers with auth
  disabled are unchanged. A refused session fails with one message, `lease
  <id> is not active, or this session did not prove it holds it …`. It reads
  the same for an expired lease on purpose. **Don't re-acquire in a loop on
  this error**: each new lease holds a phone until its TTL runs out.
- **Hub and node fleets: upgrade nodes before the hub** (#346). A new hub
  forwards the lease token to the node that runs the session, and only a new
  node strips it before the driver sees it.
- **Add a log filter for the lease token** (#346). Appium logs the raw `POST
  /session` body before Xenon sees it. It cuts that body at 1024 characters,
  and the cut can land inside the token, so the rule matches the token's hex
  digits. With `--log-filters <file>`:

  ```json
  [{"pattern": "(leaseToken\\\\?[\"']?\\s*:\\s*\\\\?[\"']?)[0-9a-fA-F]+", "flags": "g", "replacer": "$1**LEASE TOKEN**"}]
  ```

  With an Appium config file (`--config`, which is how Xenon Control starts
  Appium):

  ```yaml
  server:
    log-filters:
      - pattern: '(leaseToken\\?["'']?\s*:\s*\\?["'']?)[0-9a-fA-F]+'
        flags: g
        replacer: '$1**LEASE TOKEN**'
  ```
- **Database migration: one nullable column, `Recording.started_by`** (#342).
  `runMigrations` applies it at startup, and older rows stay null ("recorded
  by" is unknown for them). If you run with `XENON_AUTO_MIGRATE=false`, apply
  `20260927120000_recording_started_by` yourself before starting this
  version.

### Added

- **A Recordings library** (#342). Past Live devices recordings used to be
  reachable only from the download bar right after Stop.
  - **`/recordings`** lists every recording you can see: when, phones,
    length, who recorded it, bookmarks and status. You can filter by phone,
    recorder and time, or search phone names and bookmark labels. The filters
    are kept in the link.
  - **A recording's page** plays every phone side by side on one clock, with
    Space to play or pause, a timeline you can drag, and ← → to skip 5 s.
    - A phone that started later shows "Starts at 0:12".
    - Bookmarks are marked on the timeline.
    - Annotations are drawn on their phone at their time.
  - **Download** gives all videos, the side-by-side video, the proof bundle,
    or one phone's video with or without its annotations.
  - **Delete** is for the recording's owner or an admin.
  - Live devices offers **Open in Recordings** after Stop.
- **A table view on the Devices page** (#340), beside the cards. It has
  sortable columns (Status, Device, Platform, Type, Team, and Host when there
  is more than one host) and the card's own Control, Reserve and More
  actions. The view and the sort are remembered and carried in the link
  (`?view=table`).

### Security

- **Recordings exposed other teams' phones** (#341, #343, #344). In a
  recording mixing teams, a member could download another team's phone's
  video, zips, proof bundle and side-by-side video. They could also start,
  stop, bookmark or annotate recordings of phones they can't see, and clear
  their marks. Stop's response listed every phone in the group. Every
  recording route now follows one team rule and answers a hidden phone or
  group with a plain 404.
- **Device control, reservations and SDK leases ignored teams** (#345). A
  member could tap, type, install, read the screen, clipboard and logs,
  preview, reserve or lease another team's phone whenever nobody held it.
- **A lease id alone claimed its phone** (#346). Anyone who knew an active
  lease's id could start a session on its phone. The token that proves a
  lease never reaches the driver, the Session row, the dashboard or Xenon's
  logs.
- **Every dashboard received every team's live events** (#347): phones,
  session commands, healing, intercepted network traffic, recordings and bug
  reports. Bug reports also reached nodes. Each event now goes only to
  dashboards whose user can see that phone. Selector and node events, which
  aren't one phone's data, are unchanged.

### Fixed

- **A device sync could free a phone in use** (#348). Every 30 s by default,
  the sync read each phone, spent seconds in adb and the iOS tools, then
  wrote the whole row back. That undid anything written in between:
  - a live preview's hold, after which Stop had nothing to release;
  - a new session's lock, so a second session could get the same phone;
  - a team change;
  - a stream's port.

  iOS simulators came back free from every sync, even mid-session. The sync
  now writes only what discovery changed. In a timed test on the lab, a
  preview started inside a sync lost its hold 2 times in 3 before this fix
  and 0 times in 3 after.
- **The "New device" webhook fired for every phone on every sync** (#348),
  and the dashboard got a `device_added` for each. Both now fire only for a
  phone that is actually new.
- **Dashboards signed in through `/login` got no live events** (#349). The
  socket accepted only the older raw-key cookie, so with auth enabled the
  header stayed on "Connecting…". Pages that rely on live events alone,
  such as session activity, healing, network capture and selector health,
  never updated. Only the Devices page, which also polls, looked right.
- **Team-scoped Appium sessions failed on every real server** (#345). The
  Prisma store's team filter put `null` inside an `in` list, which Prisma
  rejects. This broke device allocation for a team-bound API key or
  `xenon:team`.
- **A recording's `video.mp4` ignored `Range`** (#341). It advertised
  `Accept-Ranges` but always sent the whole file.

### Notes

- New endpoints:
  - `GET /xenon/api/recordings`;
  - `DELETE /xenon/api/recordings/:groupId`;
  - `GET /xenon/api/recordings/:groupId/source.mp4`.

  `GET /xenon/api/recordings/:groupId` adds a `summary`. The lease-create
  response's `appiumCapabilities` add `xenon:options.leaseToken`.
- An admin asking for a recording group with no rows now gets 404 from
  `video.mp4`, `videos.zip`, `bundle.zip` and `annotations/clear`. Before,
  this was an empty 200 or a 500.
- Members don't get the side-by-side video of recordings made before 1.22.1,
  which have no layout file to check. Admins still do.
- A live event's team scope is fixed when the dashboard connects. A
  membership change applies after a reload.

## 1.28.1

Patch release. A phone open in two tabs keeps its live preview when one tab
closes, and an iPhone left in an abandoned preview is released like an
Android phone. Device control's tab is named after the phone.

### Fixed

- **Closing one of two tabs on the same phone froze the other** (#337).
  Leaving device control, or removing a Live devices tile, stopped the
  preview and released the phone at once, even while another tab was
  watching it. A test could then take the phone.
  - Leaving now asks the server to let go, and the server waits 3 seconds.
    It stops the preview and releases the phone only if nobody is still
    watching and no recording is running.
  - A reload keeps its stream, because the new page starts it again within
    those 3 seconds.
  - **Stop** still stops the preview for everyone.
- **An abandoned iPhone preview was never released** (#338). A crashed
  browser, a sleeping laptop or a lost network held the iPhone until someone
  released it by hand or restarted the server. The server now checks every
  minute and releases a preview that nobody has watched for 10 minutes,
  as it does on Android since 1.28.0. It keeps a preview that an Appium
  session or a recording relies on.
- **Device control's tab read "381103b720057ece · Device"** (#336). It now
  reads "Galaxy S9+ · Device", the name its header shows.
- **Android offered "Write to device" for the clipboard** (#336), which
  only ever failed: Android lets Xenon read the clipboard, not write it.
  The button is gone on Android, and a note under the field says why. iOS
  keeps writing.
- **The Omni-Vision divider's grip was hard to see** (#336): 1.66:1 against
  the page in dark and 1.34:1 in light. It is now 5.70:1 and 5.39:1.

### Notes

- `POST /xenon/api/control/:udid/stream/leave` is new. It has the same
  ownership rule as `stream/stop` and answers 202.
- No database or configuration changes.

## 1.28.0

Minor release. Omni-Vision is rebuilt around a compact element tree you can
use from the keyboard, beside a details pane you can resize, and its "AI
Insight" tab becomes **Checks**. Device control now lets go of a phone when
you close its tab, so tests no longer queue behind a page nobody is viewing.

### Added

- **Checks**, replacing "AI Insight" (#331). Nothing in that tab was AI. It
  gives seven results for the selected element: unique locator, stable
  locator, interactive, enabled, has size, on screen, and accessible name.
  Each passes, warns or fails with a one-line reason. A locator that isn't
  unique comes with one that is, if one exists.
- **A notice when a capture may be out of date** (#331). The tree shows
  "Captured 12 s ago". After any input to the device, it says "The screen
  may have changed since this capture." and offers **Refresh**, and the
  highlights on the device dim.
- **A resizable split** between the tree and the details (#332). Drag the
  divider, or focus it and use ← → Home End. Double-click resets it, and
  the browser remembers where you left it.
- **An element path in Info** (#332). It lists the element's ancestors,
  and each one selects that ancestor.
- **A search match count** (#332), which screen readers announce.

### Changed

- **A compact element tree** (#332).
  - Rows are 26 px high.
  - A run of plain wrapper elements shares one row, such as "hierarchy ›
    FrameLayout › … › launcher", and each part still selects its own node.
  - Names are short: a resource id is shown without its package.
  - Each row has a role icon.

  On a 66-element Android home screen, a fully expanded tree now has 45
  rows instead of 66 and 10 levels instead of 19. Names cut off went from 48
  to 12.
- **The tree works from the keyboard** (#332). It is one tab stop, with ↑ ↓
  → ← Home End to move and Enter or Space to select. Screen readers hear it
  as a tree.
- **The selected element is always shown** (#332). Selecting it on the
  device, in search, from the path, or again after a Refresh opens its
  branch and scrolls to it. Refresh keeps the element selected with its new
  values, and keeps your Code gen locator.
- **The locator buttons have labels** (#332): **Test**, **Verify**,
  **Tap** and **Copy**.
  - Without an Appium session on the device, one note explains why Verify
    and Tap are unavailable.
  - The session is checked again with every capture.
- Code gen wraps long lines instead of scrolling sideways, and the element
  count and source moved to the capture line (#332).

### Fixed

- **Closing device control's tab left the phone held** (#333). Closing the
  tab, reloading or typing another address kept the live-preview hold, so
  Appium sessions for that phone queued for 5 minutes and then failed with
  "Device is busy".
  - The page now releases the phone as it goes away.
  - On the server, a hold that nothing released (a crashed browser, a
    sleeping laptop, a lost network) is released 10 minutes after its last
    viewer left. With H.264 preview it was never released before, and with
    MJPEG the check ran hourly; it now runs every minute.
  - Neither releases while anyone is watching, over either transport, or
    while a recording runs.
- **The Test locator button never outlined its match on the device** in
  device control (#332).
- **After a Refresh, Info showed the old capture's element** (#332).
- **A slow capture could replace a newer one** (#331), for example the
  previous device's.
- **Search hid matches inside collapsed branches** (#331).
- **"Interactable" was claimed for any enabled container** (#331).
- **The health monitor's "stream still running" check never worked**
  (#334). It looked up the stream services by a name that TypeDI does not
  register, so a busy device whose Appium session had been lost could be
  reclaimed while a stream was still running on it.

### Notes

- Two tabs showing the same phone share one hold, so closing either
  releases it. Leaving device control through the app already did this.
- On iOS, closing the tab releases the phone, but the server-side release
  of an abandoned hold is Android-only for now.

## 1.27.0

Minor release. Device control's Actions tab is redesigned around apps: you
can install builds from the Apps library, and search and uninstall
installed apps from a list. The Android clipboard now reports honestly: it
can be read, and a write says plainly that it isn't possible.

### Added

- **Install from the Apps library** (#328). The Actions tab lists the
  library's builds for the device's platform, with version and package, and
  installs the one you choose. Before, it could only upload a file from your
  computer. With nothing for this platform, the menu says so and links to
  the Apps page.
- **A searchable list of installed apps** (#328), replacing the dropdown of
  package IDs.
  - Each app has **Copy** and **Uninstall**, and uninstalling still asks
    first.
  - Typing a package ID the list doesn't show, such as a system app, offers
    to uninstall it. This replaces "Or enter manually".
- **Write text to the device's clipboard** (#328), next to **Read** and
  **Copy**. This works on iOS; on Android see below.

### Changed

- **The Actions tab has three sections** (#328): **Apps**, **Text and
  clipboard**, and **Swipe**. It uses the app's standard buttons and fits
  without scrolling.
  - **Upload file** installs as soon as you pick a file.
  - The round D-pad is now a row of four swipe buttons, which keyboard and
    screen-reader users can still use.
- **Copying falls back when the browser blocks it** (#328). A dashboard
  served over plain `http://` on a network address can't copy. The text is
  selected instead, with a hint to press ⌘C or Ctrl+C.

### Fixed

- **Android clipboard writes reported success and did nothing** (#329).
  Appium Settings, which Xenon uses to reach the clipboard outside a test
  session, can only read it. `POST /control/:udid/clipboard` now answers
  **501** on Android with that reason, and the dashboard shows it.
- **Android clipboard reads couldn't fail** (#329). Any error came back as
  an empty clipboard. A failed read now answers 500 with the reason, and a
  successful one uses the documented Appium Settings action.

## 1.26.2

Patch release. Device control's Actions tab asks before uninstalling an
app, reports the result of every action, and works with a keyboard and a
screen reader. No server changes.

### Fixed

- **Uninstall ran on one click** (#326). It removed the app and its data
  straight away. A dialog now asks first, naming the app and the device, and
  Cancel or Esc closes only the dialog. The result says what happened
  ("Uninstalled com.foo from Galaxy S9+") or why it failed.
- **Actions failed silently** (#326).
  - **Smart Input** has a Send button (Enter still works) and shows "Sent"
    when the text goes through. A failure shows the reason and keeps your
    text so you can resend it.
  - **Swipe buttons** say why a swipe failed.
  - **Clipboard errors fit the platform:** the Android hint about the
    Appium Settings app no longer shows on iOS, which gives the actual reason
    instead.
  - **Install messages** name the device and the file, not the UDID.
- **Keyboard and screen readers** (#326).
  - The four swipe buttons, the text field, the app picker and the manual
    package field now have names.
  - Tab now reaches the "Select File" chooser, which shows a focus ring.
- **Light theme** (#326). Placeholder text measured 2.11:1 and now passes
  (4.80:1), and the manual package field no longer looks disabled.

## 1.26.1

Patch release. Device control names a device the way its Devices card does.
No server changes.

### Fixed

- **Device control showed the codename** (#324). Opening the Galaxy S9+
  from the Devices page showed "star2ltexx" in the header. The header now
  reads "Galaxy S9+", falling back to the reported name when a device has
  no friendly one, and screen readers announce the view by that name too.
  The Shell tab's greeting uses it as well.

## 1.26.0

Minor release. The Devices page can filter by platform and by real or virtual
device, and its search finds a device by the name its card shows. Filters
live in the link. Secondary buttons on the Devices page, such as Reserve and
Release, look as designed again. No server changes.

### Added

- **Platform and Type filters** (#321). A second toolbar row, under the
  status tabs, holds:
  - **Search.** Press `/` to jump to it.
  - **Platform and Type menus.** Each is a quiet "+ Platform" button until
    set, then a chip such as "Platform: iOS" with an × to clear it. The
    menus show counts:
    - **Platform:** Android and iOS, plus tvOS when the lab has one;
    - **Type:** real devices, or virtual ("simulators and emulators").
  - **Clear**, shown only while something is filtered.
  - A count such as "2 of 5 devices", and an icon Refresh.
- **Every count accounts for the other filters** (#321). With iOS
  selected, "Ready 3" means 3 ready iOS devices, so a number is always what
  you'd get by choosing it.
- **Filters live in the link** (#321), for example
  `/devices?status=ready&platform=ios&q=galaxy`. They survive a reload, and
  opening a device and closing it returns to the same filtered list. Back
  leaves the page rather than stepping through each change.

### Fixed

- **Search couldn't find the name on the card** (#321). It matched the raw
  name and UDID only, so "Galaxy" didn't find a Galaxy S9+ whose raw name is
  "star2ltexx". Search now matches every word you type anywhere in the
  shown name, the codename, the maker, the model, the platform and OS
  version, "Emulator" or "Simulator", the team or the UDID.
- **Device control's stylesheet restyled buttons on the Devices page**
  (#322). Its own secondary-button rule shared a class with the app's
  Button. On the Devices page it made Reserve and Release bold and
  over-padded, and squeezed an icon button's icon to nothing. The class is
  now renamed. A new test fails if a stylesheet outside the Button's own
  restyles every Button again.
- **Nothing matching the filters** now reads "No devices match these
  filters", with a **Clear filters** button (#321).

## 1.25.0

Minor release. Live Devices recordings can no longer be lost by stopping the
device's stream underneath them. When the idle timeout releases your devices,
a notice says so and can put them back. Live Devices also shows the same
device names as the Devices page.

### Fixed

- **A recording left alone for 5 minutes was lost** (#317). The idle timeout
  ran during recordings, and its release stopped the device's stream under
  the recording. Stopping the recording then gave FAILED with 28 bytes, so
  everything was lost, including unattended runs such as an automated test.
  The timeout is now paused while recording. After Stop, the 5 minutes start
  again.
- **The server stopped a stream that a recording was reading** (#318).
  `POST /control/:udid/stream/stop` now answers **409** `device_recording`
  while the device is being recorded, and leaves the stream and the lock
  alone. The answer includes the recording's `groupId`.
  - Admins are refused too: recordings stop by group, so forcing one device
    would end the whole group. `POST /recordings/:groupId/stop` does that
    cleanly, keeping the video and releasing the devices.
  - A caller who may not use the device still gets the usual 403 and learns
    nothing about the recording.
- **Clicking a recorded device in the Live Devices list did nothing visible**
  (#319). It now shows "Stop recording before changing the devices on the
  grid.", as adding a device already did, and sends no request.
- **Live Devices showed codenames** such as "star2ltexx" (#319). The device
  list, the tile's label and the Remove button now use the name the Devices
  page shows, such as "Galaxy S9+". Searching the list by codename still
  finds the device.

### Added

- **A notice after an idle release** (#317): "Released N device(s) after 5
  minutes without activity.", with **Restore devices** and **Dismiss**. It
  stays until you dismiss it.
  - **Restore devices** puts the same devices back, the same as clicking them
    in the list.
  - A device someone else now holds, or one that's offline or no longer
    connected, is skipped, and the notice names it.
  - Choosing **Release now** in the warning shows no notice.

## 1.24.0

Minor release. On Live Devices, recording no longer switches Annotate on, so
you can use the phone as soon as you press Record. An Interact / Annotate
switch replaces the Annotate button. No server changes.

### Changed

- **A recording starts on Interact** (#315). Pressing Record used to turn
  Annotate on, which paused taps and swipes until you found and turned off
  the Annotate button. Taps now reach the phone straight away. Marks you
  draw still stay on screen when you switch back.
- **An Interact / Annotate switch replaces the Annotate button** (#315).
  - It always shows which mode you're in.
  - Annotate is unavailable until you start recording, and its tooltip says
    so.
  - The drawing tools work only on the Annotate side, as before.

### Added

- **Esc returns to Interact while annotating** (#315). It's ignored while
  you type in a text field, and it isn't intercepted in Interact mode, so a
  focused Android device still receives Esc as Back. The on-tile label now
  reads "Annotating · Esc to stop".

## 1.23.1

Patch release. Two polish fixes on the Devices page. No server changes.

### Fixed

- **Control and Reserve looked like plain text** (#312). Control was a grey
  outline and Reserve had no border at all.
  - Control is now a green-tinted button in the theme's accent colour, and
    fills solid green on hover.
  - Reserve and Release are outlined buttons.
  - The tinted style is available to the rest of the app as the Button's
    `tonal` variant.
- **The status filters read flat** (#313).
  - The selected filter now uses the accent colour.
  - Ready, Busy, Reserved, Maintenance and Offline each have a dot in the
    colour of that state's cards.
  - A filter with no devices fades back, so the others stand out.
  - Selector Health's Window filter gets the same selected style.
- **Refresh wrapped onto a line of its own** in narrow windows (#313). Search
  and Refresh now wrap together.

## 1.23.0

Minor release. The Devices page shows each device by the name people know it
by, with a phone or tablet outline, in a redesigned card that leads with the
device's state. The server now reads each device's name, model, maker and form
factor. Includes a database migration that is applied automatically at
startup.

### Changed — operator action may be needed

- **Upgrade the hub before its nodes** (#309). A node running this version
  sends four new device fields. A hub on an earlier version stores a node's
  devices exactly as sent, so it rejects them and the node's devices do not
  register. This hub ignores device fields it cannot store, so later upgrades
  in either order are safe.
- **Database migration: four nullable columns on `Device`** (#309):
  `marketingName`, `model`, `manufacturer` and `formFactor`. `runMigrations`
  applies them at startup (`db push` on SQLite, `migrate deploy` on
  PostgreSQL), and existing rows need no backfill. If you run with
  `XENON_AUTO_MIGRATE=false`, apply `20260926120000_device_identity` yourself
  before starting this version.

### Added

- **Friendly device names** (#309). The server reads them when it discovers
  a device, and never holds up discovery (5 s limit):
  - **Android:** the name on the phone's About screen ("Galaxy S9+", or
    whatever your lab renamed it to), plus model, maker, and phone, tablet or
    TV. Emulators use their AVD name.
  - **iPhone and iPad:** the model name from a built-in table (iPhone 11
    through the iPhone 16 family, and recent iPads). A model the table
    doesn't know shows the device's own name rather than a guess.
  - **iOS simulators:** keep their name.

  A device that can't report these fields registers exactly as before.

### Changed

- **Redesigned device card** (#310). The card is about 200 px tall instead of
  320, with four parts:
  - **Status band** across the top, showing the state and what the device is
    doing ("Busy · Test session · 12m", "Reserved · 46m left · by priya@…").
    Ready is a quiet grey band, so the unusual states stand out.
  - **Name block:** a phone, tablet or TV outline (dashed for emulators), the
    friendly name, and maker · model · OS.
  - **Badges:** battery, temperature and team, with tags as quiet text.
  - **Footer:** a quieter Control button, with the reason beside it when
    Control is disabled.

  The "Real" and "Shared" labels, the server URL, the network address and
  "Time in use" are no longer on the card.
- **The ⋯ menu holds the copy actions** (#310): Copy UDID, Copy server URL,
  Copy IP address and Copy capabilities.
- **Admin-only menu items** (#310). Manage tags, Assign team (which replaces
  the clickable team chip) and Enter/Exit maintenance now appear for admins
  only. The server has always refused them to members, who got an error.

### Fixed

- **Card text below 4.5:1 contrast** (#310). The reserved band in dark theme,
  the busy band in light theme and an offline card's details now all read at
  4.5:1 or better.

## 1.22.4

Patch release. The device cards on the Devices page show each device's real
state and offer only actions that can work. No server changes.

### Fixed

- **A device in maintenance showed as a red "Error"** (#307), and no status
  filter included it: the filters added up to one fewer than All. It now
  reads "Maintenance" and has its own filter, and every device counts in
  exactly one filter.
- **Cards offered actions that could not work** (#307). Control was enabled
  on offline devices, devices in maintenance and devices another user was
  controlling, and Reserve showed on offline devices. Control is now disabled
  in those cases, with the reason shown on the card ("Device is offline",
  "In maintenance", "A test is running on this device", "Another user is
  controlling this device"). Admins can still control a device in
  maintenance or one another user holds, as the server allows.
- **Internal IDs on the cards** (#307). "SID · manual_u42" and "RES · …" now
  read "Live control by another user", "Test session · 12m" and "Reserved by
  you · 46m left".
- **The reservation countdown showed fractions of a second** (#307), such as
  "46m 16.1s", and did not change between refreshes. It now shows whole
  minutes.
- **Low battery and high temperature were blue** (#307), the colour of a
  reservation. They are now amber.
- **Emulators showed a battery and temperature** (#307), which are
  synthetic, and offline devices showed their last, stale reading. Neither
  shows a badge any more.

## 1.22.3

Patch release. A polish pass on Live Devices: clearer layout, proper icons,
plainer wording, and better screen-reader support. No server changes.

### Changed

- **The grid starts on Auto** (#305). It sizes itself to the devices on it,
  so one or two phones fill the space instead of sitting in a 2×2 grid with
  empty cells. The other layouts are still one click away.
- **Real icons replace text symbols and an emoji** (#305) on the recording
  toolbar, the tile's side buttons and the device list, matching the rest of
  the app.
- **While recording, the REC timer takes Record's place** (#305) instead of
  sitting next to a greyed-out Record button.
- **Clearer tile messages** (#305). "Starting stream…" shows the device name
  instead of its ID, and on an iPhone says a start can take up to 20 seconds.
  The "Connection failed" screen and the tile's side buttons now follow the
  light and dark themes.
- **Plainer wording** (#305). "Grid" instead of "mosaic", "Home" instead of
  "Home (android)", and the video-ready message points up to the download
  button, which is where it is. The device list says it is loading (or that
  loading failed) instead of showing "No devices online." before the list
  arrives.

### Fixed

- **Screen readers** (#305). Each device in the list is announced by its name
  and platform and says whether it is on the grid; the iOS / Android groups
  say whether they are expanded; the tile's side buttons are announced as
  Home, Back, Recent apps, Screenshot and Remove instead of by their symbol.

## 1.22.2

Patch release. Live Devices tiles respond where you tap, and a tile whose
stream ends reconnects by itself instead of going blank or freezing.

### Fixed

- **Taps near the top or bottom of a Live Devices tile landed off target**
  (#302). A tile is often letterboxed, as in the 3×2 layout, so the picture
  fills only part of it. Taps were mapped against the whole tile, which put a
  tap near an edge about 220 px (Android) or 75 points (iPhone) toward the
  middle. Taps are now mapped against the picture, and a press on the black
  bars around it is ignored. A swipe that ends off the picture stops at the
  screen edge.
- **After a server restart, a reopened Android tile couldn't be tapped**
  (#302). Only the "start stream" request fetched the screen size, and
  reopening a tile never sends it. The size is now fetched by every request a
  tile uses to connect to the stream.
- **A tile went blank or froze when its stream ended** (#303). This affected
  iPhone tiles, and Android tiles on the MJPEG stream (for example while
  recording). After a server restart the tile went blank; after the stream was
  stopped it froze on the last frame. Either way it stayed "live" and never
  retried, because the browser reports nothing when such a stream ends. A live
  tile now asks the server every 5 seconds whether its stream is still running
  and reconnects if not. While the server is unreachable, for example
  mid-restart, the tile waits instead of giving up.

## 1.22.1

Patch release. Completes 1.22.0's annotation work for multi-device
recordings: the side-by-side video now carries every mark, and each device's
own video shows its marks at the right moment.

### Fixed

- **The side-by-side video of a multi-device recording had no marks**
  (#299). Each device's marks are now drawn into its own cell, in the right
  place and for the right time window, exactly as in that device's own
  video. This applies to `composite.mp4`, `videos.zip` and `bundle.zip`, and
  the download is prepared in the background when you press Stop.
  Recordings made before this version have no layout record, so their
  side-by-side video is served without marks, as before.
- **Marks appeared early in each device's own video in multi-device
  recordings** (#300). By about 1–3 seconds, depending on how long the
  devices took to start. Each device's video starts recording before the
  dashboard's timer does. Xenon now records that head start per device and
  moves the marks to match, so they line up with the screen as they do in
  the side-by-side video. Single-device recordings were not affected.
- **Marks drawn after a page reload used a different timebase** (#300). A
  reload restarted the recording timer from the first device's start rather
  than the original start, so in multi-device recordings those marks were
  off by the same head start. A reload now resumes on the original start.

## 1.22.0

Minor release. Annotations on Live Devices recordings now come out in the
downloaded video exactly as drawn: same place, same shape, same colour, gone
when you press Clear marks. A recording also survives a page reload. The
Bookmark button is removed. Includes a database migration that is applied
automatically at startup.

### Changed — operator action may be needed

- **Database migration: one nullable column, `Annotation.end_timecode_ms`**
  (#296). `runMigrations` applies it at startup (`db push` on SQLite,
  `migrate deploy` on PostgreSQL), and existing rows need no backfill. If you
  run with `XENON_AUTO_MIGRATE=false`, apply
  `20260925120000_annotation_end_timecode` yourself before starting this
  version.

### Fixed

- **Marks appeared in the wrong place in the recorded video** (#295). The
  drawing layer was stuck at the browser's default 300×150 canvas instead of
  covering the tile, so marks were measured against the wrong box. Nothing
  below the top 150 pixels of the tile could be drawn at all.
- **Marks were also off-target when the tile was letterboxed** (#296). A tile
  added before the device reported its screen size kept a 9:16 fallback, and
  a narrow 3×2 cell squeezes a tile out of shape. Marks are now measured
  against the video picture itself, not the tile.
- **A page reload lost a running recording** (#296). So did closing the tab
  or navigating away. The server kept recording and nothing in the dashboard
  could stop it. The page now picks the recording back up (REC timer, Stop,
  and the marks on screen) from the new `GET /xenon/api/recordings/active`.
- **The same device could be recorded twice at once** (#296). Record after a
  reload started a second capture; four of those used up
  `maxConcurrentRecordings` until a restart. A device that is already
  recording is now refused with the busy reason `recording_other_group`.
- **Clear marks only cleared the browser** (#296). Every mark stayed in the
  video until the end. Clear marks now removes the marks from the video from
  that moment on, and it can no longer overtake a mark that is still being
  saved.
- **Circles and arrows came out as filled boxes, and Draw was just another
  rectangle** (#296). Each mark is now rendered by the browser with the same
  code as the live preview and composited over the video. Draw is real
  freehand.
- **One text mark wiped every mark from the download, and text marks never
  appeared** (#296, #297). Text marks can only be created through the API.
  The bundled ffmpeg has no font lookup, the text position used the wrong
  variables, and an apostrophe broke the filter. Xenon now ships a font
  (Inter, OFL-1.1) and escapes text correctly. If text ever fails to render
  anyway, the other marks still do.
- **The annotation toolbar moved under the cursor** (#296). Buttons appeared
  and disappeared as marks were drawn, so clicks landed on the wrong control.
  They now stay in place and grey out instead. The on-screen hint is now a
  small label, not a banner covering a third of a small tile.

### Added

- `POST /xenon/api/recordings/:groupId/annotations/clear` with
  `{ timecodeMs }` (#296).
- An optional `image` (PNG data URL) on `POST …/annotation`, burned into the
  video as-is. Marks without one keep the previous box rendering (#296).

### Removed

- **The Bookmark button and its `B` shortcut** (#296). Existing bookmarks,
  `POST …/bookmark` and `bookmarks.json` in proof bundles are unchanged.

### Development

- **LogcatView's recording specs leaked stubs between tests** (#294). The
  suite passed but reported 5 unhandled errors; it now reports none.
- **The control sweep covers the sign-in pages as a signed-out visitor**
  (#293).

## 1.21.7

Patch release. Two small fixes in the dashboard sidebar and on the Users page.

### Fixed

- **The Invite user button on the Users page was unstyled** (#291). It
  showed as plain text with the "+" stacked above it, at every width. Its
  styles lived in the Settings page's stylesheet, which the Users page never
  loads. They now live with the shared page header, so every page that
  shows a header button gets them.
- **Users and Teams had the same icon in the sidebar** (#290), so the two
  entries couldn't be told apart in the icon rail. Users now has its own
  icon (a person with a cog), matching its page header.

### Development

- **The control sweep now tests the Save, Discard and Restore Defaults
  buttons on Settings and Maintenance** (#289). It had silently skipped
  them. It also names any control it couldn't test instead of only counting
  it.

## 1.21.6

Patch release. Finishes the auth-disabled clean-up started in 1.21.5.

### Fixed

- **With auth disabled, Profile opened on a password form that could only
  fail** (#287). In that mode you are a synthetic admin with no account
  password, so "Update password" always returned an error. Profile now leaves
  that view out and opens on API tokens. Those work in this mode, acting as
  the bootstrap admin. With auth enabled, nothing changes.

## 1.21.5

Patch release. No Logout when authentication is disabled.

### Fixed

- **With auth disabled, the account menu offered Logout** (#285). There is no
  session to end in that mode: every visitor is a synthetic super admin.
  Logout sent you to a sign-in page with no account behind it, and the only
  way back was to type a URL. The menu now says "Sign-in is off on this
  server." instead. The sign-in page itself redirects to the dashboard while
  auth is disabled. With auth enabled, nothing changes.
- **`GET /xenon/api/auth/me` includes `authDisabled`** (#285): `true` for the
  synthetic auth-disabled identity, `false` otherwise.

### Documentation

- The 2026-09-23 dashboard UI audit is now in the repo as
  `website-audit.md` (#284).

## 1.21.4

Patch release. Device control behaves like a proper dialog for keyboard and
screen-reader users.

### Fixed

- **The device-control view was not announced as a dialog** (#282), and
  keyboard focus could Tab onto the Devices page, sidebar and header hidden
  behind it. It is now a modal dialog named after the device.
  - The page behind can't be focused or clicked.
  - Focus moves into it when it opens and returns to the Control button when
    it closes.
  - Escape closes it, except while typing in a field.
  - Toasts raised from device control are still announced and clickable.

### Development

- **`npm run test:sweep`** (#281) runs the control sweep that found the dead
  Upload app button and the hidden account menu. On every page it clicks
  each control with a real mouse click and fails if one does nothing or
  can't be clicked. It runs against a live server without changing
  anything: writes are stubbed and devices mocked. It takes about 18
  minutes; run it before a release.

## 1.21.3

Patch release. The account menu works on the Devices and Apps pages again, and
the unit tests are safe and green.

### Fixed

- **The account menu was unusable on the Devices and Apps pages** (#279). The
  menu opened behind those pages' toolbars, so Theme, Profile and Logout
  couldn't be clicked. It has been like this since the top bar was rebuilt in
  April. The toolbars now sit below the header.
- **Some selected states were shown only by colour** (#279). Screen readers
  now hear which Profile view is open and which Overview fleet filter (All /
  Non-ready) is on.

### Development

- **Running the unit tests killed every process the user owned** (#277). A
  test gave `ProcessRegistry` a fake process ID of 1. `ProcessRegistry`
  signals process groups, so this became `kill(-1)`, which on macOS signals
  every process the user owns: the test runner, the Xenon server and every
  open app. The test now stubs `process.kill`, and `ProcessRegistry` never
  group-signals a process ID below 2. That also keeps a device helper that
  failed to start from signalling init when Xenon runs as root in a container.
- **`npm run test:all` passes in one run on Node 20 and 22** (#278): 1,247
  tests. `.mocharc.json` became `.mocharc.js`, which turns off Node's
  built-in TypeScript type stripping on Node 22.18+ so ts-node stays in
  charge. Specs no longer depend on another spec having run first, and three
  out-of-date tests were brought up to date.

## 1.21.2

Patch release. The Apps page's Upload app button works again.

### Fixed

- **Upload app on the Apps page did nothing** (#274). The button sat inside a
  label around the hidden file input, and browsers don't pass a click on a
  button through to a label's input, so the file picker never opened. It now
  opens the picker itself and works from the keyboard too. It is disabled
  while an upload is in progress. The empty-page "Upload your first app" card
  was not affected.
- **The Apps page had two primary buttons** (#274). Refresh is now a
  secondary button, as on the Devices page, leaving Upload app as the page's
  one primary action.

## 1.21.1

Patch release. It fixes one light-theme defect found after 1.21.0 shipped.

### Fixed

- **The disabled Record button rendered as a pink block in the light theme**
  (#272). On Live devices, Record stays disabled until a device is in the
  mosaic, and in light its faded red fill blended to pink. The white label
  measured about 1.9:1, and the button read as an alert. When disabled it now
  looks like the Stop, Bookmark and Annotate buttons beside it. Enabled, it is
  still solid red. The dark theme is unchanged.

## 1.21.0

Minor release. It adds a light theme, a calmer and more accessible sign-in,
honest save errors across the dashboard, and fixes that keep passwords and
reset links out of the server log (#265). **If you run without SMTP, read
"Changed — operator action may be needed" before upgrading.**

### Security

- **Password-reset links were written to the server log in plaintext by
  default.** With no SMTP configured, `XENON_PASSWORD_RESET_LOG_FALLBACK`
  defaulted to on, and every reset (self-service or admin-triggered) logged
  the full link, `/xenon/reset-password/<raw token>`, at `warn` level. The
  token is a credential for the account until it is used or expires (1 hour).
  Anyone who could read the log, or any system it was shipped to, could reset
  that account's password, including a SUPER_ADMIN's. The logger's secret
  redaction did not catch it.
- **Opening a reset link also logged the token, even with SMTP.** The
  token was a path segment (`/xenon/reset-password/<token>`), and the page
  then checked it with `GET …/reset-password/check/<token>`. Both URLs were
  written to the server log on every open (Appium's `[HTTP]` request lines
  and Xenon's UI-fallback line), about five times per open, while the token
  was still valid. Links now carry the token in the URL fragment
  (`/xenon/reset-password#<token>`), which browsers never send to the server.
  The validity check is `POST /xenon/api/auth/reset-password/check` with the
  token in the body, and the page removes the token from the address bar and
  browser history. Links issued before this release still work; their first
  page load is logged as before, and they expire within an hour.
- **Dashboard sign-in wrote the user's password to the server log.** Appium
  logs every request body (`[HTTP] --> POST /xenon/api/auth/login
  {"email":…,"password":…}`), and Xenon's routes share Appium's server. The
  same applied to change-password, the reset calls, creating a user with a
  password, and API-key sign-in. The dashboard now sends
  `X-Appium-Is-Sensitive: true` on each of those requests, and Appium logs a
  placeholder in place of the body.
  **Scripted clients** (SDK, CI, `curl`) calling these endpoints are not
  covered by this change. Send the same header, or add a redaction rule with
  Appium's `logFilters` server option. **Rotate** any password or API key
  that may have been logged, and purge old server logs, including copies
  shipped to a log aggregator.
- **A reset link stayed valid after the password changed.** Resetting with
  one link, or changing the password, left every other outstanding link for
  that user usable for the rest of its hour. That included one that had
  leaked into a log. A successful reset or a password change now revokes all
  of the user's outstanding links.

### Changed — operator action may be needed

- **`XENON_PASSWORD_RESET_LOG_FALLBACK` is now opt-in (default `false`).**
  If you ran without SMTP and relayed reset links out of the log, that stops
  on upgrade. Use the Users page instead (below). To keep the old behaviour,
  set `XENON_PASSWORD_RESET_LOG_FALLBACK=true` explicitly; the server then logs
  a startup warning that reset links will be written to the log in
  plaintext. Configuring `XENON_SMTP_URL` remains the recommended setup.
- **Admins issue reset links from the Users page** (`POST
  /xenon/api/users/:id/reset-link`). With SMTP the link is emailed to the
  user, as before. Without SMTP it is returned once, to the admin who asked,
  shown in a copy-once dialog, sent with `Cache-Control: no-store`, and never
  logged. The audit line records who issued a link for whom, not the link.
  Role rules apply: an ADMIN can issue links only for MEMBERs, a SUPER_ADMIN
  for anyone, and nobody for themselves (use Change password).
- **Self-service forgot-password no longer creates tokens it cannot
  deliver.** With neither SMTP nor the opt-in fallback, the request still
  returns `204` (so it still doesn't reveal whether an email exists) but
  creates no token.

A SUPER_ADMIN locked out with no other admin and no SMTP can still recover:
start the server with `XENON_BOOTSTRAP_RESET_PASSWORD=true`. That sets the
oldest active SUPER_ADMIN's password to `XENON_BOOTSTRAP_ADMIN_PASSWORD` and
signs out their sessions. Remove the variable afterwards.

### Added

- **Light theme** (#270). A Theme control in the account menu offers Dark,
  Light or System. System follows the operating system's setting and
  switches live when it changes. The choice is saved per browser and applied
  before the page first paints, so there is no dark flash. Dark stays the
  default. All light text meets WCAG AA contrast. The terminal, the live log
  and Omni-Vision's generated code stay dark in both themes.

### Changed

- **Graphite dashboard theme** (#268). Surfaces are neutral graphite, not
  green-tinted black. Green now means "an action you can take" and teal means
  "healthy". Before, one green meant both.
  - Secondary text meets WCAG AA; the old dim text measured about 3.1:1.
  - The primary button measures 9.2:1, up from 3.3:1.
  - All-caps labels and Title Case headings are now sentence case.
  - Coloured glows are gone.
- **Sign-in pages** (#264). A still, plain layout replaces the animated hero.
  - All text meets WCAG AA contrast.
  - Errors are readable ("Incorrect email or password.", an unreachable
    server, a server error).
  - A rate-limited sign-in counts down from the server's `Retry-After`.
  - A session-expired notice appears only after a real session expiry.
  - The password field warns when Caps Lock is on.
  - Inter and JetBrains Mono are now bundled with the dashboard, so the
    dashboard no longer requests Google Fonts. That matters for air-gapped
    labs.
- **Restore Defaults asks first** (#266). It resets the server config and
  zeroes every device's healed-selector count, and it now opens a
  confirmation that lists these effects.

### Fixed

- **Refused saves reported success** (#266). The dashboard treated a 400/500
  response to a save as success. Settings said the change had synchronized
  while the server had rejected it. Saves now fail visibly and show the
  server's reason. The network is blamed only for a real network failure.
- **The header status was hardcoded** (#266). The pill always read "Online",
  and its "Updated Xm ago" timer turned red after 10 minutes on any open tab.
  It now reflects the real connection: Live, Connecting…, Reconnecting…, or
  Disconnected since a given time.
- **Settings "Discard" was disabled while a field was invalid** (#266),
  exactly when you would want it.
- **Smaller dashboard fixes** (#266):
  - The Sessions search icon no longer covers the typed text.
  - Each page has its own browser-tab title.
  - ⌘K now searches builds, and reaches Live devices, Selector health, Users
    and Profile.
- **Xenon Control matches the dashboard palette again** (#269). The Mac
  launcher's generated colours had not been regenerated after #268.

### Internal

- Colours moved into design tokens (`web/src/tokens.css`), with no visual
  change (#267). A test ratchets the remaining hard-coded colours (54, down
  from about 590), so they can only go down.

## 1.20.6

Patch release. A redesigned sign-in page, and the dashboard now shows the
right version number.

### Changed

- **Sign-in pages redesigned** (#261). Login, forgot-password and
  reset-password share a new layout: one dark background, a frosted-glass
  card for the form, and a hero that shows three devices streaming live, with
  a short loop in which a selector fails and then heals. Nothing is loaded
  from a third party, no dependencies are added, and all motion is CSS that
  stops under `prefers-reduced-motion`. The login form gains a show/hide
  password toggle and an error box that screen readers announce. Sign-in
  behaviour and the `?next=` redirect are unchanged.

### Fixed

- **The header showed `v0.3.0` on every release** (#262). `__XENON_VERSION__`
  was read from `web/package.json`, a private manifest that is never bumped,
  instead of the plugin's own `package.json`. The account menu now shows the
  published version, and a test pins the two together.
- **Login fields had no accessible names.** Their labels were not linked with
  `htmlFor`, so screen readers read the inputs without names and clicking a
  label did not focus its field.

## 1.20.5

Patch release. Found by clicking every control on the Devices page.

### Fixed

- **A reservation's remaining time displayed an hour short.** Reserving a
  device for 2 hours rendered `RES · alice (1h)`. The server was right —
  `reservedUntil` was 120 minutes away — but the card formatted the remainder
  with `prettyMilliseconds(…, { compact: true })`, which keeps only the largest
  unit and floors it, so the banner was a whole hour low for all but the first
  millisecond of a reservation: 2h showed 1h, 4h showed 3h, 8h showed 7h. It is
  the number someone reads to decide whether they have time to finish, so it
  either rushed them or had the device re-reserved for nothing. It now reads
  `1h 59m`, and an expired remainder renders `expiring` rather than `-5s`.

### Known

- A device in maintenance still shows a red **ERROR** badge and matches no
  status filter, because `userBlocked` maps to the `error` status kind and
  there is no maintenance bucket. A deliberately parked device therefore looks
  broken and cannot be found through the filters. Unchanged here — adding a
  status kind, its label, colour and filter bucket is a product decision rather
  than a defect fix.

## 1.20.4

Patch release. Three defects on the Apps registry page, all found by clicking
every control on it.

### Fixed

- **Deleting an artifact left the row on screen.** The delete had already
  succeeded — the server returned zero apps — but `DELETE /apps/:id` answers
  `204 No Content` and the api-client ended in an unconditional `res.json()`,
  which throws `Unexpected end of JSON input` on an empty body. The caller's
  `catch` swallowed it into a console error, so nothing on screen changed and
  clicking again re-asked "Permanently remove …?" about an artifact that no
  longer existed. 204 and 205 now resolve instead of parsing, in the shared
  client, so every bodiless response is safe rather than just this one.
- **A filter that matched nothing claimed the registry was empty.** The
  condition was `filteredApps.length === 0`, which conflates "you have no apps"
  with "your filter excluded them", so a full registry rendered the first-run
  state — "No apps yet … Upload your first app" — offering the one action that
  could not help. The two cases are now distinct, and the filtered-empty one
  reports how many artifacts exist and offers to clear the filter.
- **The copy-bundle-id control copied an empty string.** `internal.bundle` is a
  placeholder for a null `packageName`, not a value, so the click put nothing
  on the clipboard — and its confirmation tick never appeared either, because
  it stored `pkg-` while the check compared against `pkg-null`. The control is
  now only offered when there is something to copy.

## 1.20.3

Patch release.

### Fixed

- **Downloading an app from the Apps registry returned 404.** The row was
  found and the file was on disk, but `res.download` refused it and answered
  with an HTML error page instead. Uploaded apps live under
  `~/.cache/xenon/apps/`, and `.cache` is a dot-segment, which `send` hides
  unless told otherwise. It began failing when Appium 3 moved to Express 5:
  `send` 0.19 read an unspecified `dotfiles` as legacy and its legacy branch
  looked at the last path segment alone, so a file named `<uuid>.ipa` was
  served regardless of the directories above it; `send` 1.2.0 dropped that
  branch, so `dotfiles` defaults to `ignore` and a dot anywhere in the path is
  now fatal. Measured against the same `.ipa`: Express 4.22.1 → 200, Express
  5.1.0 → 404, Express 5.1.0 with `dotfiles: 'allow'` → 200 and all 6,579,953
  bytes. No traversal risk: the path comes from the App row Xenon wrote at
  upload time, never from the request. `express.static` was unaffected — with a
  `root` set, `send` dot-checks only the request path — so this was the one
  caller that needed it.

## 1.20.2

Patch release. One label; no behaviour change.

### Changed

- **The device-control tab now reads "Logs" rather than "Debug Logs".** It
  matches the tab's own state key, which has always been `logs`, and the four
  labels beside it — Actions, Screenshot, Shell, Omni-Vision — none of which
  qualify what they show.

## 1.20.1

Patch release. Found by using the Debug Logs toolbar rather than by testing it.

### Fixed

- **Every filter change leaked a WebSocket, and the leaked one was
  unfiltered.** Changing the level or the `package:` term closed the old socket
  and opened a new one — but `close()` delivers its event asynchronously, and
  the effect's cancellation token was a ref shared across runs, which the next
  run had already reset. The dying socket's `onclose` therefore read as an
  unexpected close, retried on the 500ms backoff, and reconnected from its own
  closure carrying the previous filter. That socket overwrote the reference to
  the correctly-filtered one, which no later cleanup could reach. Measured on
  an iPhone 14: two sockets opened per change, and the survivor was always the
  one with no filter at all.

  The pane still looked right, because the browser filters locally as well —
  but the device firehose kept arriving, which is exactly what pushing
  `--process` down to `ostrace` exists to prevent. The visible symptoms were a
  RECORD that captured every process on the device while a single app was
  selected, a pane that churned through its 5000-record buffer in seconds, and
  a FREEZE whose content scrolled away underneath a held scroll position.

  The token is now created per effect run. Verified against the same device: a
  10-second recording filtered to one process went from 10,606 lines spanning
  many processes to 769 lines from a single PID, and five filter changes opened
  four sockets and closed three — one live, none stranded.

Minor release. The Debug Logs filter now means the same thing on both
platforms, and the iOS stream stops fighting itself when two people watch it.

### Added

- **Filter iOS logs by app id.** An os_trace record names the binary that
  logged (`/…/Food Truck`), never the app it belongs to, so `package:` meant
  something different on each platform — on Android a process name already _is_
  the package name. The executable is now translated to its bundle id from
  `ios apps`, read once at stream start rather than per record, and both forms
  are accepted: the app id the filter is documented around, and the name a
  reader can actually see in the pane. Apps that are not installed apps —
  `backboardd`, `locationd` — keep their own names, exactly as
  `surfaceflinger` does on Android. Verified against an iPhone 14: a viewer
  filtered to `com.example.apple-samplecode.Food-TruckJM7967FMBS` received the
  app's 4 launch records and none of the other 173,768.

### Fixed

- **Two viewers of one iOS device silenced each other.** A log session was
  keyed by device _and_ filter, so two people wanting different slices got two
  `ios ostrace` children — and os_trace_relay serves exactly one consumer.
  Measured against an iPhone 14, three concurrent children left every one of
  them mute, including a fresh capture taken from a shell; killing them
  restored 2,223 lines in 10s immediately. There is now one child per device.
  A viewer needing levels it does not emit widens it in place, keeping the
  multiplexer and every attached socket, and each socket narrows the shared
  stream to its own slice.
- **A viewer that named no levels inherited another viewer's Debug.** On a
  shared child, "asked for nothing" cannot mean "unfiltered" — measured, 102,809
  Debug records nobody requested. The stream now reports which levels it
  granted, and that is what the socket filters to.
- **A filter value could not contain a space.** `package:Food Truck` parsed as
  `package:Food` plus a text term `Truck`, which is not what anyone typing it
  meant. Double-quoted values are now one term.

## 1.19.0

Minor release: the Debug Logs tab works on iOS.

### Added

- **iOS device logs in the Debug Logs tab.** Previously Android-only — the tab
  told an iOS user their platform was unsupported. It now streams over the same
  WebSocket, the same multiplexer and the same pane, with the transport chosen
  by the device's platform. The source is `go-ios ostrace` rather than `syslog`:
  syslog carries only Notice and Error, and Debug is what a developer opens the
  tab for. Records arrive as structured JSON, so the subsystem becomes the tag —
  which is what Xcode's console groups by — and os_log's levels are mapped onto
  the set the UI already speaks, with `Default` folded into `I` rather than
  promoted to `W`, because rendering an ordinary message as a warning is a lie
  the colour scheme then repeats.
- **A level filter applied at the source on iOS.** The unfiltered firehose was
  measured at 5,485 lines/sec, past what a pane can show and past what a browser
  can hold; the default excludes Debug and the dropdown widens the running
  stream when a viewer asks for more.

## 1.18.1

Patch release. Install hardening; no runtime behaviour changes.

### Fixed

- **A reinstall could leave a Prisma client that cannot load** — and therefore a
  plugin that silently does not start. An installed client was found holding a
  fragment of its own previous version: `path.join(…)` on one line continued by
  a bare `.join(…)` on the next. That is valid JavaScript, so nothing caught it
  until `require()` failed with `path.join(...).join is not a function`, at
  which point Appium logged "Could not load plugin 'xenon'" and carried on
  serving 404s. The splice itself could not be reproduced — six reinstalls
  across `--source=npm` and `--source=local` came out clean — so what is fixed
  is what is demonstrably wrong. `postinstall` regenerates the client inside
  the installed package and copies it over the one the tarball shipped, and the
  two are never the same size (110180 shipped, 110172 regenerated) because the
  embedded engine paths differ between a checkout and a package under
  `node_modules`. A per-file copy leaves whatever the new generation did not
  overwrite; the destination is now replaced outright. And nothing checked the
  result: the client is now loaded at the end of generation, while the install
  is still on screen, and a failure prints the file, the error and the way out.

## 1.18.0

Minor release: every iOS locator the inspector suggests changes value, and many
`unique` badges change with them. Nothing breaks — the old ones did not resolve
— but saved locators will look different.

### Fixed

- **iOS class chains were missing their backticks, so none of them worked.**
  Appium's class-chain grammar requires them around the predicate. Measured
  against a real iPhone:
  `**/XCUIElementTypePageIndicator[name == "Page control"]` resolves 0 elements
  and ``**/XCUIElementTypePageIndicator[`name == "Page control"`]`` resolves 1.
  Every chain this service had ever produced was unusable — 280 in a single
  home-screen snapshot, each badged unique. Xenon's own frontend matcher already
  expected the backticked form, so the generator had been out of step with its
  own parser.
- **iOS XPath selected on `@text`**, which is an Android attribute. An
  XCUIElement has `name`, `label` and `value` and no text at all.
- **Both XPath and the predicate hardcoded which attribute they named.** On iOS
  `node.text` is `label || value`, so an element that keeps its text in `value`
  and has no label — a page indicator, for instance — got `label == "Page 2 of
  2"` and matched nothing. Both now name whichever of the two supplied it.
- **`-ios predicate string` and `-ios class chain` hardcoded `unique: true`.** A
  predicate badged unique was measured matching two elements. Both now consult
  the same uniqueness index as every other strategy, which also reduced the
  unique-badged class chains in one snapshot from 280 to 51 — the difference
  between a claim and a count. Predicate uniqueness is deliberately
  conservative: a compound is at least as selective as its label term, so a
  unique label implies a unique predicate but not the reverse.

Verified end to end against a real iPhone. Across the four strategies, locators
badged unique went from `class chain 0/10, xpath 9/10, accessibility id 10/10,
predicate 8/10` to **60/60**.

## 1.17.5

Patch release.

### Fixed

- **An installed WebDriverAgent was reported as missing**, sending readers off
  to reinstall an app that was already there. Two causes. The run log was
  appended to across runs and never truncated, and that same file is the
  evidence the failure is classified from — so a "Did not find test app" line
  written on one day was still matched the next, and once a device had
  genuinely missed WDA even once, every later failure of any kind reported it
  as missing forever. The log is now emptied before each spawn. And there was
  no way to say the other thing: go-ios distinguishes `cannot get test app
  information: Did not find test app` from `cannot start test runner:
  LaunchAppWithStdIo: failed to launch app`, but only the first had a
  classifier. The second now has one, and it points somewhere useful — an app
  that will not start is nearly always the device refusing to run it (untrusted
  developer certificate, locked screen, lapsed signature), none of which
  reinstalling fixes.

## 1.17.4

Patch release. **Upgrade straight to this if you are on 1.17.2 or 1.17.3** —
neither of those fixes works, and the damage they were meant to prevent still
occurs.

### Fixed

- **An iOS session could uninstall WebDriverAgent from the device**, and could
  not complete. Both symptoms had one cause: Xenon sent
  `appium:usePreinstalledWDA` alongside `appium:webDriverAgentUrl`. The
  capability does not choose the startup strategy — the URL already does;
  `selectWdaStartupStrategyName` returns `existing-url` on it before looking at
  anything else, and that strategy is explicitly hands-off. All the extra
  capability adds is a detour through `preparePreinstalled`, which kills the
  runner and then uninstalls every WebDriverAgentRunner not on a one-entry
  keep-list. Against a WDA that Xenon hosts through go-ios, each half produced
  one of the symptoms — both observed on a real iPhone: the uninstall as
  "Removing WebDriverAgent runner app 'com.qasecret.WebDriverAgentRunner
  .xctrunner'", leaving the device with no WDA until one is re-signed by hand,
  and the kill as the driver's own next request failing with ECONNRESET while
  `iproxy` still held the port. The capability is now deleted from both
  capability buckets rather than merely not added, including when a caller
  supplies it: on this path honouring it would kill the WDA Xenon is hosting.

## 1.17.3

Patch release. **Superseded by 1.17.4 — this fix does not work.** It corrected
the format of `appium:updatedWDABundleId` (the capability wants the id without
the `.xctrunner` suffix, which the driver appends when building its keep-list),
but a correct keep-list only converts the uninstall into a kill: the session
still fails and the device's WebDriverAgent is still stopped. The argument was
right; the call should not have been happening at all.

## 1.17.2

Patch release. **Superseded by 1.17.4 — this fix does not work.** It stopped
Xenon claiming a preinstalled WebDriverAgent it could not name, but named it
wrongly, so the device's runner was still uninstalled on the next session
attempt.

## 1.17.1

Patch release.

### Fixed

- **A Mac with more simulators than the port range holds could not see its own
  attached iPhone.** Discovery leased a `wda` and an `mjpeg` port to every
  simulator installed on the machine, booted or not — 158 of them against
  ranges of 100 where this surfaced. Both ranges drained, `acquire` threw, and
  the throw escaped the whole discovery pass, so IOSDeviceManager returned no
  devices at all and `removeStaleDevices` deleted the physically attached
  iPhone for not appearing in its own device list; it vanished from the
  dashboard about thirty seconds after appearing. Three changes: ports are only
  leased to a device that can use one now (a real device, or a booted
  simulator); `PortAllocator.tryAcquire` reports exhaustion as `undefined`
  rather than throwing, because a device that cannot get a port is still a
  device and must still be listed; and `iOSCapabilities` acquires just-in-time,
  after the stream-reuse check rather than before, since that branch deletes
  both ports. Measured with the default `iosDeviceType=both`: real devices
  listed at t+115s went 0 → 2, exhaustion errors constant → 0, and port leases
  held from a drained range → 3, with 0 of 113 simulators holding one.

## 1.17.0

Minor release.

### Added

- **The device preview says when the device is merely asleep.** A sleeping
  device streams a perfectly black frame, indistinguishable from a broken
  stream or a black-themed app, and the wake control sat two panes away with
  nothing connecting them. The preview now says so over the black frame, with a
  Wake button wired to the existing unlock route. It asks the device rather
  than looking at the picture: sampling the frame for black is the obvious
  implementation and the wrong one, because plenty of real app screens on an
  AMOLED panel are pure black and telling someone their display is off while
  they are looking at it is the worse failure. Keyed on `Display Power: state=`
  rather than `mWakefulness=` — measured on a Galaxy S9, a screen turned off by
  the power button reports `mWakefulness=Dozing` while the panel is genuinely
  off. `doze` (always-on display is lit) and `unknown` both show nothing; every
  ambiguity resolves toward silence. A 2s read-through cache shares its
  in-flight promise, so six concurrent requests cost one `dumpsys power`. iOS
  implements no reader and the overlay never appears there.

## 1.16.1

Patch release. **Upgrade straight to this if you are on 1.16.0** — that release
puts the Omni-Vision tree controls out of reach.

### Fixed

- **The source badge pushed every action button outside the panel.** The tree
  header is 309px wide in the embedded layout and holds a title, a count pill
  and four buttons. It did not fit on one line before 1.16.0 either — the count
  pill was already breaking mid-word into "66 / ELEMENTS" — and adding a third
  pill pushed Expand All, Collapse All, the inspect-mode toggle and Refresh
  past the panel's right edge, off screen. The last two exist in that header
  only because embedded mode has no other route to them, so 1.16.0 removed the
  only way to reach inspect mode or refresh a snapshot from the device page.
  The row now wraps deliberately and the actions never shrink or leave the
  panel.
- **The document root offered a locator that can never resolve.** `<hierarchy>`
  is the XML document element, not a UI element, and Appium's XPath engine
  returns nothing for `/hierarchy[1]`. It was the first row anyone clicks
  Verify on, badged unique and answering "found 0". It now offers none, and the
  panel says why instead of showing an empty list.

## 1.16.0

Minor release. One new capability, and the fix that makes it usable.

### Added

- **Locator verification.** Every suggested locator gets a Verify button that
  resolves it through the real Appium driver and reports what came back: found,
  not found, or ambiguous with a count. A second button finds and taps, so you
  can prove a locator drives the element you meant rather than the one above
  it. Ambiguous locators are refused rather than acted on. This answers a
  different question from the match badges beside it, which test a locator
  against the captured XML and cannot evaluate `-android uiautomator` or an iOS
  predicate at all.

### Fixed

- **The inspector now works while a test is running.** Android permits one
  UiAutomator instrumentation at a time, so `uiautomator dump` — how the
  inspector read the hierarchy — is SIGKILLed while
  `io.appium.uiautomator2.server` holds it. Verification needs a driver. You
  could inspect a device or drive it, never both. The hierarchy now comes from
  the session when there is one, which is also the only tree a suggested
  locator can honestly be judged by, and from the device otherwise.
- **Four locator defects that only surface once a Verify button can contradict
  them**, each measured against a live driver: an XPath tag is the
  fully-qualified class (`//Button[@resource-id=…]` found 0,
  `//android.widget.Button[…]` finds 1); absolute XPaths are rooted at
  `/hierarchy[1]`, which also means a screen with more than one window no
  longer shows only the first; uniqueness is counted once per document instead
  of walked per suggestion, replacing several hardcoded `unique: true`; and
  `text`/`name` are stringified at the parser, since `parseAttributeValue`
  turns a clock reading "22" into the number 22 and the tree view slices it.
- A failed snapshot states its reason in the panel instead of leaving it blank,
  and a badge says whether the tree came from the session or the device.

Generated absolute XPaths change form, but the old ones resolved to nothing, so
no working saved locator is affected. The Android tree gains a `hierarchy` root
row.

## 1.15.0

Minor release: three additive features, no breaking changes.

### Added

- **Debug Logs recording.** RECORD captures the raw log stream between an
  explicit start and stop and writes it to a file. Its own buffer, independent
  of the 5000-record display cap and of the active filter, because that cap
  holds only about a minute of a chatty device. Records are serialised on
  arrival, and at the 500k cap the newest are dropped so the window you chose
  keeps its beginning; truncation is declared in both the file header and its
  trailer.
- **Click-to-inspect in Omni-Vision.** Clicking an element on the live device
  selects it and shows its bounds, attributes and ranked locators. The overlay
  already existed but was hidden behind the embedded flag in the only place the
  component is used, so the capability was unreachable.
- **Orientation-aware, icon-only device controls** — a vertical strip beside a
  portrait device, a horizontal bar under a landscape one, so the controls sit
  where the device is not. At 1440 the preview column drops 683px → 406px and
  the log pane gains it.

All three verified against a Galaxy S9, not only in unit tests.

## 1.14.0

Minor release: the Debug Logs tab gains a feature, and one behaviour change is
visible to existing API clients.

### Added

- **Continuous logcat streaming.** The Debug Logs tab streams a parsed,
  filterable logcat over an authenticated WebSocket (Android only; iOS renders
  an unsupported state). Replaces a 3-second `logcat -d -t 500` poll that
  appended without dedup, so the 1000-line buffer held roughly the same 500
  lines twice. Adds per-tag colouring, field-aware filtering, find with
  prev/next, match case and a soft-wrap toggle.

### Changed

- **BREAKING for API clients: `GET /control/:udid/logs` is now
  ownership-checked.** It served the same `adb logcat` bytes as the new
  WebSocket with no ownership check, which made that check decorative — a
  reader refused at the socket could GET the identical data. It joins
  `clipboard` in `OWNERSHIP_CHECKED_READS`. Only denies when the device is held
  by **another** user; your own and unheld devices are unaffected and admins
  bypass. An external SDK client polling logs on someone else's busy device
  will now see 409.

### Fixed

- **`--plugin-xenon-auth-disabled` did nothing.** It is declared in
  `schema.json` so Appium accepted and echoed it, but every consumer reads
  `config.authDisabled`, which comes from `XENON_AUTH_DISABLED`. Nothing
  bridged the two.
- **Long-lived sidecars were orphaned on every SIGTERM.** Appium's own handler
  exits before the plugin's async cleanup phases run, so `adb logcat`, scrcpy,
  go-ios, WDA, iproxy and ffmpeg all survived shutdown and another set leaked
  on the next restart. Now killed synchronously from a `process.on('exit')`
  hook.
- Three status indicators returned to their intended animation:
  `device-control.css` defined its own `@keyframes pulse-dot`, a global name
  `index.css` also defines, so loading that sheet silently redefined the
  animation app-wide.

## 1.13.1

Patch release. Nothing here changes a caller-visible contract: a new
`Session.user_id` column is populated and preferred when reading, so callers
who were previously denied start being allowed — the bug being fixed rather
than a change of behaviour anyone depended on.

### Fixed

- **A session authenticated by `xenon:options.sessionToken` was
  unattributable.** The gate verified that token and discarded the payload, so
  the ownership guard denied the caller their own device for being
  unidentifiable.
- A `df:options` key pair now records the user alongside the ApiKey id, so new
  rows resolve their owner without the ApiKey hop. `SessionOwnerResolver`
  prefers `Session.user_id` and falls back to `api_key_id → ApiKey.userId` for
  rows written before this release.

## 1.13.0

Minor release, not patch: this changes behaviour visible to callers.

### Changed

- **`/control` mutations against a device held by another user, or running
  another user's Appium session, now return 409.** Your own session stays
  interactive.
- **MEMBER cookie sessions gain the `devices` scope.** Device control was
  admin-only in practice before this, which also meant no dashboard user could
  ever receive the 409 — admins bypass the guard.
- **`GET /control/:udid/clipboard` now requires ownership.** Other reads stay
  open.
- `stream/start` no longer overwrites a lock held by someone else.

Note: sessions created without the `df:options.accessKey`/`token` pair persist
`api_key_id = null` and are unattributable, so the fail-closed rule denies
everyone non-admin on that device — including the engineer who started the run.
1.13.1 extends attribution to `xenon:options.sessionToken` callers.

## 1.12.1

Patch release. **Upgrade straight to this if you are on 1.12.0** — that release
prevents the server from starting against an existing config file.

### Fixed

- **1.12.0 would not start with a pre-existing config** — its three new
  retention args were added to `schema.json`'s `required` list. Appium validates
  the config file against that schema and refuses to start when a required key is
  absent, so any install upgrading into a config written before 1.12.0 died at
  boot with `REQUIRED must have required property 'recordingFailedCleanupDays'`
  and exit code 2, with nothing in the message to suggest the fix was to hand-edit
  a YAML file. The args were never meant to be mandatory: all three declare a
  default and `CleanupService` destructures with its own fallbacks. They are now
  optional and existing configs load unchanged. A guard test pins the count of
  args that are required *despite* declaring a default so the set cannot grow —
  each addition breaks every config written before it.

## 1.12.0

Minor release: a retention policy for Live Devices recordings — the one asset
class nothing ever removed. Minor rather than patch because this is the first
version that **deletes recordings on a schedule**; every earlier release kept
them forever.

### Added

- **Recording retention and orphan sweep** — `CleanupService` covers Builds and
  Sessions (`session.video_recording` is the Appium session video, a different
  model), and there is no `DELETE` route for recordings, so the tree grew without
  bound. On one developer machine it had reached 313 MB across 78 directories,
  the oldest three months past the 30-day build window, with **265 MB of it
  unreachable** — directories no DB row pointed at, left behind by failed starts.
  A third phase now runs on the existing `buildCleanupSchedule` cron: expire rows
  by age and count, then sweep directories no surviving row can reach. Expiring
  first leaves those directories unreachable, so one pass reclaims both.
  Reachability is decided by `file_path`, never by directory name — only 35 of 39
  rows on that machine were named after their own id.

### Changed

- New plugin args, shaped like their build counterparts:
  `recordingCleanupDays` (30), `recordingCleanupMaxCount` (100), and
  `recordingFailedCleanupDays` (2) — a failed recording holds no playable file,
  so it need not linger as long as real footage.
- **Recordings are now deleted automatically.** Nothing was ever removed before,
  so this changes behaviour on existing installs: raise `recordingCleanupDays`,
  or set it very high, if recordings are retained as evidence. In-flight
  recordings are excluded from both rules, and the sweep refuses to run if the
  `Recording` table read returns no rows while directories exist.

## 1.11.2

Patch release: what a real device disconnected mid-recording turned up. The
1.11.1 fix worked, but it stopped one step short — and it made two dormant
recording-bookkeeping gaps reachable.

### Fixed

- **A device that stopped answering served a frozen frame indefinitely** — the
  reuse health check in 1.11.1 tested whether a frame *existed*, not whether it
  was recent, and `latestFrame` is only ever assigned. The capture loop swallows
  capture errors without changing the session status, so a device that went away
  (unplugged, adb killed, reboot) left the MJPEG server rewriting the last good
  JPEG every 60ms: a frozen preview, and a recording that `ffprobe` calls
  perfectly healthy and which is a still photograph. That is worse than the
  0-byte failure 1.11.1 addressed, because it looks valid. Capture health is now
  measured as how long the device has been silent — time, not a failure count,
  since a fast `ADB Exit` and a 15s `ADB Timeout` are very different amounts of
  frozen video. Past a 10s grace window the session is refused for reuse and
  stream clients are disconnected, so ffmpeg finalises the footage it actually
  captured. Verified on hardware by disconnecting a device mid-recording: the
  frozen tail is bounded to the grace window instead of running until someone
  presses Stop.
- **A stalled device could still go unlogged** — the warning for the above was
  emitted from the capture loop, but disconnecting clients is precisely what
  idles that loop, so the failure that would have crossed the threshold never
  happened. Measured on the device: 10 failures spanning 9.214s against a 10s
  threshold, then silence. Either path now claims the announcement, so a stall is
  logged exactly once no matter which notices it first.
- **A recording stayed `RECORDING` when its ffmpeg exited on its own** — nothing
  reconciled the row, so it kept no `ended_at`, duration or size until a manual
  Stop, or until a server restart marked it `FAILED`. This was near-unreachable
  before — ffmpeg only exited early if it crashed — and the stall fix above makes
  a clean early exit a designed outcome. The row is now finalized from the exit
  (`fail_reason=source_ended`, so a short recording is visible as such rather
  than silently truncated), and the file gets the faststart remux the normal stop
  path performs.
- **Recording duration was wall-clock, not video** — `duration_ms` measured the
  time between start and Stop, which matches the file only while capture keeps
  up. A disconnected device produced 335964ms for a 35.16s mp4, and the same
  number fed the recording-duration metric and the proof-bundle manifest. The
  finished file is now probed (via the bundled ffmpeg — there is deliberately no
  `ffprobe` dependency), falling back to wall-clock when it cannot be read.
  Nothing is lost: wall-clock remains derivable from `started_at` and `ended_at`.

## 1.11.1

Patch release: the Android counterpart to the stale-stream-session fixes that
1.11.0 made on the iOS side.

### Fixed

- **Android preview and recording could be handed a stream port that serves
  nothing** — `startStream` reused any session marked `running` *or* `starting`
  without checking that anything was still serving it. A session whose HTTP server
  had closed, or one that went live without ever capturing a frame (startup warns
  after a 5s first-frame wait and continues anyway), was therefore reused
  indefinitely: ffmpeg exited 1 against the port and left a 0-byte mp4 — the same
  silent symptom as the 1.11.0 promise-map fix, reached by a different route.
  Reuse now requires the session to be `running`, its own server to still be
  listening, and at least one frame to have been captured; anything else is torn
  down and restarted. `GET /:udid/stream` kept a second copy of the same
  short-circuit, so it now routes through `startStream` as well — the Android
  analogue of the iOS route fix in 1.11.0.

## 1.11.0

Minor release: iOS live-streaming reliability, including the root-cause fix for
WebDriverAgent being terminated a few minutes after launch.

### Fixed

- **WebDriverAgent terminated minutes after launch (iOS 17+)** — the vendored
  go-ios was pinned at v1.0.134, which does not keep the XCTest session alive.
  iOS terminates the runner while the host-side `runwda` process stays alive with
  `exitCode === null`, so nothing on the host notices and it presents as a hang.
  Isolated by holding one WebDriverAgent build constant and varying only the
  launcher: v1.0.134 died at 2m51s, `xcodebuild` survived 11m+, v1.2.1 survived
  12m+. Note the version bump alone would not have reached existing installs —
  the installer's cache check was version-blind — so it now records the installed
  version and upgrades in place.
- **iOS preview stuck on "Connection Failed" until a manual stop or restart** — a
  `UniversalMjpegProxy` that exhausted its reconnect budget stayed in the
  per-device cache, and because the upstream URL was unchanged it was reused
  indefinitely, short-circuiting every request to 503 even after the device
  recovered. Stopped proxies are now evicted and recreated.
- **A dead WDA went undetected for up to an hour** — `GET /:udid/stream` reused any
  session marked `running` without checking it, so recovery waited on the hourly
  watchdog. The stream path now health-checks before reuse and restarts on demand.
- **Android recordings silently produced 0-byte files until a server restart** —
  `startStream` registered its in-flight promise *after* invoking the task while
  releasing the key from inside the task's own `finally`. On the early-return path,
  which never awaited, the release ran before the registration and left a settled
  promise stuck in the map, so every later call returned a stale port for the life
  of the process. Both stream services now dedupe through a `SingleFlight` helper
  in which the release cannot precede registration.
- **Perpetual empty-diff churn on the committed Prisma client** — `@prisma/client`
  ships some runtime `.d.ts` files with CRLF while the client is committed as LF,
  so every `prisma generate` rewrote them. Generated output is normalised to LF and
  the freshness check now compares EOL-insensitively.

### Changed

- Vendored go-ios pinned to **v1.2.1** (was v1.0.134); the installer records the
  installed version in `.go-ios-version` so existing caches upgrade rather than
  being skipped.

## 1.10.5

Patch release: Live Devices recording reliability and video-only downloads.

### Fixed

- **Empty / unplayable mosaic recordings** — ensure MJPEG is running before ffmpeg
  (stop Android H.264 preview when needed); persist orchestrator recording IDs in
  the DB so Stop targets the correct ffmpeg; avoid macOS `taskpolicy` Economy wrap
  that broke VideoToolbox; remux to standard faststart mp4 on stop.
- **Composite download gate** — only offer side-by-side when the server actually
  started a composite.

### Added

- **Video-only downloads** — `GET /recordings/:groupId/video.mp4` and
  `GET /recordings/:groupId/videos.zip` (mp4 files only; proof bundle remains for
  API clients).
- **Live Devices recording UX** — elapsed `REC` timer, Starting/Stopping states,
  clearer Record N devices label, success/error banners, Download video /
  Download videos / Side-by-side actions.

## 1.8.1

Patch release: two real-device iOS / session-lifecycle fixes found while
verifying the hosted-MCP lab path end-to-end on real Android and iOS hardware.

### Fixed

- **Real-device iOS sessions** — `injectWDAUrl` wrote the WebDriverAgent
  capabilities (`webDriverAgentUrl`, `usePreinstalledWDA`, `updatedWDABundleId`)
  into **both** the W3C `alwaysMatch` and `firstMatch[0]` objects. The spec
  forbids a capability appearing in both, so appium-xcuitest rejected every
  real-device iOS session with "property 'webDriverAgentUrl' should not exist on
  both primary and secondary object" — even though WebDriverAgent itself
  launched fine. The injected WDA caps are now written to exactly one bucket.
  (#160)
- **Device stuck `busy` after a thrown session create** — when the driver's
  `createSession` (or the remote forward) **threw**, the device allocated for
  the session was left stuck `busy: true` with no session, unavailable until the
  hub restarted: the throw skipped both `finalizeSession` and
  `handleSessionFailure` (the latter only unblocks when `createSession`
  *returns* an error object, not when it throws). The session-creation block now
  releases the device on any thrown error before rethrowing. (#161)

## 1.8.0

First release since 1.7.10, covering 11 merged PRs. The headline is **hosted-MCP
support**: everything Xenon Studio's lab mode needs (granular MCP scopes, session
tokens, audit ingest, MCP plugin endpoints) is now available from a published
version instead of only from `main`.

### Added

- **Hosted MCP support** — the `xenon-mcp` token audience is accepted on the REST
  bearer path so MCP plugin tool calls authenticate, plus the MCP plugin
  endpoints themselves. (#152, #153)
- **Granular MCP scopes** — flat→granular scope mapping with a least-scope
  default; `xenon-mcp` tokens carry granular `scope`/`roles` claims alongside a
  down-mapped flat `scopes` claim, so a token's REST reach never exceeds its MCP
  grant. (#153)
- **Session tokens (R9)** — `/auth/token` mints a short-lived `xenon-session`
  token alongside the `xenon-mcp` one, and `createSession` gained an opt-in
  `xenon:options.sessionToken` gate that closes the direct-to-Appium bypass.
  Off by default. (#153)
- **Capability flags** — `/capabilities` advertises `mcpScopedTokens` and
  `sessionTokenGate` so clients can detect support. (#153)
- **Audit ingest** — `POST /xenon/api/audit/events` feeds `EventLogService`
  (`mcp_audit` events), for gateway authz decisions. (#153)
- **Healing APIs** — `GET /healing/selector-health` (hotspots + etalon age), a
  `sessionId` filter on `GET /healing/events`, and an
  `xenon:options.healingTiers` tier-policy gate in `HealingOrchestrator`. (#152)
- **Socket bearer auth** — the Socket.IO handshake accepts a hub-issued bearer
  JWT as a dashboard principal. (#151)

### Fixed

- **iOS shared-stream device lock** — a manual stream lock (`manual_<actor>_<udid>`)
  no longer overwrites a live Appium session's `session_id`, which previously made
  session teardown fail to release the device (leaving it stuck `busy: true`) and
  caused the health monitor to skip reclamation. Session teardown now also stops an
  idle session-owned stream (when no one is watching) instead of letting it linger.
  (#157 — closes #149, #150)
- **Slow session creation** — the device-availability wait now polls every **1s**
  instead of 10s, so a create waiting on a briefly-busy device proceeds within ~1s
  of it freeing rather than quantizing into 10s chunks. (#155)
- **Lease port allocation** — hub node-pair credentials are wired into
  `LeaseService`'s port allocator. (#154)
- **Token minting** — `/auth/token` validates that `scopes` is an array before
  minting, returning a clean 400 instead of failing opaquely. (#153)
- **Recordings** — bearer principals can start recordings (`req.auth.userId`
  fallback). (#152)
- **mac-app hang diagnostics** — app shutdown is no longer reported as a GPU
  crash, and normal suspension no longer trips the hang detector. (#145, #148, #156)

### Changed

- **mac-app** — Electron 33 → 43. (#146)
- Added a load-guard test for the log batcher. (#147)

## 1.7.10 and earlier

Not tracked in this file — see the git history and PR list.
