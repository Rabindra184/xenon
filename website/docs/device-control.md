---
title: Live device control
description: Open a phone in the dashboard, watch its screen and drive it with taps, swipes and typing, install apps, read its logs, and see how holds keep two people from fighting over one phone.
---

Device control opens one phone in the dashboard: you see its screen live, and you can tap, swipe, type, install apps, read its clipboard and logs, and take screenshots. It works on real phones, emulators and simulators, with no test session needed. This page covers what each part does, how a phone is held while you use it, and who may control which phone.

## Open a phone

On the **Devices** page, choose **Control** on a phone's card. The page opens at `/xenon/devices/<udid>/control`, and the tab you pick is part of the address, so a link such as `/xenon/devices/<udid>/control/logs` opens the Logs tab. **Control** is greyed out, with a reason, when a test is running on the phone or when it is offline, and, for everyone but an admin, when it is in maintenance or another user has control of it. [Devices and allocation](./devices.md) describes those states.

Opening the page starts the preview for you. An iPhone's preview first has to start WebDriverAgent through go-ios, as [Installation and requirements](./installation.md#iphones-and-go-ios) describes, so it takes longer to appear than an Android phone's. If the screen doesn't appear, the page says **Stream unavailable**, and **Retry** tries again.

## Drive the phone

On the screen:

- **Click** to tap.
- **Press and hold** for half a second or more to long-press.
- **Drag** to swipe.
- **Type** after you have clicked the screen: what you type goes to the focused field, and **Enter** and **Backspace** press those keys on the phone. Nothing is sent while the focus is in a text box on the page.

Beside the screen are buttons for portrait and landscape, **Home**, **Back** and **App switcher** (Android only), volume up and down, **Lock** and **Unlock**. If a press fails, a message says why. A sleeping Android phone streams a black frame, so the page says **Display is off**, with a **Wake device** button.

### Live preview

Device control shows the preview as an MJPEG stream, unless an Android phone's H.264 stream is turned on, as described below. Each browser watching a phone is counted as a viewer, and the preview stops when none is left.

On Android, a faster H.264 stream is available, and device control and the Live devices tiles both use it. It is off by default, and you turn it on in a config file, because `streaming` is an object:

```yaml
server:
  use-plugins: [xenon]
  plugin:
    xenon:
      streaming:
        androidH264: true
```

`true` captures the screen with scrcpy, which comes with Xenon. `androidH264: { source: screenrecord }` uses Android's own screen recorder instead, which starts slowly and restarts about every three minutes. With it on, a phone is captured once: device control and the Live devices tiles play the H.264 stream, and a page asks for MJPEG only when it has to.

- **A browser without WebCodecs** shows MJPEG. Browsers offer WebCodecs only on `https` or `localhost`, so a dashboard opened over plain `http://hub:4723` has none. The page tells the server, which starts the MJPEG capture and ends the H.264 one as soon as nobody is playing it: at once, or when the last viewer still playing it leaves.
- **A stream that fails** or shows no frame for 30 seconds falls back to MJPEG by itself, in device control and on a tile alike, and asks the server for MJPEG in the same way.
- **A phone with a test session on it** shows the session's own video, which is MJPEG.
- **A phone that is being recorded** always uses MJPEG, so the recording and the preview never both capture the screen. A recording that starts ends the H.264 capture at once, and a page that was playing it switches to MJPEG by itself. See [Recordings](./recordings.md).

iPhones always use MJPEG.

## The tabs

### Actions

