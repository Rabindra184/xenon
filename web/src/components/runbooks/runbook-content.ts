/**
 * Runbook content keyed by failure category.
 *
 * Each entry gives testers concrete steps for a kind of session failure,
 * opened from the "Open runbook" link on the session page's "Why it failed"
 * card. There is one for every category a session can hold: the ones the
 * server writes, and the retired ones older sessions still have. No other:
 * failure-categories.spec.ts holds the keys to them, and
 * runbook-content.test.tsx holds every UI name they mention to what the
 * dashboard shows.
 *
 * Each says what really lands in its category and quotes the texts that put
 * it there (FAILURE_RULES, failureCategories.ts), since a name can mislead:
 * an Android app that crashes outright is filed Element not found or Stale
 * element, and App crash says so.
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

The Xenon server restarted or shut down while this session was running. When
it shuts down it ends the sessions it is running ("Hub shutdown"). After a
restart, a session on one of that server's own phones has ended with it, and
a session on a phone connected to another machine ends too if the server
can't pick it up again.

## Likely causes

- Someone restarted, stopped or updated the Xenon server.
- The server stopped unexpectedly and was started again.
- The computer running it restarted.

## What to do

1. Run the session again.
2. If restarts happen during test runs, ask whoever looks after the Xenon
   server to plan them outside test hours, and to find out why it stopped if
   nobody restarted it.
`,
  },
  session_lost: {
    title: 'Session lost',
    markdown: `# Session lost

The session stopped working partway through: the helper app Appium uses to
drive the phone (WebDriverAgent on an iPhone, UiAutomator2 on Android) stopped
answering, or Xenon lost track of the session. The failure reason or a failed
command says something like "Could not proxy command to the remote server",
"socket hang up", "instrumentation process is not running", "Session does not
exist" or "Session heartbeat timeout". It's rarely the test's fault.

## Likely causes

- The phone was unplugged, restarted, or lost its connection to the computer
  it's plugged into.
- The helper app on the phone stopped, for example after running out of
  memory, or was started again without the session.
- The computer the phone is plugged into stopped answering Xenon.
- On an iPhone, a command took longer than the session's
  \`appium:commandTimeouts\` allows, and Appium ended the session ("Appium did
  not get any response from").

## What to do

1. Run the session again.
2. On the **Devices** page, check the phone is still connected. If this keeps
   happening on one phone, restart it and check its cable.
3. If new sessions on that phone then don't start at all, check on an iPhone
   that it's unlocked, Auto-Lock is set to Never, Developer Mode is on
   (Settings, Privacy & Security), and it trusts the computer it's plugged
   into. If they still don't start, ask whoever looks after the lab.
4. If sessions on several phones were lost at the same time, ask whoever looks
   after the Xenon server: the computer they're plugged into may have stopped.
`,
  },
  timeout: {
    title: 'Timeout',
    markdown: `# Timeout

Something ran out of time: the test sent no command for longer than its
\`newCommandTimeout\`, or a command, a script or a wait didn't finish in time.
The failure reason or a failed command says, for example, "New Command Timeout
of 60 seconds expired", "Session timed out due to inactivity" or "did not
complete before its timeout expired".

## Likely causes

- The test paused, hung or stopped between commands for longer than
  \`newCommandTimeout\`: a long sleep, a step waiting on something outside the
  app, or a test runner that crashed.
- A script or a web page took too long.
- Xenon waited for an element to become usable and it never did ("to be
  enabled").
- On Android, the phone couldn't read the screen because the app never let it
  go idle ("hogging the main UI thread"): an endless animation or video, or an
  app busy on its main thread.
- A slow phone.

## What to do

Raise \`newCommandTimeout\` only if the app really needs long pauses between
commands. Otherwise:

1. In the **Commands** tab, find the last command and compare its time with
   **Ended** in the session's details: a long gap means the test stopped sending
   commands.
2. On the **Devices** page, check the phone's battery and temperature where
   its card shows them: a hot or nearly flat phone slows down. They are the
   phone's latest readings, not the ones from the run.
3. If the same command times out run after run, report it against the test,
   or against the driver if the command clearly hung.
`,
  },
  element_not_found: {
    title: 'Element not found',
    markdown: `# Element not found

A command couldn't find the element the test asked for: the failure reason or
a failed command says "no such element" or "An element could not be located".
When AI self-healing is on, a failed find has already been tried again in the
other ways this session allows.

## Likely causes

- The screen wasn't ready: the element appeared after the test stopped looking.
- A different screen was showing: a dialog, a permission prompt, a sign-in page
  or an error.
- The app had crashed or closed, so another app or the home screen was showing.
  On Android an app that crashes outright gives the test no error of its own,
  so its crash is filed here.
- The app changed: the element's id, text or place in the layout is different
  now.
- The selector only works on some phones, screen sizes or languages.

## What to do

1. Open the **Screenshots** tab, or play the video in **Recording**, to see what
   was on screen when the find failed.
2. If another app or the home screen was showing, the app may have crashed. On
   Android, open **Device logs**, where the session has them, and tick **Errors
   only**: a crash shows as "FATAL EXCEPTION", then the app's package name.
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

If the **Reason** in **Why it failed** is about something else, start from that.
`,
  },
  stale_element: {
    title: 'Stale element',
    markdown: `# Stale element

The test used an element it had found earlier, and the app had since redrawn
the screen, so that element no longer exists. The failure reason or a failed
command says "stale element reference", or the driver's own words: "does not
exist in DOM anymore" or "is not present in the cache or has expired"
(Android), "is not present in the current view anymore" or "expired from the
internal cache" (iPhone), "no longer attached to the DOM" (web pages).

## Likely causes

- The test kept an element across a change on screen: moving to another screen,
  a list refreshing, the keyboard opening or closing, or an animation.
- The app redraws the screen by itself, for example a list that updates while
  the test is using it.
- The app had crashed or closed, and the element went with it. On Android an
  app that crashes outright gives the test no error of its own, so its crash
  can show up here.

## What to do

1. In **Why it failed**, read the **Reason** to see which element it was.
2. Find the element again just before using it, rather than keeping it from
   earlier in the test.
3. If the screen is still changing, wait for it to settle, for example for the
   element to be visible again, before tapping or typing.
`,
  },
  app_crash: {
    title: 'App crash',
    markdown: `# App crash

The app under test stopped. On an iPhone the failure reason or a failed command
says the app "is not running, possibly crashed". A test that reports a crash in
its own words ("The application has crashed", "Application not responding")
lands here too.

An Android app that crashes outright gives the test no error of its own: the
next command fails on whatever replaced it, so the session is filed under
Element not found or Stale element. Where the session has **Device logs**, its
crash report is there.

## Likely causes

- A bug in the app, often on the last screen or action the test reached.
- The phone ran low on memory or was under heavy load.
- The app was closed: by the phone, or by a test step.

## What to do

1. Play the video in **Recording**, or open the **Screenshots** tab, to see the
   last screen before the crash.
2. Open **Device logs**, where the session has them, and tick **Errors only**.
   On Android the crash report is a "FATAL EXCEPTION", then the app's package
   name and the code it failed in.
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

A prompt was in front of what the test wanted to use. Phones don't report this
themselves: a native permission prompt usually shows up as Element not found.
This category comes from a web page on an iPhone ("unexpected alert open", "A
modal dialog was open"), or from a test that reports the prompt in its own
words ("Permission alert", "Allow while using app").

## Likely causes

- The app asked for a permission (location, camera, notifications...) the first
  time it needed one on this phone, or after it was reinstalled.
- The phone showed a prompt of its own.
- A web page opened an alert.

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
  system_overload: {
    title: 'System overload',
    markdown: `# System overload

Something ran out of memory or of open files. The failure reason or a failed
command says "OutOfMemoryError", "too many open files" or "EMFILE".

## Likely causes

- Appium's helper on the phone ran out of memory, most often while reading the
  whole screen (the page source) of a very long list or web page. That is the
  helper's own limit: the phone itself can have memory to spare.
- "too many open files": the computer running Xenon hit its limit, usually after
  running many sessions for a long time.

## What to do

1. If the test reads the page source often on a long screen, find the elements
   it needs instead.
2. If it keeps happening on one phone, restart that phone.
3. For "too many open files", ask whoever looks after the Xenon server: a
   restart clears it, and the limit can be raised.
`,
  },
  wda_failure: {
    title: 'WDA failure',
    markdown: `# WDA failure

Older sessions were filed here when the failure reason or a failed command
mentioned WebDriverAgent, the helper app Appium puts on an iPhone to drive it,
or said "Session does not exist". Newer sessions that lose WebDriverAgent are
filed under Session lost, which has the same advice.

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

Older sessions were filed here when the failure reason or a failed command said
"command failed". Despite the name, that rarely meant Xenon failed: most were a
stale element on a web page or in a web view on an iPhone ("An element command
failed because the referenced element is no longer attached to the DOM").
Newer sessions with a stale element are filed under Stale element.

## What to do

1. In **Why it failed**, read the **Reason** to see what it was.
2. For a stale element, find the element again just before using it, rather
   than keeping it from earlier in the test.
3. If the screen is still changing, wait for it to settle before tapping or
   typing.
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
