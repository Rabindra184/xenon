# Xenon Control — Safe and Current (Part A)

**Date:** 2026-10-06
**Status:** Design approved in conversation; written spec awaiting review
**Scope:** `mac-app/` only, plus its user doc `website/docs/xenon-control.md` and a CI workflow.

## Context

Xenon Control is the Mac app that configures and starts Appium with the Xenon
plugin. The plugin is at 2.17.0. The app is at 0.1.5 in the source, but the
only release is 0.1.3, built against plugin 1.10.1. Since then the plugin has
changed what several options mean, added options, dropped its `required` list,
and documented things a launcher must do (log filters, go-ios install, a long
shutdown drain) that the app doesn't do.

This is **Part A** of a three-part modernisation:

- **A — Safe and current** (this spec): fix what is unsafe, wrong or out of
  step with Xenon 2.17. No visual redesign.
- **B — Redesign for everyday users:** new layout (Home, guided setup,
  Essentials vs Advanced), plain language, light/dark, accessibility.
  Separate spec.
- **C — Show what Xenon can do now:** live devices and sessions, shareable
  addresses, first sign-in help, hub link check, update notices, connecting AI
  agents. Builds on B's Home screen. Separate spec.

The primary user of the finished app is a **QA tester** who starts the lab,
opens the dashboard and runs tests. Part A doesn't change layout, but every
message it adds or changes is written for that user: plain words, no option
keys, variable names or commands in the main text.

## Goals

1. Secrets never reach Appium's log or the app's per-run log files.
2. Stopping or quitting never cuts Xenon's shutdown short.
3. A machine set up by the app can actually run iPhones.
4. The settings form and the generated launch match the plugin that is
   installed, not the one the app was built against.
5. The Start button is always right about whether it can start, and says why
   not. Nothing fails silently.
6. Setup installs into the same Appium folder the app shows and launches from.
7. A tested 0.2.0 build and docs that describe it.

## Non-goals

- Layout, navigation, visual style, light theme, new screens (Part B).
- Rewriting option labels and descriptions as plain language (Part B). Part A
  only fixes descriptions that are now **wrong**.
- Using Xenon's HTTP endpoints for readiness, live counts or LAN addresses (Part C).
- New guided settings for public URL, first sign-in, email, telemetry, MCP (Parts B/C).
- Moving `cloud.apiKey` and proxy passwords into the Keychain (Part B, with
  the Cloud and Network settings redesign). Part A covers them by log
  redaction (A1) and export stripping (A5).
- Changing the `bootedSimulators: true` profile default. It changes which
  devices testers see; that's a product call for Part B.

## A1 — Hide secrets in logs

**Problem.** Appium logs request bodies. Xenon's docs
(`website/docs/authentication.md` "log-filters") give two `log-filters`
rules that redact tokens, passwords and `apiKey` values, and say Xenon
Control's config file is where they go. `LaunchBuilder.buildConfigYaml`
(`mac-app/src/main/LaunchBuilder.ts:72-89`) writes no `log-filters`, so
session tokens, lease tokens, sign-in passwords and API keys land in plain
text in the Logs tab and in every file under the app's logs folder.

**Design.**
- `LaunchBuilder` always writes `server.log-filters` with the two rules,
  copied from `authentication.md`. They live in one constant,
  `XENON_LOG_FILTERS`, in a new `mac-app/src/main/logFilters.ts`, with a
  comment pointing to the doc section they mirror.
- Not user-editable in Part A. The rules are the documented minimum, not a
  preference.
- The Launch Preview shows them, since it shows the generated config.

**Tests.**
- Unit: the generated YAML contains both rules, with their patterns intact
  after the YAML round trip (`yaml.load(buildConfigYaml(...))`).
- Unit: applying each rule (`new RegExp(pattern, flags)` + `replace`) to
  sample log lines (a `POST /session` body with `token`, a sign-in body with
  `password`, a `cloud.apiKey` value) yields `**REDACTED**` and leaves
  surrounding text intact.
- Live: start a server, create a session with a `token` capability, and check
  that the Logs tab and the run's log file show `**REDACTED**`.

## A2 — Let Xenon shut down cleanly

