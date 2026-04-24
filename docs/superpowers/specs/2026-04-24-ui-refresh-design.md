# Xenon UI Refresh — Design Spec

**Date:** 2026-04-24
**Status:** Approved — ready for implementation planning
**Direction:** Command Center (hybrid modern-enterprise / ops-tool)
**Target release:** v1.5.0

---

## 1. Goals, non-goals, success criteria

### Goal

Rebuild the Xenon dashboard (`web/`) as a clean modern-enterprise operations tool in the "Command Center" visual direction — GitHub / Fly.io / Tailscale-tier polish — without regressing a single feature or URL. The current UI reads as retro-tactical HUD (scanlines, neon glow, 8–10px uppercase mono everywhere). The refresh replaces that with a sober, information-dense interface that reads as a serious ops surface.

### In scope

- New design tokens — dark-only, GitHub-forest-green accent palette.
- Rebuilt app shell: expandable sidebar (56/200px) with grouped nav + live counts, slim 44px header, `⌘K` search trigger.
- New **Overview** landing page at `/` and `/overview`.
- New **⌘K command palette**: navigation + entity search across devices, sessions, teams, api keys, apps.
- Rebuilt device card and the device-explorer filter/toolbar.
- New shared UI primitives: `Button`, `Card`, `Pill`, `StatusDot`, `StatusCode`, `KeyValueRow`, `Popover`, `Menu`, `SegmentedControl`, `Table`, `EmptyState`.
- Skin + targeted polish pass on every other existing screen (session-dashboard, apps, webhooks, settings, ai-settings, maintenance, teams, api-keys, device-control, omni-inspector, terminal, reservation-modal, tag-manager-modal, ApiKeyGate).
- Fonts consolidated to **Inter** (body/headings) and **JetBrains Mono** (IDs, status codes). Outfit removed.

### Out of scope

- Light mode. Tokens will be structured so that adding a light palette later is a new token file, not a refactor.
- Information-architecture restructuring that removes or merges features.
- Backend changes. Overview widgets consume only data the dashboard already fetches.
- i18n / RTL support.
- Mobile / tablet layouts. The dashboard remains desktop-only.

### Success criteria

1. Every existing route, button, modal, and socket event works identically after the refresh.
2. Lighthouse a11y ≥ 90 on Overview, Device Explorer, and Settings.
3. All existing Jest unit tests pass; no regressions.
4. Baseline screenshots captured under `web/screenshots/` at the start and end of each phase.
5. The entire refresh is gated by a single `themeV2` feature flag that can be toggled off per-user via URL param for rapid rollback.
6. No new npm dependency is introduced purely for visual purposes. Existing deps (`lucide-react`, `socket.io-client`, `react-router-dom`) remain the only interaction primitives.

---

## 2. Design tokens

All `:root` vars in `web/src/index.css` are rewritten. Old tokens remain as compatibility aliases pointing to new tokens so nothing breaks on day one; the aliases are removed in the cleanup phase.

### Surfaces

```
--bg-canvas:   #0d1117   /* app background */
--bg-surface:  #161b22   /* cards, sidebar body */
--bg-elevated: #1c2128   /* popovers, modals, hover surfaces */
--bg-subtle:   #0d1117   /* nested surfaces inside cards */

--border-default: #21262d
--border-strong:  #30363d
--border-muted:   #1c2128
```

### Text

```
--text-primary:   #e6edf3   /* headings, bright values */
--text-secondary: #c9d1d9   /* body */
--text-muted:     #8b949e   /* labels, metadata */
--text-subtle:    #6e7681   /* timestamps, placeholders */
```

### Accent (primary = forest green)

```
--accent:         #3fb950
--accent-bold:    #238636   /* primary button fill */
--accent-subtle:  rgba(63,185,80,0.1)
--accent-border:  rgba(63,185,80,0.3)
```

### Status

Each status exposes `-fg`, `-bg`, `-border`:

```
--status-ready-fg:    #3fb950   (and matching bg/border)
--status-busy-fg:     #d29922
--status-reserved-fg: #58a6ff
--status-error-fg:    #f85149
--status-offline-fg:  #8b949e
```

### Typography

- Families: `Inter` (body + headings), `JetBrains Mono` (IDs, uppercase status codes, timestamps, data values where character alignment matters). Outfit is removed.
- Scale: 11 / 12 / 13 / 14 / 16 / 20 / 24 / 32 px. No 8–10 px text anywhere.
- Letter-spacing: `-0.01em` on headings and numeric values; `0` on body; `0.1em` only on uppercase mono status codes.
- Weights: 400 / 500 / 600 / 700. No 800.

### Spacing, radii, motion

