# Xenon Control

A native macOS desktop app (Electron + React) that **configures and launches** the Appium
server with the Xenon plugin — the piece the web dashboard deliberately leaves out.

It owns the launch lifecycle and hands off to the existing dashboard once the server is up:

- **Start / stop** the Appium process (`appium server --config <generated file>`), with live log streaming. Stop and
  quit give Xenon time to finish its shutdown (see "Stopping and quitting" below).
- **Auto-generated settings form** built from the option list of the Xenon installed in the
  profile's Appium folder (its own `schema.json`: 52 options in the current plugin, with types,
  enums, defaults, and descriptions). The bundled snapshot is the fallback, and the Settings tab
  says which list it shows.
- **Saved launch profiles** — a library of named configs (e.g. "Local Android", "Hub").
- **Secrets in the Keychain** — AI keys, hub token, DB URL, SMTP, encrypted via Electron
  `safeStorage` and injected as environment variables at launch (never written to disk). The Cloud
  API key and the proxy password are the exceptions for now: see "Architecture" below.
- **Secrets kept out of logs** — every generated config carries Xenon's two `log-filters` rules, so
  tokens, passwords and `apiKey` values show as `**REDACTED**` in the Logs tab and in the per-run
  log files.
- **Toolchain health checks** — Node, Appium (3.1.1 or newer), drivers, adb/`ANDROID_HOME`,
  Xcode, iPhone support (go-ios) — with a preflight gate that blocks a doomed launch.
- **Set up** — install the Xenon plugin + platform drivers, and go-ios for iOS profiles, into the
  Appium folder the profile launches from. Run it again after updating Xenon.
- **Start says why it's off** — the status bar and the Health tab give the reason, and readiness
  is re-checked by itself (profile switch, a changed port or Appium folder, window focus, Re-check,
  after Set up or a stop).

### Enterprise features

- **Launch preview (dry-run)** — see the exact `appium` command, `APPIUM_HOME`, env-var
  **names** (never values), and the fully-resolved config YAML before starting. Copy or save it.
- **Config validation** — schema-derived checks (numeric ranges like `maxConcurrentRecordings`
  1–16, port 1–65535, base-path format, hub address) surface inline and **gate Start**. The hub must
  be an origin (no path, no `user:pass@`) and is written to the config as that plain origin.
- **Profile import/export** — share standardized launch configs across a lab as JSON. Secrets
  are never exported: only the *names* of secrets a profile injects. The export also leaves out
  `cloud.apiKey`, `proxy.auth.password` and env vars named like secrets (listed under
  `strippedEnv` so an importer knows what to re-enter), and cuts `user:pass@` from addresses.
- **Config export** — write the generated Appium config YAML to a file for CI or audit.
- **Extra env vars** — per-profile arbitrary `KEY=VALUE` (e.g. `OTEL_*`), injected at launch.
  One named like a secret (`DATABASE_URL`, `XENON_HUB_TOKEN`, `OPENAI_API_KEY`, …) is flagged and
  never exported, and one under the secret's own name is moved into the Keychain when profiles
  load, if that leaves the launch unchanged.
- **Per-run log files** — every launch is written to a timestamped file under the app's
  `logs/` folder; one-click "Open logs / APPIUM_HOME" from the header.
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
SIGKILL 5 s later (`ProcessSupervisor` + `stopEscalation.ts`). The status bar reads "Stopping —
saving recordings and releasing phones…" and the Stop items are disabled meanwhile. ⌘Q with a
server running does the same stop and quits once Xenon has exited (up to ~35 s; the window stays
up, or reopens, so the state shows). A second ⌘Q forces it: SIGTERM, SIGKILL after 2 s, and the
app quits within about 5 s (`quitFlow.ts`).

## Architecture

Standard Electron three-layer split. All Node / child-process / secret logic lives in the
**main** process; the **renderer** is sandboxed React that talks to main only through a typed
`contextBridge` API in the preload script.

