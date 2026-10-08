# Xenon Control

A native macOS desktop app (Electron + React) that **gets a Mac ready for Xenon and starts the
Appium server with the Xenon plugin**: the piece the web dashboard deliberately leaves out. It is
built for the QA tester who wants to know "can I test now?", and keeps everything technical
behind one switch for the engineer who sets the Mac up. The user guide, with screenshots, is
[Xenon Control for Mac](../website/docs/xenon-control.md).

It owns the launch lifecycle and hands off to the existing dashboard once the server is up:

- **Four places in a sidebar** — Home, Setup, Settings and Logs (⌘1–⌘4), a profile switcher on
  top and the server's status with one Start/Stop button at the bottom. The Profiles sheet
  (rename, duplicate, delete, import, export) opens from the switcher or File → Manage Profiles….
- **Home** — answers "can I test now?" from the pure model `homeState`: first run, setting up,
  checking, can't start (with one quick fix from `quickFix`: use the next free port, Set up this
  Mac, fix the setting, how to install, see Setup), ready, starting, running (test address and
  colleagues' `<mac>.local` address with Copy, Open dashboard), stopping, stopped unexpectedly
  (the reason, the last problem line, and a jump to it in Logs), and another profile running.
- **Setup** — the toolchain checks (Node, Appium 3.1.1 or newer, Android tools, Xcode, Xenon,
  the drivers, iPhone support/go-ios) as plain sentences in three groups (`setupRows`), with a
  preflight gate that blocks a doomed launch. **Set up this Mac** installs the Xenon plugin and
  the platform drivers, and go-ios for iOS profiles, into the Appium folder the profile launches
  from, and shows its steps inline. Run it again after updating Xenon.
- **Settings** — **Essentials** (the everyday options in plain words, `essentials.ts`), **All
  settings** (every option of the effective schema with a hand-written label and help,
  `optionCatalog.ts`; unknown options of a newer Xenon fall back to Xenon's own text under
  "More") and **Keys & accounts** (every Keychain secret). The option list is the one of the
  Xenon installed in the profile's Appium folder (its own `schema.json`: 52 options in the current
  plugin), with the bundled snapshot as the fallback.
- **Logs** — Everything / Problems only (error and warning words, and Xenon's ❌ / ⚠️ marks), a
  search, times on every line, Copy and Save as… (the lines in view, with times; a saved file
  starts with a `Xenon Control log · <date> · <view> · N of M lines` header) and Clear. Main keeps
  a run's lines and the crash's quoted line, so a window opened after a crash still has them.
- **Show technical details** (⌥⌘T, stored per Mac) — raw option names and descriptions, the
  Settings → All settings → **Technical** group (base path, Appium folder, keep-alive,
  environment variables, launch preview, config export), versions, folders and commands on
  Setup, the app's own log lines and Open log folder, and Server → Preview Launch… (⌘P) and
  Export Config…. With it off, no main sentence carries an option key, environment name,
  command or path (an e2e no-jargon check enforces it).
- **Appearance** — System / Light / Dark (View → Appearance, stored per Mac). The palette is the
  dashboard's own tokens (`npm run sync:tokens`), WCAG 2.1 AA in both themes.
- **Secrets in the Keychain** — every secret is encrypted via Electron `safeStorage` and reaches
  the server as an environment variable at launch, never written to a file. See "Architecture".
- **Secrets kept out of logs** — every generated config carries Xenon's two `log-filters` rules, so
  tokens, passwords and `apiKey` values show as `**REDACTED**` in Logs and in the per-run log
  files.
- **Start says why it's off** — under the sidebar's Start and on Home, and readiness is re-checked
  by itself (profile switch, a changed port or Appium folder, window focus, Check again / Try
  again, after Set up or a stop).

### Enterprise features

- **Launch preview (dry-run)** — with technical details on: the exact `appium` command,
  `APPIUM_HOME`, env-var **names** (never values), and the fully-resolved config YAML before
  starting. Copy or save it.
- **Config validation** — schema-derived checks (numeric ranges, port 1–65535, base-path format,
  hub address) surface inline in plain words and **gate Start**. The hub must be an origin (no
  path, no `user:pass@`) and is written to the config as that plain origin.
- **Profile import/export** — share standardized launch configs across a lab as JSON. Secrets
  are never exported: only the *names* of secrets a profile injects. The export also leaves out
  env vars named like secrets (listed under `strippedEnv` so an importer knows what to re-enter),
  and cuts `user:pass@` from addresses. A notice after an export says how many values were left
  out (and names them with technical details on).
- **Config export** — write the generated Appium config YAML to a file for CI or audit.
- **Extra env vars** — per-profile arbitrary `KEY=VALUE` (e.g. `OTEL_*`), injected at launch, in
  All settings → Technical. One named like a secret (`DATABASE_URL`, `XENON_HUB_TOKEN`,
  `OPENAI_API_KEY`, …) is flagged and never exported, and one under the secret's own name is moved
  into the Keychain when profiles load, if that leaves the launch unchanged.
- **Per-run log files** — every launch is written to a timestamped file under the app's `logs/`
  folder; Logs → Open log folder and Technical → Open Appium folder open the folders.
- **Auto-update** — `electron-updater` wired for packaged builds (set a `publish` channel in
  `electron-builder.yml`).

### Config completeness (important)

Appium validates a `--config` file against the installed plugin's `schema.json` before it
applies defaults. Plugins up to 2.13.1 mark 23 args `required`, so they reject a config that
leaves one out; later plugins have no `required` list. The launcher reads the option list of
the plugin actually installed in `APPIUM_HOME` (`SchemaService.effectiveSchema`, falling back to
the bundled snapshot) and merges **schema defaults for the args that list marks `required`**
(`requiredDefaults` in `src/main/configDefaults.ts`) underneath the profile's settings, so a
generated config starts on any plugin version and any value the user changed still wins. A
plugin with no `required` list gets none, which leaves `XENON_JSON_LOGGING` in charge of JSON
logging. Settings the installed plugin doesn't list are left out of the config (Appium refuses
unknown plugin args); they stay in the profile, and the server log names them at start.

