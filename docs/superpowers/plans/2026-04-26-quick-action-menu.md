# Quick-Action Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Back, App Switcher (Android-only), Volume Up, and Volume Down buttons to the existing `device-footer-actions` aside in `device-control.tsx`, without disturbing Home / Lock / Unlock / Portrait / Landscape.

**Architecture:** Pure frontend change. Two new files: a tiny constants module (`keycodes.ts`) and edits to `device-control.tsx`. No backend modification — `AndroidDeviceManager.pressKey` already accepts arbitrary numeric keycodes via `adb shell input keyevent`, and `WDAClient.pressKey` already maps `'volumeup'` / `'volumedown'` to `/wda/pressButton`. No new dependencies.

**Tech Stack:** React 17, TypeScript, lucide-react icons, existing `XenonApiService.pressKey`.

**Spec:** `docs/superpowers/specs/2026-04-26-quick-action-menu-design.md`

---

## File Structure

| File | Purpose |
|---|---|
| `web/src/components/device-control/keycodes.ts` | NEW — exports `ANDROID_KEYCODE` and `IOS_BUTTON` constants. ~12 LOC. |
| `web/src/components/device-control/device-control.tsx` | MODIFIED — adds 4 handlers, 4 buttons in the existing footer aside, conditional render on `currentDevice.platform`. ~30 lines added. |

No CSS changes. No backend changes. No new npm dependencies.

---

## Conventions (read first)

- **Branch:** all work goes on `feat/quick-action-menu` (already created and checked out by brainstorming).
- **Commits:** Conventional Commits, e.g. `feat(device-control): add Back/AppSwitcher/Volume buttons`.
- **Verification per task:** type-check via `npx tsc --noEmit -p tsconfig.json` (project-wide errors that pre-date this branch are acceptable; only fail the task if the *new* errors mention files we touched).
- **Build check after JSX edit:** `npm run build:xenon` — Vite must produce a clean build.
- **Final smoke test:** `npm run dev` and click each new button on a real or simulated device.
- **Never bypass hooks** with `--no-verify`.

---

## Task 1: Add `keycodes.ts` constants module

**Files:**
- Create: `web/src/components/device-control/keycodes.ts`

- [ ] **Step 1: Create the constants file**

```ts
// web/src/components/device-control/keycodes.ts
//
// Hardware-button identifiers used by the device-control footer.
// Android values match `adb shell input keyevent <numeric>` codes from
// https://developer.android.com/reference/android/view/KeyEvent.
// iOS strings are the names recognized by WDA's /wda/pressButton, mapped
// in src/device-managers/ios/WDAClient.ts.

export const ANDROID_KEYCODE = {
  HOME: 3,
  BACK: 4,
  APP_SWITCH: 187,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
} as const;

export const IOS_BUTTON = {
  HOME: 'home',
  VOLUME_UP: 'volumeup',
  VOLUME_DOWN: 'volumedown',
} as const;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: no errors mentioning `keycodes.ts`. (Pre-existing project-wide errors unrelated to this file are acceptable.)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/device-control/keycodes.ts
git commit -m "feat(device-control): add keycodes constants module"
```

---

## Task 2: Add lucide icon imports

**Files:**
- Modify: `web/src/components/device-control/device-control.tsx` (lines ~5–30, the existing `lucide-react` import block)

The existing import block already imports `Home`, `Lock`, `Unlock`, `ChevronLeft`, `ChevronRight`, `Camera`, etc. We need to add `Square` (App Switcher), `Volume1` (Volume Down), `Volume2` (Volume Up). `ChevronLeft` is already imported — reuse it for Back.

- [ ] **Step 1: Add three new icon names to the lucide-react import**

Open `web/src/components/device-control/device-control.tsx`. Find the existing import block:

```tsx
import {
  Home,
  Lock,
  Unlock,
  Upload,
  Clipboard,
  Camera,
  FileText,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  RotateCw,
  Move,
  Package,
  Loader2,
  Trash2,
  Wifi,
  Download,
  Search,
  Terminal as TerminalIcon,
  Zap,
  ScrollText,
  Sparkles,
  Copy,
  Check,
} from 'lucide-react';
```

Add `Square`, `Volume1`, `Volume2` so it reads:

```tsx
import {
  Home,
  Lock,
  Unlock,
  Upload,
  Clipboard,
  Camera,
  FileText,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  RotateCw,
  Move,
  Package,
  Loader2,
  Trash2,
  Wifi,
  Download,
  Search,
  Terminal as TerminalIcon,
  Zap,
  ScrollText,
  Sparkles,
  Copy,
  Check,
  Square,
  Volume1,
  Volume2,
} from 'lucide-react';
```

