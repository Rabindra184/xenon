# Xenon Dashboard Redesign — Design

**Date:** 2026-04-24
**Status:** Draft (awaiting user review)
**Author:** claude-opus-4-7 (on behalf of @Rabindra184)

## 1. Summary

Redesign the entire Xenon web dashboard (all 10 pages plus the app shell) to
match a reference design the user supplied. The reference is a dark,
calm, Tailwind-based Ops console with a 56px icon-only sidebar, a fixed
top bar with logo/search/status/profile, a breadcrumb+title page
pattern, and card-based content rows.

This spec covers the frontend only. It does not add backend metrics
endpoints or change any plugin/healing/device behavior.

## 2. Goals and Non-Goals

### Goals

- Adopt the reference's visual system (tokens, typography, spacing,
  radii, components) across every route.
- Rebuild the shell (TopBar + Sidebar) to match the reference.
- Rebuild the Overview page to match the reference pixel-closely at
  1440×900, with responsive behavior down to 768px.
- Preserve all real-data wiring: Overview, Builds, Devices, Settings,
  etc. continue to read from their current API endpoints and websocket
  streams.
- Land the work in phases so the app is never broken between merges.

### Non-Goals

- No new backend endpoints (heals-today, session histograms, etc.).
  Where a KPI has no data source, we render "—" with a subtle
  "not yet tracked" tooltip.
- No new features or functional changes. Inspector, healing, plugin
  behavior, auth, teams, api-keys, webhook events — all unchanged.
- No light theme, no theming toggle. Single dark palette.
- No i18n. Copy stays English.

## 3. Technical Foundation

### 3.1 Tailwind install

- Install `tailwindcss@^3.4`, `postcss@^8.4`, `autoprefixer@^10.4` as
  dev deps in `web/`.
- Add `web/tailwind.config.js` with `content: ['./index.html',
  './src/**/*.{ts,tsx}']` and `theme.extend = {}` — we rely on
  arbitrary-value syntax (`bg-[var(--surface)]`) to match the
  reference code verbatim.
- Add `web/postcss.config.js` wiring `tailwindcss` + `autoprefixer`.
- Replace the top of `web/src/index.css` with the reference's font
  import + `@tailwind base; @tailwind components; @tailwind utilities;`
  directives.

### 3.2 Tokens

Replace the contents of `web/src/tokens.css` with the reference's
token palette, verbatim names:

```css
:root {
  --bg: #0a0d0c;
  --surface: #111514;
  --surface-2: #161b1a;
  --border: #1f2624;
  --border-strong: #2a3331;
  --text: #e6ebe9;
  --text-muted: #8a938f;
  --text-dim: #5b6460;
  --green: #22c55e;
  --green-dim: #16a34a;
  --amber: #f59e0b;
  --red: #ef4444;
  --blue: #3b82f6;
}
```

Plus the reference's body setup (fonts, antialiased, scrollbar,
`.bg-grid`, `.pulse-dot` keyframes).

Old token names (`--bg-canvas`, `--bg-surface`, `--accent`, `--status-*`)
are removed. Per-component CSS that references them is rewritten
during each page's phase.

### 3.3 Fonts

- Inter 400/500/600/700 via Google Fonts `@import`.
- JetBrains Mono 400/500 for timestamps, UDIDs, version badges.
- Self-host optional (out of scope for this spec).

## 4. Shell

Two fixed elements plus a main content region:

### 4.1 TopBar (`web/src/components/header/`)

- Fixed, 56px tall, full width, `z-20`.
- Left: green 28px rounded square logo ("X"), "XENON" + "DEVICE OPS"
  stacked text, `v0.3.0` mono pill.
- Center: search input, max-width 576px, `⌘K` kbd affordance.
  Triggers the existing `CommandPalette`.
- Right:
  - `Updated Nm ago` relative timestamp (updates every 5s from last
    WS message timestamp).
  - Connection pill (green dot + "Online" when WS connected; amber
    "Reconnecting" otherwise).
  - Profile button — shield icon + role name + chevron; opens the
    existing profile menu.

Replaces `header.tsx` and `header.css`. `header.css` is removed;
styles live inline via Tailwind utilities.

### 4.2 Sidebar (`web/src/components/sidebar/`)

- Fixed, 56px wide, full height, `z-30`.
- Icon-only. Active route shows a 2px green bar on the left edge + a
  white icon (inactive icons are `--text-dim`).