- **Apps.** **Install from library** lists the builds in the Apps library that suit the phone (an app that belongs to a team is listed only if you can see it: see [Teams](./teams.md#apps-have-a-team)), and **Upload file** installs a file from your computer, an `.apk` on Android, or an `.ipa` or `.app` on iOS, up to 4 GB. Installed apps are listed below, with a search box. Choose **Uninstall** on one and confirm: the app and its data are removed. Installing takes a while on a slow phone: Xenon gives an Android install 10 minutes.
- **Text and clipboard.** **Send text** types into the focused field. **Read** shows what is on the phone's clipboard. **Write to device** sets it, on iPhones only: Android lets Xenon read the clipboard but not write it, and the button isn't offered there. An Android read needs the Appium Settings app on the phone. An iPhone clipboard write takes about 3 seconds, because Xenon brings WebDriverAgent to the front for it, checks that the text landed, and puts your app back.
- **Swipe.** Four buttons swipe up, down, left and right, for those who can't drag.

### Screenshot

Takes a picture of the screen. Your browser keeps the newest 50 for each phone, so they survive a reload or leaving the page. You can compare two, draw marks on one, copy it, download it, or download them all as a zip. **Clear all** removes them from your browser.

### Logs

The phone's live log: logcat on Android, and the system log on an iPhone, which needs go-ios. It keeps up as lines arrive, and the status at the top says **Live**, **Connecting**, **Offline** or **Denied**. **Pause** stops it scrolling, **Record** keeps every line from when you start to when you stop, whatever the filter says, and **Export shown lines** saves what is on screen. Click a line to see its details, and to show only its tag or app, or hide its tag.

The filter box takes terms that are all applied together:

| Term | Shows |
|---|---|
| `level:W` | That level or worse. The levels, lowest first, are `V`, `D`, `I`, `W`, `E` and `F`. |
| `tag:Wifi` | Lines whose tag contains the text, in any case. |
| `package:com.example` | Lines from an app whose package name contains the text. On an iPhone, this is the process name. |
| `-tag:chatty` | Hides lines whose tag contains the text. |
| `-package:com.noisy` | Hides lines from an app whose package contains the text. |
| any other word | Lines whose message contains it. |

Put a value that contains a space in quotes: `package:"Food Truck"`. The **?** beside the box lists these too.

- On an iPhone, Debug lines are left out until you ask for them with `level:D`, because an iPhone writes thousands of them a second. Narrowing to one app with `package:` keeps the Debug lines to that app's own.
- When your browser can't keep up, Xenon drops lines and shows a warning line, `N lines dropped (slow client)`, in their place. That line is never hidden by a filter, so a `level:E` view can't make you think no errors were lost.
- The newest lines, up to 2,000, are sent when you open the tab, and your browser holds 5,000. **Record** is the way to keep more.

### Shell

A small shell for quick checks on the phone, such as `getprop` or `dumpsys battery` on Android. It runs only the commands on a short list, exactly as listed, one command to a line. Type `help` in it to see the list for the phone in front of you, and `clear` to clear the screen.

- **Plain words only.** Each word may use letters, digits and `. _ / : = @ % + , -`. Anything the phone's shell would read as an instruction, such as `;`, `|`, `&`, `$`, quotes, redirection, `*` or a new line, is refused, and the command never reaches the phone. A refused command prints the reason in the terminal.
- **Android** allows `ls`, `ps`, `top`, `getprop`, `date`, `netstat`, `pm list packages`, `ip addr`, `whoami`, `uptime`, `dumpsys battery`, `dumpsys wifi`, `dumpsys power`, `cat /proc/meminfo` and `cat /proc/cpuinfo`. `ls`, `ps`, `top`, `getprop`, `date`, `netstat`, `pm list packages` and `ip addr` take plain arguments, such as `ls /sdcard` or `getprop ro.build.version.release`. The others take none: `dumpsys battery` is the whole command.
- **iOS simulators** allow `listapps`, `get_app_container` and `getenv` (the last two take plain arguments), and, with no arguments, `ls`, `ps`, `date`, `uptime`, `whoami` and `id`.
- **Real iPhones** allow `apps` and `info`. Xenon adds the phone's own UDID, so a command can't name another device.

It is open to anyone who can control the phone, so give that to people you would trust with the phone itself.

### Omni-Vision

Holds the [Inspector](./inspector.md), which reads the screen's element tree, suggests locators for an element and writes test code that uses one. It doesn't use the AI provider. Omni-Vision's own search of the screen, by text or by a description, is for tests and the API: see [Omni-Vision](./omni-vision.md).

## Holds: one person at a time

While you have a phone open, Xenon holds it for you and marks it busy. Tests aren't given a held phone: they wait for it, or take another. A hold belongs to you and the phone, not to a browser tab, so a second tab of yours shares it.

- **Someone else's hold.** If another person has the phone, your attempt is refused with `409` and a message naming them, such as "Device is being controlled by Priya. Ask them to release it, or use an admin key to force-release." The dashboard shows it as a message. A phone held by a test session says it is in use by a session and names its owner. An admin may control a phone anyway.
- **A leased phone.** A phone held by an SDK lease belongs to the person who took the lease. Others get `409` too, saying it is leased by them through the SDK and is free again when the lease ends. See [Leases for CI](./leases.md).
- **Letting go.** When you close the page or leave it, Xenon waits 3 seconds, so that a reload keeps the preview, and then stops the preview and releases the phone, if nobody else is watching and nothing is recording it. A preview whose browser vanished without leaving stops after about ten minutes with no viewers.
- **What a hold covers.** Controlling a phone, reading its clipboard and reading its logs are refused only while someone else holds the phone, in live control, in a test session or through a lease. Admins aren't refused. A phone that nobody holds is open to every member who can see it. A screenshot or the list of installed apps needs only that you can see the phone.

## Who may control a phone

- **The team rule applies.** You can open only phones you can see: the shared pool and your teams' phones, or all of them for an admin. A phone you can't see answers as if it didn't exist. See [Teams](./teams.md).
- **The role and the scope.** Controlling a phone takes the Member role or above, and members do it from the dashboard. Over the API it takes a token with the `devices` scope. A member's own tokens carry only `sessions` and `read`, so a script that controls phones needs an admin's token. Reading, such as a screenshot, doesn't need that scope.
- **Phones on a node** are controlled through the hub, which checks the rules above and asks the node to act. The node holds the preview and counts its viewers, by the same rules. Everything on this page works for them. Only the API's install from a file path on the hub is refused, with `501`, because a path names a file on one machine: **Upload file** and the Apps library both work. [Hub and nodes](./hub-and-nodes.md) has the details.
- **A cloud provider's phone** can't be controlled from here: the request is refused with `501`.

## Related

- [Recordings](./recordings.md): record one or several phones.
- [Devices and allocation](./devices.md)
- [Hub and nodes](./hub-and-nodes.md)
- [Omni-Vision](./omni-vision.md) and [Inspector](./inspector.md)
