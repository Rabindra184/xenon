# Xenon Control — Visual Refresh Design

**Date:** 2026-07-16
**Status:** Approved (direction + scope confirmed with product owner)
**Depends on:** PR #96 (`fix/mac-app-p0-defects`) — merge that first; this branch stacks on it.

## Goal

Take the Xenon Control mac app (`mac-app/`) from a functional but generic
Tailwind-default look to an enterprise-grade product surface that is visually
one family with the Xenon web dashboard, without changing what the app does.

**Direction (decided):** match the Xenon dashboard identity — dark-first
graphite surfaces, emerald green accent, Inter + JetBrains Mono
(`web/src/tokens.css` is the source of truth).

**Scope (decided):** reskin **plus** structural UX upgrades. Not a layout
redesign.

## Non-goals

- Light theme / following the system appearance (dark-only, like the dashboard).
- Window vibrancy / translucency.
- Log virtualization (revisit if real-world logs jank).
- A dashboard-style overview page or multi-window UI.
- Any behavior change to profiles, secrets, preflight, or the process
  supervisor beyond what the UI upgrades require.

## 1. Theme & tokens

- New `mac-app/src/renderer/src/tokens.css`, ported from `web/src/tokens.css`:
  `--bg #0a0d0c`, `--surface`, `--surface-2`, `--border`, `--border-strong`,
  `--text`, `--text-muted`, `--text-dim`, `--green #22c55e` (+ dim), `--amber`,
  `--red`, `--blue`, status fg/bg/border triples, 4px spacing scale.
- `tailwind.config.mjs` maps semantic color names to those CSS vars
  (`bg`, `surface`, `surface2`, `border`, `text`, `muted`, `dim`, `accent`,
  `danger`, `warn`, `info`). Components use only semantic names — no raw
  `slate-*` classes remain in `mac-app/src/renderer`.
- Dark-only: `color-scheme: dark`, all `dark:` variant classes deleted.
- Fonts bundled locally (no network): Inter (UI, 400/500/600) and
  JetBrains Mono (logs/code, 400/500) as woff2 under
  `mac-app/src/renderer/fonts/`.
- One focus style app-wide: 2px green ring (`--green` at 60%), visible on
  every interactive element via a shared utility.

## 2. App shell

- **Sidebar (≈260px)** becomes the brand carrier:
  - Top: Xenon mark + "Xenon Control" wordmark (replaces the centered
    title-bar text; the title bar stays as the hiddenInset drag region).
  - Profile rows: name, platform badge (iOS / Android / Both), port; the
    running profile shows a pulsing green dot.
  - Bottom: status card — server state, port, uptime while running, plugin
    schema version. Replaces the bare "schema: plugin x.y.z" line.
- **Footer status bar**: slightly taller; status dot + label, clickable
  dashboard URL when running; Start = solid green, Stop = solid red,
  Preview = ghost/outline. Disabled Start keeps its tooltip reason.

## 3. Component system

- **Segmented control** for schema enums with ≤ 4 values (`platform`,
  `androidDeviceType`, `iosDeviceType`); enums with more values stay selects,
  restyled on surface-2.
- **Toggle** switches to the green accent.
- **Inputs** (text/number/select/textarea): surface-2 background, `--border`
  border, green focus ring, mono font where the value is code-like.
