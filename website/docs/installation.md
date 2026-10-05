---
title: Installation and requirements
description: What Xenon needs, how to install it from npm or from source, where it keeps its data, and how to check it works.
---

This page lists what Xenon needs, installs it from npm or from source, and shows how to check that it works. To get a first test running quickly, use the [Quick start](./quick-start.mdx).

## Requirements

| Component | Needed |
|---|---|
| **Node.js** | 20.19 or later in the 20 line, 22.12 or later in the 22 line, or 24 and later. This is Appium 3's own range. |
| **Appium** | 3.1.1 or later in the 3 line (`npm i -g appium`). Appium 3 also needs npm 10 or later. |
| **Android** | The Android SDK with platform tools (`adb`), with `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) set to its folder, and the UiAutomator2 driver. |
| **iOS** | A Mac with Xcode, the XCUITest driver and, for real iPhones, go-ios (see [iPhones and go-ios](#iphones-and-go-ios)). |
| **Database** | SQLite, built in. |
| **Recording** | ffmpeg, which comes with Xenon. |
| **Optional** | An AI provider key (Gemini, OpenAI, Anthropic or a local Ollama) for the AI features, such as the AI healing tiers. `ideviceinstaller` and `ideviceinfo` from libimobiledevice, for installing apps on iPhones and showing their battery level. |

To check your Android or iOS setup against the driver's own requirements, run `appium driver doctor uiautomator2` or `appium driver doctor xcuitest`. It runs the checks the driver provides.

### Android needs `ANDROID_HOME`

Xenon finds `adb` through `ANDROID_HOME` or `ANDROID_SDK_ROOT`, and both the folder and the variable must exist when Appium starts. Without them the log says `Neither ANDROID_HOME nor ANDROID_SDK_ROOT environment variable was exported`, and Xenon finds no Android devices. On a Mac with Android Studio the SDK is usually in `~/Library/Android/sdk`:

```bash
export ANDROID_HOME=~/Library/Android/sdk
```

### What comes with Xenon

Installing the plugin brings its own ffmpeg, so you don't install one. Session video and the recordings from the dashboard use it. Xenon also adds its folder to the end of the `PATH` it runs with, and the video clip in a bug report uses the first ffmpeg on that `PATH`: yours, if you have one installed, and otherwise Xenon's.

### iPhones and go-ios

For real iPhones, Xenon runs its own copy of go-ios, version 1.2.1, from `~/.cache/xenon/goIOS/ios`. A go-ios on your `PATH` is not used. Xenon uses it to start WebDriverAgent on the iPhone, for the live preview and recordings, and for the iPhone's logs and CPU charts. Before it hands an iPhone to a session, Xenon checks that WebDriverAgent answers, and starts it through go-ios when it doesn't. The plugin includes the script that downloads that version from go-ios's GitHub releases, but neither installing the plugin nor starting the server runs it. On a machine with iPhones, run it once:

```bash
node "${APPIUM_HOME:-$HOME/.appium}/node_modules/@xenon-device-management/xenon/lib/src/scripts/install-go-ios.js"
```

It puts go-ios in that folder and records the version in `.go-ios-version`. Run it again after upgrading Xenon: it replaces an older copy with the version Xenon expects. Without it, an iPhone's live preview can't start and the log says `go-ios binary not found`. A session that asks for that iPhone is refused too, with an error saying the phone is unhealthy, because Xenon can't start WebDriverAgent on it.

## Install from npm

```bash
appium plugin install --source=npm @xenon-device-management/xenon
appium driver install uiautomator2      # Android
appium driver install xcuitest          # iOS (macOS only)
```

Appium keeps plugins and drivers in its home folder, `~/.appium` unless `APPIUM_HOME` says otherwise. The plugin goes into `node_modules/@xenon-device-management/xenon` inside it. The plugin and its dependencies take several hundred MB on disk.

## Start Xenon

The quick way is flags. Every option has one, `--plugin-xenon-` followed by its name in kebab-case, so `maxSessions` becomes `--plugin-xenon-max-sessions`:

```bash
appium server --use-plugins=xenon \
  --plugin-xenon-platform=both \
  --plugin-xenon-enable-dashboard