### Stopping and quitting

Xenon's own shutdown (archive recordings, release phones, reap go-ios/logcat helpers) takes up
to about 15 s, and SIGKILL skips it, so Stop is patient: SIGINT, then SIGTERM after 30 s, then
SIGKILL 5 s later (`ProcessSupervisor` + `stopEscalation.ts`). Home reads "Stopping — saving
recordings and releasing phones…", the sidebar "Stopping…", and the Stop items are disabled
meanwhile. ⌘Q with a server running does the same stop and quits once Xenon has exited (up to
~35 s; the window stays up, or reopens, so the state shows). A second ⌘Q forces it: SIGTERM,
SIGKILL after 2 s, and the app quits within about 5 s (`quitFlow.ts`).

## Architecture

Standard Electron three-layer split. All Node / child-process / secret logic lives in the
**main** process; the **renderer** is sandboxed React that talks to main only through a typed
`contextBridge` API in the preload script.

```
src/
  shared/        types, IPC channel names, secret descriptors, the log view rules (logView.ts),
                 the status words and preferences shared by main and renderer (no Node imports)
  main/          Electron main process
    index.ts             app lifecycle, window, Tray, IPC wiring
    menu.ts              the app menu and the menu-bar icon's menu (pure templates)
    copy.ts              main-process text that reaches the window
    ProcessSupervisor.ts spawn/stop the appium child, keep and stream its lines, detect ready/crash
    stopEscalation.ts    the SIGINT -> SIGTERM -> SIGKILL timing (STOP_GRACE_MS and friends)
    quitFlow.ts          what ⌘Q does while a server runs (wait, or force on a second press)
    LaunchBuilder.ts     profile -> argv + env + Appium config YAML (pure, unit-tested)
    proxyEnv.ts          HTTPS_PROXY / HTTP_PROXY from the proxy settings and the Keychain password
    logFilters.ts        the two log-filters rules every config carries (mirrors authentication.md)
    SchemaService.ts     option list: the installed Xenon's, else the bundled snapshot
    ProfileStore.ts      named profiles via electron-store
    profileSecrets.ts    moves secret values out of profiles and into the Keychain
    SecretsStore.ts      safeStorage-encrypted secrets (Keychain-backed)
    PreferencesStore.ts  per-Mac preferences: technical details, appearance
    LastRunStore.ts      how each profile's last run ended, for Home's footer
    shareAddresses.ts    the test and colleagues' addresses; nextFreePort.ts for "Use port N"
    ToolchainInspector.ts toolchain checks + port/plugin preflight
    SetupService.ts      Set up: plugin + drivers + go-ios into the profile's APPIUM_HOME
    env.ts               resolve the real shell PATH (GUI apps don't inherit it)
    paths.ts             app-managed filesystem locations
  preload/       typed, whitelisted IPC bridge
  renderer/src/  React + Tailwind UI
    App.tsx, AppShell.tsx   the sidebar and the four places
    screens/                Home, Setup, Logs, settings/ (Essentials, AllSettings,
                            KeysAndAccounts, Technical)
    sheets/Profiles.tsx     the Profiles sheet
    hooks/                  useServer, useProfiles, usePreferences, useEffectiveSchema, …
    copy/*.ts               every word the window shows, one catalog per screen
    components/ui/          the UI kit on Radix primitives; components/slots/ placeholder components that render nothing yet
    homeState.ts, quickFix.ts, setupRows.ts, essentials.ts, optionCatalog.ts, …
                            the pure models behind the screens (unit-tested)
resources/       schema.json snapshot (synced from ../schema.json at build; git-ignored)
```