- Spacing (4 px grid): 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48.
- Radii: `4` (chips, inputs), `6` (cards, buttons), `8` (modals). No 20 px pill radii.
- Shadows: `--shadow-sm` subtle lift on hover; `--shadow-md` for popovers and modals. No drop-glow, no neon bloom.
- Motion: 150 ms standard ease `cubic-bezier(0.2, 0, 0, 1)` for hover and state changes; 250 ms for route transitions. No pulsing, no scanlines. `prefers-reduced-motion` disables all transitions.

### Compat aliases

All legacy tokens (`--color-primary`, `--bg-page`, `--primary`, etc.) are kept as aliases pointing to new tokens in phase 1, so unchanged `.css` files still render correctly. Removed during phase 7.

---

## 3. App shell

Three fixed zones: 44 px header at top, expandable sidebar (56/200 px) on the left, content fills the remainder.

### Header

`web/src/components/header/header.tsx` rebuilt.

- **Left:** brand mark (existing `logo.svg` re-styled without drop-shadow glow) and mono version chip (`v1.4.0`) sourced from `package.json` at build time.
- **Center:** `⌘K` search trigger — a wide input-looking button that opens the command palette. Placeholder `"Search devices, sessions, settings…"` with a right-side `⌘K` / `Ctrl+K` keyboard hint chip.
- **Right:** system status pill (● Online / ▲ Degraded / ▼ Offline) driven by the existing socket connection state; profile avatar with dropdown containing workspace/node context (unchanged from today, re-skinned).
- Bottom border: `1px solid var(--border-default)`. No scanline overlay.

### Sidebar

`web/src/components/sidebar/sidebar.tsx` rebuilt.

- Two width states: **56 px** (icon-only — current footprint) and **200 px** (expanded, labels + counts).
- Expansion triggered by hover with a 150 ms open delay and 300 ms close delay (prevents flicker). A pin icon in the sidebar footer toggles "locked open." The state (`collapsed` / `expanded` / `pinned-open`) is persisted to `localStorage['xenon.sidebar']`.
- Two sections with uppercase mono section headers:
  - **WORKSPACE** — Overview, Devices, Sessions, Apps, Notifications.
  - **ADMIN** — Settings, AI Engine, Maintenance, Teams, API Keys.
- API Docs remains as an external-link row at the bottom (unchanged behavior).
- Each nav row: icon + label + optional right-aligned count chip. Counts are derived client-side from existing socket-backed stores (`devices.length`, `activeSessions.length`). No new backend calls.
- Active state: `accent-subtle` background + 2 px `accent` left stripe + accent-colored icon. No glow.

### Routes

- New `/overview` route added, lazy-loaded like the others.
- `/` now redirects to `/overview` (previously redirected to `/devices`).
- All other routes in `web/src/routes/index.tsx` are unchanged.

### Overview page

`web/src/components/overview/overview.tsx` + `overview.css`. Lazy-loaded.

- **Page header:** breadcrumb label "WORKSPACE" + `Overview` title + a `Last 24h` time-range dropdown (client-side filter over the activity stream) + primary `+ New session` button (opens the existing new-session modal used by manual sessions).
- **KPI row — 4 tiles:**
  - **Devices online** — `n / total`, with fleet-uptime % below.
  - **Active sessions** — count, with queued count in amber below.
  - **Heals today** — count, with success % in green below.
  - **Failures (24h)** — count, with delta vs. previous 24 h.
  All four use existing endpoints (`GET /xenon/api/devices`, `GET /xenon/api/sessions`) and the existing socket stream. No new endpoints.
- **Fleet status** (≈ 60 % width): compact table with status dot + name + mono UDID + status code. Rows link to `/devices/:udid/control`. Shows top 6 by priority (busy and reserved first, offline last), with a `View all →` link to `/devices`.
- **Recent activity** (≈ 40 % width): stream of the last 20 events from the existing `EventManager` socket channel — session lifecycle, heal events, node join/leave, build completions. Monospace timestamp column + one-line description with entity links.

### Command palette (`⌘K`)

`web/src/components/command-palette/command-palette.tsx`, plus `command-index.ts` (in-memory index) and `fuzzy.ts` (scoring).

- Opened globally via `useCommandPalette` hook listening for `Cmd+K` / `Ctrl+K`. Ignores keystrokes whose event target is `contenteditable`, `input`, or `textarea`.
- Keyboard-first listbox: arrow keys navigate, Enter selects, Esc closes and restores focus.
- Index populated from data already resident in the app — device and session stores (socket-backed) plus static route / team / api-key / app entries. Rebuilt incrementally on socket deltas. Zero network traffic.
- Scoring: character-subsequence fuzzy + prefix bonus. Max 8 results, grouped by kind: `Navigation` / `Devices` / `Sessions` / `Teams` / `API Keys` / `Apps`.
- Selection routing:
  - Device → `/devices/:udid/control`.
  - Session → `/builds?session=:id`.
  - Team → `/teams` with team pre-selected.
  - API key → `/api-keys` with key focused.
  - App → `/apps` with app focused.
  - Navigation item → its path.
