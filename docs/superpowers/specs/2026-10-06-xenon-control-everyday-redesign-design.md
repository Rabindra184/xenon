# Xenon Control — Redesign for Everyday Users (Part B)

**Date:** 2026-10-06
**Status:** Design agreed in conversation, section by section (Home's job, profiles, window layout B, Home states, Essentials + Setup mockups, approach "rebuild screens in place", sections 1–5). Waiting for the user's review of this document.
**Depends on:** Part A ("safe and current", `2026-10-06-xenon-control-safe-and-current-design.md`): A1–A7 merged, A8 / 0.2.0 in PR #524. Part B starts after 0.2.0 ships.
**Scope:** `mac-app/` (Xenon Control), plus its docs (`website/docs/xenon-control.md`, `mac-app/README.md`).

## Context

Xenon Control configures and starts Appium with the Xenon plugin. Part A
made it safe and in step with Xenon 2.17 without changing its layout. The
layout is still a developer tool:

- a permanent profile sidebar;
- a header of raw fields (Port, Base path, APPIUM_HOME);
- four tabs (Settings, Secrets & Env, Health, Logs);
- a bottom status bar.

Settings shows about 64 options at once with their raw names. The Secrets
tab shows environment-variable names and "inject in this profile". Health
shows commands and paths. Nothing tells a tester, after Start, what to do
next.

This is **Part B** of three:

- **A — Safe and current:** done.
- **B — Redesign for everyday users:** this spec.
- **C — Show what Xenon can do now:**
  - live phones and sessions;
  - addresses as Xenon reports them;
  - first sign-in help;
  - hub connection status;
  - update notices;
  - connecting AI agents.

  It gets its own spec. Part B builds C's places as empty slots (see
  "Part C slots").

## Who it is for

**Primary: a QA tester.** They open the app to answer "can I test now?",
press Start, then open the dashboard or copy the address their tests
connect to. They don't change Appium settings and shouldn't meet option
names, environment variables, commands or paths.

**Secondary: the engineer who sets the Mac up.** Everything the app shows
today stays reachable behind one switch, **Show technical details**.

Most testers have **one profile** and rarely switch.

## Goals

1. A tester on a fresh Mac goes from opening the app → Set up → Start → copy
   the test address → open the dashboard without meeting any technical text.
2. With technical details on, an engineer still finds everything the app
   shows today: raw option names and descriptions, environment variables,
   base path, Appium folder, launch preview, config export, system log
   lines, versions, paths and commands.
3. The app looks like one family with the web dashboard, follows the Mac's
   light/dark appearance, and meets WCAG 2.1 AA in both themes.
4. No secret value is written to any file: the Cloud API key and the proxy
   password move into the Keychain, closing Part A's known gap.

## Non-goals

- Live device, session and queue data, Xenon-reported addresses, first
  sign-in help, hub link status, update notices, AI-agent connection
  (Part C; only their empty slots are built here).
- Changing what the server does, how readiness is decided (Part A's model
  stays), or the `bootedSimulators: true` profile default.
- A native (SwiftUI) rewrite, or a new renderer project. The renderer is
  rebuilt in place.
- Windows/Linux layouts.

## Decisions taken in conversation

| Question | Decision |
|---|---|
| Home's job | "Start, then get going": ready? → Start → Open dashboard / Copy test address; Part C's live strip once running |
| Profiles | One, rarely switch: a profile switcher replaces the profile list; management moves to a Profiles sheet |
| Window layout | B, slim sidebar: switcher on top, Home / Setup / Settings / Logs, compact status + Start/Stop at the bottom |
| Home states | As mocked: first run, can't start (with one-click fixes), ready, running (test address, colleagues' address, Open dashboard), stopped unexpectedly |
| Settings | Essentials (~10 plain options) + All settings; raw names only with Show technical details |
| Setup | Three plain checklists (This Mac, Xenon, Phones), one Set up button, technical details on demand |
| Approach | Rebuild screens in place on the existing Electron + React + Tailwind app; keep Part A's logic |