- **Object-array editors**: `simulators` / `emulators` become mini table
  editors (one row per entry: name + SDK inputs, add/remove buttons) writing
  the same array-of-objects shape. A "raw JSON" escape hatch stays available
  for arbitrary shapes (reusing the PR-#96 JsonField with its error state).
- **String-array editors**: `adbRemote`-style lists become chip inputs
  (type + Enter to add, click × to remove).
- **Toasts**: minimal internal toast stack (bottom-right, auto-dismiss) for
  export/save/copy confirmations and non-blocking errors. No library.
- **Buttons**: primary (green), destructive (red), ghost — one shared
  component, consistent sizing.

## 4. Settings IA

- Sticky section nav (anchor links, scroll-spy highlight) on the left edge of
  the Settings tab content.
- Search box above the form filtering fields by label **or** raw key name;
  empty-result state included.

## 5. Logs

- Terminal panel full-bleed on surface (JetBrains Mono, ANSI colors from
  PR #96). Toolbar: filter input, auto-scroll toggle, Copy, **Clear**, and a
  line-count badge (e.g. "1,204 lines, showing 87").

## 6. Health

- Check rows restyled with the dashboard's status chip triples
  (ready/busy/error colors).
- Wire the existing-but-unused `SetupProgress` IPC events into the
  "Install plugin + drivers" flow: inline step progress + terminal-style
  output while installing.

## 7. Mac-native behaviors

- Application menu (main process):
  - **File**: New Profile ⌘N, Import…, Export…
  - **Server**: Start/Stop ⌘⏎, Open Dashboard ⌘D, Launch Preview ⌘P
  - **View**: Settings ⌘1, Secrets & Env ⌘2, Health ⌘3, Logs ⌘4
  - Menu items enable/disable with server state (renderer state already
    broadcast to main via the supervisor).
- Hover-revealed row actions become focus-revealed too
  (`group-focus-within`), so keyboard users can duplicate/delete.

## 8. Empty & edge states

Every view defines its empty state with a next action:

- No profiles → headline + primary "New Profile" button.
- No env vars → one-line hint + Add button (exists, restyle).
- No logs → hint + Start shortcut.
- Settings search with no matches → "No settings match ‘…’".
- Crashed state → status bar shows the error, Logs tab badge.

## Enterprise quality bar

The bar every screen must pass before this ships (this is what separates a
product from an internal tool):

1. **Keyboard-first** — every action reachable without a mouse; visible focus
   ring; Esc closes any overlay; menu shortcuts work.
2. **Every state designed** — loading, empty, error, disabled-with-reason.
   No dead ends, no unexplained disabled buttons.
3. **No silent failures** — every user action yields visible feedback
   (state change or toast) within 100ms, even if the work continues async.
4. **Accessibility floor** — roles/labels on icon-only controls, tablist
   semantics on tabs, `aria-invalid` on erroring inputs, contrast ≥ 4.5:1 for
   text on all new tokens.
5. **Self-contained** — bundled fonts, no network fetches from the renderer.
6. **Consistency by construction** — components own their styling; screens
   compose components; no one-off hex values outside `tokens.css`.

## Testing & verification

- **Unit (vitest):** value-mapping logic of the table/chip editors
  (array-of-objects ⇄ rows, string-array ⇄ chips); scroll-spy section
  resolution; toast queue behavior.
- **E2E (Playwright, extends `test/e2e/app.e2e.spec.ts`):** segmented control
  persists its value through the store; settings search filters and clears;
  section nav navigates; toast appears after export; ⌘1–4 switch tabs; chip
  editor round-trips `adbRemote`; table editor round-trips `simulators`.
- **Live pass:** drive the built app with the Playwright driver (as in the
  review), screenshot every tab + modal + running state, and eyeball against
  this spec before the PR is opened.

## Delivery

- Branch `feat/mac-app-visual-refresh`, stacked on `fix/mac-app-p0-defects`
  (PR #96). **Merge #96 first**; then rebase this branch onto main and open
  the PR — one consolidated PR for the refresh, per repo practice on merge
  pacing.
- Implementation order (each step leaves the app working):
  1. tokens.css + Tailwind mapping + fonts (pure reskin, no structure)
  2. shared components (Button, Input, Toggle, Segmented, Toast)
  3. shell (sidebar, status bar, menu bar + shortcuts)
  4. settings IA (nav + search) and editors (table/chip)
  5. logs/health polish, empty states, a11y sweep
  6. full e2e + live screenshot verification
