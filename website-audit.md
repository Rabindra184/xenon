# website-audit.md — Xenon dashboard (RAW first pass, deliberately messy)

- **Target:** Xenon dashboard. Live at `http://localhost:4723/xenon/` (auth disabled, synthetic SUPER_ADMIN "Auth Disabled"); source at `web/` (React 17 + Vite 5 + Tailwind 3 + TS 4.9).
- **Date:** 2026-09-23
- **Status (2026-09-25):** a snapshot of `main` @ 6e9ba43, kept as written. Many findings have been fixed since: saves, the status pill, Restore Defaults and small bugs (#266); design tokens, contrast and sentence case (#267, #268); light theme (#270); Upload app (#274, #276); account menu on Devices/Apps (#279); device-control dialog (#282).
- **Mode:** BOTH (live + codebase, cross-referenced)
- **Build audited:** `main` @ 6e9ba43 (includes #264 sign-in redesign + #265 reset/logging fixes), served from `lib/public`.
- **Viewport policy:** the project supports **1280–1440px only** (CLAUDE.md "Breakpoints": no phone/tablet-portrait). So the skill's 375px mobile pass was replaced by 1280×800 and 1440×900 passes. Anything below 1280 is out of scope by design, and I'm not calling it a defect.
- **Data state:** EMPTY LAB: 0 devices attached, 0 sessions, 1 user (admin@xenon.local). So a lot of what I saw is **empty states**. Populated-state layouts are covered by the repo's route-mocked Playwright suite (`web/test/viewport/overflow.spec.ts`, 78 cases, which pass), not by my eyes. NOT VERIFIED: populated tables and cards visually.
- **Tools:** in-app browser pane (Chromium), page-JS probes (contrast computed from computed styles and blended backgrounds, a11y names, overflow), console and network reads, plus a parallel codebase sweep (notes merged below).
- **Read-only:** no forms submitted with data, no device or session actions.

## Open questions (running)
- Is the "Sessions" nav item the same destination as `/builds`? The route table has both `/sessions/*` and `/builds/...`.
- Who is the primary persona, the QA engineer watching runs or the lab admin managing devices? The nav tries to serve both at equal weight (14 items).
- Flowstep connector: only `replace-screen`/`delete-screen` are exposed in this session, so no mockups could be generated. See "Rough opportunity ideas".

---

## Global / app shell

### G1. Every nav item is a `<button>`, not a link — High
- **What:** All 14 sidebar entries (Overview, Devices, Live Devices, Apps, Sessions, Selector Health, Notifications, Settings, AI Engine, Maintenance, Teams, Users, API Keys, API Docs) are `BUTTON` elements with no `href` (DOM probe on /xenon/overview).
- **Why:** there's no URL on hover and no middle-click or ⌘-click to open in a new tab, and right-click has no "Copy link". Screen readers announce them as buttons, not navigation links. It breaks the platform convention for navigation (WCAG 4.1.2 semantics, plus basic web affordance).
- **User impact:** power users juggling several devices and sessions can't open pages side by side, which is a real workflow in a device lab. **Business:** makes the tool feel less like a professional console.
- **Fix:** render nav items as react-router `<NavLink>` with `aria-current="page"`. Keep the icon-rail look.
- **Effort:** S (one component, `web/src/components/sidebar/sidebar.tsx`, probably).

### G2. `document.title` is always "Xenon" — Medium
- **What:** the `title` probe returned "Xenon" on /xenon/overview (and every page swept below, see the table).
- **Why:** with several tabs open (common: Live Devices + a session + Selector Health) every tab reads "Xenon". Browser history and bookmarks are indistinguishable, and screen readers announce no page change on navigation.
- **Fix:** per-route title such as `Devices · Xenon`, plus a live device or session name on detail pages. Cheap with a tiny `useDocumentTitle` hook.

### G3. Secondary-grey text fails AA contrast across the shell — High
- **What (measured on /xenon/overview):** header search placeholder "Search devices, sessions, settings…" **3.0:1** at 14px; "⌘K" hint 3.2:1 at 10px; "Updated 1m ago" 3.2:1 at 12px; the "Super Admin" role line 3.2:1 at 10px; "0 devices" 3.0:1; "Non-ready" filter 2.9:1 at 11px; "No devices registered." 3.0:1; the "Live" tag 3.0:1 at 10px.
- **Why:** all of these are the `--text-dim` token (#5b6460). It's used for text app-wide but only reaches ~3.0–3.2:1 on these surfaces, below the 4.5:1 AA minimum for normal text. The #264 sign-in work already measured and fixed this on the auth pages only.
- **Fix, cheap:** raise `--text-dim` in `web/src/tokens.css` to ≥ ~#7a837f (measured 5.0:1 on --bg). One line, every consumer fixed. **Right fix:** audit which uses are text and which are decorative (dividers or icons might want the darker value) and split tokens into `--text-dim` (text, AA) and `--icon-dim` or `--decor`. See the codebase notes for use counts.
- **Risk:** visual hierarchy flattens slightly. Re-check that --text-muted and --text-dim remain distinguishable.

### G4. Heavy use of 10–11px text — Medium
- Font sizes under 12px are present on the shell and Overview: 10px ("⌘K", "Super Admin", "Live") and 11px ("Non-ready"). Combined with G3 these are the hardest strings on the page to read. At 1280–1440 on a laptop there's no space reason for 10px. Suggest an 11–12px floor for real text and 10px only for purely decorative tags.

### G5. No 404 page: unknown URLs silently become Overview (High)
- **What:** `/xenon/definitely-not-a-page-xyz` renders **Overview** (h1 "Overview", URL rewritten to /xenon/overview). The `*` route redirects.
- **Why:** a stale bookmark, a mistyped deep link or a link from an old Slack message looks like it "worked" but shows the wrong page. The user gets no signal that the thing they wanted (e.g. a session ID) doesn't exist. Heuristic: error prevention and recovery / visibility of system status.
- **Fix:** a real "Page not found" view with the requested path, a link home, and ideally a search box. Detail routes like `/builds/:id` should render "Session not found" rather than redirecting. **Effort:** S.
- **Worth investigating:** what `/builds/<nonexistent id>` and `/devices/<nonexistent udid>/control` do. NOT VERIFIED.

### G6. Staleness pill turns amber on an idle, healthy server (Medium)
- **What:** the header's "Updated 5m ago" turns **amber** (`rgb(245,158,11)`, title "Data hasn't updated in a while.") after a few idle minutes on /settings with 0 devices and nothing to update.
- **Why:** amber means warning, but nothing is wrong: the socket is up and there are simply no events in an empty or quiet lab. Crying wolf trains people to ignore the colour when it matters. Next to it, the green "Online" pill says the opposite.
- **Fix:** base staleness on the socket or heartbeat, not on the last data event, or show "Up to date · no activity". **Effort:** S–M. HYPOTHESIS: it's driven by last-event time. The codebase notes may confirm.

### G7. Three (really four) page-header patterns (Medium, design system)
- **Overview:** plain `h1` "Overview", no icon, no subtitle, no divider.
- **Devices / Sessions:** green icon + h1 + subtitle ("Builds and the test sessions recorded against them.") + a full-bleed bottom border.
- **Selector Health:** eyebrow "TEST QUALITY" + icon + h1 + subtitle + top-right icon buttons (share, refresh).
- **Settings:** icon + h1 + subtitle, no divider.
- **Why:** page chrome that changes shape page to page makes the app feel stitched together. The eye has to re-find the title each time. `components/ui/page-header.tsx` exists, so HYPOTHESIS: some pages bypass it.
- **Fix:** one PageHeader with optional eyebrow, subtitle and actions slots, used by every page. **Effort:** S–M.

### G8. Search inputs: three implementations, one overlapping its icon (Medium + bug)
- **Bug, Sessions (/xenon/builds):** the "Find builds…" input has class `input-base w-full h-8 pl-8 pr-2 text-xs`, but **computed `padding-left` is 12px, not 32px**. `.input-base` CSS beats Tailwind's `pl-8`. The search icon spans x=78–92 and the text starts at x=80, so the **icon covers the first ~12px** and the placeholder visibly reads "ind builds…". Measured, and seen in the screenshot.
- **Consistency:** header global search (its own style), `input-base` (Sessions), `device-explorer-header-text-filter` (Apps, padding 36px, fine), and Devices "Search by name or UDID…" (no leading icon). Four search-field looks.
- **Fix:** a single `<SearchInput>` primitive. For the bug, either make `.input-base` not set padding-left, or put the utility after it or use `!pl-8`. **Effort:** XS for the bug, S for the primitive.

### G9. Placeholder-only / unlabelled inputs (High, a11y)
- **Measured (inputs with no `<label for>` / aria-label):**
  - /devices: "Search by name or UDID…"
  - /apps: "Filter by bundle or name..."
  - /builds: "Find builds…" + the time-range `<select>` ("All time")
  - /selector-health: 2 `<select>`s (tier, platform)
  - /settings: the number input (Idle Health Frequency, 30000 ms) and the cron text input
  - /maintenance: 2 number inputs + the cron input
  - **/profile: all 3 password inputs** (current, new, confirm). The visual labels "New password" / "Confirm new password" are present but **not associated**, and they measure 3.2:1 contrast too.
- **Why:** screen readers announce "edit text" with no name. Placeholders vanish on typing, and clicking a label doesn't focus its field. It's the same bug #264 fixed on the sign-in pages, still present everywhere else. WCAG 1.3.1 / 3.3.2 / 4.1.2.
- **Fix:** `htmlFor`/`id` on existing visual labels, `aria-label` on search boxes. **Effort:** S. Mechanical, many files.

### G10. Off-scale font sizes (Low, design system)
- Seen: 9px (Sessions dates, e.g. "Jul 23, 17:48:03", at 3.0:1), 9.5px (Settings), 9.9px (Apps), 11.2px and 11.5px (Settings, Maintenance), alongside 10, 11 and 12px. Fractional sizes like 11.2 and 9.9 point to rem or em math on a non-16 base, or hand-tuned values outside the type scale. The codebase notes count `text-[..px]` arbitrary values.
- 9px timestamp text at 3.0:1 contrast is the single least readable string I found.

---

## Per-page notes

### /xenon/overview (empty lab)
- Two KPI tiles only, "DEVICES ONLINE —" and "ACTIVE SESSIONS 0". **Inconsistent empty encoding:** an em dash in one tile, zero in the other, for the same "nothing" state. Sub-lines "No devices registered" vs "No queue".
- Fleet status "0 devices" / "No devices registered." plus Recent activity "No activity yet". Below that, **over half the viewport (≈y 290–900 of 900) is empty.** There's no first-run guidance: nothing says how to connect a device, where the docs are, or how to run a first session. For a new install, Overview is the landing page and it's a dead end (dimension 1: dead ends).
- **Opportunity:** a first-run checklist card ("Connect a device → Upload an app → Run a session → Watch it live") that disappears once each step has happened.
- "View all →" on Fleet status goes to Devices. Fine.

### /xenon/devices (empty)
- Empty-state title "**Global Device Registry Empty**" plus body "Xenon hasn't detected any active device nodes in your infrastructure. Ensure your device farm is connected and heartbeat signals are active." Jargon ("device nodes", "heartbeat signals", "device farm") and no concrete steps. The real fixes are "plug in a device with USB debugging enabled / check `adb devices` / boot a simulator / set ANDROID_HOME"; the memory notes say a missing ANDROID_HOME silently yields 0 devices. HYPOTHESIS: the most common reason for this screen is environment, not hardware, and the page could say which platforms are enabled and whether adb/xcrun were found.
- Two refresh controls: top-right "REFRESH" and the empty state's "Manual Sync". Same job, different labels and styles. The "Manual Sync" label measures **3.3:1** on its own green-tinted button.
- The filter chip row (All / Ready / Busy / Reserved / Offline, each with a count) is still shown with all zeros. Minor.

### /xenon/builds (Sessions) — the one populated page (7 builds from July)
- **Naming split:** the nav says "Sessions" and the h1 says "Sessions", but the URL is `/builds`, the search says "Find builds…", the list items are builds, and the subtitle is "Builds and the test sessions recorded against them." `/xenon/sessions` redirects to `/xenon/builds`. Users have to learn that a Session page lists Builds. Pick one noun hierarchy and use it in the nav, URL and placeholder.
- Master/detail: the list is on the left (~150px of a 1440 viewport). The **right pane (~1150px) is empty** until you click, with "Select a build from the left to see its sessions." in low-contrast text. Opportunity: auto-select the most recent build, or show aggregate stats there.
- Build rows: name, a 9px timestamp, pass/fail count circles ("1", "1") with no labels. The small circled numbers are **colour-coded only** (green or red ring). HYPOTHESIS: failing a colour-only check (WCAG 1.4.1). Needs a closer look.
- The build hash line (`bc2c43e-3…`) is ~9px mono in dim grey.
- The summary tiles PASSED 4 / FAILED 3 / RUNNING 0 are good at a glance.

### /xenon/settings
- **Bug: Discard is disabled while there's a validation error.** Enter 1000 in Idle Health Frequency: inline error "Below minimum safe value of 5000ms." and `aria-invalid="true"` (good). The action bar shows "Unsaved changes · Restore Defaults · DISCARD · [Resolve errors to save]", but **Discard is `disabled`** (`web/src/components/ui/Layouts.tsx:48`: `disabled={isSaving || isValidating}`). You can't abandon an invalid edit, which is exactly when you want to. You have to hand-type a valid value back or leave the page. Verified live (`discardDisabled: true`). **Fix:** `disabled={isSaving}` only. **Effort:** XS. **Severity:** Medium (circumventable but maddening). The same ActionBar is probably on AI Engine and Maintenance too, so the same bug likely applies there. NOT VERIFIED on those pages.
- **Positive:** the dirty-dot per card ("Modified"), the sticky action bar, and the disabled save labelled "Resolve errors to save" are good patterns worth reusing.
- Casing mix inside one bar: "DISCARD" uppercase, "Restore Defaults" title case, "Resolve errors to save" sentence case.
- "Restore Defaults" sits right next to the unsaved-changes controls in the same bar. HYPOTHESIS: it's one click from wiping all three cards. NOT VERIFIED whether it confirms (I didn't click it, because it writes config).
- The preset buttons "BATTERY SAVER (2 AM)", "STANDARD (HOURLY)", "OPERATIONAL COVERAGE (30M)", "HIGH PERFORMANCE (10M)" are mono all-caps, and "Operational coverage" and "Battery saver" are metaphors that don't say what runs (it's a WDA restart / cache purge cron). "Intent-Based Presets" is 3.0:1 at 11px.
- Help text "Minimum safe value: 5000ms. Note: This frequency is overridden when a schedule is active." is 3.0:1 at 11.2px. The override rule is important and hidden in the least readable text on the card.
- Three cards across leave ~40% of the page empty below. Fine for settings, noting it.

### /xenon/devices/live (Live Devices / mosaic)
- **Good:** Record is disabled with a real reason in its tooltip, "Add a device to the mosaic first", with `cursor: not-allowed`. The layout buttons (1, 2×1, 2×2, 3×2, Auto) have `title`s.
- **Disabled Record still reads as active:** `background rgb(220,38,38)` at `opacity .4` on near-black renders as a clearly red, saturated block at 0.6-scale screenshot size. The most eye-catching control on an empty page is one you can't press. Suggest a neutral outline button while disabled and red only when armed. Low–Medium.
- **The h1 "Live Devices" is 16px** here while other pages' h1s are larger (Overview's is visually ~24px). Another page-header inconsistency (see G7).
- Empty grid: four "Drag device here / or click one in the panel" drop cells take ~85% of the viewport with no device in them. First-time users get the instruction in the smallest, lowest-contrast text on the page, in the left panel: "Click a device to add it to the mosaic. Record captures every device in the mosaic. After Stop, download the video (mp4) — not a proof bundle." The phrase "— not a proof bundle" assumes you know what a proof bundle is, and where to get one if you want one.
- The picker item `star2ltexx` shows a hollow "○" marker while the device is **Ready** (per /devices and the API). The legend under the list ("available / in use / offline") uses dots. HYPOTHESIS: hollow means "not in mosaic", but it reads like "offline". Low. NOT VERIFIED which state maps to which glyph.
- NOT VERIFIED (deliberately): starting a stream, dragging into a cell, or recording. All would take a manual lock or start ffmpeg on the real device that was attached mid-audit, which is out of bounds for a read-only pass.