## 1. Structure and navigation

**Window.**
- Default size 1120 × 760, minimum 900 × 600 (unchanged). The title bar
  stays hidden-inset.
- Home fits the minimum size without scrolling.

**Sidebar** (slim, about 168 px: icons and names), top to bottom:
1. **Profile switcher.** A button with the profile name. It opens a popover
   listing every profile, each with a one-line summary (e.g. "Android and
   iPhone · port 4723"), a check mark on the current one, **New profile…**
   and **Manage profiles…**.
2. **Places:** Home, Setup, Settings, Logs. Each has an icon and a name.
   - Setup shows a "!" badge when any readiness blocker or check needs
     attention.
   - Logs shows a dot after the server stops unexpectedly, cleared when Logs
     is opened.
3. **Status and Start/Stop.**
   - A dot and a word: Stopped / Starting… / Running / Stopping… / Stopped
     unexpectedly.
   - A compact Start or Stop button, through Part A's `requestStart` path
     and rules.
   - Clicking the status goes to Home.

**Removed.** The bottom status bar, the profile header (name, Port, Base
path, APPIUM_HOME fields, Export / Import / APPIUM_HOME / Log Folder
buttons) and the tab strip. The name is edited in the Profiles sheet. Port
moves to Essentials; base path and Appium folder move to All settings →
Technical. Import and export move to File and the Profiles sheet. Log
Folder moves to Logs (technical).

**Show technical details.** One switch, stored per Mac (not per profile),
off by default, in Settings (bottom of Essentials) and View → Show
Technical Details (⌥⌘T). When on:
- Settings shows each option's raw name and original description, and All
  settings gains a **Technical** group:
  - environment variables;
  - base path;
  - Appium folder;
  - keep-alive timeout.
- Setup shows versions, folders and commands (with Copy).
- Logs shows the app's own system and diagnostic lines and **Open log
  folder**.
- Server → **Preview Launch…** (⌘P) and **Export Config…** become
  available.

**Menus.**

| Menu | Items |
|---|---|
| File | New Profile ⌘N, Import Profiles…, Export Profile…, Manage Profiles… |
| Server | Start / Stop ⌘⏎, Open Dashboard ⌘D, Copy Test Address ⇧⌘C, and with technical details: Preview Launch… ⌘P, Export Config… |
| View | Home ⌘1, Setup ⌘2, Settings ⌘3, Logs ⌘4, Appearance ▸ System / Light / Dark, Show Technical Details ⌥⌘T |
| Menu-bar icon | status line, Start / Stop, Open Dashboard, Copy Test Address, Show Xenon Control, Quit Xenon Control |

## 2. Screens

### Home

Home always answers "can I test now?" and offers the one next step. Its
state comes from the pure model `homeState` (section 4). The copy is final
unless marked as an example.

| State | When | Content |
|---|---|---|
| **First run** | Xenon or a needed driver isn't installed in the profile's Appium folder, and Setup isn't running | Title "Let’s get this Mac ready". Sub "A one-time setup, about 2 minutes." A checklist: Node.js, Appium, Xenon, Android support, iPhone support (only the ones the profile's phones need), each ✓ or ○ with "— not installed yet". Primary **Set up this Mac** (runs Setup and shows its steps inline). |
| **Setting up** | Setup is running | Title "Setting up this Mac…" plus the step list (A3's plain rows). |
| **Can’t start** | Readiness has a blocker, or a setting is invalid | Title "Can’t start yet". The reason as one plain sentence (Part A's `firstBlocker` / validation message). One quick fix (see below) plus **Try again**. Footer "Something else? See Setup for every check." |
| **Ready** | Readiness ok, stopped | Title "Ready to start". A summary line from the profile, e.g. "Android phones and iPhones · this Mac only" or "· shared with hub-mac". Primary **Start**. Footer "Last run: today 09:42 · stopped normally" (from the last run's end state). |
| **Starting** | Status `starting` | Title "Starting…", "Usually under 10 seconds.", **Stop**. |
| **Running** | Status `running` | Header "● Running", "for 1 h 12 min", **Stop**. The **Part C live strip** (empty slot). A **Test address** card with the address and **Copy**, and below it "Colleagues on your network: http://lab-mac.local:4723/wd/hub" with **Copy**. Primary **Open dashboard**. The **first sign-in card** (Part C slot). |
| **Stopping** | Status `stopping` | Title "Stopping — saving recordings and releasing phones…". No buttons (Start/Stop in the sidebar shows the forced-stop path as Part A defines). |
| **Stopped unexpectedly** | Status `crashed` | Title "Xenon stopped unexpectedly". The reason in a sentence ("Appium refused this profile’s settings.", "Port 4723 was taken by another app.", or the exit message). "Last message: …" (the last error line from the run log, one line, truncated). Primary **Start again**, secondary **See what happened** (opens Logs with Problems only, scrolled to that line). |

**Quick fixes on "Can’t start"** (pure model `quickFix`):

| Blocker | Button | Action |
|---|---|---|
| Port in use | **Use port N** | `net:nextFreePort(port + 1)` gives N; the button saves it to the profile |
| Xenon not installed in the Appium folder | **Set up this Mac** | Runs Setup |
| Invalid setting | **Fix it** | Opens Settings at that field (`focusSetting`) |
| Appium or Node.js missing or too old | **How to install** | Opens the installation docs page |
| Anything else | **See Setup** | Opens Setup |

**Addresses.**
- **Test address:** `http://localhost:<port><basePath>`.
- **Colleagues' address:** `http://<host>.local:<port><basePath>`, where
  `<host>` is the Mac's local network name (`os.hostname()` minus any
  `.local`).
- Both are computed in main (`share:addresses`).
- Part C may later replace the colleagues' address with the addresses Xenon
  reports.

### Setup (today's Health)

**Header and checks.**
- Header "Setup", **Check again**, and "Everything this Mac needs to run
  tests. Checked 2 minutes ago."
- Three groups of `StatusRow`s, each an icon plus one plain sentence:

| Group | Rows (shown only when relevant to the profile's phones) |
|---|---|
| This Mac | Node.js, Appium, Android tools, Xcode |
| Xenon | "Xenon 2.17.0 is installed" / "Xenon isn't installed yet"; Part C slot: update available, and hub connection when sharing with a hub |
| Phones | Android support, iOS support, iPhone support (A3's check) |

**A row that needs attention:**
- It gives the cause and what to do in plain words.
- It offers an action where the app can do it (**Set up this Mac**, **Check
  again**), or a docs link where it can't (Node.js, Appium, Xcode, Android
  tools).
- With technical details on, it also shows its detail (version, folder),
  the command to fix it (with **Copy**), and the raw remediation text.

**Copy rewrite.** Every message `ToolchainInspector` and `toolchainRules`
produce gets a plain sentence in `setupRows` (section 4). Today's
remediations move to the technical detail. Example:
"appium not found on PATH / Install Appium 3: npm i -g appium" becomes
"Appium isn’t installed on this Mac. Xenon needs Appium 3.1.1 or newer."
plus a **How to install** link, with the command under technical details.

**Set up.**
- **Set up this Mac** (the A3 button, renamed) sits under the groups:
  "Installs or updates whatever is missing."
- Its steps appear inline beneath it (A3's plain step rows and summary).
- It stays disabled while the server runs, with A3's hint.

### Settings

Tabs: **Essentials** | **All settings** | **Keys & accounts**. The
**Show technical details** switch sits at the bottom of Essentials.

**Essentials** (the pure catalog `essentials`). Groups and rows, in this
order. "When" rows appear only when their condition holds.

| Group | Label | Option | Control |
|---|---|---|---|
| Phones | Which phones | `platform` | Segmented: Android / iPhone / Both |
| | Android | `androidDeviceType` (when Android in use) | Segmented: Real phones / Emulators / Both |
| | Only emulators that are already running | `bootedEmulators` (when Android emulators in use) | Switch |
| | iPhone | `iosDeviceType` (when iPhone in use) | Segmented: Real iPhones / Simulators / Both |
| | Only simulators that are already running | `bootedSimulators` (when simulators in use) | Switch |
| Tests | Tests at the same time | `maxSessions` | Number (1–99) |
| | Port tests connect to | server port | Number (1–65535) |
| | Wait for a free phone up to | `deviceAvailabilityTimeoutMs` | Number in minutes (ms ↔ min, 0.5 step) |
| Recording & history | Keep a full record of each test — "video, steps and logs, in the dashboard" | `enableDashboard` | Switch |
| | Keep history for | `buildCleanupDays` | Number in days |
| Sharing & sign-in | Ask people to sign in | `authDisabled` (inverted) | Switch |
| | Share this Mac’s phones with a lab hub | `hub` set / unset | Switch; when on, reveals **Hub address** (`hub`, origin only), **Access key** and **Token** (Keychain secrets `XENON_HUB_ACCESS_KEY`, `XENON_HUB_TOKEN`). Turning it off clears `hub` and keeps the keys. |
| AI help | Repair broken element lookups automatically | `enableSelfHealing` | Switch |
| | AI service | `aiProvider` (when repair on) | Segmented: Gemini / OpenAI / Claude / Ollama |
| | Gemini key / OpenAI key / Claude key | the matching Keychain secret | Secret field ("•••••••• saved" / "Paste a key") |
| | Ollama address | `aiBaseUrl` (when Ollama) | Text |

**Further rules.**
- **Dashboard overrides:** options whose Xenon description says a value
  saved in the dashboard wins (self-healing, AI service and model, history,
  health checks) show "The dashboard can override this."
- **Raw names:** with technical details on, every row also shows its raw
  option name and the original description.
- **Validation:** Part A's rules, shown inline under the row in plain
  words.

**All settings.**
- Every option of the effective schema (Part A's A4), grouped, using the
  hand-written plain catalog `optionCatalog`: a label, one line of help and
  a group per Xenon 2.17 option.
- An option the catalog doesn't know (a newer installed Xenon) falls back
  to a humanized name and Xenon's description, in a "More" group.
- **Search** matches labels and help, plus raw names when technical details
  are on.
- The **Technical** group (technical details only) holds:
  - base path;
  - Appium folder (blank = automatic, with the resolved folder shown);
  - keep-alive timeout;
  - the environment-variables editor (A5's secret-name warning kept).

**Keys & accounts.**
- **Every Keychain secret:**
  - Gemini, OpenAI and Claude keys;
  - hub access key and token;
  - email for password resets (SMTP);
  - **Cloud access key** (new);
  - **proxy password** (new);
  - database file (technical details only).
- **Each secret** has a plain label, a one-line purpose, saved / not set,
  **Save**, **Clear** (with confirmation), and **Used by this profile** (a
  switch replacing "inject in this profile").
- Filling a key from Essentials turns "Used by this profile" on
  automatically.

### Logs

**Toolbar.**
- **Show:** Everything / Problems only (warnings and errors).
- Search, **Copy**, **Save as…**, **Clear**.
- With technical details: **Open log folder**.

**Lines and behaviour.**
- Each line shows its time (HH:MM:SS) and text, with warnings and errors
  coloured and marked by an icon.
- The app's own system and diagnostic lines (Launching…, Stopping Xenon…,
  diagnostics) appear only with technical details on, except the stop and
  crash lines, which always show.
- Opened from Home's **See what happened**, it switches to Problems only
  and scrolls to the line Home quoted.

### Profiles sheet

From the switcher's **Manage profiles…** or File → Manage Profiles….

- A list of profiles with name and summary.
- **Rename**, **Duplicate**, **Delete** (confirm: "Delete “QA Lab — iOS”?
  Its settings can’t be recovered."), **Import…**, **Export…**.
- **After an export**, a notice says how many secret values were left out
  ("3 secret values were left out — enter them again after importing")
  from A5's `strippedEnv` plus the stripped settings. The names are listed
  with technical details on.
- **After an import**, A6's import feedback, unchanged.

## 3. Visual system and accessibility

**Tokens.**
- `scripts/sync-tokens.mjs` / `tokens-lib.mjs` grow from 13 colours to the
  dashboard's full token set in `web/src/tokens.css`, generating
  `src/renderer/src/tokens.css`:
  - colours, including the status triples;
  - the 4 px spacing scale;
  - radii, shadows and type sizes;
  - the `:root[data-theme='light']` block.
- The CI `sync:tokens:check` keeps them in step.
- `tailwind.config.mjs` maps the semantic names, spacing, radii and type
  sizes to the variables. No raw hex or arbitrary pixel values outside
  `tokens.css`; a test enforces it.

**Appearance.**
- System (default) / Light / Dark, stored per Mac.
- System follows macOS live (`nativeTheme` + `prefers-color-scheme`).
  Main sets `nativeTheme.themeSource` so menus, dialogs and the title bar
  match.
- The renderer sets `<html data-theme>` before first paint.

**Type, density and motion.**
- **Type:** Inter for all text. JetBrains Mono only for addresses, log
  lines and technical details. Sizes only from the dashboard's scale.
- **Density:** rows at least 32 px, targets at least 24 px.
- **Motion:** subtle transitions. None when macOS Reduce Motion is on
  (`prefers-reduced-motion`).

**UI kit (`src/renderer/src/components/ui`).**
- **Components:**
  - Button: primary, secondary, danger, quiet; sizes sm / md.
  - TextField, NumberField (with unit suffix and conversion), SecretField.
  - Switch, Segmented (radio group), Select, Tabs.
  - Group (card with heading), StatusRow (icon, sentence, action, technical
    detail).
  - Banner, Sheet/Dialog, Popover, Tooltip, Badge, EmptyState, Toast (A6's,
    restyled).
- **Radix primitives** (`@radix-ui/react-switch`, `-tabs`, `-dialog`,
  `-popover`, `-select`, `-tooltip`, `-radio-group`) give keyboard
  behaviour and ARIA roles. They are styled only with token classes.
- **Icons:** Lucide at 14 and 16 px only.

**Words.**
- Every user-visible string lives in `src/renderer/src/copy/<screen>.ts`
  (and `src/main/copy.ts` for main-process messages that reach the
  window).
- **Rules:**
  - Plain words and sentence case.
  - Buttons are verbs.
  - Errors say what happened and what to do.
  - No option keys, environment names, commands or paths in a main
    sentence; those appear only in technical details.
- Part A's exact strings are kept unless this spec rewrites them.

**Accessibility (WCAG 2.1 AA, a requirement).**
- **Contrast:** at least 4.5:1 for text and 3:1 for controls and the focus
  ring, in both themes, checked by a token test.
- **Keyboard:**
  - Tab order follows the layout.
  - Arrow keys move within the sidebar, tabs, segmented controls and lists.
  - A visible focus ring on every interactive element.
  - A skip-to-content link.
  - Every action is reachable without a mouse.
- **Names:** every control has an accessible name (label `for`/`id`, or
  `aria-label` for icon buttons).
- **Announcements:** server status changes are announced politely; errors
  are announced assertively.
- **Never colour alone:** each status has an icon and words.

## 4. Architecture

**Renderer.**
- `App.tsx` (about 790 lines today) becomes a thin composition of:
  - `AppShell`: sidebar, places (`'home' | 'setup' | 'settings' | 'logs'`,
    plain state, no router library), Settings tab, keyboard navigation;
  - `useServer`: state, log subscription, start/stop through Part A's
    `requestStart`;
  - `useProfiles`: list, active profile, draft, debounced persistence;
  - `usePreferences`: technical details, appearance;
  - `useEffectiveSchema`: Part A's A4 refresh logic, moved;
  - Part A's `useReadiness` and setup progress, unchanged.
- **Screens:** `screens/Home`, `screens/Setup`, `screens/Settings`
  (`Essentials`, `AllSettings`, `KeysAndAccounts`, `Technical`),
  `screens/Logs`, `sheets/Profiles`.

**New pure models** (unit-tested, no React or Electron):

| Module | Contract |
|---|---|
| `homeState.ts` | `homeState(input: { server: ServerState; readiness: PreflightResult \| null; checking: boolean; installing: boolean; setupNeeded: boolean; issues: ValidationIssue[]; profile: Profile; lastRun: LastRun \| null }): HomeView` — the state kind, title, sentence, primary/secondary actions |
| `quickFix.ts` | `quickFix(blocker: Blocker, ctx): QuickFix \| null` per the table in section 2 |
| `essentials.ts` | The Essentials catalog: rows with `{ id, group, label, help?, read(profile, secrets), write(profile, value), control, units?, when?(profile) }`, including ms ↔ min and the inverted sign-in switch |
| `optionCatalog.ts` | `{ [optionKey]: { label, help, group } }` for every Xenon 2.17 option, plus `fallbackLabel(key, description)` |
| `setupRows.ts` | `setupRow(check: ToolCheck, profile): { tone, sentence, action?, technical: { detail, command?, remediation? } }` |
| `copy/*.ts` | String catalogs |

**Main process.**
- **Preferences** (`electron-store`, per Mac): `technicalDetails: boolean`,
  `appearance: 'system' | 'light' | 'dark'`. IPC `prefs:get` / `prefs:set`.
  Setting appearance updates `nativeTheme.themeSource`.
- **`share:addresses(profile)`** returns `{ test, colleagues }`.
- **`net:nextFreePort(from)`** returns the first port at or above `from`
  that Part A's connect probe reports free (it gives up after 50).
- **Last run:** the supervisor records `{ endedAt, how: 'stopped' | 'crashed', reason? }`
  per profile for Home's footer.
- **Keychain secrets, new:**
  - **`CLOUD_KEY`** ("Cloud access key"). Xenon reads cloud credentials from
    the environment (`CLOUD_KEY`, `CLOUD_USERNAME`;
    `src/device-managers/cloud/CapabilityManager.ts`,
    `src/helpers/index.ts`), and its cloud schema doesn't require
    `cloud.apiKey` (`src/types/CloudSchema.ts`). So the launch passes the
    secret as `CLOUD_KEY` and **never writes `cloud.apiKey`**. A cloud user
    name in the settings is passed as `CLOUD_USERNAME`.
  - **`PROXY_PASSWORD`** ("Proxy password"). Xenon's `proxy` option wins
    over `HTTP(S)_PROXY` and falls back to them when unset
    (`src/helpers/outboundProxy.ts`). So when the profile's proxy has a
    password, the launch omits the `proxy` option and passes
    `HTTPS_PROXY` / `HTTP_PROXY` built from the proxy settings with the
    password from the Keychain. A proxy without a password stays a
    `proxy` option as today.
  - **Migration:** on load, any `cloud.apiKey` or `proxy.auth.password` in a
    profile moves into the Keychain and out of the profile, as Part A moved
    the Database URL.
  - Exports keep stripping both (A5).

**Part C slots.** These components render nothing until Part C supplies
data, so C adds data sources, not layout:
- `HomeLiveStrip`
- `FirstSignInCard`
- `SetupUpdateRow`
- `SetupHubRow`
- `ConnectAgentsGroup` (Settings)

## 5. Testing and delivery

**Tests.**
- **Unit:** every pure model in section 4. Every Essentials row reads and
  writes its option (including unit conversions and the inverted switch);
  every Home state and quick fix; every Setup row for every check outcome.
- **No-jargon e2e:**
  - For each screen and Home state, with technical details off, the test
    reads the rendered text and fails on:
    - `camelCase` option keys from the schema;
    - `[A-Z][A-Z0-9_]{3,}` environment-style names;
    - command words (`npm `, `appium `, `brew `, `xcode-select`);
    - absolute paths, except inside the addresses.
  - With technical details on, it asserts the raw names appear.
- **Catalog completeness:** every property of the bundled schema has an
  `optionCatalog` entry with a label and help.
- **Tokens:** contrast pairs at AA in both themes; no raw hex or arbitrary
  sizes outside `tokens.css`.
- **Accessibility e2e:** `@axe-core/playwright` on every screen in both
  themes (no serious or critical violations), and a keyboard-only run from
  launch to Start.
- **Keychain:**
  - unit tests that `cloud.apiKey` and `proxy.auth.password` are never in
    the generated config;
  - that `CLOUD_KEY` / `HTTPS_PROXY` are in the launch environment;
  - the migration;
  - that exports leave both out.
- The existing e2e suite is rewritten for the new navigation, keeping every
  Part A behaviour test.

**Live checks** (per PR, as Part A):
- the built app with a throwaway home folder, port 4799, Android only;
- screenshots of every changed screen in light and dark;
- for B5, a live check that a proxy with a password set in the Keychain is
  actually used by Xenon's outgoing calls (through a local test proxy that
  records an authenticated request).

**Before 0.3.0,** the user does a VoiceOver pass on Home, Setup and
Settings.

**Delivery:** seven PRs, each branched from `main`, merged on green:

| PR | Contents |
|---|---|
| B1 Foundations | Full token sync + light theme, Appearance preference and `nativeTheme`, UI kit on Radix, copy catalog structure, token and contrast tests. Existing screens adopt the tokens (the app follows light/dark) |
| B2 Shell | `AppShell` sidebar, profile switcher and Profiles sheet, sidebar status + Start/Stop, menus and menu-bar icon, Show technical details; `App.tsx` split into hooks; the bottom bar and header removed; existing panels mounted as Setup / Settings / Logs until their PRs land |
| B3 Home | `homeState`, `quickFix`, `share:addresses`, `net:nextFreePort`, last run, all Home states, empty Part C slots |
| B4 Setup | `setupRows`, plain rewrite of every toolchain message, inline Set up steps, technical details |
| B5 Settings | `essentials`, `optionCatalog`, Essentials / All settings / Keys & accounts / Technical, Keychain cloud key and proxy password with migration and launch environment |
| B6 Logs | Everything / Problems only, times, copy and save, system lines behind technical details, jump to the crash line |
| B7 Release 0.3.0 | Docs with screenshots in both themes, README, version |

## Risks

- **Radix adds about 40 KB gzipped** and seven dependencies. Mitigation:
  only the primitives listed; the renderer is local, so load cost is small.
- **Hand-written labels can drift from Xenon's options.** Mitigation: the
  catalog completeness test fails when the bundled schema gains an option,
  and unknown installed options still render with Xenon's own text.
- **Proxy via environment differs subtly from the `proxy` option:**
  `NO_PROXY` applies, and so does Xenon's env proxy rule for axios.
  Mitigation: only when a password is set, and the B5 live check confirms
  Xenon's calls go through it. If it fails, B5 falls back to keeping the
  password in the `proxy` option with a visible note, and Goal 4 is
  recorded as unmet for the proxy.
- **The `.local` colleagues' address** depends on Bonjour on the network.
  Mitigation: it is labelled "on your network"; Part C can replace it with
  Xenon's reported addresses.
- **Removing the header fields** moves Port and the Appium folder.
  Mitigation: Port is in Essentials → Tests; the Appium folder is in
  Technical, and Setup / Home's quick fixes cover the common cases.
