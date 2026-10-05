---
title: How healing works
description: "What Xenon does when findElement can't find an element: the six tiers, the fingerprints it learns, what your test gets back, which tiers call your AI provider, and how to turn healing off or limit it."
---

When a test's `findElement` can't find an element, Xenon looks for it in other ways before the test sees the failure. It tries six tiers in turn, cheapest first, and stops at the first one that finds the element. The test then carries on as if its selector had worked, and the [Selector health](./selector-health.md) page lists the selector so you can fix it in the test. This page explains when healing runs, what each tier does, what your test gets back, and how to turn healing off or limit it.

## When healing runs

- **On a missing element.** Healing runs when `findElement` answers "no such element". Any other error, such as an invalid selector, reaches the test as it is.
- **After autowait.** With [autowait](./autowait.md) on, Xenon first retries the find until autowait's timeout. Most selectors that look broken belong to a screen that is still loading, and a retry is cheaper than healing. Healing gets its turn when the time is up. Autowait is off by default.
- **Not for an empty list.** A `findElements` that finds nothing returns an empty list, which isn't an error, so it isn't healed.
- **With a page source and a screenshot.** Before the first tier, Xenon reads the screen's page source and takes a screenshot. If it can't get both, healing doesn't run and the test gets the original error. A session that allows no tier (`healingTiers: []`, see [Choose tiers for one session](#choose-tiers-for-one-session)) isn't healed, and Xenon reads neither.

The tiers run one after the other. A tier that finds nothing, or fails, hands over to the next one. When none finds the element, the test gets the original "no such element" error.