```
src/
  shared/        types + IPC channel names + secret descriptors (no Node imports)
  main/          Electron main process
    index.ts             app lifecycle, window, Tray, IPC wiring
    ProcessSupervisor.ts spawn/stop the appium child, stream logs, detect ready/crash
    stopEscalation.ts    the SIGINT -> SIGTERM -> SIGKILL timing (STOP_GRACE_MS and friends)
    quitFlow.ts          what ⌘Q does while a server runs (wait, or force on a second press)
    LaunchBuilder.ts     profile -> argv + env + Appium config YAML (pure, unit-tested)
    logFilters.ts        the two log-filters rules every config carries (mirrors authentication.md)
    SchemaService.ts     option list: the installed Xenon's, else the bundled snapshot
    ProfileStore.ts      named profiles via electron-store
    SecretsStore.ts      safeStorage-encrypted secrets (Keychain-backed)
    ToolchainInspector.ts toolchain checks + port/plugin preflight
    SetupService.ts      Set up: plugin + drivers + go-ios into the profile's APPIUM_HOME
    env.ts               resolve the real shell PATH (GUI apps don't inherit it)
    paths.ts             app-managed filesystem locations
  preload/       typed, whitelisted IPC bridge
  renderer/      React + Tailwind UI (SettingsForm, SecretsPanel, HealthPanel, LogConsole, …)
resources/       schema.json snapshot (synced from ../schema.json at build; git-ignored)
```

The launcher passes **non-secret** settings via a generated Appium config YAML
(`server.plugin.xenon.*`) and **secrets** via the process environment (`XENON_*`,
`DATABASE_URL`), matching how Xenon resolves config. Settings kept in the Keychain stay out of the
file. The exceptions for now are the Cloud API key (`cloud.apiKey`) and the proxy password
(`proxy.auth.password`): they are ordinary settings, so they are written to the generated config in
plain text. They move to the Keychain in a later release. The log rules hide values named `apiKey`
or `password`. A profile export leaves both out; the generated config, as Preview shows it and
**Save config…** writes it, still contains them.
The Settings form shows the secret-bearing settings (the AI keys, Database URL) as pointers to
Secrets & Env (`SECRET_SETTINGS` in `src/shared/secrets.ts`); a profile saved by an older
version that carries one has it moved into the Keychain (`src/main/profileSecrets.ts`).

## Develop

```bash
cd mac-app
npm install          # also rebuilds native deps for Electron
npm run dev          # syncs schema.json, starts electron-vite dev
npm run typecheck    # tsc for main + renderer
npm test             # vitest unit tests (launch builder, schema->form model, readiness, stop timing, …)
npm run test:e2e     # Playwright drives the REAL built app (out/) end-to-end; needs a ready Mac (below)
npm run build        # production build into out/
npm run dist         # build + package a signed/notarized DMG (needs Apple creds)
```

The form and the launch use the option list of the Xenon installed in the profile's Appium
folder (read from its `package.json` `appium.schema`); the Settings tab says which Xenon that
is. The bundled snapshot is the fallback when Xenon isn't installed or its list can't be read.
`schema.json` is copied from the repo root at build time (`npm run sync:schema`; `npm run
sync:schema:check` fails if the copy is stale). The copy under `resources/` is git-ignored, so
every build and `dist` refreshes it and CI has no committed copy to compare.

### Tests and CI

- **Unit tests** (`npm test`) run anywhere. Some read files outside `mac-app/` (`../schema.json`,
  `../website/docs/authentication.md`), so run them from a full checkout.
- **The e2e suite** (`npm run test:e2e`) launches the real built app against an isolated user-data
  folder. It needs a Mac with Node and Appium 3.1.1 or newer installed and Xenon installed in the
  Appium folder the app auto-detects: the assertions that expect Start to be enabled depend on the
  live readiness check, which reads the real toolchain, and fail on a Mac without it. A Xenon
  server already listening on :4723 is fine: the tests that need Start switch to a free port.
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
