# Omni-Vision: Checks tab, stale capture, labels — design

Date: 2026-09-26
Status: approved in brainstorming ("go"), first of two Omni-Vision PRs. The
two-column layout redesign is separate.

## Why

Reviewed live on the lab Galaxy S9+ (66-element capture):

- **"AI Insight" isn't AI.** `analyzeElement()` runs rules in the browser,
  and the code even labels its rule sets "AI ENGINE 1–4". The tab restates
  Info in prose, repeats Info's top locator as "Recommended Locator", and
  repeats the attributes as "Quick Facts".
- **It says "Interactable" for things you can't tap.** The rule is
  `clickable || enabled`, so any enabled container qualifies, while its own
  sentence says "It is a visual container."
- **The capture goes stale silently.** After a tap or swipe on the phone,
  the tree, the highlights and the locators still describe the old screen.
  Highlights then point at the wrong things, and nothing says so.
- **Refresh has no race guard.** A slow earlier capture can overwrite a
  newer one.
- **Icon buttons have no names.** Four on the tree header and four on each
  locator give their meaning only on hover, and screen readers get nothing.
- **Style drift:** emoji for roles and frameworks where the app uses lucide
  icons, and Title Case headings.

Decisions made in brainstorming:

| Question | Decision |
|---|---|
| The tab's name | **Checks**, refocused on actionable findings about the selected element |
| Scope | This fix PR first (no layout change); the layout redesign after |

## Behaviour

### Checks tab

The tab replaces AI Insight in the same position: Info · Checks · Code gen.
Its tooltip reads "Checks for this element". It is disabled until an element
is selected, as today.

At the top, a summary: "✓ 5 passed · ⚠ 1 warning · ✕ 1 failed", counting
only the checks that apply. Below it, one row per check: a status icon
(`CircleCheck` for pass, `TriangleAlert` for warning, `CircleX` for fail,
`Info` for info), the check's label, and a one-line detail.

| id | Label | Pass | Otherwise |
|---|---|---|---|
| `unique` | Unique locator | The best locator matches only this element in the capture: "`id` android:id/content matches only this element" | **fail** "matches N elements" or "matches nothing in this capture". It suggests another locator that is unique, if one exists ("use `accessibility id` Search instead"). **info** if the matcher can't evaluate the strategy ("Can’t check `-android uiautomator` locators here"), and **fail** "No locator suggested" if there are none. |
| `stable` | Stable locator | The best locator scores stable or moderate, and the detail is the scorer's reason | **warn**, with the scorer's reason (fragile or very fragile) |
| `interactive` | Interactive | Clickable, long-clickable, checkable or scrollable, an editable field, or an iOS control type | **info** "Not interactive — a tap here goes to whatever is under it" |
| `enabled` | Enabled | `enabled` is not false | **fail** "Disabled — taps are ignored" |
| `size` | Has size | Width and height above 0 | **fail** "Zero-size — it can’t be tapped or seen" |
| `onscreen` | On screen | The rect is fully inside the screen (`metadata.screenWidth/Height`) | **warn** "Partly off screen — scroll it into view first", or "Off screen — scroll it into view first". Left out when the capture has no screen size. |
| `name` | Accessible name | An interactive element has text, content-desc, a label, or an iOS name | **warn** "No accessible name — screen readers and accessibility-id locators have nothing to use". Left out for non-interactive elements. |

- "Best locator" is `sortLocatorsByPriority(node.suggestedLocators)[0]`, the
  same order Info uses.
- The Quick facts and Recommended locator blocks go: Info already shows
  both.
- The element-role grouping under "By role" stays. Its emoji become lucide
  icons.

### Stale capture

- The tree header shows the capture's age: "Captured just now", "Captured
  12 s ago", "Captured 3 min ago". It updates every 10 s.
- The capture is stale once any input has reached the phone after it was
  taken:
  - device control passes `deviceActionAt`, the time of its last input
    (canvas tap, long press, swipe, typing, key, hardware buttons);
  - Omni-Vision records its own Interact-mode taps and swipes.