Healing is on by default. It takes time: each tier reads the screen or waits for an answer, and the AI tiers wait for your provider. The **Time spent healing** number on [Selector health](./selector-health.md#the-numbers-at-the-top) adds it up.

## The six tiers

| Tier | Name | How it looks for the element | Calls your AI provider |
|---|---|---|---|
| 0 | **Resilio** | The element's path through the screen's element tree, stored from an earlier run, compared with the tree on screen now. | No |
| 1 | **Native** | Your selector as written: the find that just failed. With autowait on, it was retried until the timeout. Healing starts when it has failed. | No |
| 2 | **Fuzzy XML** | The page source compared with the element's stored fingerprint, or, without one, with the words in your selector. | No |
| 3 | **OCR** | The text in your selector, read off a screenshot on the Xenon server. | No |
| 4 | **Visual AI** | A screenshot and a description of the element, sent to your AI provider. | Yes |
| 5 | **LLM** | Your selector, the page source and a screenshot, sent to your AI provider, which answers with an XPath. | Yes |

### Resilio

Resilio remembers the path a selector's element had through the screen's element tree when Xenon learnt the selector's [fingerprint](#fingerprints): the element and each of its parents, with their types, ids and attributes. When the selector breaks, it looks on the screen now for the element at the end of the most similar path, and uses it only when it is sure:

- **The element kept its identity and moved.** Its `resource-id` on Android, or its `name` on an iPhone, is the same, but the layout around it changed: a new row above it, a wrapper around it. That is how a positional XPath such as `//*[@resource-id='com.example:id/form']/android.widget.Button[2]` breaks. Such an element scores about 99% wherever it moved.
- **No other element comes close** to its score.
- **It still has what your XPath states.** When your selector names a text, description, label, name or value, such as `@text='OK'`, the element must still have it: a dialog button that now reads `Delete` isn't healed to.

An element whose id changed, or that is gone, scores far lower, with its neighbours close behind, so Resilio leaves it to Fuzzy XML rather than guess. For the element it takes, Xenon writes XPaths as Fuzzy XML does, keeps those that match that element alone on the screen, and asks the driver for each until one finds it. The heal's confidence is the element's score.

Resilio needs the path, which Xenon learns with the selector's [fingerprint](#fingerprints). A selector whose fingerprint has no path yet is left to the next tier.

### Fuzzy XML

Fuzzy XML scores every element in the page source and takes the best one that scores over 50%.

- **With a fingerprint** (see [Fingerprints](#fingerprints)), an element must be of the same type as the one remembered. It then scores on its text, label and name, on identifying attributes such as `content-desc`, `resource-id`, `label`, `name`, `id` and `hint`, and most of all on its position: an element within a few pixels of where the remembered one was scores highest.
- **Not an element whose id names another one.** When the fingerprint has an id and the element has a different one, or none, the element is picked only if its text, label or `content-desc` reads the same as the remembered one's, case and punctuation aside. However close its position, "Log out" doesn't stand in for "Log in", nor `pay_later` for `pay`. A button whose id was renamed and kept its text still does. The id is an Android `resource-id`, compared without the app's package, or an iPhone's accessibility identifier: its `name`, when that isn't just its label. Two ids are the same when they have the same words, however written: `btn-pay`, `pay_btn` and `payBtn`. When the fingerprint has no id, as for an iPhone element without an accessibility identifier, or an Android one without a `resource-id`, Fuzzy XML goes by the scores alone, with position counting most.
- **Not with a fingerprint that holds only a position.** One that says nothing about which element it is isn't used: Fuzzy XML matches as if there were none, and Xenon learns the fingerprint again. Otherwise, on an unexpected screen, a broken selector could heal to whatever button took its place.
- **Without one,** Xenon takes the words in your selector, those of three letters or more, leaving out `and`, `or`, `text`, `contains`, `xpath` and `element`. It compares them with each element's type, text and attributes, and similar spellings count too.

For the element it picked, Xenon writes XPaths, by its name, label, `content-desc`, `resource-id`, value or text, under its parent, and its full path, and asks the driver for each until one finds it. The heal's confidence is the element's score.

### OCR

OCR reads the words on a screenshot with Tesseract, on the Xenon server. Nothing is sent anywhere. The text it looks for comes from your selector: the value given for `text`, `content-desc`, `label` or `name`, such as `Login` in `//*[@text='Login']`, or else the last part of the selector longer than three characters.

It looks for the text as the [`-custom:ai-text`](./omni-vision.md#locator-strategies) locator does: in any case, inside a word or across neighbouring words on one line, so `Sign in` matches the words `Sign` and `in`, and only words read with a confidence above 60% count. It takes the first match in reading order. The heal's confidence is the OCR's confidence in the words it matched, the lowest of them.

On an iPhone, Xenon then asks the driver for an element whose label contains that text, and uses it when there is one. Otherwise OCR gives a position on the screen; see [What your test gets back](#what-your-test-gets-back). The tier reads with Omni-Vision's OCR, whose language data comes with the plugin; see [Omni-Vision](./omni-vision.md#ocr-and-ai-vision).

### Visual AI

Visual AI sends the screenshot and a description of what to find to your AI provider. The description comes from your selector:

- `the element with text "Login"`, from a `text`, `label`, `name` or `content-desc` value in it;
- `the element with ID or identifier "…"`, from an `id` or `resource-id` value;
- otherwise `the element described by the locator "<your selector>"`.

The provider answers with a point on the screenshot, and Xenon takes a small box around it. Its confidence is always 80%: the provider doesn't give one.

### LLM

The LLM tier sends your AI provider your selector, its strategy, the first 10,000 characters of the page source and the screenshot, and asks for an XPath for the element you meant. Xenon then asks the driver for that XPath, and uses the element when the driver finds it. Its confidence is always 95%, a fixed value.

## Fingerprints

A fingerprint is what Xenon remembers about the element a selector found: its type, the identifying attributes it has (`resource-id`, `content-desc`, `text` and `hint` on Android, `name` and `label` on an iPhone, and those in the page source when a heal writes it), its position and size (on Android, only when it was learnt from a find: a heal reads the page source, which gives Android's rect as `bounds`), and its path through the screen's element tree. Fuzzy XML uses the attributes and the position, and Resilio the path. It doesn't keep an element's value, which on a text field is what the test typed.

- **Learnt from a find that worked.** After a `findElement` finds its element, Xenon records a fingerprint for that selector if it has none yet. It reads the element in the background, after the find has answered. On an iPhone that read, the page source above all, can delay the test's next command, once per new selector. A selector's first fingerprint is kept: later finds don't refresh it.
- **The path** comes from the page source Xenon reads then, where it looks for the element by the attributes it read. If the screen has changed by then and no element there shares an identifying attribute or its exact position with it, or two match it equally well, the fingerprint is kept without a path. A fingerprint without a path, or without any attribute that says which element it is, is learnt once more, the next time its selector works after the server starts.
- **Written by a heal.** After a Resilio or Fuzzy XML heal with a confidence above 70%, Xenon writes the healed element's fingerprint for the selector, with its path, replacing any it had, as long as one of the XPaths it wrote for the element matches exactly one element on the screen. Heals by OCR, Visual AI and the LLM don't change it.
- **One per selector.** The fingerprint is kept by the selector's text, in the server's database, and every session and team on the server shares it.
- **Where each happens.** Xenon learns from every session a server drives, on a node or a server with `enableDashboard` off too, except from a session that turned its own healing off with `healingTiers: []`. A heal writes its fingerprint on any server. Turning healing off stops both.
- **One at a time.** Each session learns one selector at a time. A find made while another is being learnt isn't learnt then; a later run of the same find is.

## The suggested fix

Every heal records what found the element, which [Selector health](./selector-health.md) and the session's page show as the suggested fix:

- **Resilio and Fuzzy XML:** the first of the XPaths Xenon wrote that matches exactly one element on the screen, else the one the driver found.
- **LLM:** the XPath the provider answered with.
- **OCR and Visual AI:** a note of what was seen, such as `ocr:text="Login"` or `visual:description="…"`. That is a place on the screen, not a selector, so there is no code to copy for it.

## What your test gets back

The test gets an element, exactly as from a find that worked. For `findElements`, it gets a list holding that one element.

- **Resilio, Fuzzy XML and LLM** return a real element: the driver found it with the healed XPath.
- **OCR on an iPhone** returns a real element when one has a label containing the text.
- **OCR otherwise, and Visual AI,** find a position. Xenon returns a virtual element there, whose id starts with `healed_ocr` or `healed_visual`. Nothing is tapped during the find: your test's own `click` taps the middle of the spot, once.

A virtual element answers the same commands as Omni-Vision's; see [What works on a virtual element](./omni-vision.md#what-works-on-a-virtual-element). Its `getText` answers the text OCR read, and fails with `unsupported operation` for an element Visual AI found, which reads no text.

On an iPhone, a position found in the screenshot is converted to the driver's points, which a tap uses. If the screen's size can't be read to do that, the tier counts as having found nothing, and the next tier runs.

## Where heals show up

A healed find isn't an error: the command succeeded, and it doesn't fail the session.

With the dashboard on, Xenon records each heal with the session: the selector the test asked for, what it healed to, the tier and its confidence. The session's page lists them on its **Self-healing** card (see [Sessions and builds](./sessions.md#self-healing)), and [Selector health](./selector-health.md) adds them up per selector. Without the dashboard, healing still runs and nothing is recorded. A heal on a node's phone is recorded on the hub; see [On a hub](#on-a-hub).

## Turn healing off

Healing is on unless you turn it off, in one of two ways:

- **In the server's config file,** set `enableSelfHealing: false`, and restart Appium. [Configuration](./configuration.md) lists the option.

  ```yaml
  server:
    use-plugins: [xenon]
    plugin:
      xenon:
        enableSelfHealing: false
  ```

- **On the dashboard,** a super admin turns off the **AI self-healing** switch on the **Settings** page and clicks **Save Configuration**. It applies from the next command, with no restart. A value saved there replaces the config file's until someone changes it on the page again.

With healing off, a missing element fails at once, or after autowait's timeout, and Xenon doesn't learn fingerprints either. A single session can turn its own healing off with `healingTiers: []`; see [Choose tiers for one session](#choose-tiers-for-one-session).

The switch and the option belong to the server they are set on. On a hub, a session on a node's phone runs its commands on the node, so it heals by the node's setting. See [Hub and nodes](./hub-and-nodes.md#what-each-server-decides-for-itself).

## Choose tiers for one session

A session can narrow the tiers it uses with `healingTiers` in `xe:options`. Here the numbers are `1` Resilio, `2` Fuzzy XML, `3` OCR, `4` Visual AI and `5` LLM. Native has no number: your selector always runs first.

```js
const capabilities = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'xe:options': {
    accessKey: process.env.XENON_ACCESS_KEY,
    token: process.env.XENON_TOKEN,
    healingTiers: [2, 3],
  },
};
```

This session heals with Fuzzy XML and OCR only, so healing never sends its screenshots or page source to your AI provider. A tier you leave out is skipped.

Xenon reads `healingTiers` from the session itself, on every session, whatever the server's `enableDashboard` and the session's video say.

- **A list of tier numbers** from 1 to 5 runs exactly those.
- **An empty list** runs none: the session isn't healed.
- **Any other value**, such as `"1,2"`, `["1", "2"]` or `[1, 6]`, runs only tiers 1, 2 and 3, which stay on the server. The first time one of the session's finds needs healing, the server's log says it couldn't read the value. An `xe:options` that isn't an object counts as such a value; `null` counts as not set.

`healingTiers` can't turn healing on where the option or the switch above has it off. [Capabilities](./capabilities.mdx#what-goes-in-xeoptions) lists the other fields of `xe:options`.

## Which tiers call your AI provider

Only Visual AI and the LLM, and only when an AI provider is set up. Without one, both are skipped and nothing leaves the server. Resilio, Fuzzy XML and OCR run on the Xenon server.

| Tier | What is sent |
|---|---|
| Visual AI | The screenshot, and a description made from your selector. |
| LLM | Your selector and its strategy, the first 10,000 characters of the page source, and the screenshot. |

The page source and the screenshot hold whatever the app shows, personal data included. When that matters, use a local Ollama model, set up no AI provider (no provider's key in the server's environment, config file or command line, `GEMINI_API_KEY` included, and no Ollama chosen, on the **AI engine** page or anywhere else: see [AI providers](./ai-providers.md#what-uses-the-provider)), turn healing off, or keep those sessions to the first three tiers with `healingTiers`; see [Choose tiers for one session](#choose-tiers-for-one-session). `healingTiers` covers healing only: [failure analysis](./failure-analysis.md) still sends a failed session's newest screenshot, when one was kept. [AI providers](./ai-providers.md) explains the setup, and what happens when a provider keeps failing.

## On a hub

A session on a node's phone heals on the node:

- by the node's own switch and option, and with the node's AI provider;
- with the node's own fingerprints, which it learns from finds that worked and writes after its heals, in its own database;
- recorded on the hub, with the session, as a heal on the hub's own phones is, when the hub's dashboard is on. The node keeps no record of a session its hub created, so it hands the heal back to the hub with its answer, and the session's page and Selector health show it.

## Related

- [Selector health](./selector-health.md): the selectors that needed healing, and their suggested fixes.
- [Autowait](./autowait.md): the retry that runs before healing.
- [AI providers](./ai-providers.md): setting up the provider the AI tiers use.
- [Omni-Vision](./omni-vision.md): finding elements by text or description on purpose.
- [Configuration](./configuration.md): `enableSelfHealing` and the other server options.
