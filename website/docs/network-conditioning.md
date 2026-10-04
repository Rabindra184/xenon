---
title: Network conditioning
description: "How a session's network profile works: the five profiles, what each does to an Android phone, the delay Xenon adds to every command, and what to do when a session ends without resetting the phone."
---

A network profile makes a session behave as if the connection were worse: it takes the phone offline, or slows the session down. You choose it with one capability when the session starts. This page lists the profiles, what each does on each kind of phone, what it doesn't do, and how to put a phone right when a session ends without resetting it.

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

The profile applies from the moment the session is created until it ends. There is no command or dashboard control to change it while the session runs.

## What each profile does

| Profile | Delay before each command | Android phone or emulator |
|---|---|---|
| `Normal` | None | Turns mobile data and Wi-Fi on |
| `4G` | 20 ms | Nothing |
| `3G` | 100 ms | Nothing |
| `Edge` | 400 ms | Nothing |
| `Offline` | None | Turns mobile data and Wi-Fi off |

An iPhone, real or simulated, gets only the delay, and `Offline` does nothing to it. Xenon doesn't change a real iPhone's network. For a simulator it asks `xcrun simctl network` to change the network, but `xcrun simctl help` in Xcode 26.6 lists no `network` subcommand, so the command fails, Xenon writes a warning to its log and the session carries on with only the delay.

### The delay

For `4G`, `3G` and `Edge`, Xenon waits the profile's delay before it passes each command of the session on to the driver. A test that sends hundreds of commands takes that long more for each one. The delay slows your test's commands, not the app's network traffic: Xenon doesn't limit the speed or the bandwidth the phone has.

When a session runs on a node's phone, behind a hub, the node adds the delay and applies the profile for its own phone.

### Android

`Offline` runs `adb shell svc data disable` and `adb shell svc wifi disable` on the phone, and `Normal` runs the matching `enable` commands. Turning Wi-Fi off also drops an adb connection that runs over Wi-Fi, so don't use `Offline` on a phone that is connected that way.

Xenon runs a bare `adb` for this, not the `adb` it finds through `ANDROID_HOME`, so `adb` must be on the `PATH` of the server. A server that has only `ANDROID_HOME`, such as one started from Xenon Control when the Android `platform-tools` folder isn't on your login shell's `PATH`, can't switch the network. When the command fails, Xenon writes a warning to its log and the session carries on without the change.

## When the session ends

When your test ends the session itself, with `driver.quit()` or a `DELETE` of the session, Xenon sets the phone back to `Normal`: an Android phone gets mobile data and Wi-Fi turned on. This happens only for sessions Xenon keeps track of, which is every session while the dashboard is on, or while the session records video, which it does by default.

A session that ends any other way is not reset. That includes a session Appium ends because its new command timeout ran out, and one Xenon's idle check releases after the same silence. A phone left in `Offline` stays offline, and the next test finds it without a network. Put it right by hand:

```bash
adb -s <udid> shell svc data enable
adb -s <udid> shell svc wifi enable
```

The profile belongs to one session, so it doesn't affect other sessions, but it does change the whole phone while the session lasts.

## Related

- [Capabilities](./capabilities.mdx): the other `xe:` capabilities.
- [Network interceptor](./network-interceptor.md): capturing and mocking the app's traffic.
- [Devices and allocation](./devices.md): how a session gets its phone.
