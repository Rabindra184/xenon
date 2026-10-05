/**
 * Runbook content keyed by failure category.
 *
 * Each entry gives testers concrete steps for a kind of session failure,
 * opened from the "Open runbook" link on the session page's "Why it failed"
 * card. There is one for every category the server writes (the failure
 * analysis's, and HUB_RESTART), and for no other: failure-categories.spec.ts
 * holds the keys to them, and runbook-content.test.tsx holds every UI name
 * they mention to what the dashboard shows.
 *
 * Each says what really lands in its category, which is decided by the
 * analysis's text patterns (failure-analysis-service.ts), not by the
 * category's name, and quotes them. Several match little of what Appium
 * really says: a real app crash, for one, is mostly filed as Element not
 * found (Android) or unknown (iPhone), and App crash says so.
 *
 * Lookup is case-insensitive; the page also normalizes hyphen / underscore /
 * space variants. Anything else falls back to the `unknown` runbook.
 */

export interface RunbookContent {
  title: string;
  markdown: string;
}

export const RUNBOOKS: Record<string, RunbookContent> = {
  hub_restart: {
    title: 'Hub restart',
    markdown: `# Hub restart

The Xenon server restarted while this session was running. A session on one
of that server's own phones ran inside it, so it ended with the restart. A
session on a phone connected to another machine ends too if the server can't
pick it up again after the restart.

## Likely causes

- Someone restarted or updated the Xenon server.
- The server stopped unexpectedly and was started again.
- The computer running it restarted.

## What to do

1. Run the session again.
2. If restarts happen during test runs, ask whoever looks after the Xenon
   server to plan them outside test hours, and to find out why it stopped if
   nobody restarted it.
`,
  },
  timeout: {
    title: 'Timeout',
    markdown: `# Timeout

The failure reason or one of the session's last failed commands mentions a
timeout ("timeout", "timed out") or a dropped connection ("socket hang up").
Usually a command or a wait ran out of time, or the test sent no
command for longer than its \`newCommandTimeout\` and the session was ended.
A session the server lost contact with ends up here too.

## Likely causes

- A test step waited for an element that never appeared.
- The test paused, hung or stopped between commands for longer than
  \`newCommandTimeout\`.
- A slow phone or an unreliable network.
- A command that never returned, for example because of a driver bug.
- The server lost contact with the session.

## What to do

Raise \`newCommandTimeout\` only if the app really needs long pauses between
commands. Otherwise:

1. In the **Commands** tab, look at the last command before the failure. If
   it's a find, fix the selector or wait for the element explicitly.
2. On the **Devices** page, check that the phone is still connected and,
   where its card shows them, its battery and temperature: a hot or nearly
   flat phone slows down. They are the phone's latest readings, not the ones
   from the run.
3. If the same command times out run after run, report it against the test,
   or against the driver if the command clearly hung.
`,
  },
  element_not_found: {
    title: 'Element not found',
    markdown: `# Element not found

A command couldn't find the element the test asked for: the failure reason or
one of the last failed commands says "no such element" or "An element could not
be located". When AI self-healing is on, a failed find has already been tried
again in the other ways this session allows.

## Likely causes

- The screen wasn't ready: the element appeared after the test stopped looking.
- A different screen was showing: a dialog, a permission prompt, a sign-in page
  or an error.
- The app had crashed or closed, so another app or the home screen was showing.
- The app changed: the element's id, text or place in the layout is different
  now.
- The selector only works on some phones, screen sizes or languages.

## What to do

1. Open the **Screenshots** tab, or play the video in **Recording**, to see what
   was on screen when the find failed.
2. If another app or the home screen was showing, the app may have crashed. On
   Android, open **Device logs** and tick **Errors only**: a crash shows as
   "FATAL EXCEPTION", then the app's package name.
3. In the **Commands** tab, read the selector the failed find used and compare
   it with that screen.
4. If the element only appeared late, wait for it in the test, or have Xenon
   retry finds for a while: at the start of the session, run the
   \`xenon: setAutowaitProperties\` script with
   \`{ "enabled": true, "timeoutMs": 10000 }\` (\`executeScript\` in Java,
   \`execute_script\` in Python, \`execute\` in WebdriverIO).
5. If the app changed, update the selector. Selectors that only still work
   because Xenon heals them are listed in **Selector health**: fixing those
   stops them failing like this one.

A find the test expected to fail can file a session here too. If the **Reason**
in **Why it failed** is about something else, start from that.
`,
  },
  app_crash: {
    title: 'App crash',
    markdown: `# App crash

The failure reason or one of the last failed commands says the app crashed or
stopped responding: "process has died", "activity has died", "The application
has crashed" or "Application not responding". Appium itself rarely words a
crash this way, so it's usually the test that reported it.

Most crashes are filed elsewhere. On Android the next find fails on whatever
replaced the app, so they're usually filed as Element not found. On an iPhone
the app "is not running, possibly crashed", which is usually filed as an
unknown failure.

## Likely causes

- A bug in the app, often on the last screen or action the test reached.
- The phone ran low on memory or was under heavy load.
- The app was closed: by the phone, or by a test step.

## What to do

1. Play the video in **Recording**, or open the **Screenshots** tab, to see the
   last screen before the crash.
2. On Android, open **Device logs** and tick **Errors only**. The crash report
   is there: a "FATAL EXCEPTION", then the app's package name and the code it
   failed in.
3. On Android, check **Performance**: the phone's memory running out, or the
   app's own memory climbing until the crash, points at the app using too much.
4. To watch it happen, open the phone from the **Devices** page, keep its Logs
   open, and repeat the steps by hand.
5. If the app crashes by hand too, report it to its developers with a link to
   this session and the log lines.
`,
  },
  permission_blocked: {
    title: 'Permission blocked',
    markdown: `# Permission blocked

The failure reason or one of the last failed commands mentions a system
prompt: "Permission alert", "Security alert", "Always Allow" or "Allow while
using app". A permission or security prompt was most likely on screen, in front
of what the test wanted to use.

## Likely causes

- The app asked for a permission (location, camera, notifications...) the first
  time it needed one on this phone, or after it was reinstalled.
- The phone showed a prompt of its own.

## What to do

1. Open the **Screenshots** tab, or play the video in **Recording**, to see
   which prompt was showing.
2. Let Appium answer such prompts:
   - Android: \`appium:autoGrantPermissions: true\` grants the app the
     permissions it asks for when Appium installs it. With
     \`appium:noReset\` on an app that is already installed, it does nothing.
   - iPhone: \`appium:autoAcceptAlerts: true\` accepts every alert, the app's
     own included, and \`appium:autoDismissAlerts: true\` dismisses every alert.
3. If the test is meant to check the prompt itself, tap the right button in the
   test before going on.
`,
  },
  wda_failure: {
    title: 'WDA failure',
    markdown: `# WDA failure

The failure reason or one of the last failed commands mentions WebDriverAgent,
the helper app Appium puts on an iPhone to drive it, or says "Session does not
exist". WebDriverAgent lost the session during the run, which is rarely the
test's fault. Almost every session filed here ran on an iPhone or an iOS
simulator.

## Likely causes

- WebDriverAgent was started again during the run, without the session: the
  iPhone restarted, or WebDriverAgent itself stopped, for example after running
  out of memory.
- The iPhone was unplugged or lost its connection.

## What to do

1. Run the session again.
2. On the **Devices** page, check the iPhone is still connected. If this keeps
   happening on one iPhone, restart it and check its cable.
3. If new sessions on that iPhone then don't start at all, check on the phone
   that it's unlocked, Auto-Lock is set to Never, Developer Mode is on
   (Settings, Privacy & Security), and it trusts the computer it's plugged
   into. If they still don't start, ask whoever looks after the lab.
`,
  },
  xenon_command_failure: {
    title: 'Xenon command failure',
    markdown: `# Xenon command failure

The failure reason or one of the last failed commands says "command failed".
Despite the name, few failures land here, and they rarely mean Xenon failed.
Most are a stale element on a web page or in a web view on an iPhone, which
Appium reports as "An element command failed because the referenced element is
no longer attached to the DOM": the test found an element earlier, the page
then changed, and the element the test was holding no longer exists. A test
that reports its own failure in those words lands here too.

Stale elements in a native app are worded differently and are filed as unknown
failures.

## What to do

1. In **Why it failed**, read the **Reason** to see which it was.
2. For a stale element, find the element again just before using it, rather
   than keeping it from earlier in the test.
3. If the page is still changing, wait for it to settle, for example for the
   element to be visible again, before tapping or typing.
`,
  },
  system_overload: {
    title: 'System overload',
    markdown: `# System overload

The failure reason or one of the last failed commands says "OutOfMemory",
"MemoryLimit", "thermal throttling" or "too many open files": something ran out
of memory or open files, or the phone overheated.

## Likely causes

- Appium's helper on the phone ran out of memory, most often while reading the
  whole screen (the page source) of a very long list or web page. That is the
  helper's own limit: the phone itself can have memory to spare.
- The phone got too hot and slowed itself down.
- "too many open files": the computer running Xenon hit its limit, usually after
  running many sessions for a long time.

## What to do

1. If the test reads the page source often on a long screen, find the elements
   it needs instead.
2. On the **Devices** page, check the phone's temperature where its card shows
   it. That's its latest reading, not the one from the run. Let a hot phone cool
   down, and restart one that has been on for days.
3. For "too many open files", ask whoever looks after the Xenon server: a
   restart clears it, and the limit can be raised.
`,
  },
  unknown: {
    title: 'Unknown',
    markdown: `# Finding out why it failed

Xenon couldn't tell what kind of failure this was, or has no runbook for its
kind yet. These steps help with any failure.

## What to do

1. In **Why it failed**, read the **Reason**, the **First failed command** and,
   if there is one, the **AI analysis**.
2. In the **Commands** tab, tick **Errors only** to see every command that
   failed. On Android, **Device logs** shows what the phone reported around the
   same time, and **Errors only** there shows its errors.
3. Run the session again and see whether it fails the same way.

If the same kind of failure keeps landing here, report it with a link to the
session, so it can get a runbook of its own.
`,
  },
};

/** The runbook's key for a category: "HUB_RESTART", "hub-restart" and "Hub Restart" are all `hub_restart`. */
export function runbookKey(rawCategory: string): string {
  return rawCategory
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
}

export function lookupRunbook(rawCategory: string | undefined | null): RunbookContent {
  if (!rawCategory) return RUNBOOKS.unknown;
  const key = runbookKey(rawCategory);
  // Own keys only: "constructor" is not a runbook.
  return Object.prototype.hasOwnProperty.call(RUNBOOKS, key) ? RUNBOOKS[key] : RUNBOOKS.unknown;
}
