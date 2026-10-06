---
title: Xenon Control for Mac
description: A Mac app that configures and starts Appium with Xenon, with saved launch profiles, encrypted secrets, toolchain checks and a clean shutdown.
---

This page describes Xenon Control 0.2.0. Xenon Control is a Mac app that configures and starts the Appium server with Xenon, so you don't write flags or a config file by hand. Once the server is up it hands off to the dashboard, which stays the place for devices, sessions, users and everything else you do while the lab runs.

## What it does

- **Starts and stops** the Appium server with Xenon, and streams its log live. **Stop** and quitting give Xenon time to finish what it is saving: see [Stopping the server and quitting](#stopping-the-server-and-quitting).
- **Builds the settings form from the options of the Xenon you have installed.** The app reads the option list of the Xenon in the profile's Appium folder, and the form groups the options into sections, with each one's type, allowed values, default and description. A line at the top of the **Settings** tab says which Xenon's options it shows, for example "Showing the options of Xenon 2.17.0, installed in this profile's Appium folder." When Xenon isn't installed yet, or its list can't be read, the form shows the list that came with the app instead, and the line says so. The launch follows the same list: a setting your installed Xenon doesn't know is left out of the config, because Appium refuses to start with one, and the log names what was skipped. It stays in the profile and is used again once Xenon is updated. The **Database Provider** setting is gone from the form and a launch never writes it, because Xenon keeps its data in SQLite only and the setting changed nothing.
- **Saves launch profiles**, named sets of settings such as "Local Android" or "Hub". Profiles export to and import from JSON, so a lab can share a standard one. An export carries no secret values. It names the secrets the profile uses but not their contents, and it leaves out the Cloud API key, the proxy password, and any extra environment variable whose name looks like a secret. That is a name that is one of the words `KEY`, `APIKEY`, `TOKEN`, `SECRET`, `PASSWORD`, `PASSWD`, `PWD` or `PASS`, or ends in one of them after an underscore (`TOKEN`, `API_KEY`, `DB_PASS`), or is `PGPASSWORD`, or is an `OTEL_EXPORTER_OTLP_*HEADERS` variable, or is the name of one of the secrets above, such as `DATABASE_URL`. Capitals don't matter. The names of the variables it left out are listed under `strippedEnv` in the file, so whoever imports it knows what to enter again. A `user:password@` in an address, such as a proxy URL or the hub, is cut out of the export. An export still carries the rest of the profile's settings and extra environment variables as they are, so keep secrets under other names out of them.
- **Keeps secrets encrypted.** On the **Secrets & Env** tab, AI keys, a node's hub access key and token, the database URL and the SMTP URL are stored encrypted, with the key held in the macOS Keychain, and handed to the server as environment variables at launch by each profile that ticks **inject in this profile** for them. They are never written into the config file the app generates. The **Settings** tab shows the AI keys and the **Database URL** as pointers to these secrets. The database URL is the `DATABASE_URL` the server reads when it starts, so set it on **Secrets & Env** and tick **inject in this profile**: without it the server uses its default SQLite database under `~/.cache/xenon`. A database URL that an older version saved in a profile as plain text is moved into the Keychain when the app loads, but not turned on, so a server never switches databases by itself. Two values have no encrypted place yet: the cloud API key and the proxy password are saved in the profile and written into the generated config file as plain text. The extra environment variables on the **Secrets & Env** tab are saved in the profile as plain text too.
- **Keeps tokens and passwords out of the log.** Appium logs the body of every request it receives, which includes the token of a test session and the password of a sign-in. Every config the app generates carries Xenon's two `log-filters` rules, so Appium shows the value of a `token`, `sessionToken`, `leaseToken`, `password`, `oldPassword`, `newPassword` or `apiKey` as `**REDACTED**`. That holds for the **Logs** tab and for the log file of each launch. You can't edit or turn off these rules in the app, and **Preview** shows them in the config. They aren't a complete cover: [Keep secrets out of Appium's log](./authentication.md#keep-secrets-out-of-appiums-log) lists what they miss, such as webhook addresses and text typed on a phone, so still limit who can read the log.
- **Checks the toolchain**: Node.js, Appium, the drivers, the Android SDK, Xcode and iPhone support (go-ios). A missing or too old Node.js, a missing Appium or one older than 3.1.1, a port another app is already listening on, or a plugin that isn't installed blocks **Start**, and the **Health** tab says how to fix it. The **iPhone support** check never blocks **Start**. It says *Not installed yet* until go-ios is installed, and *Xenon was updated* with a note to run **Set up** again when the go-ios on the Mac isn't the version this Xenon expects. It says *Ready for iPhones*, with the go-ios version, when all is well, and *Not needed for Android-only profiles* when the profile's platform is Android.
- **Sets Xenon up the first time**: one **Set up** button installs the Xenon plugin and the Android and iOS drivers and, for a profile whose platform includes iOS, iPhone support (go-ios). It shows each step once, in plain words, as it goes, and ends with a message that says whether setup finished or which step didn't. It is off while the server is running.
- **Previews a launch.** Before you start, it shows the exact `appium` command, the `APPIUM_HOME` it uses, the names of the environment variables it sets (never their values) and the config file it generated, log-filter rules included. You can copy or save the file.
- **Validates settings.** The port must be a number from 1 to 65535, the base path must start with `/`, a hub must be the hub's own address, an http or https URL with no path and no `user:password@`, such as `http://hub-mac:4723`, and numeric options must stay inside their allowed range. The app writes the hub into the config as that plain address, with no slash on the end, because Xenon adds its own paths to it. Problems show inline, and **Start** stays off until they are fixed.
- **Says why Start is off, and checks again by itself.** See [When Start is off](#when-start-is-off).
- **Writes a log file for every launch**, with a timestamp, in the app's logs folder. **Log Folder** in the header opens it.

## What you need

- A Mac with Apple silicon. The releases are built for it.
- Node.js and Appium 3.1.1 or newer installed on the Mac, the Appium version Xenon requires. A pre-release of Appium, such as a beta, doesn't count. Xenon Control doesn't install them; its **Health** tab checks them, and **Start** won't run without them. Because an app opened from Finder doesn't get your shell's `PATH`, it asks your login shell for `PATH`, `ANDROID_HOME` and `APPIUM_HOME`, and also looks in the usual places for Homebrew, nvm, Volta and asdf, and in `~/Library/Android/sdk`.
- Whatever your devices need: the Android SDK for Android, Xcode for iOS. For iPhones, also go-ios, which Xenon runs from its own folder. **Set up** installs it for you on a profile whose platform includes iOS. [Installation and requirements](./installation.md#iphones-and-go-ios) describes what it is and how to install it by hand.

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
2. **Open the Health tab.** It lists the toolchain checks. Under **First-run setup**, **Set up** installs the Xenon plugin and the UiAutomator2 and XCUITest drivers into the Appium folder the profile uses, or updates the plugin if it is already there, then installs iPhone support (go-ios) if the profile's platform is `ios` or `both`. The card names the folder, for example "Installs into the Appium folder this profile uses: ~/.appium." Each step shows once, in plain words, and a message at the end says whether setup finished or which step didn't. **Set up** is off while the server is running, because it replaces files a running server uses: stop the server first. Run **Set up** again after you update Xenon: the **iPhone support** check says *Xenon was updated* when the iPhone part needs it.
3. **Choose settings.** The **Settings** tab holds Xenon's options. Secrets go on the **Secrets & Env** tab, which also takes extra environment variables for a profile, such as `OTEL_*` settings for tracing, or `XENON_PUBLIC_URL` for password reset emails.
4. **Preview, then Start.** **Preview** shows what **Start** will run. **Start** is enabled once the toolchain checks that matter pass, the port is free, the plugin is installed in the profile's Appium folder and the settings are valid.
5. **Open the dashboard.** When the server is ready, the status bar shows **Running** and the dashboard address, `http://127.0.0.1:4723/xenon/` for the default port. Click it to open the dashboard in your browser, then sign in as the [Quick start](./quick-start.mdx#3-open-the-dashboard-and-sign-in) describes.

Tests connect to `http://localhost:` and the profile's port, followed by its base path, so `http://localhost:4723/wd/hub` for **Local server**. Change **Base path** in the profile's header to `/` if you want the plain URL.

### When Start is off

When **Start** is off, the status bar says why beside it, and the button's tooltip says the same. The reason is one of these:

- **A setting is invalid**, such as "Fix 1 setting first: Port".
- **The Mac isn't ready**, such as "Port 4723 is already in use by another app. Choose another port or close that app." or "Run Set up on the Health tab first. Xenon isn't installed in the Appium folder this profile uses." The **Health** tab lists every reason under **Why Start is off:**.
- **A check is running**, which shows "Checking…", or **Set up** is running, which shows "Wait for Set up to finish."

The **Start** button, ⌘⏎ and the **Logs** tab's **Start server** link all do the same thing. Pressed while something is wrong, they don't start the server: they take you to the first setting to fix, or to the **Health** tab.

The app checks again by itself when you switch profile, change the port or the Appium folder, come back to the window, press **Re-check**, or when **Set up** or the server finishes, so **Start** comes back on once you've fixed the cause. It also checks right before every start, whatever it learned earlier. If a start fails anyway, the message appears in a notice that stays until you close it and on the status bar until your next start. Importing a profile file that holds no profiles, or one the app can't read, says so too.

### Where Appium keeps its files

Plugins and drivers live in an Appium home folder. Type a path in the profile's `APPIUM_HOME` field to choose one, or leave it blank and the app picks the first of these that already has Xenon installed:

1. The `APPIUM_HOME` your login shell sets, if it sets one.
2. The app's own folder, `~/Library/Application Support/xenon-control/appium-home`.
3. `~/.appium`.

When none of them has Xenon yet, the app uses its own folder, which is where **Set up** then installs it. **Set up**, **Start**, the checks and the **APPIUM_HOME** button in the header all use that same folder, so setup installs where the server then launches from. **Start** stays off while the plugin isn't installed there.

## Stopping the server and quitting

Xenon finishes a shutdown by archiving recordings, releasing the phones it holds and stopping the helper processes it started, which takes up to about 15 seconds. **Stop** gives it time for that: it asks Xenon to stop and waits up to 30 seconds. If Xenon is still running then, the app asks again more firmly, and 5 seconds after that it ends the process. The log says when the app has to step up. While this runs, the status bar reads "Stopping — saving recordings and releasing phones…", and **Stop** and the **Stop Server** items in the **Server** menu and in the menu bar icon's menu are off, so a second click can't start the countdown over.

Quitting the app (⌘Q) while the server runs does the same stop first and quits when Xenon has stopped, which can take up to about 35 seconds. The window stays on screen during the wait so you can see what it's doing, and it reappears if you had closed it to the menu bar. Press ⌘Q a second time to skip the wait: the app asks Xenon to stop once, ends it after 2 seconds if it hasn't, and quits within about 5 seconds. A forced quit cuts Xenon's shutdown short, so a recording still in progress may not be saved.

## How it launches Xenon

For each launch the app writes a complete Appium config file with Xenon's settings and runs `appium server --config` with it. The secrets you keep on the **Secrets & Env** tab don't go in the file: they reach the server as environment variables, the ones [Environment variables](./environment-variables.md) describes. A server started this way is an ordinary Xenon server, so everything in the rest of these docs applies to it. The app doesn't set `enableJsonLogging` for you, so on Xenon 2.13.2 or newer `XENON_JSON_LOGGING=true`, added on the **Secrets & Env** tab, turns JSON logging on, unless the profile sets the JSON logging option itself, which wins. [Environment variables](./environment-variables.md) describes the variable.

To make this node part of a lab, set the hub's address in **Settings** and add the hub access key and token on **Secrets & Env**. [Hub and nodes](./hub-and-nodes.md) explains where to get them.

## What it leaves to the dashboard

Xenon Control only configures and launches the server. Managing devices, sessions, users, teams and settings while the lab runs stays in the dashboard at `/xenon/`, which the app links to.

For how the app is built and released, see its [README](https://github.com/Rabindra184/xenon/blob/main/mac-app/README.md) in the repository.

## Related

- [Installation and requirements](./installation.md)
- [Configuration](./configuration.md): every option the form offers.
- [Upgrading](./upgrading.md): **Set up** updates an installed plugin.
