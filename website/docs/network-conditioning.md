---
title: Network conditioning
description: "How a session's network profile works: the five profiles, what each does to an Android phone or emulator, changing it during a session, the delay Xenon adds to every command, and how the phone's network is put back when the session ends."
---

A network profile makes a session behave as if the connection were worse: it takes the phone offline, slows an emulator's traffic, or slows the session down. You choose it when the session starts, and can change it while the session runs. This page lists the profiles, what each does on each kind of phone, what it doesn't do, and how Xenon puts the phone's network back when the session ends.

## Choose a profile

Set `xe:network_profile` in the session's capabilities. `xe:networkProfile` is accepted too, and so is the same name inside `xe:options`. The value is one of `Normal`, `4G`, `3G`, `Edge` or `Offline`, written exactly like that, with these capitals. Any other value, including `3g`, adds no delay and changes nothing on an Android phone.

```js
const capabilities = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'xe:network_profile': '3G',
  'xe:options': {
    accessKey: process.env.XENON_ACCESS_KEY,
    token: process.env.XENON_TOKEN,
  },
};
```

The profile applies from the moment the session is created until the session ends, or until the test changes it.

## Change it during a session

`xenon: setNetworkProfile` changes the session's profile while it runs, for example to drop the network in the middle of a call and bring it back:

```js
await driver.execute('xenon: setNetworkProfile', { profile: 'Offline' });
// … check the app notices, then:
await driver.execute('xenon: setNetworkProfile', { profile: 'Normal' });
```

It answers what took effect: `{ profile, appTraffic, commandDelayMs }`.

- **`appTraffic: 'shaped'`:** the app's own traffic is slowed to the profile's figures. This happens on an Android emulator.
- **`appTraffic: 'radios'`:** Wi-Fi and mobile data were switched (Android `Offline` and `Normal`).
- **`appTraffic: 'none'`:** nothing changed on the device; only the delay before each command applies.
- **A profile that isn't one of the five** is refused with `invalid argument`.

It answers once the change is made, not once the network is back: after `Offline`, `Normal` turns Wi-Fi back on and the device then takes a few seconds to reconnect (measured on an emulator), as a phone does when it finds Wi-Fi again. A test of how the app reconnects waits for the app, not for the command.

`xenon: getNetworkProfile` answers the same shape for the profile in force, `Normal` when the session has none. Whatever a session changes is put back when it ends, to the phone's state before the session's first change.

`GET /xenon/api/capabilities` reports `features.networkProfiles`, which says which profiles change the device's own network on each kind of device, and `/sdk/version` lists `network-profile-mid-session`. On a hub, the command goes to the node that drives the phone, so the node needs this release too: an older node answers `unknown command`.

## What each profile does

| Profile | Delay before each command | Android emulator | Real Android phone |
|---|---|---|---|
| `Normal` | None | Turns mobile data and Wi-Fi on; no speed limit | Turns mobile data and Wi-Fi on |
| `4G` | 20 ms | Traffic at 15,000 kbps down, 7,500 up, 20 ms latency | Nothing |
| `3G` | 100 ms | Traffic at 2,000 kbps down, 1,000 up, 100 ms latency | Nothing |
| `Edge` | 400 ms | Traffic at 250 kbps down, 150 up, 400 ms latency | Nothing |
| `Offline` | None | Turns mobile data and Wi-Fi off | Turns mobile data and Wi-Fi off |

An iPhone, real or simulated, gets only the delay, and `Offline` does nothing to it: the phone stays online. Xenon can't change a real iPhone's network, and Xcode 26 has no `simctl` command that changes a simulator's. Xenon notes this once in its log.

### The delay

For `4G`, `3G` and `Edge`, Xenon waits the profile's delay before it passes each command of the session on to the driver. A test that sends hundreds of commands takes that long more for each one. The delay slows your test's commands, not the app's network traffic. Only on an Android emulator does a profile also slow the app's traffic (below); on a real phone Xenon doesn't limit the speed or the bandwidth.

### Android emulators

On an emulator this server drives, `4G`, `3G` and `Edge` also set the emulator's own network speed and latency through its console (the emulator's `network speed` and `network delay`), so the app's TCP and UDP traffic really is that slow. Ping isn't shaped. `Normal` lifts the limits. `Offline` turns the radios off, as on a phone, and leaves the speed as it was. Xenon reads the emulator's speed and latency before its first change and puts them back when the session ends.

Xenon reaches the console at `127.0.0.1:<port>`, the port in the emulator's serial (`emulator-5554`), and signs in with `~/.emulator_console_auth_token` of the user it runs as when the emulator asks. An emulator seen through a remote adb server isn't shaped, because its console is on another machine. When the console can't be reached, Xenon writes a warning to its log once, and the profile only delays commands.

When a session runs on a node's phone, behind a hub, the node adds the delay and applies the profile for its own phone.

### Android

`Offline` first reads whether Wi-Fi and mobile data are on, then runs `adb shell svc data disable` and `adb shell svc wifi disable` on the phone. `Normal` runs the matching `enable` commands. Turning Wi-Fi off also drops an adb connection that runs over Wi-Fi, so don't use `Offline` on a phone that is connected that way.

Xenon uses the same `adb` as the rest of its Android work, the one it finds through `ANDROID_HOME` or `ANDROID_SDK_ROOT`, so `adb` doesn't need to be on the `PATH` of the server. When a command fails, Xenon writes a warning to its log and the session carries on without the change.

## When the session ends

However the session ends, Xenon puts the phone's network back, once, before it releases the phone, so the next session's own settings can't be undone. That covers your test's `driver.quit()` or a `DELETE` of the session, Appium's new command timeout, Xenon's idle release of the phone, a stale heartbeat and a server shutdown.

- **`Offline`** turns back on only what was on before: Wi-Fi if it was on, mobile data if it was on. A radio that was already off stays off. When Xenon couldn't tell whether one was on, it turns it on.
- **An emulator's speed and latency** go back to what they were before the session's first `4G`, `3G` or `Edge`.
- **`Normal`** changes nothing at the end.

If Xenon is stopped or crashes while a session has a phone offline or an emulator shaped, it undoes the change at its next start, from its own record of it. A phone that isn't connected then is put right before its next session on the same server, or at the next start. If you need it at once, by hand:

```bash
adb -s <udid> shell svc data enable
adb -s <udid> shell svc wifi enable
```

An emulator's limits come off with `network speed full` and `network delay none` on its console (`telnet 127.0.0.1 5554`, or `adb -s emulator-5554 emu network speed full`).

The profile belongs to one session, so it doesn't affect other sessions, but it does change the whole phone while the session lasts. Only the server that drives the phone changes its network: a hub never changes a node's phone, and the node does it for its own.

## Related

- [Capabilities](./capabilities.mdx): the other `xe:` capabilities.
- [Network interceptor](./network-interceptor.md): capturing and mocking the app's traffic.
- [Devices and allocation](./devices.md): how a session gets its phone.