- Tooltip pops to the right on hover.
- Icon → route map:

  | Icon | Label | Route |
  |---|---|---|
  | LayoutGrid | Dashboard | `/overview` |
  | Smartphone | Devices | `/devices` |
  | Wrench | Apps | `/apps` |
  | MonitorPlay | Sessions | `/builds` |
  | Bell | Notifications | `/notifications` |
  | Settings | Settings | `/settings` |
  | Brain | AI | `/ai-settings` |
  | ShieldCheck | Maintenance | `/maintenance` |
  | Users | Teams | `/teams` |
  | Zap | API Keys | `/api-keys` |

  Plus a bottom "Docs" `BookOpen` icon linking to the project README
  on GitHub (external link).

Replaces `sidebar.tsx` and `sidebar.css`. `sidebar.css` is removed.

### 4.3 App shell

`App.tsx` becomes:

```tsx
<div className="min-h-screen w-full bg-[var(--bg)] text-[var(--text)]">
  <Sidebar />
  <TopBar />
  <main className="pl-14 pt-14">
    <Routes>…</Routes>
  </main>
</div>
```

The old `app-content` / `app-body-container` wrappers and their CSS are
deleted. Route-specific body classes (e.g. `settings-view`) are
removed; each page controls its own container.

## 5. Overview Page

File: `web/src/components/overview/overview.tsx`. Rewritten from
scratch using the reference structure, wired to existing
`use-overview-data` hook.

### 5.1 Layout

```
max-w-7xl, px-6, py-8, mx-auto
├── Page header (flex between)
│   ├── Breadcrumb "Acme QA / Overview"
│   ├── Title "{teamName} · Overview"
│   ├── Subtitle "Real-time fleet health and session activity."
│   └── "+ New session" green button (opens existing session-launch flow)
├── 4-up KPI grid (gap 3, sm:2-col, lg:4-col)
├── Row 1 (lg:2-col): FleetStatus + RecentActivity
├── Row 2 (lg:3-col): SessionTrend (span-2) + DeviceBreakdown
└── Footer (border-top, mono, left: "XENON Device Ops · v0.3.0", right: "© 2026 {teamName}")
```

Team name pulls from the existing teams context (falls back to
"Xenon" when unset).

### 5.2 KPI cards (components/overview/KpiCard.tsx)

| Label | Value source | State |
|---|---|---|
| Devices online | `devices.filter(d => d.online).length / devices.length` | `healthy` if all online else `warn` |
| Active sessions | `sessions.filter(s => s.status === 'running').length` | `healthy` if queue 0 else `neutral` |
| Heals today | **No endpoint today.** Render `"—"` + tooltip "Heals counter lands in a future release." | `neutral` |
| Failures (24h) | Client-side count of sessions with `failure_reason` and `createdAt >= now-24h` | `healthy` if 0 else `critical` |

`KpiCard` takes `{ label, value, secondaryValue?, subtitle, state }`
and renders a left-accent bar whose color tracks `state`.

### 5.3 Fleet status (components/overview/FleetStatus.tsx)

- Header: "Fleet status · {n} devices", filter toggle "All |
  Non-ready", "View all →" link to `/devices`.
- Rows: status dot, device-kind icon (phone/tv/laptop based on
  `platform + deviceType`), nickname + OS name line, os version
  (hidden <md), UDID truncated (hidden <lg), status label (READY /
  BUSY / OFFLINE / ERROR) in corresponding color.
- Clicking a row → `/devices/{udid}/control/screen`.
- Empty state: "All devices are ready." centered.
- Source: existing `GET /device` data from `use-overview-data`.

### 5.4 Recent activity (components/overview/RecentActivity.tsx)

- Header: "Recent activity · LIVE" with pulsing dot (green = WS
  connected).
- Populated state: vertical list of events with mono 48px HH:MM
  column and message, max 20 rows, oldest drops off.
- Empty state (reference's centered view): activity icon, "No
  activity yet" title, subtitle, "▶ Start a session" button (opens
  the new-session modal), event-types legend.
- Source: existing WS events (`session_started`, `session_stopped`,
  `node_connected`, `node_disconnected`).

### 5.5 Session activity chart (components/overview/SessionTrend.tsx)

- Header: title, "Last 24 hours" subtitle, right-side Sessions /
  Heals totals.
- 24 bars, one per hour, computed client-side: bucket the last 24h
  of `/session` data by hour. Heals is a secondary light-green
  overlay (0 for now because no heals data — render as hidden until
  a heals endpoint exists).
- Hover tooltip per bar: "HH:00 — N sessions".
- X-axis: first hour, midpoint, last hour labels.
- No backend histogram endpoint — all client-side derivation.

### 5.6 Fleet composition (components/overview/DeviceBreakdown.tsx)

