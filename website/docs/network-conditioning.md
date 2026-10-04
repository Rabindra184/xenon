---
title: Network conditioning
description: "How a session's network profile works: the five profiles, what each does to Android phones and iOS simulators, and the delay Xenon adds to every command."
---

A network profile makes a session behave as if the connection were worse: it takes the phone offline, or slows the session down. You choose it with one capability when the session starts. This page lists the profiles, what each does on each kind of phone, and what it doesn't do.

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

| Profile | Delay before each command | Android phone or emulator | iOS simulator |
|---|---|---|---|
| `Normal` | None | Turns mobile data and Wi-Fi on | Asks for no network conditioning (`none`) |
| `4G` | 20 ms | Nothing | Asks for no network conditioning (`none`) |
| `3G` | 100 ms | Nothing | Asks for `3g` |
| `Edge` | 400 ms | Nothing | Asks for `edge` |
| `Offline` | None | Turns mobile data and Wi-Fi off | Asks for `off` |

An iPhone gets only the delay. Xenon doesn't change a real iPhone's network.

### The delay

For `4G`, `3G` and `Edge`, Xenon waits the profile's delay before it passes each command of the session on to the driver. A test that sends hundreds of commands takes that long more for each one. The delay slows your test's commands, not the app's network traffic: Xenon doesn't limit the speed or the bandwidth the phone has.

When a session runs on a node's phone, behind a hub, the node adds the delay and applies the profile for its own phone.

### Android

`Offline` runs `adb shell svc data disable` and `adb shell svc wifi disable` on the phone, and `Normal` runs the matching `enable` commands. Turning Wi-Fi off also drops an adb connection that runs over Wi-Fi, so don't use `Offline` on a phone that is connected that way.

Xenon runs `adb` by name for this, so `adb` must be on the `PATH` of the server, not only in `ANDROID_HOME`. When the command fails, Xenon writes a warning to its log and the session carries on without the change.

### iOS simulators

For a simulator, Xenon runs `xcrun simctl network <udid> status <value>`, with the value from the table. That subcommand isn't in every Xcode: in Xcode 26.6, `simctl` answers `Unrecognized subcommand: network`. Where it is missing, Xenon writes a warning to its log and the session carries on with only the delay.

## When the session ends

When a session ends, Xenon sets its phone back to `Normal`: an Android phone gets mobile data and Wi-Fi turned on, and a simulator is asked for `none`. The profile belongs to one session, so it doesn't affect other sessions, but it does change the whole phone while the session lasts.

## Related

- [Capabilities](./capabilities.mdx): the other `xe:` capabilities.
- [Network interceptor](./network-interceptor.md): capturing and mocking the app's traffic.
- [Devices and allocation](./devices.md): how a session gets its phone.