- [ ] **Step 2: Add the import for the new constants module**

Find the existing imports near the top (after the lucide block). Add:

```tsx
import { ANDROID_KEYCODE, IOS_BUTTON } from './keycodes';
```

Place it adjacent to the existing relative imports (e.g., right after `import './device-control.css';` or wherever sibling-component relative imports already live, e.g. `import { Terminal } from '../terminal/terminal';`).

- [ ] **Step 3: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors in `device-control.tsx`. (Unused-import warnings are acceptable at this stage — Task 3 will use them.)

- [ ] **Step 4: Do NOT commit yet** — the unused imports will trigger lint until Task 3 wires them. Commit at the end of Task 3.

---

## Task 3: Add the four new handlers

**Files:**
- Modify: `web/src/components/device-control/device-control.tsx` (just below the existing `pressHome`/`pressLock`/`pressUnlock` definitions at lines 459–462)

- [ ] **Step 1: Locate the existing handlers**

Find this block (around line 459):

```tsx
const pressHome = () =>
  XenonApiService.pressKey(currentDevice.udid, currentDevice.platform === 'android' ? 3 : 'home');
const pressLock = () => XenonApiService.lock(currentDevice.udid);
const pressUnlock = () => XenonApiService.unlock(currentDevice.udid);
```

- [ ] **Step 2: Replace `pressHome` with the constants-based version, then add four new handlers**

Replace the three lines above with:

```tsx
const pressHome = () =>
  XenonApiService.pressKey(
    currentDevice.udid,
    currentDevice.platform === 'android' ? ANDROID_KEYCODE.HOME : IOS_BUTTON.HOME,
  );
const pressBack = () =>
  XenonApiService.pressKey(currentDevice.udid, ANDROID_KEYCODE.BACK);
const pressAppSwitcher = () =>
  XenonApiService.pressKey(currentDevice.udid, ANDROID_KEYCODE.APP_SWITCH);
const pressVolumeUp = () =>
  XenonApiService.pressKey(
    currentDevice.udid,
    currentDevice.platform === 'android' ? ANDROID_KEYCODE.VOLUME_UP : IOS_BUTTON.VOLUME_UP,
  );
const pressVolumeDown = () =>
  XenonApiService.pressKey(
    currentDevice.udid,
    currentDevice.platform === 'android' ? ANDROID_KEYCODE.VOLUME_DOWN : IOS_BUTTON.VOLUME_DOWN,
  );
const pressLock = () => XenonApiService.lock(currentDevice.udid);
const pressUnlock = () => XenonApiService.unlock(currentDevice.udid);
```

Notes:
- `pressBack` and `pressAppSwitcher` do not branch on platform — they're invoked only from Android-conditional buttons in Task 4.
- The replacement of `pressHome` is purely cosmetic (numeric `3` → `ANDROID_KEYCODE.HOME`, string `'home'` → `IOS_BUTTON.HOME`). Behavior is identical.

- [ ] **Step 3: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors. The `Square`, `Volume1`, `Volume2` imports from Task 2 are still unused (consumed in Task 4) — this is OK; lint may warn but `tsc` won't error.

- [ ] **Step 4: Do NOT commit yet** — handlers without UI bindings would be dead code. Commit at the end of Task 4.

---

## Task 4: Wire the new buttons into the footer aside

**Files:**
- Modify: `web/src/components/device-control/device-control.tsx` (lines ~720–744, the `<aside className="device-footer-actions">` block)

- [ ] **Step 1: Locate the existing aside**

Find this block (around line 720):

```tsx
<aside className="device-footer-actions">
  <button
    className={`footer-action-btn ${isPortrait ? 'active' : ''}`}
    onClick={() => setIsPortrait(true)}
  >
    <RotateCw size={14} style={{ transform: isPortrait ? 'none' : 'rotate(-90deg)' }} />{' '}
    PORTRAIT
  </button>
  <button
    className={`footer-action-btn ${!isPortrait ? 'active' : ''}`}
    onClick={() => setIsPortrait(false)}
  >
    <RotateCw size={14} style={{ transform: 'rotate(90deg)' }} /> LANDSCAPE
  </button>
  <div className="footer-divider" />
  <button className="footer-action-btn" onClick={pressHome}>
    <Home size={20} /> HOME
  </button>
  <button className="footer-action-btn" onClick={pressLock} title="Lock Device">
    <Lock size={20} />
  </button>
  <button className="footer-action-btn" onClick={pressUnlock} title="Unlock Device">
    <Unlock size={20} />
  </button>
</aside>
```

