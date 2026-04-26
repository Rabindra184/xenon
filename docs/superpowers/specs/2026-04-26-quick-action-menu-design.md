# Quick-Action Menu (Design Spec)

**Date:** 2026-04-26
**Scope:** Add Back, App Switcher, Volume Up, Volume Down to the existing `device-footer-actions` aside in `device-control.tsx`. Frontend-only change.
**Out of scope (deferred):** Power button, mute toggle, brightness sliders, iOS App Switcher gesture emulation, long-press semantics for volume, per-action telemetry events, keyboard shortcuts.

## Goal

Make the most-used hardware buttons reachable in one click from the device-control view. Today only Home, Lock, Unlock are wired; testers reach for Back, App Switcher, and Volume frequently and currently must use the device physically or fall back to a shell command in the Terminal tab.

The original "Quick-Action Floating Menu" from the feature wishlist was reframed during brainstorming: an actual floating overlay over the device stream introduces real regression risk (z-index collisions, click-vs-canvas-input ambiguity, drag-to-reposition complexity). The user value lives in the new actions, not the chrome change. The existing `device-footer-actions` aside on the right of the stream is the natural extension point.

## Audit findings (what's already wired)

- `pressHome`, `pressLock`, `pressUnlock` in `device-control.tsx:459–462`
- POST `/api/control/:udid/keyevent` and POST `/api/control/:udid/lock` / `/unlock` in `src/app/routers/control.ts`
- `AndroidDeviceManager.pressKey` calls `adb shell input keyevent <numeric>` — accepts arbitrary keycodes (no allow-list)
- `WDAClient.pressKey` already maps `'volumeup'`, `'volume_up'`, `'volumedown'`, `'volume_down'` → POST `/wda/pressButton` with names `volumeUp` / `volumeDown`
- Footer aside JSX at `device-control.tsx:720–744` already uses `.footer-action-btn` styling

**Implication:** the entire feature is a frontend change. No backend modification, no schema migration, no new dependency.

## Files Touched

| File | Change |
|---|---|
| `web/src/components/device-control/keycodes.ts` (NEW) | Tiny constants module exporting `ANDROID_KEYCODE` and `IOS_BUTTON` maps |
| `web/src/components/device-control/device-control.tsx` | + 4 handlers; + 4 buttons in the existing `<aside className="device-footer-actions">`; conditional render on `currentDevice.platform` |

No CSS changes — the new buttons reuse the existing `.footer-action-btn` class, and the second divider reuses the existing `.footer-divider` class.

## Action Map

| Button | Android keycode | iOS button name | Visible on |
|---|:---:|:---:|:---:|
| Home (existing) | 3 | `home` | both |
| **Back** | 4 | — (hidden) | Android only |
| **App Switcher** | 187 | — (hidden) | Android only |
| **Volume Up** | 24 | `volumeup` | both |
| **Volume Down** | 25 | `volumedown` | both |
| Lock (existing) | (route `/lock`) | (route `/lock`) | both |
| Unlock (existing) | (route `/unlock`) | (route `/unlock`) | both |

### `keycodes.ts`

```ts
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

## Render Order in the Aside

```
PORTRAIT       ← unchanged
LANDSCAPE      ← unchanged
─── divider    ← unchanged
HOME           ← unchanged
BACK           ← NEW (Android only)
APP SWITCHER   ← NEW (Android only)
─── divider    ← NEW (separates navigation buttons from system buttons)
VOL UP         ← NEW
VOL DOWN       ← NEW
LOCK           ← unchanged
UNLOCK         ← unchanged
```

iOS users see eight buttons (no Back, no App Switcher). Android users see ten.

## Handlers

Each handler is a single-line wrapper around `XenonApiService.pressKey`, identical in shape to the existing `pressHome`:

```ts
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
```

No new error handling. The existing pattern fires-and-forgets and surfaces failures via the route's HTTP status — consistent with `pressHome`.

## JSX Changes (illustrative diff)

```tsx
<aside className="device-footer-actions">
  {/* existing PORTRAIT, LANDSCAPE, divider, HOME */}

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

  {/* existing LOCK, UNLOCK */}
</aside>
```

Icons are all already importable from `lucide-react`, which is already a dependency. `ChevronLeft` and `Square` are already imported in `device-control.tsx`; `Volume1` and `Volume2` are not yet imported and will be added to the existing lucide import block.

## What This Spec Explicitly Does NOT Change

- The `device-footer-actions` aside's CSS class, position, or width
- `pressHome`, `pressLock`, `pressUnlock` handlers or their bindings
- Portrait / Landscape rotation logic
- The stream `<img>` element or `device-stream-image` sizing
- The `inputBuffer` keyboard-debouncing logic at `device-control.tsx:86–88` — these new buttons do not interact with canvas focus
- Tab navigation (Actions / Screenshot / Logs / Terminal / Omni)
- The `BugReportButton` floating in the bottom-right (different z-index / position; physically separate region)
- Any backend route, device manager, or schema

## Testing

### Manual smoke (required)

1. `npm run dev`
2. Open dashboard, navigate to a connected Android device
3. Click each new button: Back, App Switcher, Volume Up, Volume Down
4. Verify the device responds: Back closes the foreground activity, App Switcher shows recents, Volume changes ringtone level (or media volume if media playing)
5. Repeat on a connected iOS device or simulator: Volume Up/Down should work; Back and App Switcher should not be rendered

### Regression check (~30 seconds)

After the change, click Home, Portrait, Landscape, Lock, Unlock — confirm all still work as before.

### Why no unit tests

The new handlers are one-line wrappers around `XenonApiService.pressKey`, which calls a route already covered by existing patterns. Adding tests for the wrappers would test React rendering, not anything load-bearing. The risk-bearing surface (the `/keyevent` route and `pressKey` device manager methods) already has implicit coverage via the working Home button. If we wanted defense-in-depth, a single React Testing Library snapshot of the aside on Android vs iOS would be sufficient — but YAGNI for a one-day feature.

## Acceptance Criteria

1. On an Android device-control view, four new footer buttons render: Back, App Switcher, Volume Up, Volume Down. Clicking each fires `POST /api/control/:udid/keyevent` with the correct keycode.
2. On an iOS device-control view, only Volume Up and Volume Down render among the new buttons. Clicking each fires `POST /api/control/:udid/keyevent` with `volumeup` / `volumedown`.
3. Home, Lock, Unlock, Portrait, Landscape buttons retain pre-change behavior (verified by clicking).
4. The stream image, canvas focus, keyboard input buffer, and tab nav are unchanged.
5. No new TypeScript errors, no new lint errors in the modified files, frontend builds cleanly via `npm run build:xenon`.

## Implementation Phases

For the writing-plans skill to expand:

1. **Add `keycodes.ts` constants module.** Pure exports, no logic.
2. **Wire the four new handlers and JSX in `device-control.tsx`.** Includes the new lucide-react imports and the platform conditional.
3. **Manual smoke test on Android + iOS, regression-check existing buttons.**

Each phase is a single mergeable commit.

## Risk Assessment

- **Likelihood of breaking existing functionality:** very low. Backend untouched, existing handlers untouched, no shared CSS class redefined, no z-index/positioning changes.
- **Likelihood of platform-specific bugs:** low. Android handles arbitrary keycodes via `adb shell input keyevent`. iOS volume names are explicitly mapped in `WDAClient.pressKey` and have been there before this feature.
- **Likelihood of needing follow-up:** low. The four buttons cover the original spec's hardware-action ask. iOS App Switcher could be added later via gesture emulation if user demand arises; that's a separate spec.
