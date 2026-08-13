# Changelog

All notable changes to `@xenon-device-management/xenon` (the Appium hub plugin).

This project follows [Semantic Versioning](https://semver.org/). Releases are
published to npm automatically when `package.json`'s `version` changes on `main`
(see `.github/workflows/npm-publish.yml`).

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
