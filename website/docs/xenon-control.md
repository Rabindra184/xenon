---
title: Xenon Control for Mac
description: A Mac app that configures and starts Appium with Xenon, with saved launch profiles, encrypted secrets and toolchain checks.
---

Xenon Control is a Mac app that configures and starts the Appium server with Xenon, so you don't write flags or a config file by hand. Once the server is up it hands off to the dashboard, which stays the place for devices, sessions, users and everything else you do while the lab runs.

## What it does

- **Starts and stops** the Appium server with Xenon, and streams its log live.
- **Builds the settings form from Xenon's own option list.** The form groups the options into sections, with each one's type, allowed values, default and description. The list is a copy that comes with the app, so an option added to the plugin after the app was built isn't in the form.
- **Saves launch profiles**, named sets of settings such as "Local Android" or "Hub". Profiles export to and import from JSON, so a lab can share a standard one. A profile names the secrets it uses, and an export carries none of their values. An export does carry the profile's settings and its extra environment variables as they are, so keep secrets out of both.
- **Keeps secrets encrypted.** On the **Secrets & Env** tab, AI keys, a node's hub access key and token, the database URL and the SMTP URL are stored encrypted, with the key held in the macOS Keychain, and handed to the server as environment variables at launch by each profile that ticks **inject in this profile** for them. They are never written into the config file the app generates. The **Settings** tab shows the AI keys as pointers to these secrets. Its **Database URL** field is different: it is saved in the profile as plain text and left out of the launch, so the server never gets it. Set the database URL on **Secrets & Env** instead. The extra environment variables on that tab are saved in the profile as plain text, not encrypted.
- **Checks the toolchain**: Node.js, Appium, the drivers, the Android SDK, Xcode and go-ios. A missing or too old Node.js or Appium, a port already in use, or a plugin that isn't installed blocks **Start**, and the **Health** tab says how to fix it.
- **Sets Xenon up the first time**: one button installs the Xenon plugin and the Android and iOS drivers.
- **Previews a launch.** Before you start, it shows the exact `appium` command, the `APPIUM_HOME` it uses, the names of the environment variables it sets (never their values) and the config file it generated. You can copy or save the file.
- **Validates settings.** The port must be a number from 1 to 65535, the base path must start with `/`, a hub must be an http or https URL, and numeric options must stay inside their allowed range. Problems show inline, and **Start** stays off until they are fixed.
- **Writes a log file for every launch**, with a timestamp, in the app's logs folder. **Log Folder** in the header opens it.

## What you need

- A Mac with Apple silicon. The releases are built for it.
- Node.js and Appium 3 installed on the Mac. Xenon Control doesn't install them; its **Health** tab checks them, and **Start** won't run without them. Because an app opened from Finder doesn't get your shell's `PATH`, it asks your login shell for `PATH`, `ANDROID_HOME` and `APPIUM_HOME`, and also looks in the usual places for Homebrew, nvm, Volta and asdf, and in `~/Library/Android/sdk`.
- Whatever your devices need: the Android SDK for Android, Xcode for iOS. For iPhones, also go-ios as [Installation and requirements](./installation.md#iphones-and-go-ios) describes.

## Download and install

1. Download the `.dmg` from [the latest release](https://github.com/Rabindra184/xenon/releases/latest). The release also has a `.zip` of the app.
2. Open it and drag **Xenon Control** to **Applications**.

### The first launch

The release builds aren't notarized by Apple. Anything downloaded through a browser, AirDrop or Slack carries a quarantine flag, and macOS then refuses to open an app Apple hasn't seen: it says *"Xenon Control is damaged and can't be opened"* or *"cannot be opened because the developer cannot be verified"*. The app isn't damaged. Once, after copying it to **Applications**, run:

```bash
xattr -cr "/Applications/Xenon Control.app"
open -a "Xenon Control"
```

After that it opens with a double-click like any other app.

:::warning
The command removes the marker that tells macOS the app came from somewhere else, so macOS skips its signature and notarization checks for it. You are vouching for the app in Apple's place. Do it only for a build you downloaded from this project's releases page.
:::

`xattr -dr com.apple.quarantine "/Applications/Xenon Control.app"` removes just the quarantine flag if you prefer to change less.

## Set up and start the server

1. **Open the app.** The first time, it creates a profile called **Local server**: platform `both`, the dashboard on, 8 concurrent sessions, port 4723 and base path `/wd/hub`. New profiles also turn on the faster H.264 live preview for Android and discover only iOS simulators that are already booted.
2. **Open the Health tab.** It lists the toolchain checks. Under **First-run setup**, **Install plugin + drivers** installs the Xenon plugin and the UiAutomator2 and XCUITest drivers into the profile's `APPIUM_HOME`, or updates the plugin if it is already there.
3. **Choose settings.** The **Settings** tab holds Xenon's options. Secrets go on the **Secrets & Env** tab, which also takes extra environment variables for a profile, such as `OTEL_*` settings for tracing, or `XENON_PUBLIC_URL` for password reset emails.
4. **Preview, then Start.** **Preview** shows what **Start** will run. **Start** is enabled once the toolchain checks that matter pass, the port is free, the plugin is installed in the profile's `APPIUM_HOME` and the settings are valid.
5. **Open the dashboard.** When the server is ready, the status bar shows **Running** and the dashboard address, `http://127.0.0.1:4723/xenon/` for the default port. Click it to open the dashboard in your browser, then sign in as the [Quick start](./quick-start.mdx#3-open-the-dashboard-and-sign-in) describes.

Tests connect to `http://localhost:` and the profile's port, followed by its base path, so `http://localhost:4723/wd/hub` for **Local server**. Change **Base path** in the profile's header to `/` if you want the plain URL.

### Where Appium keeps its files

Plugins and drivers live in an Appium home folder. Type a path in the profile's `APPIUM_HOME` field to choose one, or leave it blank and the app picks one. **Install plugin + drivers** installs into the folder you typed or, when the field is blank, into the app's own folder, `~/Library/Application Support/xenon-control/appium-home`. The **APPIUM_HOME** button in the header opens the folder in use, and **Start** stays off while the plugin isn't installed there. To be sure that setup and launch use the same folder, type it in.

## How it launches Xenon

For each launch the app writes a complete Appium config file with Xenon's settings and runs `appium server --config` with it. Secrets don't go in the file: they reach the server as environment variables, the ones [Environment variables](./environment-variables.md) describes. A server started this way is an ordinary Xenon server, so everything in the rest of these docs applies to it.

To make this node part of a lab, set the hub's address in **Settings** and add the hub access key and token on **Secrets & Env**. [Hub and nodes](./hub-and-nodes.md) explains where to get them.

## What it leaves to the dashboard

Xenon Control only configures and launches the server. Managing devices, sessions, users, teams and settings while the lab runs stays in the dashboard at `/xenon/`, which the app links to.

For how the app is built and released, see its [README](https://github.com/Rabindra184/xenon/blob/main/mac-app/README.md) in the repository.

## Related

- [Installation and requirements](./installation.md)
- [Configuration](./configuration.md): every option the form offers.
- [Upgrading](./upgrading.md): **Install plugin + drivers** updates an installed plugin.