```

For anything beyond a quick try, keep the options in an Appium config file and start with it:

```bash
appium server --config xenon.yaml
```

[Configuration](./configuration.md) has a complete config file to start from, and every option with its flag and default. Keep credentials such as AI keys in environment variables, not in a config file; [Environment variables](./environment-variables.md) lists them. For a lab others share, see [Production deployment](./deployment.md).

## Where Xenon keeps its data

Xenon keeps its data under `~/.cache/xenon`, including:

| Path | Holds |
|---|---|
| `xenon.db` | The database: users, devices, sessions, builds and settings. |
| `assets/` | Session video and screenshots, and the recordings made from the dashboard. |
| `apps/` | Apps uploaded to the app library. |
| `xenon-jwt-private.pem` | The key Xenon signs tokens and stream tickets with. |
| `goIOS/` | The go-ios copy described above. |

Back up `xenon.db` and `xenon-jwt-private.pem` before an upgrade. [Data retention](./retention.md) explains how long builds, videos and screenshots are kept.

## The database

Xenon stores its data in SQLite, which needs no setup: Xenon creates `~/.cache/xenon/xenon.db` on its first start. To keep the database somewhere else, set `DATABASE_URL`, or the `--plugin-xenon-database-url` flag, to a `file:` address such as `file:/data/xenon/xenon.db`. A `postgresql://` URL stops the server at startup, with a message that says what to set. Leave `databaseProvider` unset, which means `sqlite`. Set to `postgresql`, it logs a warning that it has no effect, but it changes how Xenon updates the tables at startup, and a database made with the default setting then stops the server: see [The server doesn't start](./troubleshooting.md#the-server-doesnt-start).

Each time it starts, Xenon brings the database's tables up to date, and the log says `Syncing database schema (sqlite, db push)` and then `Database schema in sync`. You don't run migrations by hand. If your pipeline applies them instead, set `XENON_AUTO_MIGRATE=false`; [Upgrading](./upgrading.md) shows how. A hub and each of its nodes have their own database.

## Install from source

To work on Xenon itself, build it from a clone:

```bash
git clone https://github.com/Rabindra184/xenon.git
cd xenon
npm install
npm run build:all    # builds the plugin and the dashboard
npm run dev          # migrates the database, builds, installs the plugin and starts Appium
```

`npm run dev` builds the plugin only. The dashboard comes from `npm run build:all`, which a fresh clone needs first. Three things about the dev server differ from the Quick start:

- It uses `APPIUM_HOME=/tmp/xenon-home`, so install the drivers there too: `APPIUM_HOME=/tmp/xenon-home npx appium driver install uiautomator2`.
- It starts Appium with base path `/wd/hub`, so tests connect to `http://localhost:4723/wd/hub`.
- It migrates and uses the default database, `~/.cache/xenon/xenon.db`, the same one an installed Xenon on that machine uses.

`npm run server` starts Appium again without rebuilding. `npm run test:all` runs the unit tests.

## Check that it works

1. List the plugin: `appium plugin list --installed` shows `xenon`, with its version.
2. Start the server. The log names Xenon's address, `Xenon will be served at http://...:4723/xenon`, and Appium lists `xenon` under `Available plugins` as `ACTIVE`.
3. Open `http://localhost:4723/xenon/`. You should see the sign-in page. Sign in as described in the [Quick start](./quick-start.mdx#3-open-the-dashboard-and-sign-in), and the **Devices** page lists the phones, emulators and simulators Xenon found.
4. Ask the server for its Appium base path, which needs no login: `curl http://localhost:4723/xenon/api/webdriver` answers `{"basePath":""}` when Appium has no base path set.

If a device is missing, check the platform: `--plugin-xenon-platform` is `ios`, `android` or `both`. For Android, check `ANDROID_HOME` as described above. [Troubleshooting](./troubleshooting.md) covers more.

## Related

- [Quick start](./quick-start.mdx)
- [Xenon Control for Mac](./xenon-control.md): configures and starts the server for you.
- [Upgrading](./upgrading.md)
- [Configuration](./configuration.md)
