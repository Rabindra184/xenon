---
title: Execute commands
description: "The commands a running test can send to Xenon with executeScript: session details, autowait, on-screen actions and network mocks, each with its arguments and an example."
---

A test can talk to Xenon while it runs, with the same call it uses for any script: `executeScript`. Xenon answers these scripts itself, so they never reach the driver. They name a session's status for the dashboard, change [autowait](./autowait.md), tap by what is on the screen, and manage the [network interceptor](./network-interceptor.md). This page lists each command, what it takes and what it does.

## How to call them

A command is a script whose name starts with `xenon:` and ends with the command's name. The prefix `xe:` works too, and the space after the colon is optional. Names are case-sensitive. Arguments go in the script's argument list, usually as one object.

```js
await driver.executeScript('xenon: addTag', [{ tag: 'smoke' }]);
```

In the other clients, pass the object as the one argument:

```python
driver.execute_script('xenon: addTag', {'tag': 'smoke'})
```

```java
driver.executeScript("xenon: addTag", Map.of("tag", "smoke"));
```

- The five [session-details](#session-details) commands answer `{ recorded: true }`, or `{ recorded: false, message }` when nothing was saved. The others return the value described below.
- On a lab that checks every command (`XENON_REQUIRE_COMMAND_AUTH`), these scripts are commands like any other, and each must carry your credentials, as headers: see [Check every command](./authentication.md#check-every-command).
- A `xenon:` or `xe:` script Xenon doesn't know fails with `unknown command`, and the message lists the commands Xenon has. Check the spelling.
- Autowait also answers to its older names, `plugin: setWaitPluginProperties` and `plugin: getWaitPluginProperties`. See [Autowait](./autowait.md#older-names).

### Sessions on a node's phone

On a hub, a session on a node's phone goes through the hub, and what happens to these scripts depends on the hub's dashboard:

- **The hub's dashboard is on.** The hub answers the five [session-details](#session-details) commands itself, and writes to its own record of the session. Every other script goes on to the node, where the autowait, on-screen and network commands work.
- **The hub's dashboard is off.** The hub passes every script to the node. The autowait, on-screen and network commands work there. The node keeps no record of the hub's session, so the five session-details commands answer `{ recorded: false, message }` and save nothing.

A session on one of the hub's own phones is answered by the hub, which saves to its record only while its dashboard is on.

## Session details

These commands put information on the session's page in the dashboard. They write to the session's record, which Xenon keeps only when the dashboard is on (`--plugin-xenon-enable-dashboard`). None of them ever fails your test. Each answers `{ recorded: true }` when it saved something, or `{ recorded: false, message }` when it didn't, and the message says why. The server's log carries the same message as a warning. A test that cares can read the answer, and one that doesn't can ignore it.

Nothing is saved when:

- the server keeps no record of the session: its dashboard is off, or it is a node, which keeps none for a session its hub created;
- the call lacks what it needs: a name, a tag or a message, or a status that isn't `passed`, `success` or `failed`;
- `captureEvidence` can't take a screenshot, or the session isn't running on this server;
- the write itself fails.

Turn the dashboard on before a suite sends them, if you want what they send to show.

| Command | Arguments | What it does |
|---|---|---|
| `setSessionName` | A string, or `{ name }` | Names the session on the dashboard. |
| `setSessionStatus` | `{ status, reason }`, or the two values as separate arguments | Marks the session `passed` or `failed`, with an optional reason. `status` is `passed`, `success` (the same thing) or `failed`, in any case. Any other value saves nothing and is answered with `recorded: false`. The dashboard updates at once. |
| `addTag` | A string, or `{ tag }` | Adds a tag to the session. A tag the session already has is not added twice. The tags show in the session's details. |
| `debug` | A string, or `{ message }` | Adds the message to the session's Debug logs. |
| `captureEvidence` | A string, or `{ reason, label }` | Takes a screenshot now and adds it to the session as an entry named "Evidence Captured". `reason` is shown with it, and is `Manual capture` when you give none. `label` is kept in the entry. |

```js
const answer = await driver.executeScript('xenon: setSessionName', ['Checkout: pay by card']);
if (!answer.recorded) console.log(answer.message); // nothing was saved, and this says why
await driver.executeScript('xenon: setSessionStatus', [{ status: 'failed', reason: 'Payment was declined' }]);
await driver.executeScript('xenon: addTag', ['smoke']);
await driver.executeScript('xenon: debug', ['Reached the payment screen']);
await driver.executeScript('xenon: captureEvidence', [{ reason: 'Payment confirmed', label: 'receipt' }]);
```

When you don't set a status, Xenon decides it when the session ends: `failed` if any command failed, `passed` if none did. A status you set yourself stays.

## Autowait

| Command | Arguments | What it does |
|---|---|---|
| `setAutowaitProperties` | Any of `enabled`, `timeoutMs`, `intervalBetweenAttemptsMs`, `excludeEnabledCheck` | Changes autowait for this session only. Fields you leave out keep their value. |
| `getAutowaitProperties` | None | Returns the settings in force for this session. |

```js
await driver.executeScript('xenon: setAutowaitProperties', [{ timeoutMs: 2000 }]);
const props = await driver.executeScript('xenon: getAutowaitProperties', []);
```

[Autowait](./autowait.md) explains each field.

## On-screen actions

These commands work from a screenshot of the phone, not from the app's element tree, so they help where a selector can't be written. Text is read from the screenshot with OCR, which needs no AI provider. Tapping a described icon, describing the screen and asserting a visual state use the AI provider you set up under [AI providers](./ai-providers.md), and send it the screenshot. [Omni-Vision](./omni-vision.md) explains how they work.

| Command | Arguments | What it does |
|---|---|---|
| `smartTap`, or `omniClick` | `{ text }`, or `{ icon }` or `{ description }`. Optionally `index` | Taps where the text is on the screen, or where the described element is. A description wins when both are given. With text, `index`, which is 1 or more, says which match to tap when the text appears more than once: `1`, the default, is the most confident match, and an `index` past the last match taps the last one. Returns `{ clicked, message, target }`, where `target` has the tapped `x` and `y`, its `rect` and a `confidence` between 0 and 1. When nothing matches, `clicked` is `false` and `message` says so. |
| `visualTap` | `{ icon }` or `{ description }` | Taps where the AI provider finds the described element, such as "the gear icon in the top right". Returns the same as `smartTap`. |
| `uiInventory`, or `uiScanExport` | Optionally `{ maxItems }` | Returns the words on the screen as a list, at most `maxItems` (200 by default, 1000 at most). Each item has `text`, `color`, `position` (such as `top left`), `aligned`, and the text `above` and `below` it. The `icon`, `icon_color` and `icon_category` fields are always `null`. |
| `analyzeScreen`, or `omniScan` | None | Returns `{ timestamp, ocr, ai_insights }`: all the text on the screen, with each word's position and confidence, and `ai_insights`, the AI provider's description of the screenshot in a few plain sentences. When there is no description, `ai_insights` is `null` and `ai_insights_error` says why: no provider is set up, its call failed, it was rate-limited, or it didn't answer within 30 seconds. When the screenshot or the OCR fails, the command returns `{ status: 'error', message }`. |
| `assertVisualState` | A string, or `{ instruction }` | Asks the AI provider whether what you describe is true of the screen. Returns `{ result, message }`: `result` is the provider's `true` or `false`, and `message` is its reason. |

A text can be one word or several, such as `Sign in`. Xenon looks for it in any case, inside a word or across neighbouring words on one line, and taps the middle of the words it covers. Two words with a wide gap between them, such as the two ends of a toolbar, don't count as neighbours. The driver must support W3C actions (`performActions`): when it doesn't, `clicked` is `false` and `message` says so. The `x`, `y` and `rect` in `target` are in the phone's own coordinates, which on an iPhone are points, not screenshot pixels.

```js
await driver.executeScript('xenon: smartTap', [{ text: 'Sign in' }]);
await driver.executeScript('xenon: smartTap', [{ description: 'the gear icon in the top right' }]);
await driver.executeScript('xenon: visualTap', [{ icon: 'shopping cart' }]);
const items = await driver.executeScript('xenon: uiInventory', [{ maxItems: 50 }]);
const screen = await driver.executeScript('xenon: analyzeScreen', []);
const check = await driver.executeScript('xenon: assertVisualState', ['The cart shows two items']);
if (!check.result) throw new Error(check.message);
```

### When a command can't look

These commands fail, instead of answering as if they had looked, when Xenon can't get an answer. `assertVisualState` and the icon and description taps depend on the AI provider, which has 30 seconds to answer each call: a call that takes longer is cancelled and counts as failed.

- **`assertVisualState`** fails when it has no condition (`invalid argument`), and when it can't check one: no screenshot, no AI provider, a failed or rate-limited call, or an answer that isn't a clear true or false. The message says the condition was not checked. It never answers `result: false` for a check it couldn't make, so a test that asserts something is absent can't pass without a look.
- **`visualTap`**, and `smartTap` with an icon or a description, fail when there is no AI provider, or the screenshot or the call fails. `clicked: false` means it looked and found nothing.
- **`smartTap` with text** fails when the screenshot or the OCR fails, and on an iPhone when Xenon can't work out the screen's size to convert the position into points, rather than tap in the wrong place. `clicked: false` means it looked and found nothing.

## Network interceptor

These commands manage the traffic Xenon captures for the session. They work on Android, when the session has switched the interceptor on with `xe:interceptor`, or when the server's `interceptor` option turns it on for every session. Otherwise they fail with `Interceptor not active for session <id>`. What they send and answer isn't kept in the session's commands, which everyone who can see the session reads: those keep each one's name and whether it worked, and the capture is shown to admins only. [Network interceptor](./network-interceptor.md) explains the capture and the format of a rule.

| Command | Arguments | What it does |
|---|---|---|
| `addMock` | A rule: `{ match, respondWith }`, `{ match, rewriteRequest }` or `{ match, rewriteResponse }`. Optionally `id` | Adds the rule and returns its `id`. When several rules match a request, the newest wins. |
| `removeMock` | `{ id }` | Removes the rule and returns `true`, or `false` when there is no such rule. |
| `clearMocks` | None | Removes every rule and returns `{ ok: true }`. |
| `getMocks` | None | Returns the rules, oldest first. |
| `getRequests` | None | Returns the requests captured so far. |
| `exportHar` | None | Returns the traffic captured so far as a HAR 1.2 document. |

```js
const id = await driver.executeScript('xenon: addMock', [{ match: { url: 'https://api.example.com/users/me' }, respondWith: { status: 200, body: { name: 'Test User' } } }]);
await driver.executeScript('xenon: removeMock', [{ id }]);
await driver.executeScript('xenon: clearMocks', []);
const mocks = await driver.executeScript('xenon: getMocks', []);
const requests = await driver.executeScript('xenon: getRequests', []);
const har = await driver.executeScript('xenon: exportHar', []);
```

## Related

- [Autowait](./autowait.md): what the autowait commands change.
- [Omni-Vision](./omni-vision.md): how Xenon finds things on the screen.
- [Network interceptor](./network-interceptor.md): capturing and mocking traffic.
- [Capabilities](./capabilities.mdx): what a test sends when it creates a session.
