# Xenon Control

A native macOS desktop app (Electron + React) that **configures and launches** the Appium
server with the Xenon plugin — the piece the web dashboard deliberately leaves out.

It owns the launch lifecycle and hands off to the existing dashboard once the server is up:

- **Start / stop** the `appium --use-plugins=xenon` process, with live log streaming.
- **Auto-generated settings form** built from the plugin's own `schema.json` (~48 options,
  with types, enums, defaults, and descriptions) — always in sync with the plugin.
- **Saved launch profiles** — a library of named configs (e.g. "Local Android", "Hub").
- **Secrets in the Keychain** — AI keys, hub token, DB URL, SMTP, encrypted via Electron
  `safeStorage` and injected as environment variables at launch (never written to disk).
- **Toolchain health checks** — Node, Appium, drivers, adb/`ANDROID_HOME`, Xcode, go-ios —
  with a preflight gate that blocks a doomed launch.
- **First-run setup** — install the Xenon plugin + platform drivers into `APPIUM_HOME`.

### Enterprise features

- **Launch preview (dry-run)** — see the exact `appium` command, `APPIUM_HOME`, env-var
  **names** (never values), and the fully-resolved config YAML before starting. Copy or save it.
- **Config validation** — schema-derived checks (numeric ranges like `maxConcurrentRecordings`
  1–16, port 1–65535, base-path format, hub URL) surface inline and **gate Start**.
- **Profile import/export** — share standardized launch configs across a lab as JSON
  (secrets are never exported — only the *names* of secrets a profile injects).
- **Config export** — write the generated Appium config YAML to a file for CI or audit.
- **Extra env vars** — per-profile arbitrary `KEY=VALUE` (e.g. `OTEL_*`), injected at launch.
- **Per-run log files** — every launch is written to a timestamped file under the app's
  `logs/` folder; one-click "Open logs / APPIUM_HOME" from the header.
- **Auto-update** — `electron-updater` wired for packaged builds (set a `publish` channel in
  `electron-builder.yml`).

### Config completeness (important)

Appium validates a `--config` file against `schema.json`'s full `required` list, so a partial
config is rejected at startup. LaunchBuilder therefore merges **schema defaults for all
required keys** underneath the profile's settings — every generated config is complete and
reproducible, and any value the user changed still wins.

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
    LaunchBuilder.ts     profile -> argv + env + Appium config YAML (pure, unit-tested)
    SchemaService.ts     load bundled schema.json snapshot
    ProfileStore.ts      named profiles via electron-store
    SecretsStore.ts      safeStorage-encrypted secrets (Keychain-backed)
    ToolchainInspector.ts toolchain checks + port/plugin preflight
    SetupService.ts      install plugin + drivers into APPIUM_HOME
    env.ts               resolve the real shell PATH (GUI apps don't inherit it)
    paths.ts             app-managed filesystem locations
  preload/       typed, whitelisted IPC bridge
  renderer/      React + Tailwind UI (SettingsForm, SecretsPanel, HealthPanel, LogConsole, …)
resources/       schema.json snapshot (synced from ../schema.json at build; git-ignored)
```

The launcher passes **non-secret** settings via a generated Appium config YAML
(`server.plugin.xenon.*`) and **secrets** via the process environment (`XENON_*`), matching
how Xenon resolves config. Nothing sensitive lands in a plaintext file.

## Develop

```bash
cd mac-app
npm install          # also rebuilds native deps for Electron
npm run dev          # syncs schema.json, starts electron-vite dev
npm run typecheck    # tsc for main + renderer
npm test             # vitest unit tests (LaunchBuilder + schema->form model)
npm run test:e2e     # Playwright drives the REAL built app (out/) end-to-end
npm run build        # production build into out/
npm run dist         # build + package a signed/notarized DMG (needs Apple creds)
```

`schema.json` is copied from the repo root at build time (`npm run sync:schema`) so the form
always matches the installed plugin. The copy under `resources/` is git-ignored.

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

The recipient can clear the flag:

```bash
xattr -dr com.apple.quarantine "/Applications/Xenon Control.app"
open -a "Xenon Control"
```

**Understand what that does.** It removes the marker that tells macOS this bundle came from
somewhere else, so Gatekeeper skips its checks entirely — signature, notarization, the lot. It
is not a formality: it is the user vouching for the app *instead of* Apple. That is a reasonable
trade for a build your own team produced and can trace, and it is the standard workflow for
internal tools. It is not something to paste into a chat for a binary whose origin nobody can
account for — the check being skipped is the one that would have caught a tampered bundle.

Prefer `-d com.apple.quarantine` over `xattr -cr`: it drops the one attribute rather than
stripping every extended attribute on the bundle.

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
