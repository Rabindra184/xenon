# Omni-Vision Checks tab, stale capture, labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:**
- replace "AI Insight" with an honest Checks tab;
- flag a stale capture and ignore superseded refreshes;
- name the icon buttons, swap emoji for icons, and use sentence case.

**Architecture:** The pure rules are `locatorRules.ts` (moved unchanged), `elementChecks.ts` and `captureState.ts`, each tested directly. `OmniInspector` renders them. Device control passes it `deviceActionAt`.

**Tech Stack:** React 17, lucide-react, Vitest + Testing Library.

Spec: `docs/superpowers/specs/2026-09-26-omni-vision-checks-design.md`

## Global Constraints

- Tab order and names: Info · Checks · Code gen. The Checks tab's tooltip is "Checks for this element".
- Check order: unique, stable, interactive, enabled, size, onscreen, name.
- **Interactive** means clickable, long-clickable, checkable or scrollable, `android.widget.EditText` or `AutoCompleteTextView`, or an iOS control type. Enabled alone never counts.
- **Stale** means an input reached the phone after `capturedAt`: the banner "The screen may have changed since this capture." plus Refresh, and the overlay dimmed.
- Tokens only (the colour ratchet), no rule on shared Button classes, and never run `eslint --fix` on whole files.

---

### Task 1: Move the locator rules (no behaviour change)
- Create `locatorRules.ts` holding, verbatim, `StabilityLevel`, `getLocatorPriority`, `getLocatorPlatform`, `scoreLocatorStability` and `sortLocatorsByPriority`, exported.
- `OmniInspector.tsx` imports them and deletes its copies.
- **Verify:** `tsc`, `selector-matcher.test.ts`, and the web suite all pass.
- **Commit:** `refactor(omni-vision): locator rules in their own module`.

### Task 2: `elementChecks` (TDD)
- Write `elementChecks.test.ts` for every case listed in the spec's Testing section, and watch it fail.
- Implement `isInteractive`, `elementChecks(node, snapshot)` and `checkSummary(checks)`, as specified.
  - `unique` uses `matchSelector(snapshot.hierarchy, best.strategy, best.value)` and compares nodes by `xpath`. It suggests the first other suggested locator that matches only this node.
  - `stable` uses `scoreLocatorStability(best)`.
- **Commit:** `feat(omni-vision): element checks — unique, stable, interactive, enabled, size, on screen, accessible name`.

### Task 3: `captureState` (TDD)
- `captureAge(capturedAt, now)`: "Captured just now" under 5 s, then "Captured N s ago" under 60 s, "Captured N min ago" under 60 min, and "Captured N h ago" after that.
- `isStale(capturedAt, lastActionAt)` is `capturedAt > 0 && lastActionAt > capturedAt`.
- **Commit:** `feat(omni-vision): capture age and staleness`.

### Task 4: `OmniInspector` and device control (TDD)
- **Write `OmniInspector.test.tsx` first** and watch it fail. Mock `XenonApiService.getInspectorSnapshot` with a small tree; the render is `embedded`, with no overlay target.
  - The tab is named "Checks". Selecting a node shows the summary and rows.
  - A later `deviceActionAt` rerender shows the banner. Refresh calls the API again and clears it.
  - Out-of-order responses: the latest wins.
  - The tree-header icon buttons are found by name.
- **Implement:**
  - the Checks tab in place of the insight tab (removing Quick facts and Recommended locator);
  - `capturedAt` (set on a successful load), `localActionAt` (set by Omni's own tap and swipe), the `deviceActionAt` prop, the age label with a 10 s tick, the banner, and the overlay's `is-stale` class;
  - the `loadSeq` request counter;
  - `aria-label` on every icon-only button;
  - lucide icons for roles and frameworks;
  - sentence-case headings;
  - plain names in the rule comments.
- **Device control:** add `const [deviceActionAt, setDeviceActionAt] = useState(0)` and `noteDeviceAction = () => setDeviceActionAt(Date.now())`. Call it wherever it sends typing, a key, a tap, a long press, a swipe, Home, Back, app switch, volume, lock or unlock. Pass it to `<OmniInspector>`.
- **CSS:** Checks rows and summary, the banner, and `.omni-overlay.is-stale`.
- **Verify:** the web suite, tsc, and lint against main.
- **Commit:** `feat(omni-vision): Checks tab, stale-capture banner, refresh race guard, labels`.

### Task 5: Verify and open the PR
- Build, then check live on the S9+ in both themes:
  - pass and fail elements;
  - tap the phone, then the banner and the dimming appear;
  - Refresh clears them;
  - contrast.
- Run the viewport suite (device-control route).
- Push, and open the PR.
