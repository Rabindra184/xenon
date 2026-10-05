---
title: Omni-Vision
description: "Find elements by the text on the screen or by a description, with the -custom:ai-text and -custom:ai-icon locators and the on-screen execute commands: how they work, what a virtual element answers, and what needs an AI provider."
---

Omni-Vision finds things on the phone's screen by what is shown, not through the app's element tree. Text is read off a screenshot with OCR, and anything you can describe, such as "the gear icon in the top right", is found by your AI provider in a screenshot. It helps where a selector is hard to write: a canvas, a game, a web view, an image button with no label. A test reaches it through two locator strategies and a set of execute commands, and two API routes do the same on any phone without a test. This page explains each, and what you get back.

## OCR and AI vision

| | OCR | AI vision |
|---|---|---|
| Finds | Text, one word or several | Anything you can describe |
| Runs | On the Xenon server, with Tesseract | At your [AI provider](./ai-providers.md) |
| Needs | Nothing | An AI provider set up for the server |
| Sends out | Nothing | The screenshot and your description |

- **OCR's language data.** Tesseract's English language data comes with the plugin, so OCR works on a server with no internet access, and nothing is downloaded or written outside the plugin's folder. Through 2.14 the server downloaded it from `cdn.jsdelivr.net` the first time OCR ran, and saved it as `eng.traineddata` in the directory the Appium server was started from. You can delete that file.
- **One OCR at a time.** The OCR in the locators and commands below, and in self-healing's OCR tier, reads one screenshot at a time on each server, and others wait their turn, so OCR in many parallel sessions adds up. AI vision doesn't wait in this queue.
- **Without a provider,** AI vision finds nothing, and the commands that depend on it fail and say why. OCR works with no provider.

## Locator strategies

Two strategies find an element with Omni-Vision instead of the driver:

| Strategy | What it finds |
|---|---|
| `-custom:ai-text` | Text on the screen, read with OCR. |
| `-custom:ai-icon` | What you describe, found by your AI provider. |

Send them as the strategy (`using`) of an ordinary find:

```js
// WebdriverIO
const el = await driver.findElement('-custom:ai-text', 'Sign in');
await driver.elementClick(el['element-6066-11e4-a52e-4f735466cecf']);

const gear = await driver.findElement('-custom:ai-icon', 'the gear icon in the top right');
```

```python
# Appium Python client
driver.find_element(by='-custom:ai-text', value='Sign in').click()
```

- **Text** is matched in any case, inside a word or across neighbouring words on one line, so `Sign in` matches the words `Sign` and `in`, and `password` matches `password?`. Two words with a wide gap between them, such as the two ends of a toolbar, aren't neighbours. Only matches read with a confidence above 60% count.
- **`findElements`** with `-custom:ai-text` returns every match, in reading order, top to bottom and left to right, and `findElement` returns the first. With `-custom:ai-icon` there is at most one match: the provider names a point, and the element is a small box around it.
- **Positions** are the phone's own coordinates. On an iPhone, which taps in points, Xenon converts what it found in the screenshot's pixels to points.
- **No autowait.** These finds look once. [Autowait](./autowait.md) doesn't retry them, so wait for the screen yourself first.
- **When nothing matches,** `findElements` returns an empty list, and `findElement` fails with the standard `no such element` error, so a client wait that retries on that error keeps retrying. [Self-healing](./self-healing.md) doesn't run on these finds: they have already looked at the screen. Through 2.14 `findElement` failed with an `unknown error` (`AI Vision failed to find matching element`), and self-healing then ran on it.
- **With no AI provider,** `-custom:ai-icon` finds nothing, as if nothing matched.

## What works on a virtual element

An element found this way isn't in the app's element tree, so the driver doesn't know it. It is a box on the screen with an id that starts with `omni_ocr_` or `omni_ai_`, and Xenon answers its commands itself:

| Command | What it does |
|---|---|
| `click` | Taps the middle of the box. |
| `getElementRect`, `getElementLocation`, `getElementSize` | The box, in the phone's coordinates. |
| `getText` | The text it matched, for `-custom:ai-text`. For `-custom:ai-icon` it fails with `unsupported operation`: AI vision reads no text. |
| `isDisplayed`, `isEnabled` | Always `true`. |
| `setValue` (send keys) | Taps the box, then types the text into the field that has the keyboard focus. If no field took the focus, it fails with `element not interactable`. With a driver that can't say which field has the focus, it fails with `unsupported operation` before tapping. |
| Any other command | Fails with `unsupported operation`, naming the commands above. It never reaches the driver. |

The box is where the text or the described thing was in the screenshot taken for the find. If the screen scrolls or changes, a tap lands where it used to be. Xenon keeps the ids in the server's memory until the server restarts.

Through 2.14 `getText` on an element from `-custom:ai-icon` answered an empty text, `setValue` tapped and then failed, and any other command went to the driver, which failed.

Self-healing's OCR and Visual AI tiers can return elements like these too, with ids that start with `healed_`, and they answer the same commands. See [What your test gets back](./self-healing.md#what-your-test-gets-back).

## Execute commands

A test can also tap and check by what is on the screen with [execute commands](./execute-commands.md#on-screen-actions):

| Command | Uses |
|---|---|
| `smartTap` (or `omniClick`) with `text` | OCR |
| `smartTap` with `icon` or `description`, and `visualTap` | AI vision |
| `uiInventory` (or `uiScanExport`) | OCR |
| `analyzeScreen` (or `omniScan`) | OCR for the words, AI vision for its description of the screen |
| `assertVisualState` | AI vision |

`smartTap` with text looks for text the same way as `-custom:ai-text`, except that it also counts matches read with a confidence of 60% or less. It taps the most confident match unless you give an `index`, and taps in the phone's coordinates. [Execute commands](./execute-commands.md#on-screen-actions) gives each command's arguments and answers, and what each does when it can't look.

## Omni-Vision in device control

The **Omni-Vision** tab of [device control](./device-control.md) holds the [Inspector](./inspector.md), which reads the screen's element tree and suggests locators. It doesn't use OCR or the AI provider.

Two API routes run Omni-Vision on any phone you can control, with no test running on it:

- `GET /xenon/api/control/<udid>/omni-scan` reads the screen as `analyzeScreen` does: every word with its confidence and box, and the AI provider's description of the screen, or `ai_insights_error` saying why there is none. It can take tens of seconds.
- `POST /xenon/api/control/<udid>/test-locator` tries `-custom:ai-text` or `-custom:ai-icon` on the screen now, as a find in a test would, and returns the matches with their virtual element ids. Here, positions are in the screenshot's pixels.

```bash
curl -X POST http://localhost:4723/xenon/api/control/<udid>/test-locator \
  -H "x-xenon-access-key: $XENON_ACCESS_KEY" -H "x-xenon-token: $XENON_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"strategy":"-custom:ai-text","selector":"Sign in"}'
```

The locator test answers `200` with an empty `value` when nothing matches, and `500` when it couldn't look: a failed screenshot or OCR, or for `-custom:ai-icon` no AI provider or a failed call. It needs the `devices` scope, and is refused while another user holds the phone. On a hub, both routes run on the hub for a node's phone, with the hub's AI provider, on a screenshot the node takes. A cloud provider's phone answers `501`. The [API reference](/api) has their answers in full.

## Related

- [Execute commands](./execute-commands.md): the on-screen commands, with their arguments.
- [AI providers](./ai-providers.md): setting up the provider AI vision uses.
- [Inspector](./inspector.md): the element tree in device control.
- [How healing works](./self-healing.md): the healing tiers that use OCR and AI vision.
