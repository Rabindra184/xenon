# Dashboard UI/UX Audit & Remediation — Design

**Date:** 2026-07-16 · **Version audited:** 1.7.1 · **Viewports:** 1280×800, 1440×900 (supported range per CLAUDE.md)
**Scope decision:** fix ALL findings (P0+P1+P2) in one consolidated PR on `fix/dashboard-uiux-audit`.

Audit method: every route walked live in the browser against a running server (auth disabled),
with a real Android device + iPhone attached and seeded builds/sessions data
(`Build.id/Session.id LIKE '%audit%'` in the live DB — remove after verification).

## P0 — Broken

1. **Apps: invisible filter input.** `.device-explorer-header-text-filter` renders `background: #fff` with near-white text on the Apps page (class reused without its scoping parent). Fix: give the Apps filter its own dark-theme styling (or scope the shared class correctly). Verify typed text is visible.
2. **Profile → API Tokens: perpetual "Loading…".** `GET /xenon/api/profile/tokens` → `200 []`, but the component only clears loading on non-empty data. Fix: clear loading on any resolved fetch; add empty state ("No identity tokens yet") and an error state.
3. **Device Control @1280 overflow.** Tab labels truncate ("SCREENSHO", "OMNI-VISIO"); Debug-Logs toolbar Export button clips; OMNI-VISION right panel (Platform stat, By-Role counts) clips at the viewport edge. Fix: make the panel layout fit 1280 (compute intrinsic minimum per CLAUDE.md breakpoints guidance; shrink paddings/labels or allow inner scroll). Both 1280 and 1440 must render fully.
4. **Session Detail: raw JSON logs.** Text-log rows dump the whole SessionLog row JSON; Failure Summary "FIRST ERROR" is a raw JSON blob; both cause horizontal overflow. Fix: render command name/title/subtitle + timestamp per row with expandable detail; format first-error as labeled fields (command, selector, error). No page-level horizontal scroll.
5. **Runbooks: shipped TODO.** `runbook-content.ts` Timeout entry shows "TODO: document remediation steps…". Fix: write real remediation copy for all categories; remove TODO callout style-as-content. Add bullet markers to "Likely causes". Back-link should reflect actual referrer (default "Back").
6. **Device Control: stream feedback.** "Waiting for stream…" forever with no timeout/error/retry. Fix: add a timeout state (e.g. 20s) with error message + Retry button. Also make the device-screen surface `user-select: none`.

## P1 — Consistency & IA

7. **Naming drift.** Canonical names: nav "Apps" ↔ header "Apps" (subtitle may say what it is); drop "Centralized Artifact Registry" heading and "Ingest Your First Artifact" → "Upload your first app"; "Infrastructure Control" → "Settings" (keep subtitle); remove/rename "Hotspots list" reference in selector detail banner.
8. **Copy accuracy.** "5-tier" → "6-tier" (login.tsx:46, settings.tsx:345). AI page: "0/4 configured" must count ACTIVE/configured providers correctly; provider card model subtitle should reflect the actual configured model (or drop hardcoded model names).
9. **Devices cards.** Format utilization/last-used values properly (humanized duration, n/a when unknown); label semantics correctly (if it's "time in use" don't call it Utilization); consistent Host formatting; render battery/thermal row placeholder on iOS card so cards align.
10. **Builds page.** Add standard page header (icon, title, subtitle). Empty-DB state: "No builds yet" + one-line hint (only say "no builds match" when a filter/search is active). Label the per-build count badges (tooltip + color-coded pass/fail).
11. **Users page.** Standard header w/ icon + subtitle; card-contained table; action icons in a horizontal row with tooltips; consistent row height.
12. **Profile page.** Standard header; identity card (name, email, role); align sub-nav pattern with the rest of the app.
13. **Auth pages.** Forgot/reset pages get the same split brand panel as login; unify primary button color.
14. **Maintenance.** Explicit Save affordance (or visible autosave confirmation); sentence-case the resource notice; balance card grid 2×2.
15. **Overview.** H1 "Overview" (drop the "Xenon ·" prefix); session-activity chart empty state gets a short message consistent with Recent Activity's pattern.

## P2 — Polish

16. Cron placeholder: "(At internal min 0)" → "(at minute 0)" — settings.tsx:282.
17. One date format app-wide: `MMM d, HH:mm:ss` (e.g. "Jul 16, 14:45:00") via a shared formatter.
18. Notification trigger chips: neutral icon color inherited from chip state; single selection indicator.
19. A11y: accessible names for control-page tabs and all icon-only buttons (aria-label); mosaic toolbar too.
20. Mosaic picker: status-dot legend (tooltip or caption); note why a device may appear here but not on Devices.
21. Command palette: index sessions and builds (name + id) alongside devices and navigation.
22. API Keys copy: fix stray space/paren; tighten sentence.
23. OMNI-VISION inner tabs: fit or ellipsize gracefully at 1280–1440; fix truncated search placeholder.
24. Login left panel: tighten copy, replace jargon chips with benefit-oriented labels, add the X logo mark.

## Non-goals

- No visual redesign/rebrand — the dark + green system stays.
- No new features; only fixes to what exists.
- No changes below 1280 or above 1440 (unsupported range).

## Verification

- `npm run build:xenon && npm run build:copy`, reinstall plugin, walk every touched page at 1280 & 1440.
- `npm run test:viewport` against the running server (dashboard enabled, auth disabled).
- Existing unit tests (`npm test`) must stay green; frontend tests if present.
- Remove seeded `*audit*` rows from the live DB after verification.
