---
title: How healing works
description: "What Xenon does when findElement can't find an element: the six tiers, the fingerprints it learns, what your test gets back, which tiers call your AI provider, and how to turn healing off or limit it."
---

When a test's `findElement` can't find an element, Xenon looks for it in other ways before the test sees the failure. It tries six tiers in turn, cheapest first, and stops at the first one that finds the element. The test then carries on as if its selector had worked, and the [Selector health](./selector-health.md) page lists the selector so you can fix it in the test. This page explains when healing runs, what each tier does, what your test gets back, and how to turn healing off or limit it.

## When healing runs

- **On a missing element.** Healing runs when `findElement` answers "no such element". Any other error, such as an invalid selector, reaches the test as it is.
- **After autowait.** With [autowait](./autowait.md) on, Xenon first retries the find until autowait's timeout. Most selectors that look broken belong to a screen that is still loading, and a retry is cheaper than healing. Healing gets its turn when the time is up. Autowait is off by default.
- **Not for an empty list.** A `findElements` that finds nothing returns an empty list, which isn't an error, so it isn't healed.
- **With a page source and a screenshot.** Before the first tier, Xenon reads the screen's page source and takes a screenshot. If it can't get both, healing doesn't run and the test gets the original error.

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

:::caution[Resilio finds nothing in 2.14.0]

Resilio needs the element's stored path, and the database doesn't keep that path: it stores the fingerprint without it. So this tier never finds an element, and healing in practice starts at Fuzzy XML.

:::

### Fuzzy XML

Fuzzy XML scores every element in the page source and takes the best one that scores over 50%.

