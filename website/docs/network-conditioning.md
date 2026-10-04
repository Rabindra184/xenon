---
title: Network conditioning
description: "How a session's network profile works: the five profiles, what each does to an Android phone, the delay Xenon adds to every command, and how the phone's network is put back when the session ends."
---

A network profile makes a session behave as if the connection were worse: it takes the phone offline, or slows the session down. You choose it with one capability when the session starts. This page lists the profiles, what each does on each kind of phone, what it doesn't do, and how Xenon puts the phone's network back when the session ends.

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

An iPhone, real or simulated, gets only the delay, and `Offline` does nothing to it: the phone stays online. Xenon can't change a real iPhone's network, and Xcode 26 has no `simctl` command that changes a simulator's. Xenon notes this once in its log.

### The delay

For `4G`, `3G` and `Edge`, Xenon waits the profile's delay before it passes each command of the session on to the driver. A test that sends hundreds of commands takes that long more for each one. The delay slows your test's commands, not the app's network traffic: Xenon doesn't limit the speed or the bandwidth the phone has.

When a session runs on a node's phone, behind a hub, the node adds the delay and applies the profile for its own phone.

### Android

`Offline` first reads whether Wi-Fi and mobile data are on, then runs `adb shell svc data disable` and `adb shell svc wifi disable` on the phone. `Normal` runs the matching `enable` commands. Turning Wi-Fi off also drops an adb connection that runs over Wi-Fi, so don't use `Offline` on a phone that is connected that way.

Xenon uses the same `adb` as the rest of its Android work, the one it finds through `ANDROID_HOME` or `ANDROID_SDK_ROOT`, so `adb` doesn't need to be on the `PATH` of the server. When a command fails, Xenon writes a warning to its log and the session carries on without the change.

## When the session ends

However the session ends, Xenon puts the phone's network back, once, before it releases the phone, so the next session's own settings can't be undone. That covers your test's `driver.quit()` or a `DELETE` of the session, Appium's new command timeout, Xenon's idle release of the phone, a stale heartbeat and a server shutdown.

- **`Offline`** turns back on only what was on before: Wi-Fi if it was on, mobile data if it was on. A radio that was already off stays off. When Xenon couldn't tell whether one was on, it turns it on.
- **`Normal`, `4G`, `3G` and `Edge`** change nothing on the phone at the end.

If Xenon is stopped or crashes while a session has a phone offline, it undoes the change at its next start, from its own record of it. A phone that isn't connected then is put right before its next session on the same server, or at the next start. If you need it at once, by hand:

```bash
adb -s <udid> shell svc data enable
adb -s <udid> shell svc wifi enable
```

The profile belongs to one session, so it doesn't affect other sessions, but it does change the whole phone while the session lasts. Only the server that drives the phone changes its network: a hub never changes a node's phone, and the node does it for its own.

## Related

- [Capabilities](./capabilities.mdx): the other `xe:` capabilities.
- [Network interceptor](./network-interceptor.md): capturing and mocking the app's traffic.
- [Devices and allocation](./devices.md): how a session gets its phone.