- While stale:
  - a banner at the top of the tree panel (`role="status"`) reads "The
    screen may have changed since this capture." with a **Refresh** button;
  - the highlights on the phone are dimmed (the overlay gets `is-stale`,
    opacity 0.35), so they don't point confidently at the wrong thing.
- A new capture clears it.

### Refresh race

`loadSnapshot` numbers each request. A response that isn't the latest is
ignored, error or success, and only the latest request clears `loading`.

### Labels and style

- **Names:** every icon-only button gets an `aria-label` equal to its
  purpose, with the existing `title` kept. This covers the tree header's
  expand, collapse and mode buttons and Refresh, and each locator's test,
  verify, use-in-code and copy.
- **Icons:** the role emoji ("By role") and the Code gen framework emoji
  become lucide icons.
- **Sentence case:** "Snapshot stats", "By role", "Element info",
  "Stability scored", "Device preview", "Code gen".
- **Code comments:** the "AI ENGINE n" labels become plain rule names.

## Code

| File | Change |
|---|---|
| `web/src/components/omni-inspector/locatorRules.ts` (new) | Moved unchanged from OmniInspector.tsx: `StabilityLevel`, `getLocatorPriority`, `getLocatorPlatform`, `scoreLocatorStability`, `sortLocatorsByPriority` (exported) |
| `web/src/components/omni-inspector/elementChecks.ts` (new) | Pure. `type CheckStatus = 'pass' \| 'warn' \| 'fail' \| 'info'`; `interface ElementCheck { id; label; status; detail }`; `elementChecks(node, snapshot): ElementCheck[]`; `checkSummary(checks): { pass; warn; fail }`; `isInteractive(node): boolean` |
| `web/src/components/omni-inspector/captureState.ts` (new) | Pure. `captureAge(capturedAt: number, now: number): string`; `isStale(capturedAt: number, lastActionAt: number): boolean` |
| `web/src/components/omni-inspector/OmniInspector.tsx` | Imports the moved rules; the Checks tab; `capturedAt`, `localActionAt` and the `deviceActionAt` prop; the stale banner and overlay dimming; the request counter; labels, icons and casing. `analyzeElement` keeps only the role classification used by "By role" (its `interactable`, description and emoji go). |
| `web/src/components/omni-inspector/omni-inspector.css` | Checks rows and summary, the stale banner, `.is-stale` on the overlay. Tokens only. |
| `web/src/components/device-control/device-control.tsx` | `deviceActionAt` state, set at each input call, and passed to `<OmniInspector>` |

No server changes.

## Testing

Tests written first:

- **`elementChecks`:**
  - `unique`: pass, several matches (with a suggested alternative), none,
    unsupported strategy, no locators;
  - `stable`: stable, and fragile gives warn;
  - `interactive`: clickable, checkable, scrollable, EditText, iOS
    `XCUIElementTypeButton`, and a plain container gives info. This includes
    the old bug: enabled but not clickable is not interactive;
  - `enabled`, `size`, `onscreen` (inside, partly, fully off, no metadata);
  - `name`: interactive without a name warns; a non-interactive element
    leaves it out;
  - `checkSummary`: the counts.
- **`captureState`:** the age wording at 0 s, 12 s and 3 min, and
  `isStale`.
- **OmniInspector** (Testing Library, with the snapshot API mocked):
  - the tab is named Checks and shows the summary and rows for a selected
    node;
  - a later `deviceActionAt` shows the banner, and Refresh reloads and
    clears it;
  - a slow first capture resolving after a second doesn't replace it;
  - the tree header's icon buttons are reachable by name.
- **Live on the S9+,** both themes:
  - capture, then select an element that passes (`android:id/content`) and
    one that fails;
  - tap the phone to see the banner and the dimmed highlight, then refresh;
  - check contrast of the new elements.

## Out of scope

- The layout (two narrow columns): the next PR.
- Any AI-backed analysis.
- Server-side checks.