**Problem.** `ProcessSupervisor.stop()` sends SIGINT, then SIGKILL after 8 s
(`ProcessSupervisor.ts:12, 188-201`). Xenon's shutdown drains sessions for up
to 15 s (`src/index.ts`, `ShutdownCoordinator.drain(15_000)`), then flushes
telemetry and tears down sidecars. SIGKILL skips all of that: go-ios and
logcat processes are orphaned, recordings aren't archived, and phones keep the
capture proxy until the next start. On app quit, `killNow()` sends SIGINT and
the app exits immediately (`index.ts:435-437`).

**Design.**
- `STOP_GRACE_MS` becomes 30 000. SIGINT → wait up to 30 s → SIGTERM → wait
  5 s → SIGKILL. Each escalation adds a plain system line to the log ("Xenon
  is taking longer than usual to stop…", "Forcing Xenon to stop.").
- While stopping, the status bar reads **"Stopping — saving recordings and
  releasing phones…"** instead of "Stopping…". The narrow sidebar card and the
  tray keep "Stopping…".
- **Quit while running.** `before-quit` calls `event.preventDefault()`, runs
  the same graceful stop, then quits once the child exits, up to the same
  30 + 5 s limit. A second ⌘Q during the wait forces the stop and quits
  immediately. The window stays visible during the wait so the state shows.
  A system shutdown or logout gives macOS's own deadline; the same path runs
  and macOS decides.
- The timings live in one place, `ProcessSupervisor`, as named constants.

**Tests.**
- Unit (fake child process): SIGINT first; no SIGKILL before 30 s; SIGTERM at
  30 s; SIGKILL at 35 s; no further signals once the child has exited; a
  second stop request during stopping doesn't restart the timers.
- Unit: the quit path waits for exit and a forced quit escalates at once.
- Live: start, run a session, Stop. The log shows Xenon's drain finishing,
  and no `go-ios`/`ios` processes from that run are left (`pgrep`).

## A3 — Honest iPhone setup

**Problem.** The Health check "go-ios (auto-provisioned)" says *no action
needed* when go-ios is missing (`ToolchainInspector.ts:176-187`). Since 2.x
Xenon doesn't download it: `website/docs/installation.md` says to run the
plugin's `install-go-ios.js` once and again after each upgrade. Without it,
iPhones are refused as unhealthy. Setup doesn't run it. Separately, each setup
step is shown twice (a running row and a done row), and setup ends with no
summary.

**Design.**
- **Setup runs the go-ios installer** when the profile's platform includes
  iOS. After the plugin and drivers, setup runs
  `node <plugin dir>/lib/src/scripts/install-go-ios.js` with the profile's
  environment. The plugin directory is found the same way
  `readInstalledPluginVersion` finds it
  (`<APPIUM_HOME>/node_modules/@xenon-device-management/xenon`). The script
  itself decides whether to download, replace or skip. If the script is
  missing (old plugin), the step is skipped with a note.
- **The check tells the truth.** It reads `~/.cache/xenon/goIOS/ios` and
  `~/.cache/xenon/goIOS/.go-ios-version`, plus the pinned version from the
  installed plugin's `lib/src/scripts/goIosVersion.js`, loaded with
  `require` in the main process. Pinned version unavailable → presence-only
  check. Results:
  - present and matching → ok, "Ready for iPhones".
  - missing → warn (not blocking, since Android-only labs don't need it),
    "iPhones won't work until setup finishes. Run Set up on this tab."
  - present but different version → warn, "Xenon was updated. Run Set up
    again to update iPhone support."
  - platform is Android only → ok, "Not needed for Android-only profiles."
  - Label becomes **"iPhone support"**. The technical detail (path, versions)
    goes in the check's `detail`.
- **Setup progress shows each step once.** `HealthPanel` keys progress rows
  by `step` and updates the row in place. When setup ends, a toast says
  "Setup finished" or "Setup didn't finish: <step label> failed. See the
  steps above." (error toast).
- Step ids stay as they are internally. Showing them as plain labels
  ("Installing Xenon", "Installing Android support", "Installing iPhone
  support", "Checking the install") is a small map in `HealthPanel`, done
  here because the go-ios step is new.

**Tests.**
- Unit: `setupPlan` adds the go-ios step only for `ios`/`both` profiles and
  skips it with a note when the script is absent.
- Unit: the check's four outcomes from fixture directories and pins.
- Unit: progress rows de-duplicate by step and keep the latest state.
- Live: on a Mac with a connected iPhone and go-ios removed from the cache,
  Health shows the warning, Set up installs it, the check turns ok, and an
  iPhone session starts.

## A4 — Option list matches the installed plugin

**Problem.** The form and the generated config use the schema bundled at
build time (`resources/schema.json`, gitignored, synced by
`scripts/sync-schema.mjs` only on `dev`/`build`). Each build carries a
different snapshot, and nothing compares it with the installed plugin. A
newer key (e.g. `sessionMetrics`) sent to an older plugin makes Appium refuse
to start (`additionalProperties: false`). An older snapshot shows descriptions
whose meaning has since changed. Because the bundled snapshot may predate the
plugin dropping its `required` list, the launcher always writes 23 legacy
defaults, including `enableJsonLogging: false`, so `XENON_JSON_LOGGING` can
never take effect (`configDefaults.ts`).

**Design.**
- **Schema source.** `SchemaService` gains
  `effectiveSchema(appiumHome): { schema, source: 'installed' | 'bundled', pluginVersion }`.
  - Find the installed plugin directory as `readInstalledPluginVersion` does.
  - Read its `package.json` and take the schema path from `appium.schema`,
    the field Appium itself uses, so no file name is hard-coded. Load that
    file.
  - On any failure (not installed, unreadable, invalid JSON, no
    `properties`), use the bundled schema with `source: 'bundled'`.
  - Cache per `appiumHome` + installed version; invalidate after setup and on
    window focus, as the plugin version already is (`App.tsx:158-190`).
- **IPC.** `getSchema` takes the profile, so the form re-renders when the
  profile's Appium folder or the installed version changes.
- **Launch uses the same schema.**
  - `buildLaunchPlan` takes the effective schema.
  - `requiredDefaults(schema)` then naturally writes the legacy defaults only
    when the installed plugin still declares `required`. With a 2.13.2+
    plugin, `enableJsonLogging` is no longer forced, which fixes the JSON
    logging bug without a special case.
  - Profile settings whose key isn't in the effective schema are left out of
    the generated config. The log shows one plain line: "Skipped 2 settings
    your installed Xenon doesn't support: Session metrics, …" (labels via the
    existing `humanize`).
  - They stay in the profile, so upgrading the plugin brings them back.
- **Visible version.** The Settings tab shows one muted line above the search
  box: "Showing the options of Xenon 2.17.0, installed in this profile's
  Appium folder." When Xenon isn't installed: "Xenon isn't installed yet.
  Showing the options of Xenon 2.17.0 until Set up installs it." (Set up
  installs the latest Xenon, which may be newer than the bundled list.) When
  Xenon is installed but its list can't be read: "Showing the options that
  came with this app (Xenon 2.17.0). Your installed Xenon 2.9.4 didn't
  provide its own list, so a few may not apply."
- **Bundled snapshot stays fresh.** The CI job (A8) runs
  `sync-schema.mjs --check`, a new flag that fails when
  `resources/schema.json` would differ from `../schema.json`. The release
  build already syncs.
- The existing `SECTION_ORDER` mapping keeps working. Keys it doesn't place
  still fall to "Advanced". Re-sectioning is Part B.

**Tests.**
- Unit: `effectiveSchema` returns the installed schema from a fixture
  APPIUM_HOME, and the bundled one for missing, unreadable or invalid files.
- Unit: launch with an installed schema lacking `sessionMetrics` omits it and
  reports it. With a schema without `required`, no legacy defaults and no
  `enableJsonLogging`. With a schema with `required`, the legacy defaults are
  written as today.
- Live: point a profile at an Appium folder with an older plugin (e.g. 2.9.x)
  while the profile has `sessionMetrics` set. Start succeeds and the log shows
  the skipped-settings line.

## A5 — Retire dead or misleading settings

**Problem and design, item by item:**

| Item | Today | Change |
|---|---|---|
| `databaseProvider` | Live control (`schemaForm.ts:82`); has no effect since 2.15, and `postgresql` can stop a server whose database was made with the default | Hidden from the form via a `RETIRED_KEYS` list in `schemaForm.ts`, and never written to the config. A profile that has it keeps it, but it isn't launched. |
| Simulator port-pool check | `toolchainRules.ts:145-206` warns about the 100-port WDA pool and tells users to enable "Booted Simulators"; stale since #240 (only booted simulators lease a port, and a full pool no longer breaks discovery) | Remove the WDA verdict and its Health row. The `bootedSimulators` default stays (see Non-goals). |
| Hub address | `validation.ts:62-71` accepts a URL with a path | Must be an origin: scheme, host, optional port, nothing after. Message: "Use only the hub's address, like http://hub-mac:4723, without /wd/hub or other paths." |
| Profile export | `withoutSecrets` (`profileSecrets.ts:127-134`) strips only the known Keychain secrets | Also strip `settings.cloud.apiKey` and `settings.proxy.auth.password`. Drop env vars whose name ends in `_KEY`, `_TOKEN`, `_SECRET` or `_PASSWORD`, or equals `OTEL_EXPORTER_OTLP_HEADERS`, `XENON_IP_HASH_SECRET` or `XENON_BOOTSTRAP_ADMIN_PASSWORD`. Remove credentials from env values that are URLs with `user:pass@`. An exported profile lists the names it dropped under `strippedEnv` so an importer knows what to re-enter. The export stays `version: 1`; `strippedEnv` is optional and older importers ignore it. |
| Hub secret descriptions | `secrets.ts:24-32` say "only when this instance runs as a node" | "Needed when this Mac joins a hub, and on a hub or standalone server that hands out device leases." |
| `LaunchBuilder.ts:35-41` comment | Says the `authDisabled` plugin arg is a no-op | Correct the comment (fixed in the plugin by #225). Behaviour unchanged. |
| `isPluginInstalled` | Regex `/xenon/i` over `plugin list` (`ToolchainInspector.ts:245`) | Match the package name `@xenon-device-management/xenon`, as `SetupService.installedPluginName` does. |
| Appium version check | Any major ≥ 3 passes (`ToolchainInspector.ts:79`) | Requires ≥ 3.1.1 (the plugin's peer range). Below → blocking, "Xenon needs Appium 3.1.1 or newer." |

**Tests.** Unit tests for each row: retired keys absent from fields and
config; the WDA rule removed from `checkAll`; the hub validation cases; the
export-stripping cases, including the URL credential case; the package-name
match; the Appium version boundary (3.1.0 blocks, 3.1.1 passes).

## A6 — A Start button you can trust

**Problem.**
- Preflight state is set only by Start and Setup (`App.tsx:305-354`), isn't
  per profile, and isn't re-run by Health's Re-check. After one failure,
  Start stays disabled everywhere, even once fixed.
- The disabled tooltip always says "Resolve preflight blockers first", even
  when the cause is a validation issue.
- ⌘⏎ and the Logs "Start server" call `handleStart` without the validation
  gate.
- Start errors are `console.error`'d and nothing shows
  (`App.tsx:323-326`). Setup's result is ignored. Importing 0 profiles says
  nothing. "A server is already running" is thrown and swallowed.

**Design.**
- **One readiness source.** A `useReadiness(profile)` hook owns preflight
  per profile id. It re-runs, debounced at 400 ms, on:
  - profile change and port/Appium-folder edits,
  - window focus,
  - setup finishing,
  - Health's Re-check,
  - the server going from active to stopped.

  It returns `{ ready, reason, blockers, checking }`.
- **One start path.** `requestStart()` is the only way to start. The button,
  ⌘⏎, the menu, the tray and the Logs link all call it. It checks, in order:
  1. Already running → do nothing.
  2. Validation issues → don't start, go to Settings, focus the first invalid
     field.
  3. Readiness blockers → don't start, go to Health.
  4. Otherwise start.
- **Say why.** When Start is disabled, the status bar shows the reason next to
  it in plain text, and the tooltip carries the same text:
  - "Fix 1 setting first: Port" (validation).
  - "Port 4723 is already in use by another app" or "Run Set up on the Health
    tab first" (first blocker; wording in `ToolchainInspector` preflight
    messages, rewritten without "APPIUM_HOME").
  - "Checking…" while readiness runs.
- **Nothing silent.**
  - A start failure → error toast with the message, and the status bar shows
    it until the next start.
  - Setup finish → toast (A3).
  - Import of 0 profiles, or of files that couldn't be read → error toast
    "No profiles found in <file>" / "Couldn't read <n> files".
  - The `error` toast kind gets an icon and stays until dismissed.

**Tests.**
- Unit: `useReadiness` re-runs on each trigger and keys results by profile;
  a stale result for a previous profile is discarded.
- Unit: `requestStart` order of checks.
- E2E (existing Playwright suite): with an invalid port, Start is disabled
  with "Fix 1 setting first: Port". ⌘⏎ doesn't start and focuses the port
  field. Fixing the port enables Start without pressing anything else.
- E2E: a port taken by a test listener disables Start with "Port 4799 is
  already in use by another app…", and Start comes back on its own once the
  port is free. (With readiness gating Start, a start that throws can't be
  provoked in a test. The error-toast catch is checked in review.)

## A7 — Install where it says

**Problem.** With the Appium folder field blank ("auto"), the renderer passes
`undefined` and main installs into the app's own folder
(`index.ts:365`, `defaultAppiumHome()`). The header, preflight and launch use
the auto-detected folder (`resolveAppiumHome(profile)`), which may be
`~/.appium`. Setup then "succeeds" while Start still says the plugin is
missing.

**Design.**
- `setupInstall` takes the profile and installs into
  `resolveAppiumHome(profile)`, the same function the header, preflight,
  version probe and launch use.
- The "Set up" card names the folder in plain words: "Installs into the Appium
  folder this profile uses: ~/.appium." The path is shown with `~`.

**Tests.** Unit: the setup IPC resolves the folder through
`resolveAppiumHome` for blank, explicit and env-sourced profiles. Live: on a
profile with the field blank, Set up then Start works without editing the
field.

## A8 — Ship it

- **CI.** New `.github/workflows/mac-app.yml` on `pull_request` and `push` to
  `main` for paths `mac-app/**`, `schema.json`, `web/src/tokens.css`:
  `npm ci`, `sync-schema --check`, `sync-tokens --check`, `tsc --noEmit` for
  both tsconfigs, `vitest run`, `electron-vite build`. Runs on
  `ubuntu-latest`; packaging and the Playwright e2e stay local (they need
  macOS and a real toolchain).
- **Version.** `mac-app` 0.2.0. Behaviour changed (shutdown timing, readiness,
  launch contents), so not a patch.
- **Docs.**
  - `website/docs/xenon-control.md`: describe 0.2.0, the Database URL as a
    Keychain secret (already true in source), log redaction, the go-ios step,
    the clean stop, and the option list following the installed plugin.
  - `mac-app/README.md`: option count and the same points.
  - Root `CHANGELOG.md` lines that announce mac-app 0.1.4/0.1.5 as released:
    reword to say they ship in 0.2.0.
- **Release.** Build the DMG and zip as today (`npm run dist`). Publishing the
  GitHub release is done by the maintainer and is not automated by this work.

## Delivery

One branch and PR per item, in this order, each off the latest `origin/main`:

1. A1 log filters (smallest, highest risk reduced)
2. A2 clean shutdown
3. A7 install folder (A3 builds on the same IPC)
4. A3 iPhone setup
5. A4 installed option list
6. A5 retired and misleading settings (uses A4's schema plumbing for
   retired keys)
7. A6 Start button
8. A8 CI, docs, version 0.2.0

Every PR runs `npm test` and `npm run build` in `mac-app/`, and before merge
the change is checked live in the built app on this Mac (Android and, where
relevant, a real iPhone), with before/after evidence in the PR.

## Risks

- **Longer quit.** Quitting with a running server can now take up to 35 s.
  Mitigation: the window shows "Stopping — saving recordings and releasing
  phones…", and a second ⌘Q forces it.
- **Loading the installed plugin's go-ios pin with `require`.** It runs code
  from the installed plugin in the main process. The file is a small,
  dependency-free module from the plugin the user installed and the app
  launches anyway. If it throws or is missing, the check falls back to
  presence-only.
- **Installed-schema read.** An unusual install layout falls back to the
  bundled schema: the same behaviour as today, plus the visible line saying
  so.
- **Log filters cost.** Two regexes per log line. Appium applies them, not the
  app; the plugin docs recommend them for every deployment.