- [ ] **Step 2: Replace the aside with the extended version**

Replace the entire `<aside>...</aside>` block with:

```tsx
<aside className="device-footer-actions">
  <button
    className={`footer-action-btn ${isPortrait ? 'active' : ''}`}
    onClick={() => setIsPortrait(true)}
  >
    <RotateCw size={14} style={{ transform: isPortrait ? 'none' : 'rotate(-90deg)' }} />{' '}
    PORTRAIT
  </button>
  <button
    className={`footer-action-btn ${!isPortrait ? 'active' : ''}`}
    onClick={() => setIsPortrait(false)}
  >
    <RotateCw size={14} style={{ transform: 'rotate(90deg)' }} /> LANDSCAPE
  </button>
  <div className="footer-divider" />
  <button className="footer-action-btn" onClick={pressHome}>
    <Home size={20} /> HOME
  </button>
  {currentDevice.platform === 'android' && (
    <>
      <button className="footer-action-btn" onClick={pressBack} title="Back">
        <ChevronLeft size={20} /> BACK
      </button>
      <button className="footer-action-btn" onClick={pressAppSwitcher} title="App Switcher">
        <Square size={20} /> APPS
      </button>
    </>
  )}
  <div className="footer-divider" />
  <button className="footer-action-btn" onClick={pressVolumeUp} title="Volume Up">
    <Volume2 size={20} /> VOL+
  </button>
  <button className="footer-action-btn" onClick={pressVolumeDown} title="Volume Down">
    <Volume1 size={20} /> VOL−
  </button>
  <button className="footer-action-btn" onClick={pressLock} title="Lock Device">
    <Lock size={20} />
  </button>
  <button className="footer-action-btn" onClick={pressUnlock} title="Unlock Device">
    <Unlock size={20} />
  </button>
</aside>
```

Three structural changes vs. the original:
1. After `HOME`, an Android-only fragment renders `BACK` + `APPS`.
2. A second `<div className="footer-divider" />` separates navigation buttons from system buttons.
3. `VOL+` and `VOL−` slot between the new divider and `LOCK`.

The existing PORTRAIT, LANDSCAPE, HOME, LOCK, UNLOCK buttons are byte-for-byte identical.

- [ ] **Step 3: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors mentioning `device-control.tsx`.

- [ ] **Step 4: Frontend build**

Run: `npm run build:xenon`
Expected:
```
✓ built in <N>s
🔄 Syncing build artifacts...
✅ Xenon build complete.
```

- [ ] **Step 5: Commit Tasks 2, 3, 4 together**

```bash
git add web/src/components/device-control/device-control.tsx
git commit -m "feat(device-control): add Back/AppSwitcher/Volume quick-action buttons"
```

---

## Task 5: Manual smoke test (Android)

**Prerequisites:** A connected Android device or emulator visible to `adb devices`.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: `[Xenon] Dashboard available at: /xenon/`

- [ ] **Step 2: Open the dashboard**

Open http://127.0.0.1:4723/xenon/ in a browser, log in, navigate to the connected Android device, click into device-control.

- [ ] **Step 3: Verify all 10 buttons render in the footer aside**

Visually confirm, top to bottom: PORTRAIT, LANDSCAPE, divider, HOME, BACK, APPS, divider, VOL+, VOL−, LOCK, UNLOCK.

- [ ] **Step 4: Verify each new button works**

Click each:
- BACK → on-screen activity returns to previous (or home if at root)
- APPS → device shows the recent-apps switcher
- VOL+ → device volume bar appears, volume increases by one notch
- VOL− → device volume bar appears, volume decreases by one notch

- [ ] **Step 5: Regression-check existing buttons**