- **With a fingerprint** (see [Fingerprints](#fingerprints)), an element must be of the same type as the one remembered. It then scores on its text, label and name, on identifying attributes such as `content-desc`, `resource-id`, `label`, `name`, `id`, `hint` and `value`, and most of all on its position: an element within a few pixels of where the remembered one was scores highest.
- **Without one,** Xenon takes the words in your selector, those of three letters or more, leaving out `and`, `or`, `text`, `contains`, `xpath` and `element`. It compares them with each element's type, text and attributes, and similar spellings count too.

For the element it picked, Xenon writes XPaths, by its name, label, `content-desc`, `resource-id`, value or text, under its parent, and its full path, and asks the driver for each until one finds it. The heal's confidence is the element's score.

### OCR

OCR reads the words on a screenshot with Tesseract, on the Xenon server. Nothing is sent anywhere. The text it looks for comes from your selector: the value given for `text`, `content-desc`, `label` or `name`, such as `Login` in `//*[@text='Login']`, or else the last part of the selector longer than three characters.

It matches one word at a time. It takes the first word it reads that contains the text, or that is part of it. For `Sign in`, that is the first `Sign` or `in` on the screen, whichever it reads first. (The [Omni-Vision](./omni-vision.md) locators and commands match text of several words; this tier doesn't.) The heal's confidence is the OCR's confidence in that word.

On an iPhone, Xenon then asks the driver for an element whose label contains that word, and uses it when there is one. Otherwise OCR gives a position on the screen; see [What your test gets back](#what-your-test-gets-back). The first time OCR runs, the server downloads its language data; see [Omni-Vision](./omni-vision.md#ocr-and-ai-vision).

### Visual AI

Visual AI sends the screenshot and a description of what to find to your AI provider. The description comes from your selector:

- `the element with text "Login"`, from a `text`, `label`, `name` or `content-desc` value in it;
- `the element with ID or identifier "…"`, from an `id` or `resource-id` value;
- otherwise `the element described by the locator "<your selector>"`.

The provider answers with a point on the screenshot, and Xenon takes a small box around it. Its confidence is always 80%: the provider doesn't give one.

### LLM

The LLM tier sends your AI provider your selector, its strategy, the first 10,000 characters of the page source and the screenshot, and asks for an XPath for the element you meant. Xenon then asks the driver for that XPath, and uses the element when the driver finds it. Its confidence is always 95%, a fixed value.

## Fingerprints

A fingerprint is what Xenon remembers about the element a selector found: its type, the identifying attributes it has (`content-desc`, `resource-id`, `text`, `name`, `id`, `hint`, `label`, `value`), and its position and size. Fuzzy XML uses it.

- **Learnt from a find that worked.** After a `findElement` finds its element, Xenon records a fingerprint for that selector if it has none yet. It reads the element in the background, after the find has answered. A selector's first fingerprint is kept: later finds don't refresh it.
- **Updated by a heal.** After a Resilio or Fuzzy XML heal with a confidence above 70%, Xenon replaces the fingerprint with the healed element's, as long as one of the XPaths it wrote for the element matches that element alone. Heals by OCR, Visual AI and the LLM don't change it.
- **One per selector.** The fingerprint is kept by the selector's text, in the server's database, and every session and team on the server shares it.
- **Only where the dashboard runs.** Xenon learns on a server with the dashboard on, and never on a node. Turning healing off stops the learning as well.
- **One at a time.** Each session learns one selector at a time. A find made while another is being learnt isn't learnt then; a later run of the same find is.

## The suggested fix

Every heal records what found the element, which [Selector health](./selector-health.md) and the session's page show as the suggested fix:

- **Resilio and Fuzzy XML:** the first of the XPaths Xenon wrote that matches exactly one element on the screen, else the one the driver found.
- **LLM:** the XPath the provider answered with.
- **OCR and Visual AI:** a note of what was seen, such as `ocr:text="Login"` or `visual:description="…"`. That is a place on the screen, not a selector, so there is no code to copy for it.

## What your test gets back

The test gets an element, exactly as from a find that worked. For `findElements`, it gets a list holding that one element.

- **Resilio, Fuzzy XML and LLM** return a real element: the driver found it with the healed XPath.
- **OCR on an iPhone** returns a real element when one has a label containing the word.
- **OCR otherwise, and Visual AI,** find a position. On an iPhone, Xenon first asks the driver for an element that covers that spot, and returns it when there is one. Otherwise, and always on Android, Xenon taps the middle of the spot at once, during the find, and returns a virtual element whose id starts with `healed_ocr` or `healed_visual`.

A virtual element answers the same commands as Omni-Vision's; see [What works on a virtual element](./omni-vision.md#what-works-on-a-virtual-element). Two things differ for one that healing returned:

- The tap during the find has already happened. A `click` on the element taps the same spot again.
- `getText` answers Xenon's note about the match, such as `Found text "Login" via local OCR (92% confidence)`, not the element's own text.

On an iPhone, a position found in the screenshot is converted to the driver's points before Xenon taps it. If the screen's size can't be read to do that, the tier counts as having found nothing, and the next tier runs.

## Where heals show up

A healed find isn't an error: the command succeeded, and it doesn't fail the session.

With the dashboard on, Xenon records each heal with the session: the selector the test asked for, what it healed to, the tier and its confidence. The session's page lists them on its **Self-healing** card (see [Sessions and builds](./sessions.md#self-healing)), and [Selector health](./selector-health.md) adds them up per selector. Without the dashboard, healing still runs and nothing is recorded.

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

With healing off, a missing element fails at once, or after autowait's timeout, and Xenon doesn't learn fingerprints either.

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

This session heals with Fuzzy XML and OCR only, so its screenshots and page source never go to your AI provider. A tier you leave out is skipped.

`healingTiers` only narrows healing. An empty list, or one with no numbers in it, runs every tier, and it can't turn healing on for a server where it is off. To stop healing, use the option or the switch above. [Capabilities](./capabilities.mdx#what-goes-in-xeoptions) lists the other fields of `xe:options`.

## Which tiers call your AI provider

Only Visual AI and the LLM, and only when an AI provider is set up. Without one, both are skipped and nothing leaves the server. Resilio, Fuzzy XML and OCR run on the Xenon server.

| Tier | What is sent |
|---|---|
| Visual AI | The screenshot, and a description made from your selector. |
| LLM | Your selector and its strategy, the first 10,000 characters of the page source, and the screenshot. |

The page source and the screenshot hold whatever the app shows, personal data included. When that matters, use a local Ollama model, leave the provider unset, or keep those sessions to the first tiers with `healingTiers`. [AI providers](./ai-providers.md) explains the setup, and what happens when a provider keeps failing.

## On a hub

A session on a node's phone heals on the node:

- by the node's own switch and option, and with the node's AI provider;
- without fingerprints learnt there, since a node doesn't learn them;
- with nothing recorded. The node keeps no record of a session its hub created, and the hub sees only the element the node answered with. Such a heal shows neither on the session's page nor in Selector health.

## Related

- [Selector health](./selector-health.md): the selectors that needed healing, and their suggested fixes.
- [Autowait](./autowait.md): the retry that runs before healing.
- [AI providers](./ai-providers.md): setting up the provider the AI tiers use.
- [Omni-Vision](./omni-vision.md): finding elements by text or description on purpose.
- [Configuration](./configuration.md): `enableSelfHealing` and the other server options.