- Header: "Fleet composition · By operating system · {n} devices".
- Stacked horizontal bar (2px tall) showing OS share.
- List below: color swatch, OS string (mono), count, percentage.
- Source: `devices` grouped by `platformVersion || platformName`.
- Colors: tvOS shades of green, iOS blue, Android amber, fallback
  `--border-strong`.

## 6. Other pages (high-level direction)

Each page keeps its functional shape but re-skins to the new design
system. Concrete component layouts are deferred to that page's
implementation phase (see §8).

- **Devices** (`/devices`, `/devices/:udid/control/:tab`) — device
  list + device-control mirror. List becomes card grid
  (SmartphoneIcon/TvIcon + status dot + os + nickname). Control page
  keeps split: screen mirror left, interaction right.
- **Apps** (`/apps`) — keep table-ish list; restyle toolbar + row
  cards with new tokens.
- **Builds** (`/builds`) — SessionDashboard. Redesign the status
  filter chips (text + icon + count), use card rows for sessions,
  keep existing sidebar for build list.
- **Notifications** (`/notifications`) — webhook settings. Keep
  structure; restyle as card sections with token colors.
- **Settings / AI-Settings / Maintenance** — keep the `.settings-grid`
  scaffold; rebuild each card as a rounded surface with the reference
  border + spacing rhythm; iOS-style toggles stay.
- **API Keys / Teams** — simple list pages, restyle only.

These pages stay functionally intact through their phase — visual
changes only.

## 7. Data strategy

All real-data wiring preserved. Changes limited to:

- `use-overview-data.tsx` gains a derived `sessionTrend` array
  (length 24) computed from `sessions[]`.
- `activity` event stream formatting is moved into a helper so
  RecentActivity only receives pre-formatted rows.

No new endpoints. No request path changes. `GET /device`,
`GET /session`, `GET /queue/length`, WS `session_*` / `node_*`
continue to drive Overview.

## 8. Phased implementation order

Each phase is a merge-able unit. Between phases the app is fully
functional.

1. **Foundation** — install Tailwind + PostCSS, rewrite
   `tokens.css` with the new token names PLUS backwards-compat
   aliases (`--bg-canvas: var(--bg)`, `--bg-surface: var(--surface)`,
   `--accent: var(--green)`, `--status-ready-fg: var(--green)`, etc.)
   so every legacy `*.css` file continues to resolve. Update
   `index.css` to load Tailwind. No component JSX changes. Verify:
   build succeeds, no visual regression at each route.
2. **Shell** — rewrite `Sidebar`, `TopBar`, and `App.tsx` wrapper.
   Delete `sidebar.css`, `header.css`. All pages now sit under the
   new shell; their own bodies still use legacy CSS (cosmetic
   mismatch is expected mid-phase).
3. **Overview** — rewrite Overview, add 5 sub-components under
   `components/overview/`. Delete old `ActivityStream.tsx`,
   `FleetTable.tsx`, `KpiTile.tsx`, `overview.css`.
4. **Builds + Devices** — the two most-used pages. Restyle, keep
   feature parity.
5. **Apps + Settings cluster** — Apps, Settings, AI-Settings,
   Maintenance, Notifications, API-Keys, Teams. Each is a smaller
   incremental restyle.
6. **Cleanup** — delete any orphan `*.css` files, remove the
   token aliases introduced in Phase 1, remove `tailwind-merge`
   if unused.

## 9. Testing and verification

- **Build**: `npm run build:xenon && npm run build` must pass on every
  phase.
- **Unit tests**: existing `vitest` suite in `web/` continues to pass.
- **Visual**: after each phase, capture Playwright screenshots at
  1440×900, 1024×768, 390×844 for each affected route. Store under
  `web/screenshots/<phase>/`.
- **Manual**: log in with bootstrap key, click through every route,
  verify no console errors and no 500s.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Token rename breaks pages before their phase | Phase 1 keeps old token names as aliases (`--bg-canvas: var(--bg)` etc) until phase 6 |
| Bundle size grows from Tailwind | Content scanning in `tailwind.config.js` keeps output small; JIT only generates used classes. Expect +5–10KB gz. |
| Per-phase visual regressions | Screenshot diff after each phase; phase ordering puts highest-traffic pages earliest |
| `CommandPalette`/profile-menu integration with new TopBar | Reuse existing components; only their chrome changes |

## 11. Open questions

- Logo: does the user have an SVG file, or is the "green X square"
  acceptable as a final logo? (Assumption: green square is fine for
  now; replaceable later.)
- Team/tenant name display: Overview title reads "{team} · Overview".
  If no team context exists, we use "Xenon" as the tenant name.
  (Assumption: no multi-tenant branding work in this redesign.)

## 12. Next step

Write the implementation plan via `writing-plans`.
