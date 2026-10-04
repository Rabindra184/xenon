---
title: Inspector
description: "The inspector in device control: the screen's element tree, an element's details, suggested locators with a stability score, checks, Test, Verify and Tap, and generated test code."
---

The inspector shows the element tree of the screen on a phone you control, the way Appium sees it. Pick an element, on the phone or in the tree, and it shows the element's details, suggests locators for it, checks how well they would work, and writes test code that uses one. It works in your browser on a capture of the screen, and doesn't use the AI provider. This page explains each part.

## Open it

Open a phone in [device control](./device-control.md) and choose the **Omni-Vision** tab. The inspector captures the screen's element tree and lists it.

The line above the tree says how many elements the capture has, where the tree came from, and how old it is, such as `214 elements · Session · Captured 12 s ago`:

- **Session:** an Appium test is running on the phone, and the tree is its page source: the same tree the driver finds locators in.
- **Device:** no test is running, so the tree was read from the phone itself. It can differ a little from what a test's driver sees.

After you tap, swipe or type on the phone, the line says `The screen may have changed since this capture.` Click **Refresh** there, or the **Refresh snapshot** button on the tree's header, to capture again. When a capture fails, the reason shows with **Retry**. The commonest are a locked screen, and a screen the app marks as secure, which the phone won't read.

## Inspect and Interact

A button on the tree's header switches between two modes:

- **Inspect mode** (the default): clicking the phone's screen selects the element under the pointer, and hovering outlines it. Only the innermost elements, those with no children, can be clicked; pick a container in the tree or in the element's path.
- **Interact mode:** clicks go to the phone, as on the other tabs.

## The element tree

The **Source** panel lists the tree. Each row names its element by its text, `content-desc` or label, else the last part of its resource id, its name, or its type. An element that only wraps one child, with nothing to tap or read, shares its child's row.

- **Expand all** and **Collapse all** sit on the header.
- With the tree focused, the arrow keys move between rows, **→** and **←** open and close a row, **Home** and **End** go to the first and last row, and **Enter** or **Space** selects.
- **Search elements** matches an element's type, text, name or any attribute. A role word finds elements of that kind: `button`, `input`, `image`, `text`, `list`, `toggle` or `nav`. The count of matches shows below the box.
- Drag the divider between the tree and the details to resize them, or focus it and use the arrow keys, **Home** and **End**. Double-click it to go back to the default. Your browser remembers the split.

## The details

The details pane has three tabs: **Info**, **Checks** and **Code gen**. With no element selected, it shows the capture's **Snapshot stats** (elements, width, height and platform) and its elements **By role**.

**Info** shows the selected element:

- **Element info:** its type, its text, and its **Path** from the top of the tree. Click a step in the path to select that element.
- **Layout:** its X, Y, width and height.
- **Locators:** the suggested locators, below.
- **Attributes:** every attribute it has a value for.

## Suggested locators

The inspector suggests the locators an element allows, in this order:

1. `accessibility id`: the `content-desc` on Android, the name or label on iOS.
2. `id`: the `resource-id` on Android, the identifier on iOS.
3. On iOS, `-ios predicate string`, by type and label (or value), when the element has text, and `-ios class chain`, by type and name (or label). On Android, `-android uiautomator`, by resource id, then by text.
4. `xpath` by `resource-id`, else by text (on iOS, its label or value), else by `content-desc`.
5. The element's full path as an XPath, such as `/hierarchy[1]/android.widget.FrameLayout[1]/…`, when none of those applies.

The top of an Android tree, `hierarchy`, isn't an element, and gets no locators.

Each locator shows a stability score, `stable`, `moderate`, `fragile` or `very-fragile`, with the reason:

- `accessibility id` and `id` are stable. One with a UUID in it is fragile, and an `id` that is a long number without a package name is moderate.
- `-ios predicate string`, `-ios class chain` and `-android uiautomator` by resource id or description are stable. `-android uiautomator` by text is moderate: it breaks when the wording changes.
- An XPath from the top of the tree, or with a position such as `[2]`, is very fragile. A deep one, with more than seven `/`, is fragile. One by `content-desc`, `resource-id` or `text` is moderate. Any other XPath is fragile.
- `class name` is fragile: it is rarely unique.

Click a locator to use it in **Code gen**. Each has four buttons:

| Button | What it does |
|---|---|
| **Test** | Matches the locator against the capture, in your browser, and outlines what it matches on the phone. It shows `unique`, the number of matches, `0 matches`, or `preview unavailable` for a locator it can't match here: `-android uiautomator`, an XPath other than a full path or a single `//Type[@attribute="value"]`, a class chain other than `**/Type`, `**/Type[n]` or one attribute compared with `==`, or a predicate with anything but `==` and `AND`. |
| **Verify** | Asks the driver of the Appium test running on the phone to find the locator, and says how many elements it found and how long it took, such as `Appium found 1 element in 140ms`, or the driver's error. |
| **Tap** | Finds the element with the test's driver and taps it on the phone. It refuses when the locator matches more than one element. |
| **Copy** | Copies the locator's value. |

**Verify** and **Tap** need an Appium test running on the phone. Start the test first, then open the phone: while device control is open, its live preview holds the phone, and a new test can't start on it. With per-command authentication on (`XENON_REQUIRE_COMMAND_AUTH`), the driver refuses them: they reach Appium with your dashboard sign-in, which isn't a credential for a test's commands.

On Android, the two `-android uiautomator` suggestions share one name, so **Test**'s result, the locator chosen for **Code gen**, and the choice in its list follow the first of them.

## Checks

**Checks** runs a fixed list of checks on the selected element, in your browser, on the capture, and counts the passes, warnings and failures:

| Check | Passes when | Otherwise |
|---|---|---|
| **Unique locator** | The best locator, in Appium's order of preference (`accessibility id`, `id`, the platform's own, `-ios class chain`, `class name`, then `xpath`), matches only this element. | Fails, says what it matches, and names another locator that matches only this element, if one does. A locator it can't match here is a note. |
| **Stable locator** | That locator scores `stable` or `moderate`. | A warning, with the reason. |
| **Interactive** | The element can be tapped, typed into or scrolled. | A note: a tap there goes to whatever is under it. |
| **Enabled** | The element is enabled. | Fails: taps are ignored. |
| **Has size** | Its width and height aren't zero. | Fails: it can't be tapped or seen. |
| **On screen** | It is fully inside the screen. | A warning: scroll it into view first. |
| **Accessible name** | For an interactive element, it has text, a `content-desc` or a label. | A warning: screen readers and `accessibility id` locators have nothing to use. |

## Code gen

**Code gen** writes a short test that finds the element and acts on it, in one of four styles:

| Style | What it writes |
|---|---|
| **Java** | A TestNG test with the Appium Java client's `AppiumBy`. |
| **Python** | A test function with the Appium Python client's `AppiumBy`. |
| **JavaScript** | A WebdriverIO test, with `describe` and `it`. |
| **WebdriverIO** | WebdriverIO lines with `driver.$()`, outside a test. |

The test types into a field, scrolls a scrollable element in Java, and taps anything else. **Locator** chooses which suggestion it uses; it starts at `accessibility id` or `id` when the element has one. A locator a style can't express, such as `class name` in the two WebdriverIO styles, gives a comment saying so. The copy button on the code copies it.

The code puts the locator's value between quotes as it is. In the Java and Python code, a value with double quotes in it, as the XPath and predicate suggestions have, needs those quotes escaped before the code compiles.

## Related

- [Live device control](./device-control.md): opening a phone, the other tabs, and who may control a phone.
- [Omni-Vision](./omni-vision.md): finding elements by the text on the screen or a description.
- [Selector health](./selector-health.md): the selectors your tests could only find with self-healing.