- Implementation: ~200 LOC, hand-rolled against existing primitives. No new dependencies.

---

## 4. Device card + other screens

### Device card

`web/src/components/device-card/device-card/device-card.tsx`. Current class-based component migrated to a functional component while rebuilding. Public interface preserved — still accepts `{ device: IDevice, reloadDevices: () => void }` and a `navigate` prop; `DeviceCardWrapper` remains the default export, so no import-site changes are needed.

**Layout, top to bottom:**

1. **Accent stripe** — 2 px, 100 % height, left edge, colored by status. The only "glow" in the card.
2. **Header row:** platform + SDK label (left) · `● STATUS` mono uppercase code (right).
3. **Device name** — 15 px, weight 600, `letter-spacing: -0.01em`. Truncated with `title` for full value.
4. **UDID** — JetBrains Mono 11 px, middle-ellipsis, full on hover.
5. **Tags row** — team chip (if `device.teamId`) + up to 3 tag pills, radius 12, soft `pill` primitive. Overflow `+N` chip if more. Hidden when no team and no tags.
6. **Metrics block** — nested surface (`bg-subtle`, radius 5, 10–12 px padding) with key/value rows: Battery, Thermal, Host, Utilization. A reservation banner or active-session banner replaces the Utilization row when present.
7. **Actions row:**
   - Primary `Control` — `accent-bold` fill, full width minus siblings.
   - Secondary `Reserve` (or `Release` when reserved) — outline.
   - Overflow `⋯` — popover with: Manage tags, Enter/Exit maintenance, Assign team (admin only), Copy UDID, View sessions.
   - Rules unchanged from today: hide `Reserve` when busy; disable `Control` when busy with a non-manual session.

**Container:** `bg-surface`, `1px var(--border-default)`, radius 6, 12–14 px padding, 180 px min-height. Hover: `border-strong` + `shadow-md`. No `translateY` lift, no scanline overlay.

Modals (`ReservationModal`, `TagManagerModal`) keep their logic; only re-skinned.

### Other screens

No information-architecture changes. Every screen automatically receives the new tokens via CSS variables. The following screens get **additional targeted work** on top of skinning:

| Screen | Extra work |
|---|---|
| `device-explorer` | New filter/toolbar row — segmented status tabs (All / Ready / Busy / Reserved / Offline), inline search, sort dropdown. Grid layout unchanged. |
| `session-dashboard` | Tabs refactored into the new `SegmentedControl`; new empty states; trace-waterfall color legend redrawn against the new status palette. |
| `device-control` | Inspector sidebar gains new section headers; action toolbar uses the new `Button` primitive. |
| `omni-inspector` | POM workbench code-block styling rebuilt; mono tokens applied consistently. |
| `terminal` | ANSI color palette recalibrated to match new status colors. No behavior change. |
| `settings`, `ai-settings`, `maintenance` | Introduce a `FieldGroup` form primitive (label + control + help-text) and a consistent `Card` section container. |
| `api-keys`, `teams` | Tables migrated to the new `Table` primitive; row action menus adopt the shared `⋯` popover. |
| `webhook-settings` | Uses the new `EmptyState` and form primitives. |
| `apps` | Tile grid rebuilt with the `Card` primitive. |
| `reservation-modal`, `tag-manager-modal` | Adopt the new modal primitive (`bg-elevated`, radius 8, `shadow-md`). Same fields. |
| `ApiKeyGate` | Full-page skin pass; bootstrap-banner styling re-aligned with the new palette. |

### Shared primitives (new)

Living under `web/src/components/ui/`:

- **`Button`** — variants `primary` (accent-bold fill) · `secondary` (outline) · `ghost` · `danger`. Sizes `sm` / `md`.
- **`Card`** — surface container with optional `header` / `footer` slots.
- **`Pill`** — rounded soft chip for tags, counts, and inline labels.
- **`StatusDot`** — 6 px dot colored by a `Status` enum.
- **`StatusCode`** — mono uppercase code + optional dot, colored by status.
- **`KeyValueRow`** — the label-value pattern used by the device card metrics block.
- **`Popover`** + **`Menu`** — anchored floating surface; used by `⋯` overflow and sidebar profile dropdown.
- **`SegmentedControl`** — pill-group used by filter tabs and session-dashboard view switcher.
- **`Table`** — header + row + cell wrappers for consistent table density.
- **`EmptyState`** — icon + title + description + optional CTA.

Existing `Button`, `badge`, `Toast`, `input` primitives are rewritten against the new tokens but **keep their exports**, so no import-site churn.