### /xenon/apps (1 artifact: WDA-SIGNED.IPA)
- **Two icon-only row actions with no accessible name and no tooltip:** `<button class="utility-icon-btn">` (download) and `<button class="utility-icon-btn danger">` (delete). The DOM probe found 2 unnamed buttons. A screen reader says "button, button". A sighted user has to recognise a 14px glyph, and the delete is one click from download. High for a11y, Medium for UX. **Fix:** `aria-label` + `title` ("Download WDA-SIGNED.IPA", "Delete WDA-SIGNED.IPA"), plus a confirm dialog for delete (NOT VERIFIED whether one exists, because I didn't click it).
- The artifact name renders uppercase ("WDA-SIGNED.IPA"). If the real filename is mixed case, uppercasing changes what users copy and search. HYPOTHESIS: CSS `text-transform`. Verify against the API.
- Column headers are mono all-caps in dim grey (ARTIFACT BUNDLE, VERSION, SIZE, REGISTRY DATE, MANAGEMENT). "Registry date" and "Management" are odd names for "Uploaded" and "Actions".
- Platform toggle "ANDROID / iOS" + filter + "1 OF 1 ARTIFACT" + a funnel icon + Refresh + Upload App: six controls in one row. Fine at 1440. NOT VERIFIED at 1280.
- 9.9px text present (probe).

### /xenon/selector-health (clean state)
- Six KPI tiles (Brittle selectors 0, Total heals 0, Sessions touched 0, LLM heals 0, Est. cost $0, Resolved 0) with "no change" delta chips at **2.6:1** 10px. Very low-contrast zeros.
- Empty state "Locator hygiene is clean / No selectors required healing in the last 30 days" + "View API docs". Pleasant, but "View API docs" is an odd next step for "you're clean". Opportunity: link to "How healing works" or the Settings toggle.
- Two filter `<select>`s (tier, platform) without programmatic labels (see G9).
- Eyebrow "TEST QUALITY" (see G7).

### /xenon/ai-settings
- **Good:** clear model. "All credentials and endpoints are managed via environment variables." Providers without keys are greyed out with "NOT SET". Runtime config on the right.
- Contrast: "NOT SET" **2.6:1** at 10px, "DEFAULT" 2.7:1 at 11px, "TEMPERATURE" / "MAX TOKENS" 2.9:1 at 10px. The labels for the sliders are the least readable text on the page.
- NOT VERIFIED: whether the same ActionBar Discard-disabled-while-invalid bug (Settings) applies here. The slider inputs probably can't go invalid.

### /xenon/profile (auth-disabled mode)
- The subtitle reads "Auth Disabled — **SUPER_ADMIN**": a raw enum in UI copy. Elsewhere the role renders as "Super Admin" (header, Users table). Inconsistent.
- **All three password fields are unlabelled programmatically** (G9) and their visible labels are 3.2:1.
- In auth-disabled mode the page offers "Update Password" for a synthetic user that has no password. HYPOTHESIS: submitting fails or does something odd. NOT VERIFIED (didn't submit). Suggest hiding the form with an explanation when `kind === 'auth-disabled'`.
- The left sub-nav ("Password & Authentication", "API Tokens") is the **only** place in the app with a secondary nav column. Settings, AI Engine and Maintenance are separate top-level items instead. IA inconsistency: why are the user's API tokens here, while the API Keys admin page is top-level?

### /xenon/users, /teams, /api-keys, /notifications, /maintenance
- **Users:** single row "Bootstrap Super Admin". Row actions are icon-only (edit, key, trash) at ~14px. The column headers "Email / Role / Status / Last Login" are 3.0:1 at 11px. "Last Login —" for the bootstrap admin even though that admin signed in earlier. NOT VERIFIED whether last login is tracked in auth-disabled mode.
- **Teams, API Keys, Notifications:** few contrast fails (3–4 each) and no unlabelled inputs. Checked, nothing notable beyond G3/G4.
- **Maintenance:** 2 unlabelled number inputs + a cron input (G9). Help text 3.0:1 at 11.2px ("Standard enterprise rete[ntion]…", "Protects against databas[e]…", "Disabling this will leav[e]…"). The important consequences of the setting are in the least readable text.

### /xenon/runbooks/general
- h1 "**Unknown failure category**". That's a deep-linkable route that, for a plausible slug like "general", tells the user their category is unknown. NOT VERIFIED what the valid slugs are (the codebase notes may list them). Low.

---

## Interaction & keyboard (dimension 8, 10)
- **Focus visible:** yes, but only the **browser default** ring (`outline: auto 1px`, Chromium's default focus colour) on every tab stop sampled (20 stops: nav, header, Overview filters). No designed focus style. On a near-black UI the 1px default ring is faint. Medium: design a 2px `--green` focus ring token.
- **No skip link.** From page load it takes **17 tab stops** (14 nav + "Xenon home" + "Open command palette" + the account menu) before reaching page content, on every page. Medium.
- **Landmarks:** 1 `main`, 1 `nav`, 1 `aside`, **3 `header` elements**. OK-ish. Multiple `header`s are fine if they're in sectioning content. NOT VERIFIED which three.
- **Command palette (⌘K):** `role="dialog"`, `aria-modal="true"`, `aria-label="Command palette"`, focus moves into the input, Escape closes. **But focus is not returned to the trigger on close**: `document.activeElement` became `<body>`. The keyboard user loses their place. Medium. **Fix:** store and restore the previously focused element.
- **Palette search scope doesn't match its promise.** The placeholder is "Search devices, sessions, settings…". "star2" finds the device (good), "dev" finds the Devices page, but **"author-appium" (a real build visible on /builds) returns "No results."** Either index builds and sessions or change the placeholder. Medium (trust: the UI claims a capability it doesn't have).

## Performance signals (dimension 13), signals not measurements
- Localhost load of /overview: DOMContentLoaded 76ms, load 122ms (cached). Not meaningful for remote hubs.
- **Static assets are uncompressed:** `content-encoding: null` on `index-*.js` (199KB decoded), `index-*.css` (80KB), `useSocket-*.js` (41KB). Gzip or brotli would cut the JS to roughly a quarter. HYPOTHESIS: ~50–60KB gzipped, based on Vite's own build report of ~64KB gzip for the main chunk. Low on LAN, Medium for a hub reached over VPN.
- **Hashed assets are sent `Cache-Control: public, max-age=0`**, so every navigation or reload revalidates every asset (304 round trips). Content-hashed filenames can be `max-age=31536000, immutable`. Low–Medium.
- **Duplicate or chatty API calls** seen in the network log while navigating: `GET /api/teams` twice back to back, `GET /api/config` three times within one page change, `/api/device?t=…` twice 14ms apart, and **`/api/device` polled every ~5s** on /devices and /devices/live *in addition to* the Socket.io "Connected to Hub" push channel. Cache-busting `t=` params on every call defeat HTTP caching. This is a production build, so it isn't StrictMode double-invocation. Medium for hub load with many dashboard tabs. HYPOTHESIS: several components fetch the same resource independently. A shared query cache (react-query/SWR) or context would dedupe.
- Third-party hosts: **none**. Only `localhost:4723` (post-#264 self-hosted fonts). Checked.

## Technical (dimension 14)
- Console on this tab: 6× `401 (Unauthorized)`, 1× `429 (Too Many Requests)`, 2× "[Socket] Connected to Hub". ASSUMPTION: the 401s and 429 come from **my own earlier sign-in and rate-limit tests in this browser tab** (#264/#265 verification). They predate the 96 dropped network entries, so I couldn't attribute them. Every API call in the retained window returned 200. Not counted as an app defect. Re-check in a fresh profile.
- `lang="en"` present. Checked.
- Horizontal overflow: **0 elements** past the viewport edge on all 17 routes at 1440×900 (probe). Checked. The 1280 boundary is covered by the repo's Playwright spec (78/78 passing earlier today).
- Images without `alt`: 0 on every page probed. Checked.
- **Data freshness observed live:** `/api/device` went from `[]` to 1 device (star2ltexx) during the audit, and /devices, /devices/live and the palette all reflected it. But the header kept saying "Updated 5m ago" (amber) after the device appeared, which reinforces G6 (the staleness clock isn't tied to device updates).

### G5 (continued): detail links to missing items fail silently too (High)
- **Verified:** `/xenon/builds/does-not-exist-123` renders the normal Sessions list (h1 "Sessions", 7 builds, nothing selected). **The URL keeps the bogus id** and there's no "not found" text, toast or `role=alert` (checked the page text and live regions).
- **Verified:** `/xenon/devices/NOPE-UDID/control` renders the Devices grid (h1 "Devices", star2ltexx card). The URL still says `/devices/NOPE-UDID/control`, again with no message.
- **Why this is worse than the generic 404:** the realistic case is a **shared link to a session that was cleaned up** (Maintenance auto-deletes builds after N days) or a device that was unplugged. The recipient lands on a list that looks normal and concludes the link is wrong or the app is broken. The URL now contradicts the screen.
- **Fix:** detail routes render an explicit "Session `does-not-exist-123` wasn't found. It may have been removed by retention (30 days)." state with a link back to the list. **Effort:** S per route.

### 1280×800 pass
- All 14 main routes: **0 elements past the viewport edge** and 0 text elements clipped without an ellipsis (probe). Checked. Consistent with the Playwright suite.

---

## Cross-reference: live vs code (spot-verified by me, not just relayed)

These codebase-sweep claims I re-checked in source before trusting them:

- **VERIFIED: failed saves can show success (Critical).** `web/src/api-service/api-client.ts` `jsonResult()` handles only 403 (toast) and 409 (device conflict). For any other status it does `return res.json()`, so a **400/422/500 with a JSON body resolves as success**. `components/settings/settings.tsx` `handleSave` then calls `setBaseline(payload)` and toasts "Infrastructure parameters synchronized across fleet.". The UI claims the save worked, marks it clean, and the server never applied it. The mechanism is certain. NOT VERIFIED: which endpoints actually return JSON error bodies (most Express handlers here do `res.status(4xx).json({error})`, so probably many). **Fix:** `if (!res.ok) throw new ApiError(res.status, body)` in `jsonResult`, then audit the ~63 call sites that relied on the old behaviour.
- **VERIFIED: "Restore Defaults" is one click and destructive (High).** `handleResetToDefaults` sets DEFAULTS, calls `handleSave(DEFAULTS)` (a server write), **then `resetMetrics()`**. No confirm dialog. It sits in the same ActionBar as Discard (see /settings notes). **Fix:** a confirm dialog naming both effects ("Reset 3 settings to defaults and clear metrics?"), or split the metrics reset out.
- **VERIFIED and CORRECTS my G6:** the header staleness isn't "last event time" as I guessed. It's **time since the header component mounted**: `web/src/components/header/header.tsx` `useRelativeTime()` does `const [startedAt] = useState(() => Date.now())` and ticks every 5s. It turns `aging` (amber) at 2 min and `stale` (red) at 10 min regardless of data. On any tab left open 10 minutes, the header claims the data is stale while sockets and polls keep it live. The **"Online" pill is hardcoded** green text (`header.tsx:109`), and the account menu's "Registry · Default", "Node · Root · Primary" and "System · Stable" are static strings (`header.tsx:135–151`). **Severity raised to High:** these are status indicators with no connection to status. In an ops console that's a trust problem. **Fix:** drive the pill from the Socket.io connection state and "Updated" from the last successful fetch or socket message, or remove them.
- Live confirms the code notes on: no 404 route (G5), `document.title` static (G2), contrast failures from `--text-dim` (G3), unlabelled inputs (G9), and the palette missing some destinations (live: builds not searchable).
- Code notes add, NOT VERIFIED live by me: session rows are `<tr onClick>` (mouse-only). The device-control overlay has no dialog role, Escape or focus trap. Reservation duration options are clickable `div`s. The ErrorBoundary uses 3 undefined CSS vars (button text 1.89:1) and doesn't reset on navigation. There are 18 native `alert/confirm/prompt` calls. The primary `<Button>` is white on `#16a34a` at **3.30:1** (a text-contrast failure on the main CTA style, inconsistent with the #264 sign-in button, which is black on `#22c55e`).

---

## Codebase sweep notes (merged verbatim from the parallel read-only pass)

## 0. Headline findings (details below)

1. **The API client never rejects on HTTP errors.** In `api-service/api-client.ts:71-104`, `jsonResult` toasts on 403 and 409 and then does `return res.json()` for every status. A 400, 401 or 500 with a JSON body therefore **resolves as success**. All 63 call sites in `api-service/index.ts` go through it. Example: `settings.tsx:170-174` awaits `updateGlobalConfig`, then calls `setBaseline` and toasts "Infrastructure parameters synchronized across fleet." That success toast would show even when the server rejected the write (HYPOTHESIS for any specific endpoint; the mechanism itself is certain). **Critical.**
2. **No 401 handling mid-session.** `auth-context.tsx:36-38` calls `getMe()` once on mount. Nothing reacts to a later 401: `api-client` has no 401 branch, and pages get error bodies back as "data". An expired session mid-use produces empty lists or silent failures, not a redirect to `/login?reason=expired`. **High.**
3. **"Server unreachable" looks like "empty".** Overview (`use-overview-data.tsx:70,81,91,113` all `/* ignore */`), Devices (`device-explorer.tsx:96-100` `console.log` then shows "Global Device Registry Empty"), and Sessions (`builds-page.tsx` never reads `data.loading`/`data.error`, which `use-builds-data.ts:13-14,78-79` provides). None of them has an error or offline state. **High.**
4. **The header status signals are hard-coded.** The "Online" pill (`header/header.tsx:107-109`) is always green. The "Updated Xm ago" label is time since the Header *mounted*, not since the last data (`header.tsx:8-28`, whose own comment admits it). After 10 minutes on any page it turns red and says "Data is stale — reconnection may be needed" while the data is live. The account dropdown shows static "Registry Default", "Node Root · Primary" and "Stable" (`header.tsx:131-153`). Overview "Live" is also always on (`overview.tsx:48` passes `live`, default `true`). **High.** These are trust-eroding false signals.
5. **About 235 text uses of `--text-dim`.** That is 136 × `text-[var(--text-dim)]` in TSX, 97 × `color: var(--text-dim)` in CSS, and 2 more (1 inline style, 1 placeholder). Measured contrast: 3.19:1 on `--bg`, 3.01:1 on `--surface`, **2.85:1 on `--surface-2`**, and 2.53:1 on `#1f2624`. All fail AA 4.5:1. This is worse than the 3.1–3.2 in the brief because of surface-2. **High.**
6. **Primary button fails AA.** `.btn-primary` is `#ffffff` on `--green-dim #16a34a`, which is **3.30:1** (hover `#2ea043` is 3.37:1), at 12px/600 weight in `button.css:30-37`. The newly redesigned sign-in uses black on `#22c55e` (9.22:1, `login.tsx:220`), so the primary CTA looks different on either side of login. **High / consistency.**
7. **Session rows can't be reached by keyboard.** `builds/session-row.tsx:48-50` is `<tr onClick={onOpen}>` with no link, no tabIndex and no key handler. Keyboard and AT users cannot open a session detail from the Sessions list. **High (a11y blocker on a core path).**
8. **The one ErrorBoundary is broken and poorly scoped.** It lives in `routes/index.tsx:59` around all routes, with no reset on navigation: after one crash, sidebar clicks keep showing the error until a reload. Header, Sidebar and CommandPalette sit outside any boundary, so a crash there is a white screen. It references **undefined tokens**: `--bg-main`, `--accent-red`, `--secondary` (`ErrorBoundary.tsx:46,52,72,84`). The result is no background, a red icon and error text rendered in `--text` colour, and button text `#e6ebe9` on `#22c55e` at **1.89:1**. The copy is jargon: "Component Exception Detected … Xenon's isolation engine". **High.**
9. **"Restore Defaults" on /settings is a one-click destructive action.** `settings.tsx:184-192` saves DEFAULTS to the server *and* calls `resetMetrics()` (`POST /config/reset-metrics`) with no confirm and no undo. A metrics-reset failure is only `console.error`. **High.**
10. **18 native browser dialogs** (13 `confirm`, 3 `alert`, 2 `prompt`) in an enterprise dashboard, while a Radix `Modal` exists. **Medium.**

---

## 1. Stack and dependencies (checked)

`web/package.json`. Installed versions were verified from `node_modules`. Where the table says "current major", that is ASSUMPTION / NOT VERIFIED online (no network check).

| Package | Declared / installed | Assumed current major (Sep 2026) | Note |
|---|---|---|---|
| react / react-dom | 17.0.2 | 19 | 2 majors behind. No automatic batching; `useLogcatStream` batches manually because of this (per CLAUDE.md) |
| react-router-dom | ^6.30.2 / 6.30.2 | 7 | 1 major behind. v7 is mostly a drop-in from 6.30 with future flags |
| @types/react-router-dom | 5.3.3 | n/a | **Stale**: v5 typings, while v6 ships its own types. Dead or misleading devDep. Nit |
| @types/styled-components | 5.1.34 | n/a | **Dead**: `styled-components` is neither a dependency nor imported anywhere (grep of `src` finds 0 hits). Nit |
| @types/jest | 26.0.24 | n/a | The tests run on vitest. Likely dead. Nit |
| vite | ^5.0.12 / 5.4.21 | 7 (ASSUMPTION) | 2 majors behind |
| vitest / @vitest/ui | ^1.6.1 | 3–4 (ASSUMPTION) | Behind |
| tailwindcss | ^3.4.19 | 4 | 1 major. v4 is a config-model rewrite (CSS-first), so L effort |
| typescript | **4.9.5 in web** vs **^5.5.4 in the root** `package.json` | 5.x | **Two TS versions** in one repo. Web's TS is listed under `dependencies`, not `devDependencies` (Nit) |
| @testing-library/react | 11.2.7 | 16 | 5 majors behind. v11 predates React 18 |
| @testing-library/user-event | 12.8.3 | 14 | 2 majors behind. `Modal.tsx:25-36` comments on a focus workaround needed *because* tests use `fireEvent` rather than user-event v14 |
| react-markdown | ^8.0.7 | 9–10 | Behind |
| pretty-ms | ^8 | 9 | Minor |
| lucide-react | ^0.555 | fine | |
| Radix (dialog, popper, portal, dismissable-layer, roving-focus) | ^1.x | fine | Low-level Radix pieces are installed directly (popper, roving-focus). Used by `Menu.tsx`/`Popover.tsx` |

Other stack notes:
- `web/README.md` is **stale Create-React-App boilerplate** (46 lines: "bootstrapped with Create React App", `yarn start`, localhost:3000). The project uses Vite. `src/react-app-env.d.ts` is also a CRA leftover. Nit.
- `tailwind.config.js` does **not** map the design tokens into the theme (only `fontFamily` is extended). That is why TSX carries 1,785 `var(--…)` references, mostly as `text-[var(--text-dim)]`-style arbitrary values. **Opportunity**: map `colors: { text: { DEFAULT: 'var(--text)', muted: …, dim: … }, surface: …}` so `text-dim` / `text-muted` become first-class classes, and a later AA fix is a single token edit. M effort.
- `runbook-page.tsx:49` uses `prose prose-invert prose-sm`, but `@tailwindcss/typography` is not installed (`plugins: []`), so those classes are no-ops. The styling comes from `.runbook-prose` in `runbook-page.css`. Nit (dead classes, misleading).
- `tsconfig`: `strict: true`, `target: es5`. `tsc --noEmit -p web` passes with 0 errors.
- **ESLint** (root `.eslintrc.js`; `npx eslint web/src`, no fix): 773 problems. 717 are prettier; 25 `no-unused-vars`; 13 `no-non-null-assertion`; **8 errors "Definition for rule 'react-hooks/exhaustive-deps' was not found"**, meaning the `react-hooks` plugin is not installed or configured, so **Rules of Hooks and exhaustive-deps are not enforced on the frontend at all**. The `eslint-disable` comments in `command-palette.tsx:64`, `ai-settings.tsx:101`, `maintenance-settings.tsx:54`, `settings.tsx:102`, `webhook-settings.tsx:70`, `useIdleDetector.ts:122` and `reset-password.tsx:36` point at a rule that doesn't exist. There is also **no `jsx-a11y` plugin**, so none of the a11y issues below are linted. Medium, S–M effort (add plugins, which will surface a backlog).

---

## 2. Route inventory (checked)

Top-level routes in `App.tsx:39-61`. All are `lazy`: login, forgot-password, reset-password, `reset-password/:token`, and `/api-key-gate` (ApiKeyGate, then redirect to /overview). `*` goes to `RouteGuard` and then `Shell`.
Shell routes are in `routes/index.tsx:61-87`, all `lazy`, under one `ErrorBoundary` and one `Suspense` ("Hydrating view…").

| Path | Component (file, lines) | In sidebar? | Loading | Error | Empty | h1 |
|---|---|---|---|---|---|---|
| `/` | Navigate to /overview | – | – | – | – | – |
| `/overview` | `overview/overview.tsx` (55) + `use-overview-data.tsx` | yes | **none** (renders zeros/"—" immediately) | **none**: 4 silent `.catch(() => {/* ignore */})` | partial ("No devices registered", "No queue"), indistinguishable from API down | 1 (own `text-2xl` h1, not `PageHeader`) |
| `/devices` | `device-explorer/device-explorer.tsx` (254, **class component**) | yes | yes ("Loading devices…" h3, line 202) | **no**: catch does `console.log(error)` then shows "Global Device Registry Empty" (96-100) | yes (207, 219) | 1 via PageHeader |
| `/devices/:udid/control/:tab?` | same DeviceExplorer + overlay `.device-control-modal` (235-243) | no (reached via card) | device-control has its own | many `console.error` | – | device name is an `h2`, sub-cards `h4` (skips h3) |
| `/devices/live` | `mosaic/DeviceMosaicView.tsx` (460) | yes | **none** for the device list | the list load `catch { /* swallow */ }` (116); tile-level banners exist (391) | picker has empty text (NOT VERIFIED visually) | 1 (`text-base` h1, line 376; a third h1 style) |
| `/apps` | `apps/apps.tsx` (486) | yes | yes | yes (toasts) | yes | 1 |
| `/sessions`, `/sessions/*` | Navigate to /builds | – | | | | |
| `/builds`, `/builds/:buildId` | `builds/builds-page.tsx` (148) | yes (label "Sessions") | **none**: `data.loading` never read. While loading it shows "Select a build from the left…" (108-111) | **none**: `data.error` never read | yes (`buildHasNoSessions`) | **2 h1s**: PageHeader "Sessions" + `builds-header.tsx` h1 |
| `/builds/:b/sessions/:s` | `session-detail/session-detail-page.tsx` (193) | no (drill-down) | yes (61) | yes (67-72), and notFound navigates away with a toast (50-59) | n/a | **0 h1** |
| `/notifications` | `webhook-settings/webhook-settings.tsx` (361) | yes | yes | yes | yes | 1 |
| `/settings` | `settings/settings.tsx` (402) | ADMIN | yes | yes (toast) | n/a | 1 |
| `/ai-settings` | `settings/ai-settings.tsx` (430) | ADMIN | yes | yes | n/a | 1 |
| `/maintenance` | `settings/maintenance-settings.tsx` (275) | ADMIN | yes | yes | n/a | 1 |
| `/api-keys` | `settings/api-keys.tsx` (562) | ADMIN | yes | yes | yes | 1–2 |
| `/teams` | `settings/teams.tsx` (582) | ADMIN | yes | yes | yes | 1–2 |
| `/users` | `pages/users.tsx` (377) | ADMIN | yes | yes (inline) | weak (1 hit) | 1 |
| `/selector-health` | `selector-health/selector-health-page.tsx` (712) | yes | yes | yes (3 hits) | yes (uses `EmptyState`) | 1 |
| `/selector-health/detail?value=` | `selector-detail-page.tsx` (507) | no (drill-down) | yes | weak (1 hit) | yes | 1–2 |
| `/runbooks/:category` | `runbooks/runbook-page.tsx` (62) | **no** (reached only from session failure links) | n/a (static) | fallback banner for an unknown category | – | h1 comes from markdown (NOT VERIFIED) |
| `/profile` | `pages/profile/profile-page.tsx` (49) | no (header dropdown) | none | none at page level | – | 1 |
| `*` | `<Navigate to="/overview" replace />` | – | | | | |

Missing-state list (key finding):
- **No error state at all**: Overview, Sessions/Builds list, Live Devices list, Devices (error shows as an empty registry).
- **No loading state**: Overview, Sessions/Builds list, Live Devices list, Profile.
- **Zero skeleton components anywhere** (grep "skeleton" finds 0 hits). Loading uses 21 different spinner/"Loading…" usages. There are **three different app-level loading texts**: `App.tsx:38` "Loading…" (inline `style={{padding:40}}`), `route-guard.tsx:12` "Loading…" (inline style), and `routes/index.tsx:49` "Hydrating view…" (jargon).
- `EmptyState` primitive (`ui/EmptyState.tsx`) is used by only **2 files** (`selector-health-page.tsx`, `network-panel.tsx`). Every other empty state is hand-rolled.

Routing and navigation findings:
- **No 404.** The catch-all `routes/index.tsx:86` silently redirects to /overview. A mistyped or stale URL (e.g. an old `/builds/<deleted>`) lands on Overview with no explanation. **Medium**. Fix: a NotFound page with "Go to Overview" (S).
- **Coded but not in the sidebar**: `/runbooks/:category`, `/profile` (header menu only), `/selector-health/detail`, `/devices/:udid/control/:tab?`, `/api-key-gate` (only by URL; legacy path, referenced nowhere in `src` except App.tsx). This is all reasonable drill-down except `/api-key-gate`: **HYPOTHESIS: dead legacy route**. Its `ApiKeyGate.tsx:14-18` treats *any* non-401 from `/sessions` as authed, and `.catch` → `authed=false`, so server-down shows the key form.
- **Nav links to missing routes**: none found. Sidebar paths all exist.
- **Command palette nav list is out of sync with the sidebar.** `command-palette/command-index.ts:13-24` omits **Live Devices, Selector Health, Users and Profile**. It is also **not role-filtered**, so Members see Settings, AI Engine, Maintenance, Teams and API Keys, which the sidebar hides from them (`sidebar.tsx:43-48`). **Medium**, S effort (share one nav config between sidebar and palette).
- **No route-level role guard.** Admin pages rely on the sidebar hiding them plus a server 403 toast (`api-client.ts:72-80`). A Member who types `/settings` gets the page chrome, then a 403 toast, and probably empty or default form values (HYPOTHESIS: settings may show DEFAULTS as if real). **Medium**. Fix: `<RequireRole min="ADMIN">` wrapper with a "You don't have access" page (S–M).
- **Sidebar uses `<button onClick={navigate}>`, not links** (`sidebar.tsx:85-103`). Across the app there are only 7 `<Link>` usages vs 19 `navigate(...)` calls. Consequences: no middle-click or cmd-click to open in a new tab, no URL on hover, no "copy link". Session rows, build rail items and device cards behave the same way. **Medium** for a multi-tab ops tool (M effort).
- Sidebar tooltips are `group-hover` only (`sidebar.tsx:100`), not focus. Sighted keyboard users see icon-only nav with no label. **Teams and Users share the same `Users` icon** (`sidebar.tsx:46-47`). 13 icon-only items plus API Docs. **Medium/Low**.
- Nav label "Sessions" points at `/builds`, whose page h1 is "Sessions" while the URL says builds. Deliberate (comment at `routes/index.tsx:67-68`), but the naming split leaks into the URL. Nit.
- Runbook links use raw `href="/xenon/runbooks/..."` (`session-detail-page.tsx:134`, `failure-summary.tsx:62`). That causes a **full page reload** outside the router (auth re-fetch, socket reconnect). Low. Fix: `<Link>`.
- **No per-route `document.title`.** grep finds 0 hits. Every tab is titled "Xenon" (`index.html:26`). WCAG 2.4.2 and multi-tab usability. **Medium**, S effort.
- Profile tabs are not URL-addressable (`profile-page.tsx:13`, local state), and have no `role="tab"` / `aria-selected` / `aria-current`. Low.

---

## 3. Design-system consistency (checked)

### Colours
- Hex literals: **141** in `src` TS/TSX/CSS, excluding `tokens.css` and tests (157 including them). Plus **466 `rgba()/rgb()` literals** (top: `settings.css` 121, `omni-inspector.css` 97, `device-control.css` 55, `apps.css` 33, `webhook-settings.css` 26, `selector-health.css` 22). Compare **1,785 `var(--…)` usages**.
- Most frequent hex: `#60a5fa`×13, `#000`×11, `#f87171`×9, `#4ade80`×7, `#ff4d4d`×6, `#fff`×5, `#fbbf24`×5, `#e74c3c`×5, `#1a1a1a`×5, `#f59e0b`×4, `#ef4444`×4, `#00e67a`×4, `#ffffff`×3, `#ff3333`×3, `#dc2626`×3, `#3b82f6`×3, `#38bdf8`×3, `#10b981`×3.
- **Seven different reds** in circulation: `#ef4444` (token), `#f87171`, `#ff4d4d`, `#e74c3c`, `#ff3333`, `#dc2626`, `#fca5a5`. **Five greens**: `#22c55e` (token), `#16a34a`, `#4ade80`, `#00e67a`, `#2ea043` (GitHub green, button hover, `button.css:36`), `#10b981`. **Blue**: the token is `#3b82f6`, but `#60a5fa` is the de-facto "accent" in selector-health.
- Files with the most hex: `selector-health/selector-health.css` 23, `omni-inspector/omni-inspector.css` 22, `device-control/logcat/tagColor.ts` 12 (legit: tag palette), `logcat.css` 11, `device-control.css` 10, `settings.css` 9, `mosaic/RecordingControls.tsx` 6.
- **Undefined CSS custom properties referenced.** These are real bugs: the value silently falls back or is invalid.
  - `--accent`: **17 uses**, never defined. The fallbacks differ per site: `#3b82f6` (`DevicePicker.tsx:107`, `RecordingControls.tsx:287,303`), `#60a5fa` (`selector-health.css:883,937-941,1039,1069,1073,1230,1245`; `tab-nav.tsx:27`; `selector-detail-page.tsx:218`; `selector-health-page.tsx:225`), `var(--border-strong)` (`device-card.css:86,127`). The same "accent" renders three different colours. Medium.
  - `--accent-red`, `--bg-main`, `--secondary`: `ErrorBoundary.tsx:46,52,72,84` (see headline 8).
  - `--primary-soft`: `device-control.css:710,738`. No fallback, so `background` is invalid and the focus `box-shadow` is dropped. **The focus ring for that control is invisible** (HYPOTHESIS on which control; line 735 also sets `outline: none`, so it has no focus indicator at all). Medium.
  - `--surface-raised`: `BugReportButton.tsx:40,55`. The hover background never applies. Low.
  - `--surface-1` (with fallback, `LayoutSelector.tsx:21`, `DeviceMosaic.tsx:137`) and `--red-soft` (with fallback, `network-request-modal.tsx:74`). These work but are off-system. Nit.
  - `--slider-pct` is set at runtime. OK.
- `tokens.css` has **no light theme**. `lib/theme-flag.ts` is a permanent no-op shim ("will be deleted in a later maintenance pass"). Nit, dead code.
- `tokens.css:95-100` has a reduced-motion rule, `* { animation: none !important }`. It also **stops every loading spinner** (`animate-spin`), so a reduced-motion user sees a frozen spinner icon that looks hung. Low. Fix: exempt `.animate-spin`, or use a slower opacity pulse.

### Typography
- Arbitrary Tailwind font sizes: `text-[10px]`×**55**, `text-[11px]`×26, `text-[9px]`×**6**, `text-[12px]`×1, `text-[13px]`×1 (89 total).
- CSS `font-size` has **38 distinct values**, including 11px×106, 12px×48, 10px×40, 13px×27, 11.5px×11, 10.5px×7, 9.5px×3, 9px×4, and a mix of rem values (0.7, 0.75, 0.78, 0.8, 0.85, 0.9, 0.95rem). No type scale. **9–10px text combined with `--text-dim` is the worst legibility case** (e.g. `header.tsx:124` role label is `text-[10px] text-[var(--text-dim)]`; the dropdown section labels at 132 and 145 are the same). Medium. Fix: define 4–5 text tokens (11/12/13/14/20) and ban <11px (M–L).
- **Three different h1 treatments**: Overview `text-2xl font-semibold` (`overview.tsx:23`), `PageHeader` `text-xl` (`page-header.tsx:32`), Live Devices `text-base` (`DeviceMosaicView.tsx:376`). Overview and Live Devices don't use `PageHeader` at all. Low/consistency.

### Radius and spacing
- `border-radius` in CSS: 6px×75, 4px×43, `var(--radius-md)`×29, `var(--radius-sm)`×22, 8px×18, 50%×17, 999px×13, `var(--radius-lg)`×12, 3px×6, 10px×4, 16px×2. So **~70% are literals** that duplicate token values. Nit.
- Arbitrary Tailwind sizing is rare (42 distinct non-`var` arbitrary utilities). Mostly fine. Off-palette examples: `placeholder:text-[#7a837f]`, `hover:border-[#3a4542]`, `bg-[#070b09]`, `bg-[#000]`.

### `--text-dim` used for text (AA failures)
- Count: **136** `text-[var(--text-dim)]` (TSX) + **97** `color: var(--text-dim)` (CSS) + 1 inline + 1 placeholder, about **235**.
- Contrast (computed): 3.19 (`--bg`), 3.01 (`--surface`), **2.85 (`--surface-2`)**, 2.53 (`#1f2624`).
- Top files: `selector-health.css` 23, `settings.css` 21, `pages/users.tsx` 12, `session-detail/network-request-modal.tsx` 12, `pages/profile/api-tokens-tab.tsx` 9, `session-detail/failure-summary.tsx` 9, `omni-inspector.css` 9, `header/header.tsx` 9, `overview/fleet-status.tsx` 8 (including the OFFLINE status text colour, line 34), `mosaic/DevicePicker.tsx` 8, `builds/session-table.tsx` 8, `apps.css` 7.
- Used for **form labels** (`password-tab.tsx:62`), idle-modal body copy (`IdleWarningModal.tsx:25`), the "Release now" button text (`IdleWarningModal.tsx:34`), and the Builds empty-state copy (`builds-page.tsx:109`).
- Fix options: (a) raise the token to about `#7c8580` (NOT VERIFIED; it must clear 4.5:1 on `#161b1a`); `--text-muted #8a938f` is 5.52:1 on surface-2. That is a one-line fix but it flattens the hierarchy. Or (b) keep `--text-dim` for decoration and icons only and migrate text to `--text-muted`. S for (a), M for (b). **High.**

### Button census
- `ui/button.tsx` (cva: primary, secondary, outline→secondary, ghost, link, destructive→danger; sizes sm/md/lg/icon) is imported by **7 files**, with **28 `<Button>` usages**.
- **About 216 raw `<button>` elements** (multi-line aware) with ad-hoc classes. Top files: `device-control.tsx` 30, `OmniInspector.tsx` 20, `selector-detail-page.tsx` 10, `LogcatView.tsx` 10, `teams.tsx` 7, `selector-health-page.tsx` 7, `apps.tsx` 7.
- **39 bespoke `*-btn` / `*-button` CSS classes**: `.dpad-btn .omni-action-btn .omni-clear-btn .omni-copy-btn .omni-dpad-btn .omni-fw-btn .omni-mode-btn .omni-refresh-btn .omni-test-btn .sh-action-btn .sh-back-btn .sh-copy-btn .sh-ghost-btn .sh-icon-btn .sh-refresh-btn .logcat-icon-btn .logcat-input-btn .utility-icon-btn .icon-btn-secondary .ghost-btn .save-btn .reset-btn .confirm-deploy-btn .terminal-action-btn .test-connection-btn .thumb-delete-btn .take-screenshot-btn .tab-btn .seg-btn .footer-action-btn .back-to-devices-btn .copy-btn-critical .add-inline-btn …`
- There are also **`btn-*` classes outside the primitive**: `.btn-premium .btn-save .btn-reserve .btn-cancel .btn-destructive .btn-text-only .btn-sm` (in `tag-manager-modal`, `reservation-modal`, `device-control`, `logcat`). `btn-destructive` and `btn-danger` coexist. `LogcatView.tsx` and `logcat.css` import `ui/button.css` directly, coupling to the primitive's internals.
- **94 `<button>` without an explicit `type=`** (heuristic). Inside a `<form>` that means an implicit submit. Seven files have forms; sampled `password-tab.tsx` and the users modals. Risk is Low. NOT VERIFIED per-instance.
- The `.btn-base` has **no `:focus-visible` style** (`button.css`) and relies on the UA ring. Only 6 `:focus-visible` rules exist in the whole codebase.
- Sign-in `login.tsx:220` hand-rolls its primary button (`bg-[var(--green)] text-black h-11 rounded-lg`) rather than using `<Button>`, so the primary looks different before and after login (see headline 6).
- Effort to converge: L (the device-control and omni-inspector families are the bulk).

### Inputs and selects
- Raw `<input>` ×58 vs `<Input>` ×8. Raw `<select>` ×3 vs `<Select>` ×17 (Select adoption is good).
- 20 CSS `outline: none|0` rules. Most swap to a border-colour change (1px border to green), which is a weak focus indicator. NOT VERIFIED visually. `index.css:128-131` gives the checkbox focus a 25%-alpha green shadow, which is likely <3:1 non-text contrast. HYPOTHESIS.

### Modals (6+ implementations)
1. `ui/Modal.tsx` (Radix Dialog). Has focus trap, Escape, overlay-click, focus return (with a custom workaround), and an `aria-label="Close"` close button. Good. Used by `teams`, `api-keys`, `tag-manager-modal`, `reservation-modal`, `copy-language-modal`, `network-request-modal`.
2. **Hand-rolled `fixed inset-0` overlays** (6):
   - `mosaic/IdleWarningModal.tsx:19`: role=dialog, aria-modal, labelledby, autoFocus on Continue. **No Escape, no focus trap.** The countdown has no live region (Low).
   - `pages/profile/generate-token-modal.tsx:58`: role and aria-modal. No Escape, no trap, no labelledby.
   - `pages/profile/api-tokens-tab.tsx:158`: role=dialog only. **No aria-modal, no Escape, no trap, no autofocus.**
   - `pages/users.tsx:205` (reveal secret, labelledby), `:261`, and `:336`: role=dialog, **no aria-modal** (on :261 and :336), no Escape, no trap.
3. `device-explorer.tsx:235-243`: `.device-control-modal-overlay`, the full device-control view as an overlay. **No role, no aria-modal, no Escape, no focus management**, and background content stays tabbable. This is the most-used "modal" in the product. **High** (keyboard users tab into the device grid behind it).
4. Command palette `.cp-overlay`: role=dialog, aria-modal, autoFocus, Escape handled in `hooks/useCommandPalette.ts:24`. OK. No trap (NOT VERIFIED).
- Z-index: the hand-rolled ones use `z-30` or `z-40`, while the sidebar is `z-30` and a sidebar tooltip is `z-50`. HYPOTHESIS: sidebar tooltips can render above the users/profile modal overlay (both z-30, and the sidebar comes later in DOM order?). NOT VERIFIED.
- Fix: migrate all six to `ui/Modal` (M). Wrap device control in a Radix Dialog or make it a real route page (M).

### Cards, tables, badges and pills
- `ui/Card.tsx` is used by **1 file** (`network-panel.tsx`). There are **31 distinct `*card*` CSS classes**, plus about 11 inline `rounded-* border border-[var(--border)] bg-[var(--surface)]` card recipes. The primitive is effectively unused.
- `ui/Table.tsx` is used by 4 files (`teams`, `api-keys`, `network-panel`, and the dead `ProfilingView`). Raw `<table>` appears in `builds/session-table.tsx`, `pages/users.tsx`, `pages/profile/api-tokens-tab.tsx`. Selector Health uses a CSS-grid pseudo-table (`.sh-table__row`).
- **Six chip/status primitives**: `badge.tsx` (cva), `Pill.tsx`, `status-pill-outline.tsx`, `StatusDot.tsx`, `count-badge.tsx`, `filter-pill.tsx`. There are **two different status vocabularies**: `StatusKind = ready|busy|reserved|error|offline` (`StatusDot.tsx:4`, `Pill.tsx:4`) vs `StatusTone = ready|running|failed|passed|offline` (`status-pill-outline.tsx:3`). `fleet-status.tsx:30-35` defines its own third status-style map. Medium (consistency). M effort.
- **PascalCase vs kebab-case in `ui/`**: these are **not duplicates**. Each `.css` is the stylesheet of the same-named component (`Card.tsx` imports `card.css`, `Modal.tsx` imports `modal.css`, etc.; mapping verified by grep). The real issue is **two file-naming conventions for components**: PascalCase (Card, Modal, Table, Pill, Menu, Popover, EmptyState, FieldGroup, KeyValueRow, SegmentedControl, SettingCard, StatusCode, StatusDot, Layouts, ErrorBoundary) vs kebab (button, badge, input, select, toast, page-header, count-badge, filter-pill, status-pill-outline, status-summary-card). `modal.css` is also imported by `reservation-modal.tsx` and `tag-manager-modal.tsx`, and `card.css` by `device-card.tsx`: cross-imports of another component's CSS. Nit.
- Single-consumer "primitives" (they live in `ui/` but only one caller uses them): `Card` (network-panel), `KeyValueRow`, `Menu`, `Popover` and `StatusCode` (all device-card only), `count-badge` and `status-summary-card` (build-list-rail), `filter-pill` (build-filter-bar). OK, but a signal that the primitives aren't being adopted.
- The header account dropdown (`header.tsx:111-181`) is **hand-rolled**, even though the `ui/Menu.tsx` (Radix popper and roving focus) primitive exists. It has only mousedown-outside to close (`header.tsx:44-49`): **no Escape, no arrow keys, no focus move into the menu**. Medium.

---

## 4. Accessibility in source (checked; the heuristic scan is approximate)

- **`<img>` without `alt`: 9.** `device-control.tsx:121`, `mosaic/DeviceTile.tsx:71,100,112,326,417`, `mosaic/WsH264Player.tsx:6` (HYPOTHESIS: a doc comment, not JSX), `omni-inspector/OmniInspector.tsx:945,1147`. Device-stream images should have `alt="Live screen of <device>"`. Medium, S.
- **onClick on non-interactive elements (no role/tabIndex): 12.** `apps.tsx:313` (div), `builds/session-row.tsx:49` (**tr**, see headline 7) and `:53` (td, stopPropagation only), `command-palette.tsx:106` (div, probably the overlay backdrop, acceptable), `device-control.tsx:1096`, `OmniInspector.tsx:899,971,1485`, `reservation-modal.tsx:146` (**duration options are divs**: no keyboard selection of the reservation duration, **High** within that flow), `session-dashboard/ScreenshotsView.tsx:43` and `TraceWaterfall.tsx:117` (dead code), `terminal.tsx:178`. Plus 5 `role="button"` elements elsewhere. NOT VERIFIED whether those have key handlers.
- **Icon-only buttons without aria-label or title: about 11 real** (the `button.tsx:38` hit is the primitive itself). They are: `apps.tsx:391` (Download) and `:397` (Trash/delete, unlabeled destructive action), `device-control.tsx:1030,1034,1038,1042` (D-pad up/left/right/down: `<button className="dpad-btn"><ChevronUp/></button>`), `device-control.tsx:1110`, `PomWorkbench.tsx:140` (dead), `capabilities-card.tsx:23`, `tag-manager-modal.tsx:104,121`. Medium, S.
- **Headings**: Session Detail has **no h1**. Builds has **2 h1s**. Device control goes h2 to h4 (skips h3). Device Explorer empty states use h3 with no h2. Low.
- **Form labels.** 23 inputs and 5 selects lack id/aria-label (heuristic; some are wrapped in `<label>`, so treat as upper bound). Confirmed: `pages/profile/password-tab.tsx:61-66` puts `<label>` beside `<input>` with **no htmlFor/id**, so all three password fields are unlabeled for AT. Placeholder-only inputs: `ApiKeyGate.tsx:48`, `apps.tsx:206` (search), `device-explorer.tsx:176` (search), `DevicePicker.tsx:102`, `device-control.tsx:915,999`, `maintenance-settings.tsx:220`, `settings.tsx:280`, `terminal.tsx:190`, `generate-token-modal.tsx:62`, `PomWorkbench.tsx:108`. Not labelled: `ui/input.tsx:9` (the primitive has no label plumbing; `FieldGroup` exists but NOT VERIFIED that it wires ids), `ui/select.tsx:11,17`, `selector-health-page.tsx:454,468`, `device-card.tsx:47`. Medium.
- Only **`settings.tsx:243-244`** uses `aria-invalid` and `aria-describedby` for field errors. That is the one field-level validation pattern in the app.
- **Native dialogs (18):**
  - `confirm` ×13: `users.tsx:52,62`, `api-tokens-tab.tsx:40,48`, `teams.tsx:312,384,413`, `api-keys.tsx:355`, `webhook-settings.tsx:118`, `selector-health-page.tsx:329`, `selector-detail-page.tsx:123`, `muted-list.tsx:42`, `apps.tsx:91`
  - `alert` ×3: `users.tsx:57,66,77` (users.tsx doesn't use toasts at all)
  - `prompt` ×2: `RecordingControls.tsx:196`, `DeviceMosaicView.tsx:225` (bookmark label)
  - Medium, M effort (a `useConfirm()` hook on `ui/Modal`).
- **Colour-only status**: `StatusDot` is `aria-hidden` and paired with text in `StatusCode`. OK. `fleet-status.tsx` pairs the dot with a text label. OK. The header "Online" pill has text, but the text is fake (headline 4). The recording dot in `recording-card.tsx:22` is NOT VERIFIED for an accompanying label. Mostly fine.
- Toasts: the container is `role="status" aria-live="polite" aria-atomic="true"` (`toast.tsx:65`). `aria-atomic` on the *container* re-announces all visible toasts on each change. **Errors auto-dismiss after 4s, the same as success** (`toast.tsx:38-46`), with no pause on hover. Errors like "Synchronization failed…" vanish before they can be read or copied. Medium, S (errors sticky or 8–10s; `role="alert"` for errors).
- `index.html` has `lang="en"`. OK.

---

## 5. Forms (checked, sampled)

- `<form>` elements are used in only 7 files (ApiKeyGate, login, forgot, reset, users, generate-token-modal, password-tab). All settings, teams, api-keys and webhook "forms" are button-driven, so **Enter doesn't submit** there. Low/Medium.
- Client-side validation is **thin**: presence checks via toast ("Name required", "Key name is required", "Select at least one scope", "Webhook URL is required.", "Select at least one trigger event."). There is **no URL-format validation** for webhook URLs (`webhook-settings.tsx:254` placeholder only). Settings interval (`settings.tsx:152-167`) is the one inline validated field. Errors appear as transient toasts, not next to the field.
- **Swallowed errors**: about 52 empty or ignore catches (`catch {}`, `.catch(() => {})`, `/* ignore */`, `/* swallow */`), plus about 30 `console.error` sites. Sampled console-only catches (no user feedback): `settings.tsx:190` (reset-metrics), `tag-manager-modal.tsx:54` (with a toast on a sibling path, NOT VERIFIED), `DeviceTile.tsx:214,268,300` (gesture, keystroke and screenshot failures are silent on the tile; the 409 conflict toast in api-client covers only ownership), `device-control.tsx:131,149,238,394,467,545` (auto-start stream, load apps, keyboard flush, action, screenshot, quick swipe). **A failed tap or swipe gives no feedback**, so the user retries into a dead device. Medium.
- Error copy quality: mixed and jargon-heavy. "Synchronization failed. Check network integrity." (`settings.tsx:178`), "Failed to persist updates." (`ai-settings.tsx:146`), "Failed to access infrastructure parameters.", "Infrastructure parameters synchronized across fleet." (a single-server config save), "Execution Error: …" (`apps.tsx:118`), "Uninstall failed. Check logs." (which logs?), "Deployment configuration mismatch. Adjust your platform or state filters…" (`device-explorer.tsx:219-223`, which just means no filter results), "Global Device Registry Empty … heartbeat signals are active", "Hydrating view…", "Component Exception Detected". The new sign-in pages have plain-language errors (`login-errors.ts`), so the in-app copy is now inconsistent with them. Medium, S–M (copy pass).
- Because of headline 1, **every `try { await api… ; toast(success) } catch` pattern in the app can show a false success** on a JSON error response.

## 6. Interactions and feedback (checked)

- Toasts: `useToast` is used in 19 files. Mixed with `alert` in `users.tsx` (no toasts there) and with `confirm` in 9 files. Loading toasts (`type:'loading'`, `duration 0`) are always removed in `finally` (`device-control.tsx:551-563,570-586`, `apps.tsx:107-120`). Good. The toasts name devices by **udid** ("Deploying app to R58M…"), not by device name. Low.
- Pending state on async buttons: 19 files use `disabled={saving|submitting|loading…}`. Settings pages go through `Layouts.tsx:40-51` (`isSaving`). Heuristically missing pending/disabled: `builds-page.tsx` (Export), `api-tokens-tab.tsx` (rotate/delete), `muted-list.tsx` (unmute), `copy-language-modal.tsx`, `session-detail/*` (copy actions are fine), `RecordingControls.tsx`/`DeviceMosaicView.tsx` (NOT VERIFIED; the mosaic uses optimistic state). Low–Medium. Double-submit risk on rotate/delete.
- **"Retry failed" button ships as a stub.** `builds-header.tsx:62-68` is enabled whenever there are failures. `builds-page.tsx:60-62` just toasts "Bulk retry lands in a future release." A visible, enabled primary-looking action that does nothing. **Medium**. Fix: hide it or disable it with a "coming soon" tooltip (S).
- No global connectivity indicator. The socket `isConnected` from `useSocket` is consumed only by `session-detail/network-panel.tsx:43`.

## 7. Code quality (checked)

- **TODO/FIXME/HACK/XXX: 0** in `web/src` (checked). Deferred work is instead described in comments (e.g. `header.tsx:8-11` "Phase 4 will wire…", `theme-flag.ts`).
- **Dead code (no importers, verified by grep, including dynamic imports):**
  - `components/session-dashboard/ProfilingView.tsx` (275), `ScreenshotsView.tsx` (76), `TraceWaterfall.tsx` (173). Leftovers from "retire session-dashboard monolith" (commit `349f32c`).
  - `components/omni-inspector/OmniActionToolbar.tsx` (74) and `PomWorkbench.tsx` (163).
  - That is **761 lines**, plus `lib/theme-flag.ts` no-ops and the `/api-key-gate` route (HYPOTHESIS dead).
  - **Opportunity**: profiling, screenshots and trace-waterfall views were built but are not surfaced on Session Detail. HYPOTHESIS: the redesign dropped them. Worth a product decision rather than a silent delete.
- **Large files (>600 lines)**: `settings/settings.css` **2,103** (for 4 settings pages), `omni-inspector/OmniInspector.tsx` **1,818**, `omni-inspector.css` 1,612, `device-control/device-control.css` 1,396, `selector-health.css` 1,282, `device-control/device-control.tsx` **1,209** (30 raw buttons), `selector-health-page.tsx` 712, `mosaic/DeviceTile.tsx` 661, `apps/apps.css` 604. `apps.css:505+` re-declares `device-explorer-*` classes "reused by this page", so the same class names are styled in two files. Medium (maintainability).
- `console.*` in non-test code: 5 × `console.log` (e.g. `device-explorer.tsx:97`), about 30 × `console.error`. Top files: `DeviceTile.tsx` 10, `device-control.tsx` 7, `apps.tsx` 4.
- `any`: about 173 occurrences (`: any` / `as any`). Densest: `teams.tsx` 8, `log-derive.ts` 6, `use-overview-data.tsx` 6, `device-explorer.tsx` 6. ESLint also reports 25 unused vars (mostly `OmniInspector.tsx` and `PomWorkbench.tsx`).
- Direct DOM access: only `index.tsx:20` (`getElementById('root')`). `builds-page.tsx:74-79` creates an `<a>` for the download (acceptable). Clean.
- Class components: `ErrorBoundary` (necessary), `device-explorer.tsx`, `card-view.tsx`, `widgets/spinner/spinner.tsx`. Device Explorer is a class plus a wrapper that passes `navigate` and `params` as props. Low (modernisation).
- **ErrorBoundary is mounted exactly once** (`routes/index.tsx:59`). See headline 8. Fixes: `key={location.pathname}` or `resetKeys`; add an outer boundary in `App.tsx` around Shell; use tokens; plain copy ("Something went wrong on this page", Reload, Go to Overview). S.

## 8. Legacy max-width media queries (checked; 6 remain)

| File:line | Query | Inside the 1280–1440 range? |
|---|---|---|
| `components/settings/settings.css:576` | `max-width: 640px` | no (dead in the supported range) |
| `components/device-control/device-control.css:1371` | `max-width: 900px` | no (referenced by `device-control.tsx:185` comment) |
| `components/device-explorer/device-explorer.css:171` | `max-width: 1024px` | no |
| `components/device-explorer/device-explorer.css:199` | `max-width: 640px` | no |
| `components/selector-health/selector-health.css:842` | `max-width: 1024px` | no (the CLAUDE.md dead-zone example) |
| `components/apps/apps.css:220` | `max-width: 900px` | no |

- Also note `apps.css:500`, `@media (min-width: 1401px)`, which **flips inside the supported range** (padding changes between 1400 and 1401px). It is intentional per the comment, but it is a boundary the viewport test must cover. NOT VERIFIED that `overflow.spec.ts` tests 1400/1401.
- Mixed directions persist: `settings.css:156,179,198` use `min-width:1024px`, while `device-explorer.css:171` and `selector-health.css:842` use `max-width:1024px`.
- Tailwind breakpoint prefixes in TSX: `md:`×9, `lg:`×4, `sm:`×2. `overview.tsx:26` uses `sm:grid-cols-2`, which always applies in range. Fine.
- Low (all outside the supported range). S effort to delete or convert.

## 9. Missing pages and states (checked)

- **404 page**: none. Silent redirect to /overview (`routes/index.tsx:86`).
- **Global error page**: only the ErrorBoundary (broken, see above).
- **Server down / `/xenon/api` unreachable**:
  - At boot, `getMe()` throws on network failure (`auth.ts:79-81`). `refresh()` has `try/finally` with **no catch** (`auth-context.tsx:19-27`), so there is an unhandled rejection, `me=null`, and `RouteGuard` redirects to `/login`, adding `&reason=expired` if `hadSession()`.
  - **So a server outage is presented to a returning user as "your session expired"**, and they will try to sign in against a dead server. **High.** (HYPOTHESIS on the exact login-page copy; the mechanism was verified in code.) A 5xx from `/me` takes the same path.
  - Mid-session: no offline banner, and the header still says "Online". Overview, Devices and Builds show empty states (headline 3).
- **Session expired mid-session**: not handled (headline 2). Only the boot-time check exists. Fix: in `api-client.jsonResult`, on 401 call a registered `onUnauthorized` that sets `me=null`. `RouteGuard` then redirects with `reason=expired&next=…` (S–M). Pair this with making `jsonResult` throw on `!res.ok` (M, because callers that rely on error bodies, e.g. `result.success === false` in `apps.tsx:110` and `device-control.tsx:574`, need auditing).
- **403 for Members on admin URLs**: a toast only, no access-denied page (§2).

## 10. Other confusing things and opportunities

- `builds-page.tsx:108-111`: with no build selected it says "Select a build from the left…". There is no auto-select of the latest build, so the first visit to "Sessions" is an empty right pane. Opportunity: auto-select the most recent build (S).
- The Devices "control" experience is an overlay on the Devices list, not a page (`device-explorer.tsx:234-243`). The URL changes (`/devices/:udid/control/:tab`), but Back and Escape behaviour depend on the router only. HYPOTHESIS: browser Back closes it (URL-driven), which is good, but Escape does nothing.
- The Live Devices page does its own `fetch('/xenon/api/auth/me')` (`DeviceMosaicView.tsx:94`) even though `useAuth().me` already exists: a duplicate identity fetch. Nit.
- `DeviceMosaicView.tsx:225` and `RecordingControls.tsx:196`: `window.prompt('Bookmark label?')` during a live recording blocks the page's JS thread (and so the stream UI) while open. HYPOTHESIS: the stream `<img>` keeps painting but the WS H.264 decode loop pauses. Medium.
- The header search button (`header.tsx:~70-85`) shows the hint "⌘K" on all platforms. On Windows/Linux the shortcut is Ctrl+K (`useCommandPalette.ts:20` accepts both). Nit.
- The idle-warning modal counts down every second, with no pause on focus loss (NOT VERIFIED).

---

## Coverage log

Directories and files examined:
- `web/package.json`, root `package.json` (TS version), `web/tsconfig.json`, `web/tailwind.config.js`, `web/index.html` (grep), `web/README.md`, root `.eslintrc.js` (grep), `.eslintignore`.
- `src/App.tsx`, `src/routes/index.tsx`, `src/auth/route-guard.tsx`, `src/auth/auth-context.tsx`, `src/api-service/api-client.ts` (full), `src/api-service/auth.ts` (getMe), `src/api-service/index.ts` (grep).
- `src/tokens.css` (full), `src/index.css` (tail), `src/components/ui/*` (listing, `Modal.tsx`, `ErrorBoundary.tsx`, `button.tsx`, `button.css`, `toast.tsx`, `Card.tsx`, `StatusDot.tsx` read; the rest via grep for exports and importers).
- `components/sidebar/sidebar.tsx` (full), `components/header/header.tsx` (most), `components/command-palette/command-index.ts` (nav list), `hooks/useCommandPalette.ts` (grep), `hooks/useSocket.ts` (grep).
- Pages, read fully: `overview/overview.tsx`, `overview/use-overview-data.tsx` (55-120), `builds/builds-page.tsx`, `runbooks/runbook-page.tsx`, `pages/profile/profile-page.tsx`, `mosaic/IdleWarningModal.tsx` (head).
- Pages, read in part: `device-explorer.tsx` (85-105, 190-254), `DeviceMosaicView.tsx` (90-120), `session-detail-page.tsx` (grep), `settings.tsx` (165-195), `ai-settings.tsx` (120-150), `webhook-settings.tsx` (100-130), `users.tsx` (30-80), `password-tab.tsx` (58-72), `session-row.tsx` (45-58), `device-control.tsx` (548-590, 1026-1046), `apps.tsx` (104-125, 388-402), `reservation-modal.tsx` (140-150), `Layouts.tsx` (grep).
- Everything else was covered through repo-wide grep counts (hex, rgba, var(), arbitrary values, font-size, radius, text-dim, button/input/select/table/modal census, alert/confirm/prompt, catches, console, any, TODO, media queries, focus styles, Link/navigate, document.title, dead-import check).
- Tools run: `npx tsc --noEmit -p web` (0 errors); `npx eslint web/src --ext .ts,.tsx -f unix` (no fix; 773 problems); a heuristic JSX scanner (`scratchpad/scan.cjs`); contrast computed with the WCAG formula in node.

Dimensions:
1. Stack/deps: checked (versions installed and verified; "current major" not verified online).
2. Routes/states: checked for all 22 route entries. Per-page state detection used grep counts plus reading the thin pages.
3. Design system: checked (counts). Card/table/badge census checked. PascalCase/kebab pairs checked (not duplicates).
4. Accessibility: checked via heuristic scan plus spot-checks. Not checked: runtime focus order, screen-reader output, the live contrast of every component.
5. Forms: sampled (settings, ai-settings, webhook, users, password-tab). Not every form was read.
6. Interactions/feedback: checked (toast, pending state heuristic, stubs).
7. Code quality: checked.
8. Legacy max-width: checked (all `@media` in `src`).
9. Missing pages/states: checked in code. Runtime behaviour NOT VERIFIED.
10. Opportunities: sampled.

Not checked: `components/omni-inspector/OmniInspector.tsx` internals (1,818 lines; only grep), `device-control/logcat/*` UI (recently hardened per CLAUDE.md), `selector-health` internals beyond grep, `device-card.tsx` internals, test files, `web/test/viewport/overflow.spec.ts` contents, and the sign-in pages (skipped on purpose, except the button-consistency check).

## Assumptions and unverified

- "Current major" versions for Vite, Vitest, TS, React Router, React, testing-library and react-markdown are from my knowledge, not an online check.
- The heuristic scanner (regex over JSX opening tags) may miss or over-count. Specifically: inputs wrapped in `<label>` are flagged as unlabeled (upper bound); icon-only detection may miss buttons whose text comes from an expression. Counts of 94 missing `type` and 23 unlabeled inputs are approximate.
- Headline 1 (false success toasts) is certain as a mechanism. Whether a given endpoint actually returns JSON 4xx/5xx bodies was not checked against the server code.
- The server-down-reads-as-session-expired path is verified in code. The exact rendered login copy was not viewed.
- Sidebar tooltip vs modal z-index overlap: not verified.
- The `device-control.css:710/738` (`--primary-soft`) invisible focus ring: which element it applies to was not verified.
- The `/api-key-gate` route being dead/legacy is a hypothesis (no in-app references).
- Profiling, Screenshots and Trace views being "dropped features" rather than intentionally retired is a hypothesis.
- `window.prompt` pausing the H.264 decode loop is a hypothesis.
- No visual/runtime verification was done. The browser half of the audit should confirm the states, focus rings and contrast in situ.

## Top 15 findings by severity

| # | Severity | Finding | Where | Effort |
|---|---|---|---|---|
| 1 | Critical | API client resolves on 4xx/5xx JSON, so success toasts can show on failed writes | `api-service/api-client.ts:71-104` (63 callers) | M |
| 2 | High | No 401 handling mid-session; expired session means silent empty data | `api-client.ts`, `auth/auth-context.tsx:36-38` | S–M |
| 3 | High | Server down at boot is shown as "session expired" on login | `auth/auth-context.tsx:19-27`, `route-guard.tsx:15-18` | S |
| 4 | High | Overview, Devices, Sessions and Live Devices have no error state; outage looks like "empty"; Sessions ignores `loading`/`error` | `use-overview-data.tsx:70-113`, `device-explorer.tsx:96-100`, `builds-page.tsx` | M |
| 5 | High | Header "Online" is always green; "stale" is time since mount; the dropdown's system info is fake | `header/header.tsx:8-28,107-153` | S–M |
| 6 | High | About 235 text uses of `--text-dim` at 2.85–3.19:1, failing AA | tokens + `selector-health.css`, `settings.css`, `users.tsx`, … | S (token) / M (migrate) |
| 7 | High | Primary button is white on `#16a34a` (3.30:1) and differs from the sign-in primary (black on `#22c55e`) | `ui/button.css:30-37`, `pages/login.tsx:220` | S |
| 8 | High | Session rows are mouse-only (`<tr onClick>`), so sessions can't be opened by keyboard | `builds/session-row.tsx:48-50` | S |
| 9 | High | ErrorBoundary never resets on navigation, doesn't wrap the shell, uses undefined tokens (1.89:1 button), jargon copy | `ui/ErrorBoundary.tsx`, `routes/index.tsx:59` | S |
| 10 | High | "Restore Defaults" overwrites config and resets metrics with no confirm | `settings/settings.tsx:184-192` | S |
| 11 | High | Device-control overlay has no dialog semantics, Escape or focus management; reservation duration picker is div-only | `device-explorer.tsx:234-243`, `reservation-modal.tsx:146` | M |
| 12 | Medium | 6 hand-rolled modals lacking Escape/trap/aria-modal, plus 18 native `confirm`/`alert`/`prompt` | `users.tsx`, `api-tokens-tab.tsx`, `generate-token-modal.tsx`, `IdleWarningModal.tsx`, 9 files with `confirm` | M |
| 13 | Medium | Command palette lacks 4 destinations, shows admin pages to Members; no route role guard; no 404; no `document.title` | `command-index.ts:13-24`, `routes/index.tsx:86` | S |
| 14 | Medium | Design-system drift: about 216 raw buttons + 39 bespoke btn classes vs 28 `<Button>`; 7 reds; 38 font sizes; 17 uses of undefined `--accent`; 6 status-chip primitives with 2 vocabularies | repo-wide | L |
| 15 | Medium | Frontend lint is toothless (no react-hooks, no jsx-a11y); 761 lines of dead components; stale CRA README; two TS versions (4.9.5 web / 5.5 root) | `.eslintrc.js`, `session-dashboard/*`, `omni-inspector/{OmniActionToolbar,PomWorkbench}.tsx`, `web/README.md` | S–M |

---

## Coverage log (live pass)
- **URLs visited, 1440×900:** /xenon/overview, /devices, /devices/live, /apps, /sessions (redirects to /builds), /builds, /selector-health, /notifications, /settings, /ai-settings, /maintenance, /teams, /users, /api-keys, /profile, /runbooks/general, /definitely-not-a-page-xyz (redirects to /overview), /builds/does-not-exist-123, /devices/NOPE-UDID/control, /login (earlier today, during the #264/#265 work: 1280 + 1440, error states, a real 429).
- **1280×800:** the 14 main routes (overflow and clipping probe).
- **Dimensions:** 1 UX journeys (first-run dead end, empty states) ✔ · 2 visual hierarchy (headers, emphasis of disabled Record) ✔ · 3 layout (1280/1440; 375 out of scope by policy) ✔ · 4 nav/IA (button nav, Sessions/Builds naming, Profile sub-nav, palette scope) ✔ · 5 content (jargon: "Global Device Registry", "device nodes", "Operational coverage"; raw enum SUPER_ADMIN) ✔ · 6 CTAs (Refresh vs Manual Sync, Record) ✔ · 7 trust (fake status indicators, success-on-failure) ✔ · 8 a11y (contrast probe on every page, labels, names, focus, skip link, dialog focus return) ✔ heuristic only, not a WCAG audit · 9 forms (Settings validation, Discard bug; did not submit) ✔ · 10 interactions (palette, disabled states, tooltips) ✔ · 11 states (empty ✔ seen; loading/error only from code; 404 ✔) · 12 SEO: **N/A**, an authenticated self-hosted dashboard that isn't meant to be indexed. Only checked `lang` and titles (title is a usability finding here, not an SEO one) · 13 performance signals ✔ · 14 technical (console, network, overflow, alt) ✔ · 15 design system ✔ (plus the code census) · 16 code quality: codebase notes · 17 missing pages ✔ (404, detail not-found) · 18 confusions ✔.

## Assumptions & unverified (consolidated, live side)
- NOT VERIFIED: populated states of Devices, Live Devices (streaming tiles), Apps with many rows, Selector Health with hotspots, Notifications with items. The lab was empty or near-empty.
- NOT VERIFIED: device control page (would start a stream and take a manual lock on the real device plugged in mid-audit).
- NOT VERIFIED: whether Apps delete confirms. Whether Restore Defaults confirms: **resolved by code, it doesn't**.
- NOT VERIFIED: the Discard-disabled-while-invalid bug on AI Engine and Maintenance (same ActionBar component, so likely).
- ASSUMPTION: the console 401s and 429 came from my own earlier auth testing in the same tab.
- ASSUMPTION: gzip savings estimate is based on Vite's reported gzip size, not measured over the wire.
- The Flowstep connector couldn't be used. This session exposes only `replace-screen`/`delete-screen`, which need an existing file and screen ID, and there's no list, get, create or render tool. No mockups were produced.

## Rough opportunity ideas (unfinished on purpose)
- **First-run checklist on Overview:** connect device → upload app → run session → watch live. Each step auto-checks from real data and the card disappears when done. It turns the empty Overview (G-overview) from a dead end into onboarding.
- **Honest status bar:** replace the fake "Online / Updated / Stable" trio with a real one fed by the Socket.io connection plus the last successful poll: "● Connected · 1 device · last event 12s ago". It'd be the most trusted element on screen instead of the least.
- **A "states" kit** (Loading / Empty / Error / NotFound) as 4 primitives, then a pass over every route. The codebase notes' per-route table is the checklist.
- **One token fix with a big payoff:** raise `--text-dim` to ≥ #7a837f. That removes the bulk of ~235 contrast failures in one line. Then give the primary Button black-on-#22c55e like the sign-in page (9.2:1) instead of white-on-#16a34a (3.3:1).
- **Sessions/Builds naming:** pick "Runs > Sessions" or "Builds > Sessions" and apply it to the nav, URL, placeholder and h1.
- Command palette as the power-user spine: index builds and sessions (the placeholder already promises it), add the 4 missing destinations, role-filter admin pages.
- **Flowstep, once list-files, list-screens, get-screen-image and create/edit design are enabled:** mock (1) Overview first-run, (2) the honest status bar in the header, (3) Devices empty state with environment diagnostics ("ADB found ✔ / ANDROID_HOME ✔ / 0 devices"), (4) a unified PageHeader. Those four are the most visual of the proposed changes.

---

## Triage: what I'd fix first (combined live + code, ordered by user-path severity)

| # | Sev | Fix | Evidence | Effort |
|---|---|---|---|---|
| 1 | Critical | `api-client.jsonResult` must reject on non-2xx. Today failed saves show success toasts | code, verified | S + audit of call sites |
| 2 | High | Make header status real (Online pill, "Updated…", Stable) or remove it. Today it goes red after 10 min regardless | code, verified + live amber | S |
| 3 | High | Contrast: raise `--text-dim` (≈235 text uses at ~3:1), fix primary Button (3.3:1) | live probe every page + code count | XS–S |
| 4 | High | Error and loading states: an outage currently renders as "empty" (Devices "Registry Empty", Overview) | code; live empty states | M |
| 5 | High | 404 + detail not-found states (bad URLs and deleted sessions fail silently) | live, verified | S |
| 6 | High | Nav items → real links (`NavLink`, `aria-current`) | live DOM | S |
| 7 | High | Label every input (Profile passwords, Settings/Maintenance numbers and cron, filters, searches) | live probe | S |
| 8 | High | Confirm "Restore Defaults" (it also wipes metrics); name the Apps icon buttons, confirm delete | code + live | XS–S |
| 9 | High | Keyboard: session rows, device overlay dialog, reservation picker, palette focus return, skip link, designed focus ring | code + live | M |
| 10 | Medium | Settings Discard disabled while invalid (`Layouts.tsx:48`) | live, verified | XS |
| 11 | Medium | Sessions search icon overlaps text (`.input-base` beats `pl-8`) | live, measured | XS |
| 12 | Medium | Per-route `document.title` | live | XS |
| 13 | Medium | One PageHeader, one SearchInput, one Modal (Escape/trap/aria-modal), replace 18 native dialogs | live + code | M–L |
| 14 | Medium | Duplicate fetches, 5s polling alongside the socket, no gzip, `max-age=0` on hashed assets | live network | S–M |
| 15 | Medium | Copy and IA: Sessions vs Builds, jargon empty states, raw `SUPER_ADMIN`, palette promises unsearchable sessions | live | S |

---

## Status update (2026-09-24): fixed in #266
- Triage #1 (refused saves → success): **fixed** for mutations. GETs are deliberately unchanged (goes with #4 error states).
- Triage #2 (fake header status): **fixed**. Socket-driven Live / Connecting / Reconnecting / Disconnected, and the static menu rows are removed.
- Triage #8, first half (Restore Defaults one-click): **fixed** with a confirm dialog. The Apps icon-button names and delete confirm are **still open**.
- Triage #10 (Discard disabled while invalid), #11 (search icon overlap), #12 (tab titles): **fixed**.
- The ⌘K "can't find sessions" part of #15: **fixed**. Builds are indexed, plus Live Devices, Selector Health, Users and Profile.
- Correction to the palette notes: during the fix I briefly thought the palette kept a stale query on reopen. It doesn't. There's a reset-on-close effect, and in my test the palette had never closed.
- Newly noticed, not fixed: the account menu doesn't close on Escape (click-outside only).
- Still open from the triage: #3 contrast, #4 error/loading states, #5 404 and detail not-found, #6 nav links, #7 input labels, #9 keyboard, #13 component consolidation, #14 network efficiency.