Click each:
- PORTRAIT / LANDSCAPE → stream rotates as before
- HOME → device returns to home screen
- LOCK → device screen turns off
- UNLOCK → device screen turns on (PIN/biometric still required, that's expected)

- [ ] **Step 6: Stop the dev server**

Ctrl-C in the terminal running `npm run dev`.

---

## Task 6: Manual smoke test (iOS)

**Prerequisites:** A connected iOS device or simulator. If no iOS device is available, document this and skip — the spec only requires that *if* iOS is exercised, the behavior is correct.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Navigate to an iOS device's device-control view**

Open http://127.0.0.1:4723/xenon/, click into a connected iOS device.

- [ ] **Step 3: Verify the footer aside renders 8 buttons (Back and APPS are absent)**

Visually confirm, top to bottom: PORTRAIT, LANDSCAPE, divider, HOME, divider, VOL+, VOL−, LOCK, UNLOCK.

The Android-only fragment must NOT render — no BACK, no APPS.

- [ ] **Step 4: Verify VOL+ and VOL− work**

Click each:
- VOL+ → iOS volume HUD appears, volume increases
- VOL− → iOS volume HUD appears, volume decreases

(If WDA's `/wda/pressButton` returns an error for volume on an older iOS sim, see the existing fallback in `WDAClient.pressKey` lines 376–384 — it logs a debug warning but does not throw to the UI.)

- [ ] **Step 5: Regression-check HOME, LOCK, UNLOCK**

Same as Task 5 step 5.

- [ ] **Step 6: Stop the dev server**

Ctrl-C.

---

## Task 7: Push branch and open PR

- [ ] **Step 1: Push the branch**

Run: `git push -u origin feat/quick-action-menu`

- [ ] **Step 2: Open a draft PR**

```bash
gh pr create --draft --title "feat(device-control): add Back/AppSwitcher/Volume quick actions" --body "$(cat <<'EOF'
## Summary

Extends the existing device-footer-actions aside with four new buttons:

- **Back** (Android only) — sends KEYCODE_BACK (4)
- **App Switcher** (Android only) — sends KEYCODE_APP_SWITCH (187)
- **Volume Up** — KEYCODE_VOLUME_UP (24) on Android, `'volumeup'` on iOS
- **Volume Down** — KEYCODE_VOLUME_DOWN (25) on Android, `'volumedown'` on iOS

Frontend-only change. Backend already supports these via the existing `/api/control/:udid/keyevent` route.

## Why this design

The audit's "Quick Actions PARTIAL" claim was incomplete: HOME / LOCK / UNLOCK / PORTRAIT / LANDSCAPE were already wired in the footer aside. The user-value gap was the missing actions, not the chrome. A true floating overlay (the wishlist's original framing) would have introduced z-index / stream-occlusion / canvas-input collisions; extending the existing aside has effectively zero blast radius.

## What did NOT change

- pressHome / pressLock / pressUnlock handlers (only refactored to use named constants for HOME — behavior identical)
- footer-action-btn or footer-divider CSS
- stream rendering, canvas focus, keyboard input buffer, tab nav
- Any backend route, device manager, or schema

## Test plan

- [ ] Reviewer pulls the branch, runs npm run dev
- [ ] On Android: confirms 10 buttons render; clicks BACK / APPS / VOL+ / VOL− and verifies device behavior
- [ ] On iOS: confirms 8 buttons render (no BACK / APPS); clicks VOL+ / VOL−
- [ ] Confirms HOME / PORTRAIT / LANDSCAPE / LOCK / UNLOCK still work as before

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Mark ready for review when smoke tests pass**

Run: `gh pr ready <PR-NUMBER>` (number printed by step 2).

---

## Spec Coverage Check

| Spec section | Covered by task |
|---|---|
| Goal — extend footer with 4 new buttons | Tasks 3, 4 |
| Files Touched table — `keycodes.ts` + `device-control.tsx` | Tasks 1, 2, 3, 4 |
| Action Map (5 buttons including existing Home) | Task 3 (handlers), Task 4 (JSX) |
| `keycodes.ts` exports | Task 1 |
| Render order in the aside | Task 4 |
| Handlers (one-line wrappers around `pressKey`) | Task 3 |
| JSX changes (illustrative diff) | Task 4 |
| What this spec does NOT change | Task 4 (only modifies the aside; surrounding JSX preserved verbatim); Task 3 (only adds handlers, does not delete or rewire existing ones) |
| Manual smoke (Android) | Task 5 |
| Manual smoke (iOS) | Task 6 |
| Regression check | Tasks 5 step 5, 6 step 5 |
| No unit tests (YAGNI) | Reflected in plan — no test task added; matches spec rationale |
| Acceptance criteria 1 (Android renders 4 new buttons + correct keyevents) | Task 5 |
| Acceptance criteria 2 (iOS renders only Vol+/Vol−) | Task 6 |
| Acceptance criteria 3 (existing buttons retain behavior) | Tasks 5 step 5, 6 step 5 |
| Acceptance criteria 4 (no change to stream/canvas/buffer/tabs) | Task 4 step 2 (only the aside is modified) |
| Acceptance criteria 5 (no new TS errors, clean build) | Task 4 steps 3, 4 |