---

## 5. Rollout, risks, testing

### Feature flag

A single boolean `themeV2` controls the refresh:

- Source of truth: `window.localStorage.getItem('xenon.themeV2')`, default `'on'` once the final phase ships.
- URL override: `?themeV2=0` for rapid per-session rollback.
- `<html data-theme="v2">` attribute flips between old and new CSS token scopes.
- Old tokens scoped under `html:not([data-theme="v2"])`; new tokens under `html[data-theme="v2"]`. The flag therefore also controls which token set (and which compat aliases) is active.
- Flag removed and old CSS deleted in the cleanup phase once the refresh is stable.

### Sequencing

Each phase merges to `main` independently, gated by the flag. No single mega-PR.

1. **Tokens + primitives** — new token scope, rebuilt `Button`, `Card`, `Pill`, `StatusDot`, `StatusCode`, `KeyValueRow`, `Popover`, `Menu`, `SegmentedControl`, `Table`, `EmptyState`. No behavior change.
2. **App shell** — rebuilt `Header` and `Sidebar`. New `/overview` route added (placeholder page at first).
3. **Overview page** — real widgets wired to existing stores.
4. **⌘K palette** — keyboard-only new component. No changes to existing screens.
5. **Device card rebuild** + device-explorer filter/toolbar.
6. **Remaining screens** — skin + targeted polish. One PR per screen group: session-dashboard, settings family, api-keys + teams, modals, misc.
7. **Cleanup** — remove the flag, delete old CSS, drop Outfit font import, remove compat aliases.

### Risks + mitigations

| Risk | Mitigation |
|---|---|
| Socket payload change breaks Overview | Overview consumes only fields already rendered elsewhere in the app; no new field dependencies. |
| Sidebar expand breaks `position: fixed/absolute` consumers or device-control viewport math | Audit fixed/absolute consumers in phase 2. Sidebar emits a `resize` event that modals / the device-control viewer can subscribe to if needed. None expected based on current code. |
| `⌘K` collides with in-field typing | Palette only opens when `event.target` is not `contenteditable`, `input`, or `textarea`; `Esc` restores focus. |
| Third-party embedders break on CSS class renames | No class names are removed. Only tokens are rewritten and new primitives are added. |
| Visual regressions invisible to tests | Commit a baseline screenshot set per phase under `web/screenshots/` (manual capture). Reviewer diffs them in each PR. |

### Testing strategy

- **Unit:** existing Jest + React Testing Library. Tests extended as components rebuild. No new test infra.
- **Smoke:** a manual per-phase checklist covering every route, every modal open/close, `⌘K` open/close/search/select, sidebar pin/unpin, and the feature-flag toggle.
- **Accessibility:** `@axe-core/react` (already in devDependencies if present; added otherwise) run against Overview, Device Explorer, and Settings in development. Target Lighthouse a11y ≥ 90.
- **Visual:** screenshot captures per phase committed under `web/screenshots/` (overview, devices, session-dashboard, settings, modals). Not CI-gated — used as diff reference during PR review.
- **Backend:** no backend changes, so no new backend tests.

### Files added / changed

**New files:**

- `web/src/tokens.css` — token scope extracted from `index.css` for clarity.
- `web/src/components/ui/Button.tsx`, `Card.tsx`, `Pill.tsx`, `StatusDot.tsx`, `StatusCode.tsx`, `KeyValueRow.tsx`, `Popover.tsx`, `Menu.tsx`, `SegmentedControl.tsx`, `Table.tsx`, `EmptyState.tsx` (+ matching CSS).
- `web/src/components/overview/overview.tsx`, `overview.css`.
- `web/src/components/command-palette/command-palette.tsx`, `command-index.ts`, `fuzzy.ts`, `command-palette.css`.
- `web/src/hooks/useCommandPalette.ts`.
- `web/src/hooks/useSidebarState.ts`.
- `web/screenshots/*.png` — baseline captures per phase.

**Rewritten (behavior preserved):**

- `web/src/index.css`, `web/src/App.css`.
- `web/src/components/header/header.tsx`, `header.css`.
- `web/src/components/sidebar/sidebar.tsx`, `sidebar.css`.
- `web/src/components/device-card/device-card/device-card.tsx`, `device-card.css`.
- `web/src/components/ui/button.tsx`, `button.css`, `badge.tsx`, `badge.css`, `toast.tsx`, `toast.css`, `input.tsx`, `input.css`.
- `web/src/routes/index.tsx` (add `/overview` route; redirect `/` → `/overview`).

**Skin-only (token substitution + minor polish):**

- Every other `*.css` file under `web/src/` — legacy tokens replaced with new ones. `.tsx` files in these screens remain unchanged outside the targeted-polish list in section 4.