The launcher passes **non-secret** settings via a generated Appium config YAML
(`server.plugin.xenon.*`) and **secrets** via the process environment, matching how Xenon
resolves config. No secret value is written to the generated config, the launch preview, a
config export or a profile export. The secrets are of two kinds:

- **App-wide** — the AI keys, the hub access key and token, the SMTP URL and the database URL:
  one value per Mac, injected as `XENON_*` / `DATABASE_URL` by each profile that names it in
  `secretRefs` ("Used by this profile").
- **Per profile** — the Cloud access key and the proxy password, each in a slot of its own for
  that profile (`CLOUD_KEY@<profile id>`, `PROXY_PASSWORD@<profile id>`). A duplicate copies the
  slots, a delete clears them, and the launch uses them whenever they are set. The cloud key is
  passed as `CLOUD_KEY` (with `cloud.username` as `CLOUD_USERNAME`) and `cloud.apiKey` is never
  written. A proxy with a password is passed as `HTTPS_PROXY` / `HTTP_PROXY` (with the loopback
  hosts added to `NO_PROXY`) in place of the `proxy` option; a proxy without one stays an option.
  A `cloud.apiKey` or `proxy.auth.password` an earlier version kept in a profile moves into the
  profile's slot when profiles load. While the Keychain is unavailable it stays in the profile,
  and the launch doesn't pass it; a new value is never saved anywhere but the Keychain.

All settings shows the secret-bearing settings (the AI keys, Database URL) as pointers to Keys &
accounts (`SECRET_SETTINGS` in `src/shared/secrets.ts`); a profile saved by an older version that
carries one has it moved into the Keychain (`src/main/profileSecrets.ts`).

Known limitations (from the installed Xenon 2.17.0, not this app): with a proxy password set,
Xenon's webhooks and the Chrome driver download also go through the proxy unless `NO_PROXY` names
the host, and Xenon cuts a proxy password at its first `:` (Keys & accounts warns about it).

## Develop

```bash
cd mac-app
npm install          # also rebuilds native deps for Electron
npm run dev          # syncs schema.json and the tokens, starts electron-vite dev
npm run typecheck    # tsc for main + renderer
npm test             # vitest unit tests (launch builder, home/setup/settings models, readiness, stop timing, …)
npm run test:e2e     # Playwright drives the REAL built app (out/) end-to-end; see Tests and CI (below)
npm run build        # production build into out/
npm run dist         # build + package a signed/notarized DMG (needs Apple creds)
```

