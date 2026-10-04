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

- The commands that change the dashboard return `null`. The others return the value described below.
- A `xenon:` or `xe:` script Xenon doesn't know does nothing and returns `null`. The server log says `Unknown command`. Check the spelling if a command seems to be ignored.
- Autowait also answers to its older names, `plugin: setWaitPluginProperties` and `plugin: getWaitPluginProperties`. See [Autowait](./autowait.md#older-names).

### Sessions on a node's phone

On a hub, a session on a node's phone goes through the hub, and what happens to these scripts depends on the hub's dashboard:

- **The hub's dashboard is on.** The hub answers every `xenon:` or `xe:` script itself. The five [session-details](#session-details) commands work, and write to the hub's record of the session. The autowait, on-screen and network commands answer `null` and do nothing.
- **The hub's dashboard is off.** The hub passes the scripts to the node. The autowait, on-screen and network commands work there. The session-details commands fail or do nothing, because the node keeps no record of the session.

Sessions on the hub's own phones have neither limit.

## Session details

These commands put information on the session's page in the dashboard. They write to the session's record, which Xenon keeps only when the dashboard is on (`--plugin-xenon-enable-dashboard`). With the dashboard off there is no record to write to: `setSessionName`, `setSessionStatus` and `debug` raise a database error in your test, and `addTag` and `captureEvidence` do nothing. Turn the dashboard on before a suite sends them.

| Command | Arguments | What it does |
|---|---|---|
| `setSessionName` | A string, or `{ name }` | Names the session on the dashboard. |
| `setSessionStatus` | `{ status, reason }`, or the two values as separate arguments | Marks the session `passed` or `failed`, with an optional reason. `status` is `passed`, `success` (the same thing) or `failed`, in any case. Any other value is ignored, with a warning in the server log. The dashboard updates at once. |
| `addTag` | A string, or `{ tag }` | Adds a tag to the session. A tag the session already has is not added twice. The tags show in the session's details. |
| `debug` | A string, or `{ message }` | Adds the message to the session's Debug logs. |
| `captureEvidence` | A string, or `{ reason, label }` | Takes a screenshot now and adds it to the session as an entry named "Evidence Captured". `reason` is shown with it, and is `Manual capture` when you give none. `label` is kept in the entry. |

```js
await driver.executeScript('xenon: setSessionName', ['Checkout: pay by card']);
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

These commands work from a screenshot of the phone, not from the app's element tree, so they help where a selector can't be written. Text is read from the screenshot with OCR, which needs no AI provider. Tapping a described icon and asserting a visual state use the AI provider you set up under [AI providers](./ai-providers.md), and `analyzeScreen` adds that provider's notes when there is one. [Omni-Vision](./omni-vision.md) explains how they work.

| Command | Arguments | What it does |
|---|---|---|
| `smartTap`, or `omniClick` | `{ text }`, or `{ icon }` or `{ description }`. Optionally `index` | Taps where the word is on the screen, or where the described element is. A description wins when both are given. With text, `index` says which match to tap when the word appears more than once: `1`, the default, is the most confident match. Returns `{ clicked, message, target }`, where `target` has the tapped `x` and `y`, its `rect` and a `confidence` between 0 and 1. When nothing matches, `clicked` is `false` and `message` says so. |
| `visualTap` | `{ icon }` or `{ description }` | Taps where the AI provider finds the described element, such as "the gear icon in the top right". Returns the same as `smartTap`. |
| `uiInventory`, or `uiScanExport` | Optionally `{ maxItems }` | Returns the words on the screen as a list, at most `maxItems` (200 by default, 1000 at most). Each item has `text`, `color`, `position` (such as `top left`), `aligned`, and the text `above` and `below` it. The `icon`, `icon_color` and `icon_category` fields are always `null`. |
| `analyzeScreen`, or `omniScan` | None | Returns `{ timestamp, ocr, ai_insights }`: all the text on the screen, with each word's position and confidence, and `ai_insights`, which is `null` when no AI provider is set up or its call fails. Don't rely on `ai_insights`: the provider isn't given the screenshot, so its text isn't an analysis of your screen. When the analysis fails, the command returns `{ status: 'error', message }`. |
| `assertVisualState` | `{ instruction }` | Meant to ask the AI provider whether what you describe is true of the screen. Returns `{ result, message }`, but see the caution below before you rely on it. |

Text is read one word at a time, and a match is any word that contains your text, in any case. A phrase such as `Sign in`, with a space in it, never matches, so give one word, such as `Checkout`. A text tap taps the middle of the word it found. The driver must support W3C actions (`performActions`): when it doesn't, `clicked` is `false` and `message` says so.

```js
await driver.executeScript('xenon: smartTap', [{ text: 'Checkout' }]);
await driver.executeScript('xenon: smartTap', [{ description: 'the gear icon in the top right' }]);
await driver.executeScript('xenon: visualTap', [{ icon: 'shopping cart' }]);
const items = await driver.executeScript('xenon: uiInventory', [{ maxItems: 50 }]);
const screen = await driver.executeScript('xenon: analyzeScreen', []);
const check = await driver.executeScript('xenon: assertVisualState', [{ instruction: 'The cart shows two items' }]);
```

:::caution[assertVisualState passes without checking]
`assertVisualState` answers `{ result: true, message: 'Assertion placeholder' }` whenever the AI gives no `result`. That happens when no AI provider is set up, and whenever its call fails. It normally happens even with a provider, because Xenon's request asks the provider for coordinates, not for a verdict. A `false` comes only from an error taking the screenshot, or from a reply that happens to carry a `result`. A test that checks only `result` therefore passes without checking anything. Guard it:

```js
const check = await driver.executeScript('xenon: assertVisualState', [{ instruction: 'The cart shows two items' }]);
if (check.result !== true || check.message === 'Assertion placeholder') throw new Error(check.message);
```

Pass the instruction in an object, as above: a bare string in the argument list is read as an empty instruction.
:::

## Network interceptor

These commands manage the traffic Xenon captures for the session. They work on Android, when the session has switched the interceptor on with `xe:interceptor`. Otherwise they fail with `Interceptor not active for session <id>`. [Network interceptor](./network-interceptor.md) explains the capture and the format of a rule.

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
