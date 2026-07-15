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

## What it intentionally does NOT do

Runtime device/session/user/analytics management stays in the web dashboard at `/xenon/`.
This app links out to it once the server is running.