The form and the launch use the option list of the Xenon installed in the profile's Appium
folder (read from its `package.json` `appium.schema`); with technical details on, All settings
says which Xenon that is. The bundled snapshot is the fallback when Xenon isn't installed or its
list can't be read. `schema.json` is copied from the repo root at build time (`npm run
sync:schema`; `npm run sync:schema:check` fails if the copy is stale). The copy under
`resources/` is git-ignored, so every build and `dist` refreshes it and CI has no committed copy
to compare. The palette in `src/renderer/src/tokens.css` is generated from the dashboard's
`web/src/tokens.css` (`npm run sync:tokens`; `npm run sync:tokens:check` fails on a drift) and is
committed. Every word the window shows lives in `src/renderer/src/copy/*.ts` (and
`src/main/copy.ts` for main-process text).

### Tests and CI

- **Unit tests** (`npm test`) run anywhere. Some read files outside `mac-app/` (`../schema.json`,
  `../website/docs/authentication.md`), so run them from a full checkout.
- **The e2e suite** (`npm run test:e2e`) launches the real built app with a throwaway user-data
  folder, a throwaway `HOME` (whose shell files export the run's own `PATH` and Android SDK) and
  Chromium's mock Keychain, so it never touches your profiles, Keychain or `~/.appium`. A guard
  fails the run if the app ever resolves an Appium folder under your real `~/.appium`. It needs
  Node and Appium 3.1.1 or newer on `PATH`. The tests that start a real server or need Xenon
  installed use a **sandbox Appium folder** you name in `XENON_E2E_APPIUM_HOME`; without one they
  are skipped and say so, and the rest still run. Prepare a sandbox once, outside `~/.appium`:

  ```bash
  export XENON_E2E_APPIUM_HOME=/tmp/xenon-e2e-appium-home
  APPIUM_HOME=$XENON_E2E_APPIUM_HOME appium plugin install --source=npm @xenon-device-management/xenon
  adb start-server     # before every run: see below
  XENON_E2E_APPIUM_HOME=$XENON_E2E_APPIUM_HOME npm run test:e2e
  ```

  **Start adb first** (`adb start-server`). The app's checks run `adb`, and with no adb server
  running, the first one would start it under the run's throwaway `HOME`, where it outlives the
  run. It needs no drivers: the tests assert the app's behaviour, not which drivers this Mac has
  (where a screen needs them, a test stands in for the drivers check). A Xenon server already
  listening on :4723 is fine: the tests that start one use a free port. On a busy Mac, run one
  file at a time after `npm run build`, for example
  `XENON_E2E_APPIUM_HOME=$XENON_E2E_APPIUM_HOME npx playwright test test/e2e/home.e2e.spec.ts`
  (the files are `app.e2e`, `home.e2e` and `keychain.e2e`).
- **CI** (`.github/workflows/mac-app.yml`, on changes under `mac-app/`, `schema.json`,
  `web/src/tokens.css` and `website/docs/authentication.md`) runs on Ubuntu with Node 22:
  `npm ci --ignore-scripts`, `npm run sync:tokens:check`, `npm run typecheck`, `npm test` and
  `npx electron-vite build`. Packaging and the e2e run stay local.

### Packaging & signing

`electron-builder.yml` targets a hardened-runtime DMG + zip. Code-signing/notarization is
picked up from the environment (`CSC_LINK`/`CSC_KEY_PASSWORD` for the certificate;
`APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` for notarization). The entitlements
in `build/entitlements.mac.plist` allow spawning the Appium child process and Keychain access.

The app icon is generated from `build/icon.svg` by `npm run icon` (renders via the Electron
we already depend on, then compiles `.icns` with macOS's own `sips`/`iconutil`). Re-run it
after editing the SVG and commit the regenerated `icon.png` / `icon.icns`.

> **Careful — electron-builder auto-discovers a signing identity.** If the only certificate in
> your keychain is an *Apple Development* one, it will happily sign a "release" build with it.
> That certificate is for local development, not distribution: Gatekeeper rejects it on other
> machines just as it would an unsigned app. For a build other people install, either sign with
> a **Developer ID Application** certificate and notarize (see Install below), or build
> deliberately unsigned with `CSC_IDENTITY_AUTO_DISCOVERY=false`.

## Install

### Locally, on your own machine

```bash
cd mac-app
./scripts/install-local.sh     # builds, copies to /Applications, clears quarantine
```

Or by hand:

```bash
npx electron-builder --mac --dir           # just the .app, no dmg — fastest
cp -R "dist/mac-arm64/Xenon Control.app" /Applications/
```

### Giving it to someone else

An app that hasn't been **notarized** by Apple gets stopped on arrival. Anything that travels
through a browser, AirDrop, Slack or a zip picks up a `com.apple.quarantine` flag, and macOS
refuses to open it — *"Xenon Control is damaged and can't be opened"* or *"cannot be opened
because the developer cannot be verified"*. The app isn't damaged; that is Gatekeeper doing its
job on an app Apple has never seen.

Drag the app to `/Applications`, then run this once — first launch only:

```bash
xattr -cr "/Applications/Xenon Control.app"
open -a "Xenon Control"
```

After that it opens by double-click like any other app; the flag is only applied on arrival.
(`-cr` clears every extended attribute; `xattr -dr com.apple.quarantine "/Applications/Xenon
Control.app"` removes just the quarantine one if you'd rather be surgical. Both leave the code
signature valid — verified on this bundle with `codesign --verify --deep --strict`.)

**Understand what that does.** It removes the marker that tells macOS this bundle came from
somewhere else, so Gatekeeper skips its checks entirely — signature, notarization, the lot. It
is not a formality: it is the user vouching for the app *instead of* Apple. That is a reasonable
trade for a build your own team produced and can trace, and it is the standard workflow for
internal tools. It is not something to paste into a chat for a binary whose origin nobody can
account for — the check being skipped is the one that would have caught a tampered bundle.

### The fix that means nobody needs `xattr`

Notarize. Set the credentials and build — `electron-builder.yml` already reads them:

```bash
export CSC_LINK=/path/to/DeveloperID.p12      # Developer ID Application certificate
export CSC_KEY_PASSWORD=...
export APPLE_ID=you@example.com
export APPLE_APP_SPECIFIC_PASSWORD=abcd-efgh-ijkl-mnop
export APPLE_TEAM_ID=XXXXXXXXXX
npm run dist
```

Apple staples the ticket to the DMG, Gatekeeper is satisfied on first launch, and installing is
a drag-and-drop with no terminal step for anyone. This needs a paid Apple Developer account and
a Developer ID certificate — an *Apple Development* certificate will not do.

## What it intentionally does NOT do

Runtime device/session/user/analytics management stays in the web dashboard at `/xenon/`.
This app links out to it once the server is running.
