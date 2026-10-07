# Xenon Control — Redesign for Everyday Users (Part B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Xenon Control's renderer in place for QA testers. It gets a slim sidebar, a Home that answers "can I test now?", a plain Setup, Settings split into Essentials and All settings, and plain Logs. Light and dark follow the Mac, the app meets WCAG 2.1 AA, and every technical detail sits behind one switch. The Cloud key and proxy password move into the Keychain. Ship 0.3.0.

**Architecture:** The app is Electron (`src/main`) plus React (`src/renderer/src`), talking over typed IPC (`src/shared/ipc.ts`, `src/preload/index.ts`). Every decision a screen makes goes into a pure `.ts` model with vitest tests: `homeState`, `quickFix`, `setupRows`, `essentials`, `optionCatalog`, `logView`, `navigation`. React components only render those models. Strings live in `copy/*.ts`. Part A's readiness model and start path are reused unchanged.

**Tech Stack:** Electron 43 + electron-vite, React 18, Tailwind 3, TypeScript, Radix UI primitives, Lucide icons, vitest (node env), Playwright `_electron` e2e, `@axe-core/playwright`.

**Spec:** `docs/superpowers/specs/2026-10-06-xenon-control-everyday-redesign-design.md`

## Global Constraints

**Order and scope**
- **Start condition:** B1 starts only when `origin/main:mac-app/package.json` has `"version": "0.2.0"`, meaning PR #524 is merged. If it doesn't, stop and tell the user. Task 0 (docs) can go first.
- **Files:** work only in `mac-app/`, `website/docs/xenon-control.md`, `website/static/img/xenon-control/`, root `CHANGELOG.md` and `.github/workflows/mac-app.yml`. Never edit `web/src/tokens.css`. It is the source the app copies.

**Code rules**
- `src/shared/**` must not import Node or Electron.
- **Unit tests:**
  - They live at `mac-app/test/<name>.spec.ts`, run in vitest's node environment, and use relative imports.
  - There is no jsdom and no React testing library. Logic goes into pure `.ts` modules; React is proven by e2e.
- **Part A behaviour stays.** That means `decideStart`, `afterStartCheck`, `useReadiness`, the one start path `requestStart`, `StopEscalator`, the quit flow, the effective schema (A4), retired settings and export stripping (A5), and the `bootedSimulators: true` profile default. Part A's exact strings stay unless the spec or this plan rewrites them.
- **Keep existing test ids** where an element survives: `start-button`, `stop-button`, `start-blocked-reason`, `sidebar-status`, `readiness-blockers`, `settings-search`, `schema-source`, `appium-home`, `preview-button`. Tasks name the new ones.

**Words**
- Every user-visible string added or changed lives in `src/renderer/src/copy/<screen>.ts`, or `src/main/copy.ts` for main-process text that reaches the window.
- Plain words and sentence case. Buttons are verbs. Errors say what happened and what to do.
- With technical details off, a main sentence never contains option keys, environment names, commands or paths.
- Exact copy in the spec and in this plan is final. Use it verbatim, including typographic apostrophes and quotes (’ “ ”).

**Look and accessibility**
- **Styling:**
  - Colours, sizes, radii and shadows come only from token classes.
  - No hex and no `rgb(`/`rgba(` in renderer source except `rgb(var(--…))`. No Tailwind arbitrary values (`[…px]`, `[#…]`) outside `tokens.css`. The guard test from Task 3 enforces this.
  - Lucide icons only, at `size={14}` or `size={16}`.
  - JetBrains Mono only for addresses, log lines and technical details.
- **Control boundaries** need 3:1 contrast: input borders, the switch's off track and segmented outlines use the `dim` colour. The `line` colour is only for decorative separators.
- **WCAG 2.1 AA:**
  - Every control has an accessible name.
  - A status always has an icon and words.
  - Status changes are announced politely and errors assertively.

**Dependencies**
- Add only these, as devDependencies like `react` and `lucide-react` (the renderer is bundled):
  - `@radix-ui/react-switch@^1.3.8`
  - `@radix-ui/react-tabs@^1.1.22`
  - `@radix-ui/react-dialog@^1.2.0`
  - `@radix-ui/react-popover@^1.2.0`
  - `@radix-ui/react-select@^2.3.8`
  - `@radix-ui/react-tooltip@^1.3.0`
  - `@radix-ui/react-radio-group@^1.4.8`
  - `@axe-core/playwright@^4.13.0`

**Git and the user's machine**
- One branch per PR item off the latest `origin/main`, then one PR. No attribution lines in commits or PRs.
- **Don't merge PR #524 or the B7 PR.** The user merges them when they publish the release.
- **Never touch the user's setup:**
  - their server on port 4723;
  - their `~/.appium`;
  - their iPhones;
  - their installed Xenon Control.

  Live checks use port 4799, a throwaway `--user-data-dir`, and Android emulators only.

### Per-PR shipping procedure (referenced by every item as "Ship")

1. **Unit checks.** Run `cd mac-app && npm test && npm run typecheck && npm run build && npm run sync:tokens:check`. All must pass.
2. **E2E.** Run `npm run test:e2e`. It needs this Mac's Appium with Xenon installed. All must pass.
   - If the Electron window closes by itself mid-run (Part A rulings R12 and R46), rerun once and note it in the ledger.
3. **Live check.** Write a live check script `live/b<N>.cjs` in the session scratchpad, modelled on Part A's `live/common.cjs`:
   - Playwright `_electron` launches the worktree's built `out/` with a fresh `--user-data-dir`.
   - The profile is set to port 4799, Android, emulators only.

   Take screenshots of every screen the PR changed, in **light and dark** (set through `window.xenon.prefs.set({ appearance })`). Send them to the user with SendUserFile, and say in the PR body what each shows.
4. **Open the PR.** Run `git push -u origin <branch>`, then `gh pr create --base main`. The body covers the summary, the spec section, and the evidence.
5. **Merge on green**, except B7: `gh pr checks <n> --watch`, then `gh pr merge --merge --delete-branch`. Sync `main` before the next item.

### Workspace setup (once per branch)

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git fetch origin
git worktree add .claude/worktrees/<branch-slug> -b <branch> origin/main
cd .claude/worktrees/<branch-slug>/mac-app && npm ci
```

### E2E selector migration (B2 onwards)

Part A's e2e suite (`test/e2e/app.e2e.spec.ts`) is rewritten as the navigation changes. **Every Part A behaviour test is kept**, with only its selectors moved. Shared helpers move to `test/e2e/helpers.ts`:
- `launchApp()`
- `openPlace(name: 'Home' | 'Setup' | 'Settings' | 'Logs')`
- `setTechnical(page, on: boolean)`
- `setAppearance(page, a: Appearance)`
- `createProfile()`
- `pressStartShortcut()`

| Part A selector | From B2 |
|---|---|
| `beforeAll` gate `getByTestId('profile-name')` | `getByTestId('profile-switcher')` |
| `getByRole('tab', { name: 'Health' })` | `openPlace('Setup')` (places are Radix vertical tabs, role `tab`) |
| `getByRole('tab', { name: 'Settings' / 'Logs' })` | `openPlace('Settings' / 'Logs')` |
| Header Port spinbutton, first `input[type=number]` | `openPlace('Settings')`, then `getByRole('spinbutton', { name: 'Port' })` (B2 Server group; B5 Essentials label "Port tests connect to", where the e2e uses that name) |
| Header `appium-home` | `setTechnical(true)`, Settings → Technical → `appium-home` |
| Status bar `preview-button` | `setTechnical(true)`, Settings → Technical → `preview-button` |
| Header "Log Folder" button | `setTechnical(true)`, Logs → "Open log folder" |
| `profile-row`, `new-profile`, `profile-name` (sidebar list and header) | Profiles sheet: `profile-row`, the "New profile…" button, rename field `profile-name` |
| `sidebar-brand`, `plugin x.y.z` in `sidebar-status` | Removed. The plugin version shows on Setup as `plugin-version` |

## Review Focus

1. **Another profile's server is running while a different profile is selected.**
   - Home must say which profile is running and offer to switch to it. It must not show the selected profile's address as running.
   - The sidebar status describes the server.
   - Copy Test Address copies the running profile's address.

   *(Pinned in Task 10 and Task 11.)*
2. **Appearance is "System" and macOS flips light/dark while the app is open.**
   - The window follows without a reload.
   - The first frame shown is already in the right theme.

   *(Pinned in Task 2.)*
3. **The minutes field gets a non-round or empty value.**
   - 100 000 ms shows as `1.7`. An empty field returns the option to its default, not 0.
   - Looking at a value never rewrites it.

   *(Pinned in Task 4 and Task 15.)*
4. **The hub switch is turned on with no address, then off and on again.**
   - Turning it on writes nothing until a valid address is typed. `hub: ''` is never saved.
   - Turning it off clears `hub` but keeps the access key, the token and "Used by this profile".

   *(Pinned in Task 15.)*
5. **Base paths and Mac host names in the addresses.**
   - A base path of `''`, `/` or `/wd/hub/` gives `http://localhost:4723`, `http://localhost:4723` and `http://localhost:4723/wd/hub`.
   - A host name `Lab-Mac.local` gives `http://lab-mac.local:…`.

   *(Pinned in Task 9.)*

## File structure

| Path (under `mac-app/`) | Responsibility | PR |
|---|---|---|
| `scripts/tokens-lib.mjs` | Parse both themes from the dashboard tokens, generate `tokens.css`, contrast maths | B1 |
| `src/shared/preferences.ts` | `Preferences`, defaults, `sanitizePreferences` | B1 |
| `src/main/PreferencesStore.ts` | Per-Mac preferences (`electron-store` "preferences") | B1 |
| `src/main/copy.ts` | Main-process strings that reach the window | B1 |
| `src/renderer/src/theme.ts` | `applyTheme`, `watchSystemTheme` | B1 |
| `src/renderer/src/numberField.ts` | Units, display and parse for NumberField | B1 |
| `src/renderer/src/components/ui/*` | The UI kit (Radix-backed) | B1 |
| `src/renderer/src/copy/*.ts` | String catalogs per screen | B1 to B6 |
| `src/renderer/src/hooks/*` | `useProfiles`, `useServer`, `usePreferences`, `useEffectiveSchema` | B2 |
| `src/renderer/src/navigation.ts`, `profileSummary.ts`, `exportNotice.ts` | Shell models | B2 |
| `src/shared/preflightMessages.ts` | The preflight blocker sentences, shared by main and renderer | B2 |
| `src/renderer/src/AppShell.tsx`, `components/Sidebar.tsx`, `components/ProfileSwitcher.tsx`, `components/SidebarStatus.tsx`, `sheets/Profiles.tsx` | Shell UI | B2 |
| `src/main/shareAddresses.ts`, `src/main/nextFreePort.ts`, `src/main/lastRun.ts`, `src/shared/links.ts` | Home's main-side data | B3 |
| `src/renderer/src/homeState.ts`, `quickFix.ts` | Home models | B3 |
| `src/renderer/src/screens/Home.tsx`, `components/AddressCard.tsx`, `components/slots/*` | Home UI and Part C slots | B3 |
| `src/renderer/src/setupRows.ts`, `screens/Setup.tsx` | Setup | B4 |
| `src/main/proxyEnv.ts` | Proxy URL from settings and the Keychain password | B5 |
| `src/renderer/src/essentials.ts`, `optionCatalog.ts`, `allSettings.ts`, `screens/settings/*` | Settings | B5 |
| `src/renderer/src/logView.ts`, `screens/Logs.tsx` | Logs | B6 |
| `test/e2e/helpers.ts`, `test/e2e/jargon.ts`, `test/e2e/a11y.ts` | E2E helpers, no-jargon and axe checks | B1 and B2 |

**Deleted along the way:**

| File | Removed in |
|---|---|
| `components/StatusBar.tsx` | B2 |
| `components/ProfileList.tsx` | B2 |
| `components/HealthPanel.tsx` | B4 |
| `components/SettingsForm.tsx` (its field editors move to `screens/settings/FieldEditor.tsx`) | B5 |
| `components/SecretsPanel.tsx` | B5 |
| `components/SettingsNav.tsx` | B5 |
| `components/LogConsole.tsx` | B6 |

---

## Item 0 — Spec and plan PR

### Task 0: Publish the docs

- [ ] **Step 1:** In worktree `.claude/worktrees/xenon-control-b` (branch `docs/xenon-control-everyday-redesign`, which already holds the spec), commit this plan: `git add docs/superpowers/plans && git commit -m "docs: plan for Xenon Control everyday redesign (Part B)"`.
- [ ] **Step 2:** Push and open the PR "docs: Xenon Control everyday redesign spec + plan (Part B)". Merge on green.

---

## Item B1 — Foundations (branch `feat/xenon-control-foundations`)

### Task 1: Full token sync with the light theme

**Files:**
- Modify: `scripts/tokens-lib.mjs`, `scripts/sync-tokens.mjs`, `tailwind.config.mjs`, `src/renderer/src/styles.css`
- Regenerate: `src/renderer/src/tokens.css` (`npm run sync:tokens`)
- Test: `test/tokensLib.spec.ts` (rewrite)

**Interfaces:**
- Produces, in `tokens-lib.mjs`:
  - `parseThemeBlocks(css: string): { dark: Record<string, string>; light: Record<string, string> }`.
    - `dark` merges, in order, every rule whose selector list contains a bare `:root` (both `.theme-dark, :root` blocks).
    - `light` is the `:root[data-theme='light']` block.
    - It ignores `:where(…)`, `@media` and every other selector.
    - It throws `MissingTokenError` when a name in `COLOR_VARS` is missing from `dark`.
  - `resolveVar(name: string, vars: Record<string, string>): string`. It follows `var(--x)` chains, up to 10 deep.
  - `contrastRatio(a: string, b: string): number`. Both arguments are 6-digit hex; the result is the WCAG ratio.
  - `generateTokensCss(t: { dark; light }): string`. It writes the header comment, then:
    - `:root { color-scheme: dark; …every dark var verbatim…; … }`
    - `:root[data-theme='light'] { color-scheme: light; …every light var verbatim…; … }`

    Each block also gets `<name>-rgb: r g b` for every variable whose value **resolves within that theme** to 6-digit hex. Light resolves against `{ ...dark, ...light }`, so `--color-accent` gets the light green's channels even though only `--green` is overridden.
  - It keeps `hexToRgbChannels`, `MissingTokenError` and `COLOR_VARS`, and removes `parseCssVars` and `PASSTHROUGH_VARS`.
- Tailwind (`theme.extend` unless noted):
  - **Colours as they are today:** `app`, `surface`, `surface2`, `line` and `line.strong`, `ink`, `muted`, `dim`, all through their `-rgb` channels.
  - **Colours that change:**
    - `accent` → `--color-accent-rgb`
    - `accent.fg` → `--color-on-accent-rgb`
    - `warn` → `--color-warning-rgb`
    - `danger` → `--color-danger-rgb`
    - `info` → `--color-info-rgb`
  - **Colours that are new:**
    - `ok` → `--color-success-rgb`
    - `focus` → `--color-focus-ring-rgb`
    - `sunken` → `--surface-sunken-rgb`
    - `status.{ready,busy,reserved,error,offline}.{fg,bg,border}` → `var(--status-…)` directly, with no alpha modifier.
  - `fontSize`, **replaced**: `2xs`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl` → `var(--font-size-…)`.
  - `borderRadius`, **replaced**: `none: '0'`, `sm`, `md`, `lg` → `var(--radius-…)`, `DEFAULT` → `var(--radius-md)`, `full: '9999px'`.
  - `boxShadow`: `sm`, `md`, `lg` → `var(--shadow-…)`.
  - `spacing`: `1, 2, 3, 4, 5, 6, 8, 12` → `var(--space-N)`. The values equal Tailwind's, so nothing moves.

- [ ] **Step 1: Write the failing tests.**
  - `parseThemeBlocks` on a fixture with two `.theme-dark, :root` blocks, a light block, a `:where(:root[data-theme='light'] .theme-dark)` rule and an `@media` rule:
    - a variable from the second dark block is present;
    - the light `--bg` differs from the dark one;
    - nothing from the `:where`/`@media` rules is picked up.
  - **Channels resolve through `var()`.** With `--black: #000000; --color-on-accent: var(--black)` → `--color-on-accent-rgb: 0 0 0`.
  - **Light channels are recomputed.** Dark has `--green: #22c55e; --color-accent: var(--green)` and light has only `--green: #15803d`. The light block contains `--color-accent-rgb: 21 128 61`.
  - **The real file.** On `../../web/src/tokens.css`, the generated text contains `:root[data-theme='light'] {`, `--space-4: 16px`, `--font-size-md: 14px` and `--status-ready-fg`.
  - **Missing token.** A missing `--bg` still throws `MissingTokenError`.
  - **Contrast.** `contrastRatio('#ffffff', '#000000')` is 21, to 2 decimal places.
- [ ] **Step 2: Run the tests and confirm they fail.** `npx vitest run test/tokensLib.spec.ts`.
- [ ] **Step 3: Implement**, then:
  - update `sync-tokens.mjs` to call `parseThemeBlocks`;
  - run `npm run sync:tokens`;
  - update `tailwind.config.mjs`;
  - in `styles.css`, delete `:root { color-scheme: dark; }`, which the generated file now owns;
  - map every class the replaced scales no longer define (`text-base`, `text-3xl`, `rounded-xl`, `rounded-2xl` and the like) to the nearest scale name, found with `grep -rnE "text-(base|3xl|4xl)|rounded-(xl|2xl|3xl)" src/renderer/src`.
- [ ] **Step 4: Run the tests and confirm they pass.** `npx vitest run test/tokensLib.spec.ts && npm run sync:tokens:check && npm run build`.
- [ ] **Step 5: Commit.** `feat(mac-app): sync the dashboard's full token set, light theme included`.

### Task 2: Appearance follows the Mac

**Files:**
- Create: `src/shared/preferences.ts`, `src/main/PreferencesStore.ts`, `src/renderer/src/theme.ts`
- Modify:
  - `src/shared/ipc.ts`: `prefsGet: 'prefs:get'`, `prefsSet: 'prefs:set'`, `evtPrefs: 'evt:prefs'`
  - `src/preload/index.ts`
  - `src/main/index.ts`
  - `src/main/menu.ts`
  - `src/renderer/src/main.tsx`
- Test: `test/preferences.spec.ts`, `test/menu.spec.ts` (extend), `test/e2e/app.e2e.spec.ts`

**Interfaces:**
- Produces, in `preferences.ts`:
  - `export type Appearance = 'system' | 'light' | 'dark'`
  - `export interface Preferences { technicalDetails: boolean; appearance: Appearance }`
  - `export const DEFAULT_PREFERENCES: Preferences = { technicalDetails: false, appearance: 'system' }`
  - `export function sanitizePreferences(raw: unknown): Preferences`. Each field that is missing or of the wrong type takes its default.
- `PreferencesStore`: `get(): Preferences` and `set(patch: Partial<Preferences>): Preferences`. It is an `electron-store` named `preferences`.
- Preload: `prefs: { get(): Promise<Preferences>; set(patch: Partial<Preferences>): Promise<Preferences> }` and `onPrefs(cb: (p: Preferences) => void): () => void`.
- **Main:**
  - At startup it sets `nativeTheme.themeSource = prefs.appearance`.
  - `prefs:set` saves the change, sets `themeSource`, broadcasts `evt:prefs` and rebuilds the menu.
  - The `BrowserWindow` gets `show: false` and is shown on `ready-to-show`, so the first visible frame is already themed.
- `theme.ts`:
  - `applyTheme(theme: 'light' | 'dark'): void` sets `document.documentElement.dataset.theme`.
  - `watchSystemTheme(): () => void` applies `matchMedia('(prefers-color-scheme: dark)')` now and on every change.

  `themeSource` drives that media query, so the renderer always follows it. `main.tsx` calls `watchSystemTheme()` before `createRoot`.
- `buildMenuTemplate` options gain `appearance: Appearance` and `setPrefs(patch: Partial<Preferences>): void`. View gets **Appearance ▸** with radio items System, Light and Dark, checked by `appearance`. Clicking one calls `setPrefs({ appearance })`.

- [ ] **Step 1: Write the failing tests.**
  - `sanitizePreferences`:
    - `undefined` → the defaults;
    - `{ appearance: 'blue', technicalDetails: 'yes' }` → the defaults;
    - `{ appearance: 'light' }` → `{ technicalDetails: false, appearance: 'light' }`.
  - **Menu:** the View submenu has an `Appearance` item whose submenu labels are `['System', 'Light', 'Dark']`. With `appearance: 'dark'`, only `Dark` is `checked`. Clicking `Light` calls `setPrefs({ appearance: 'light' })`.
  - **E2E `'the window follows the appearance preference'`:**
    - `page.evaluate(() => window.xenon.prefs.set({ appearance: 'light' }))` → `html[data-theme="light"]` within 2 s.
    - `'dark'` → `dark`.
    - Then `'system'` plus `page.emulateMedia({ colorScheme: 'light' })` → `light`, and `{ colorScheme: 'dark' }` → `dark`, with no reload (Review Focus 2).
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement and wire.**
- [ ] **Step 4: Run them and confirm they pass.** `npx vitest run test/preferences.spec.ts test/menu.spec.ts && npm run test:e2e -- -g "appearance"`.
- [ ] **Step 5: Commit.** `feat(mac-app): light and dark follow the Mac, with an Appearance menu`.

### Task 3: Existing screens adopt the tokens, guarded

**Files:**
- Modify: every renderer file the guard flags (14 arbitrary values today), and `src/renderer/src/ansi.ts`
- Modify: `src/renderer/src/styles.css`, adding the reduced-motion rule and making `.focus-ring` use `ring-focus`
- Test: `test/styleGuard.spec.ts`, `test/contrast.spec.ts`, `test/ansi.spec.ts` (update)

**Interfaces:**
- `parseAnsi` returns `color` as a CSS variable reference instead of hex:

  | ANSI colour | Token |
  |---|---|
  | red | `var(--red)` |
  | green | `var(--green)` |
  | yellow | `var(--amber)` |
  | blue | `var(--blue)` |
  | magenta | `var(--blue-400)` |
  | cyan | `var(--sky-400)` |
  | white | `var(--text)` |
  | black | `var(--text-dim)` |

  Bright variants map to the same tokens.
- `styles.css` adds `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }`.

- [ ] **Step 1: Write the failing tests.**
  - **`styleGuard.spec.ts`** walks `src/renderer/src/**/*.{ts,tsx,css}` except `tokens.css` and fails, naming file and line, on:
    - `/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/`
    - `/\[[^\]]*\d(px|rem)[^\]]*\]/` (arbitrary sizes)
    - `/\brgba?\((?!var\()/`
    - `/size=\{(\d+)\}/` with a value other than 14 or 16
  - **`contrast.spec.ts`** parses the generated `src/renderer/src/tokens.css` (with `parseThemeBlocks`, since its selectors match) and checks both themes:
    - **≥ 4.5:**
      - `--text`, `--text-muted` and `--text-dim` on `--bg`, `--surface` and `--surface-2`;
      - `--color-on-accent` on `--color-accent`;
      - `--color-accent`, `--color-danger`, `--color-warning`, `--color-info` and `--color-success` on `--bg` and `--surface`.
    - **≥ 3:** `--text-dim` (control boundaries) and `--color-focus-ring` on `--bg` and `--surface`.

    Today's values all pass (the lowest is dark `--color-danger` on `--surface`, 4.73), so this pins them.
  - **`ansi.spec.ts`:** `parseAnsi('\x1b[31mred\x1b[0m')` → `[{ text: 'red', color: 'var(--red)' }]`.
- [ ] **Step 2: Run them and confirm the guard and ansi tests fail.**
- [ ] **Step 3: Replace every flagged value** with token classes, and remap the ANSI palette.
- [ ] **Step 4: Run and confirm they pass.** `npm test && npm run test:e2e`. The existing suite passes unchanged.
- [ ] **Step 5: Commit.** `feat(mac-app): every screen uses the shared tokens; a guard keeps it that way`.

### Task 4: The UI kit and the copy catalogs

**Files:**
- Modify: `package.json` and `package-lock.json` (the Radix packages and `@axe-core/playwright`)
- Create, in `src/renderer/src/components/ui/`:
  - `Switch.tsx`, `Tabs.tsx`, `Dialog.tsx` (exports `Dialog` and `Sheet`), `Popover.tsx`, `Select.tsx`, `Tooltip.tsx`
  - `TextField.tsx`, `NumberField.tsx`, `SecretField.tsx`
  - `Group.tsx`, `StatusRow.tsx`, `Banner.tsx`, `Badge.tsx`, `EmptyState.tsx`
- Create: `src/renderer/src/numberField.ts`, `src/renderer/src/copy/common.ts`, `src/main/copy.ts`, `test/e2e/a11y.ts`
- Modify:
  - `components/ui/Button.tsx`: variants `primary | secondary | danger | quiet`, sizes `sm | md`. Rename every `ghost` caller to `quiet`.
  - `components/ui/Segmented.tsx`: on `@radix-ui/react-radio-group`, keeping its props.
  - `components/ui/Toaster.tsx`: token restyle. Errors use `role="alert"`, others `role="status"`.
  - `components/SettingsForm.tsx`: booleans use `Switch`.
  - `components/LaunchPreview.tsx`: on `Dialog`.
- Test: `test/numberField.spec.ts`, plus the existing e2e (radio, switch, Escape and focus-trap tests)

**Interfaces:**
- `numberField.ts`:
  - `export type NumberUnit = 'plain' | 'minutes-from-ms' | 'days'`
  - `export function toDisplay(value: number | undefined, unit: NumberUnit): string`
    - `minutes-from-ms` shows `ms / 60000` rounded to one decimal, without a trailing `.0`.
    - `undefined` shows `''`.
  - `export function fromInput(text: string, unit: NumberUnit, bounds: { min?: number; max?: number; integer?: boolean }): { ok: true; value: number | undefined } | { ok: false; error: string }`
    - `''` → `{ ok: true, value: undefined }`, meaning unset, back to the default.
    - Minutes convert back with `Math.round(min * 60000)`.
    - Bounds apply to the displayed number.
    - Errors: `Enter a number.`, `Enter ${min} or more.`, `Enter ${max} or less.`, `Enter a whole number.`
- **Component props:**
  - `Switch { checked; onCheckedChange; label: string; description?: string; id? }`. The label is a real `<label htmlFor>`.
  - `NumberField { label; value: number | undefined; unit: NumberUnit; min?; max?; step?; suffix?: string; onCommit(value: number | undefined): void; error?: string; settingKey?: string }`. `settingKey` renders `data-setting-key` so `focusSetting` works. It commits on blur or Enter, and only when the text changed.
  - `SecretField { label; saved: boolean; onSave(value: string): Promise<void>; onClear(): void; placeholder? }`. It shows `•••••••• saved` / `Paste a key`.
  - `StatusRow { tone: 'ok' | 'attention' | 'info' | 'checking'; sentence: string; action?: ReactNode; technical?: ReactNode; showTechnical: boolean; testId? }`. Each tone has its own Lucide icon and an `aria-label` word ("Ready", "Needs attention", "Note", "Checking").
  - `Group { title: string; children }` is a `<section aria-labelledby>`.
  - `Sheet` / `Dialog { open; onOpenChange; title; description?; children }`.
  - `Tabs { value; onValueChange; items: { value; label; badge?: ReactNode }[]; orientation?: 'horizontal' | 'vertical'; children }`.
- **Density:** Button `sm` is `h-6` (24 px) and `md` is `h-8`. Switch, Segmented, TextField and NumberField are at least 24 px tall. `StatusRow`, list rows and Essentials rows have `min-h-8` (32 px).
- `copy/common.ts` exports `COMMON = { copy: 'Copy', copied: 'Copied', save: 'Save', clear: 'Clear', cancel: 'Cancel', tryAgain: 'Try again', close: 'Close' } as const`.
- `src/main/copy.ts` starts empty, as `export const MAIN_COPY = {} as const`. Later tasks add to it.
- `test/e2e/a11y.ts` exports `expectAccessible(page: Page, label: string): Promise<void>`:
  - It runs `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()`.
  - It fails listing every violation whose impact is `serious` or `critical`.
  - If `AxeBuilder` can't attach to an Electron page, inject `axe-core`'s `source` with `page.addScriptTag({ content })` and call `axe.run` with the same tags, then record the ruling.

  Components that no screen mounts yet are proven by typecheck here and by the e2e of the PR that first mounts them.

- [ ] **Step 1: Write the failing tests** for `numberField`:
  - `toDisplay(300000, 'minutes-from-ms')` → `'5'`
  - `toDisplay(90000, …)` → `'1.5'`
  - `toDisplay(100000, …)` → `'1.7'`
  - `toDisplay(undefined, …)` → `''`
  - `fromInput('2.5', 'minutes-from-ms', {})` → `150000`
  - `fromInput('', …)` → `undefined` (Review Focus 3)
  - `fromInput('abc', 'plain', {})` → `Enter a number.`
  - `fromInput('0', 'plain', { min: 1 })` → `Enter 1 or more.`
  - `fromInput('1.5', 'plain', { integer: true })` → `Enter a whole number.`
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement the kit, the model and the catalogs.** Install the packages with `npm i -D <packages above>`.
- [ ] **Step 4: Run the checks and confirm they pass.** `npm test && npm run typecheck && npm run test:e2e`.
  - The radio `'android'`, radiogroup `'Platform'`, `switch`, Escape and focus-trap tests must pass on the Radix versions.
  - Add `expectAccessible(page, 'settings')` in both themes to the settings-form test.
- [ ] **Step 5: Commit.** `feat(mac-app): an accessible UI kit on Radix, and string catalogs`.

**Ship** with this live check:
- Screenshots of Settings, Secrets & Env, Health and Logs in light and dark.
- Switch Appearance from the View menu, and flip macOS appearance while on System.

---

## Item B2 — Shell (branch `feat/xenon-control-shell`)

### Task 5: Split `App.tsx` into hooks, with no visible change

**Files:**
- Create: `src/renderer/src/hooks/useProfiles.ts`, `useServer.ts`, `usePreferences.ts`, `useEffectiveSchema.ts`, and `src/renderer/src/navigation.ts` with only `export type Place = 'home' | 'setup' | 'settings' | 'logs'` and `export const PLACES: readonly Place[]`
- Modify: `src/renderer/src/App.tsx`
- Test: the existing e2e suite, unchanged

**Interfaces** (state and handlers move as they are; Part A's logic is untouched):
- **`useProfiles(): {…}`**, returning:
  - `profiles: Profile[]`
  - `activeId: string | null`
  - `draft: Profile | null`
  - `select(id: string): void`
  - `update(fn: (p: Profile) => Profile): void`. It owns the `SAVE_DEBOUNCE_MS = 300` saver.
  - `flush(): void`
  - `create(): Promise<void>`
  - `duplicate(id: string): Promise<void>`
  - `remove(id: string): Promise<void>`
  - `rename(id: string, name: string): void`
  - `importProfiles(): Promise<void>`. It toasts `importFeedback`.
  - `exportProfile(id: string): Promise<void>`. Task 7 changes it to return what was left out.
- **`useServer(): {…}`**, returning:
  - `state: ServerState`
  - `logs: UiLogLine[]`
  - `clearLogs(): void`
  - `stop(): Promise<void>`
- **`useStartFlow(i: {…}): {…}`**, in `useServer.ts`.
  - Its input is `{ draft; issues; readiness; checking; installing; refreshNow; flush; resetLogs; go(place: Place): void; focus(path: string): void }`.
  - It returns `{ requestStart(): Promise<void>; busy: boolean; startError: string | null; decision: StartDecision }`.
  - `requestStart` is Part A's (App.tsx lines 476-512). `setTab('settings')` becomes `go('settings')`, `setTab('health')` becomes `go('setup')`, and `setPendingFocus` becomes `focus`. Until Task 6, `App.tsx` maps `go('setup')` to the Health tab and `go('settings')` to the Settings tab.
- **`usePreferences(): {…}`**, returning `{ prefs: Preferences; setPrefs(patch: Partial<Preferences>): void }`. It subscribes to `onPrefs`.
- **`useEffectiveSchema(draft: Profile | null, status: ServerStatus): {…}`**, returning `{ schema; schemaInfo; installedPluginVersion; refresh(): void }`. Part A's seq and dedupe refresh moves here as it is.

- [ ] **Step 1: Run the full e2e suite on the branch as it is.** This is the baseline, and everything must be green.
- [ ] **Step 2: Move the state into the hooks.** `App.tsx` composes them and renders exactly what it rendered before.
- [ ] **Step 3: Run the checks.** `npm run typecheck && npm test && npm run test:e2e`. All pass with no test edits.
- [ ] **Step 4: Commit.** `refactor(mac-app): App state lives in hooks`.

### Task 6: Sidebar, places, status and Start/Stop

**Files:**
- Create:
  - `src/renderer/src/navigation.ts`, `profileSummary.ts`
  - `src/shared/preflightMessages.ts`
  - `src/renderer/src/AppShell.tsx`
  - `components/Sidebar.tsx`, `components/ProfileSwitcher.tsx`, `components/SidebarStatus.tsx`
  - `src/renderer/src/copy/shell.ts`
  - `test/e2e/helpers.ts`, `test/e2e/jargon.ts`
- Modify:
  - `App.tsx`: it renders `AppShell`. The header, the tab strip and `StatusBar` are deleted.
  - `serverStatus.ts`
  - `readiness.ts` (line 137) and `setupProgress.ts` (lines 80, 87, 94)
  - `ToolchainInspector.ts` (lines 168 and 262, now from `preflightMessages`)
  - `toolchainRules.ts`: the go-ios remediation.
  - `SettingsForm.tsx` (line 224)
- Delete: `components/StatusBar.tsx`, `components/ProfileList.tsx`
- Test: `test/navigation.spec.ts`, `test/profileSummary.spec.ts`, `test/serverStatus.spec.ts`, `test/readiness.spec.ts`, `test/setupProgress.spec.ts`, `test/jargon.spec.ts`, and the e2e suite (selector migration)

**Interfaces:**
- **`navigation.ts`** (adds to Task 5's `Place` and `PLACES`):
  - `export function setupNeedsAttention(readiness: PreflightResult | null, installing: boolean): boolean`. True when not installing and readiness has a blocker, or a blocking check that isn't `ok`. Task 13 widens it to any Setup row with tone `attention`.
  - `export function crashAlert(prev: { status: ServerStatus; alert: boolean }, next: { status: ServerStatus; place: Place }): boolean`. It turns on when status moves from active to `crashed`, turns off when `place === 'logs'`, and otherwise keeps its value.
- **`profileSummary.ts`:** `export function profileSummary(p: Profile): string`.
  - `android` → `Android · port 4723`
  - `ios` → `iPhone · port 4723`
  - `both` or unset → `Android and iPhone · port 4723`
- **`serverStatus.ts`:** `export const STATUS_WORD: Record<ServerStatus, string>` maps to `Stopped`, `Starting…`, `Running`, `Stopping…` and `Stopped unexpectedly`. Delete `statusBarLabel` and its tests along with `StatusBar`.
- **`preflightMessages.ts`:**
  - `export const portInUseMessage = (port: number) => \`Port ${port} is already in use by another app. Choose another port or close that app.\``
  - `export const NOT_INSTALLED_MESSAGE = "Run Set up first. Xenon isn't installed in the Appium folder this profile uses."`
- **Renamed strings:**
  - `readiness.ts`: "Press Re-check on the Health tab." → `Press Check again on Setup.`
  - `setupProgress.ts`: "See the steps on the Health tab." → `See the steps on Setup.`
  - go-ios remediation: "Run Set up on this tab." → `Run Set up again.`
  - The adb remediation's "(Secrets & Env)" → `(Settings, with technical details on: Environment variables)`.
  - The `SettingsForm` secret pointer's "Secrets & Env tab" → `Keys & accounts`.
- **Layout** (`AppShell`), from the top:
  - a skip link "Skip to content" to `<main id="content">`;
  - a sidebar `w-44`;
  - `ProfileSwitcher` (`data-testid="profile-switcher"`, Task 7 fills in its popover);
  - places as Radix `Tabs` with `orientation="vertical"`: icons `House`, `Wrench`, `SlidersHorizontal`, `ScrollText`, names Home, Setup, Settings, Logs. Setup gets a `Badge` "!" with `aria-label="Needs attention"` when `setupNeedsAttention`. Logs gets a dot with `aria-label="New problem"` when `crashAlert`.
  - **`SidebarStatus`** (`data-testid="sidebar-status"`):
    - It shows a dot icon and `STATUS_WORD`. Clicking it goes Home.
    - A compact Start (`start-button`) or Stop (`stop-button`) calls `requestStart` or `stop`.
    - `blockedReason` shows as `start-blocked-reason` text under the button and as the Start `title`.
    - `startError` shows in danger text.
    - An `aria-live="polite"` region announces `STATUS_WORD` changes.
- **Places until their PRs land:**
  - **Home:** the status word plus Part A's blocker list (`readiness-blockers`, when `showsBlockerList`).
  - **Setup:** `HealthPanel`, with an interim `plugin-version` line: `Xenon ${v} is installed` / `Xenon isn’t installed yet`.
  - **Settings:** a Server group (Port, base path, Appium folder `appium-home`, keep-alive; data keys `server.*`), then `SettingsForm`. A "Keys & accounts" tab holds `SecretsPanel` and `EnvVarsEditor`.
  - **Logs:** `LogConsole`.
- **`test/e2e/jargon.ts`:** `export function findJargon(text: string, optionKeys: string[]): string[]`. It returns every hit:
  - whole-word option keys that contain an upper-case letter;
  - `/\b[A-Z][A-Z0-9_]{3,}\b/` (skipping `HTTP`, `HTTPS`, `JSON`);
  - `/\b(npm|appium|brew) |xcode-select/`, case-sensitive, so "Appium" in a sentence passes;
  - absolute paths `/(?:^|[\s“"(])(?:~|\/)(?:[\w.-]+\/)+/` after removing `https?:\/\/\S+`.

  The e2e reads the text of `#root` after removing every `[data-raw]` subtree. `data-raw` marks text the app quotes rather than writes: log lines, Home's "Last message" quote, and technical-detail blocks. The rule judges the app's own words, not Appium's output.

- [ ] **Step 1: Write the failing tests.**
  - **`navigation`:** `crashAlert` turns on running → crashed, stays on while elsewhere, and turns off on logs. `setupNeedsAttention` is false while installing.
  - **`profileSummary`:** the three platforms.
  - **`serverStatus`:** every `STATUS_WORD`.
  - **Renamed strings:** update the pinned assertions in `readiness.spec.ts` and `setupProgress.spec.ts` to the new strings.
  - **`jargon.spec.ts`:**
    - `findJargon('Tests at the same time', ['maxSessions'])` → `[]`
    - `'maxSessions is 8'` → `['maxSessions']`
    - `'Set APPIUM_HOME'` → `['APPIUM_HOME']`
    - `'Run npm i -g appium'` → hits for both commands
    - `'Saved to /Users/qa/x/'` → one hit
    - `'http://localhost:4723/wd/hub'` → `[]`
  - **E2E**, migrating the suite per the table above, plus:
    - `'the sidebar shows the profile, places and status'`: the switcher says `Local server`; tabs Home, Setup, Settings and Logs; `sidebar-status` contains `Stopped`.
    - `'arrow keys move between places'`: focus the Home tab, `ArrowDown` → the Setup tab is selected.
    - `'skip to content'`: the first Tab focuses the skip link.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.** `npm test && npm run test:e2e`. Every Part A behaviour test passes on the new selectors.
- [ ] **Step 5: Commit.** `feat(mac-app): a slim sidebar with places, status and Start/Stop`.

### Task 7: Profile switcher, Profiles sheet and the export notice

**Files:**
- Create: `sheets/Profiles.tsx`, `src/renderer/src/exportNotice.ts`, `copy/profiles.ts`
- Modify:
  - `components/ProfileSwitcher.tsx`
  - `src/main/profileSecrets.ts`: `exportableProfile`
  - `src/main/index.ts`: the `profileExport` result
  - `src/preload/index.ts`
  - `hooks/useProfiles.ts`
- Test: `test/exportNotice.spec.ts`, `test/profileSecrets.spec.ts` (extend), e2e

**Interfaces:**
- `exportableProfile(profile)` returns `{ profile; strippedEnv: string[]; strippedSettings: string[] }`. `strippedSettings` holds the dotted paths it removed that carried a non-empty value, such as `geminiApiKey`, `cloud.apiKey` or `proxy.auth.password`.
- `profiles.export(id)` returns `{ saved: boolean; leftOut: string[] }`, where `leftOut = [...strippedEnv, ...strippedSettings]`. A cancel gives `{ saved: false, leftOut: [] }`.
- `exportNotice(leftOut: string[], technical: boolean): string | null`:
  - `[]` → `null`
  - 1 → `1 secret value was left out — enter it again after importing`
  - 3 → `3 secret values were left out — enter them again after importing`
  - With `technical`, it appends `: ` and the names joined by `, `.

  The sheet shows it as an info `Banner`.
- **Switcher popover:**
  - the profiles as a Radix `RadioGroup` (`aria-label="Profiles"`, so arrow keys move between them), each a radio (`data-testid="profile-option"`) with its name and `profileSummary`, checked on the current one;
  - then `New profile…` and `Manage profiles…`.
- **Profiles sheet** (`Sheet`, title "Profiles"):
  - **Rows** (`profile-row`) show name and summary, with Rename, Duplicate and Delete.
    - Rename shows the `profile-name` text field in the row; Enter or blur saves.
    - Delete asks `Delete “{name}”? Its settings can’t be recovered.`, with buttons `Delete` (danger, `Confirm delete` as its accessible name) and `Cancel`.
  - **Footer:** `Import…` and `Export…` (exports the current profile).
  - Today's rules on what can be deleted stay as they are.

- [ ] **Step 1: Write the failing tests.**
  - `exportNotice`: the four cases.
  - `exportableProfile`: a profile with `cloud.apiKey: 'k'` and `proxy.auth.password: 'p'` → `strippedSettings` is `['cloud.apiKey', 'proxy.auth.password']`. Empty values aren't listed.
  - **E2E**, migrated: create, rename, duplicate and delete through the switcher and sheet (Part A's tests at 125, 152, 169, 185 and 358). New:
    - `'the switcher lists profiles with a summary and switches'`;
    - `'File > Manage Profiles opens the sheet'`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(mac-app): a profile switcher and a Profiles sheet`.

### Task 8: Menus, menu-bar icon and Show technical details

**Files:**
- Modify:
  - `src/shared/types.ts`: `MenuAction`
  - `src/main/menu.ts`
  - `src/main/index.ts`: tray, menu rebuild on prefs
  - `AppShell.tsx`: action handling, ⌥⌘T
  - the interim Settings place: the switch at its bottom; base path, Appium folder, keep-alive, env vars, `preview-button` and Export config only with technical details
  - the interim Logs place: "Open log folder" only with technical details
- Test: `test/menu.spec.ts` (rewrite), e2e

**Interfaces:**
- `MenuAction` = `'new-profile' | 'import-profiles' | 'export-profile' | 'manage-profiles' | 'toggle-server' | 'open-dashboard' | 'launch-preview' | 'export-config' | 'place-home' | 'place-setup' | 'place-settings' | 'place-logs'`. Task 11 adds `'copy-test-address'`.
- **`buildMenuTemplate({ serverStatus, hasDashboard, technicalDetails, appearance, send, setPrefs })`:**
  - **File:** New Profile `Cmd+N`, Import Profiles…, Export Profile…, Manage Profiles….
  - **Server:**
    - Start Server / Stop Server `Cmd+Return` (Part A's labels).
    - Open Dashboard `Cmd+D`, enabled when `hasDashboard`.
    - When `technicalDetails`: a separator, Preview Launch… `Cmd+P` (enabled when not active) and Export Config….
  - **View:** Home `Cmd+1`, Setup `Cmd+2`, Settings `Cmd+3`, Logs `Cmd+4`, a separator, Appearance ▸, and Show Technical Details `Alt+Cmd+T`. The last is a checkbox checked by `technicalDetails`; its click calls `setPrefs({ technicalDetails: !technicalDetails })`.
- **`trayMenuTemplate({ serverStatus, hasDashboard, send, show, quit })`**, pure, in `menu.ts`:
  1. `trayStatusLabel(status)`, disabled.
  2. `Start Server` / `Stop Server`. It calls `show()` and then `send('toggle-server')`, so a blocked start is seen.
  3. Open Dashboard.
  4. `Show Xenon Control`.
  5. `Quit Xenon Control`.

  Task 11 inserts Copy Test Address after Open Dashboard.
- The Settings switch reads **Show technical details**, with the description `Option names, folders, commands and diagnostic lines`.

- [ ] **Step 1: Write the failing tests.**
  - **Menu:**
    - each label and accelerator above;
    - Preview Launch… and Export Config… absent when `technicalDetails` is false and present when true;
    - the Show Technical Details checkbox state and its `setPrefs` call;
    - `trayMenuTemplate` labels in order;
    - Start from the tray calls `show` before `send`.
  - **E2E:**
    - `'technical details reveal the Appium folder and launch preview'`: off → no `appium-home` or `preview-button`; ⌥⌘T via the menu → both visible.
    - Migrate Part A's preview tests (258, 265, 427, 440) and the Log Folder test (199) to turn technical details on first.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.** `npm test && npm run test:e2e`. Add a no-jargon check (`findJargon` → `[]`) for the Settings and Logs places with technical details off, and `expectAccessible` for the shell in both themes.
- [ ] **Step 5: Commit.** `feat(mac-app): menus and menu-bar icon for the new places; Show technical details`.

**Ship** with this live check:
- Sidebar, switcher popover, Profiles sheet and the export notice, in light and dark.
- ⌘1 to ⌘4 move between places, and ⌥⌘T toggles technical details.
- Start and Stop from the sidebar and the menu-bar icon on port 4799.

---

## Item B3 — Home (branch `feat/xenon-control-home`)

### Task 9: Addresses, the next free port and the last run (main)

**Files:**
- Create: `src/main/shareAddresses.ts`, `src/main/nextFreePort.ts`, `src/main/lastRun.ts`, `src/shared/links.ts`
- Modify:
  - `src/shared/types.ts`: `LastRun`
  - `src/shared/ipc.ts`: `shareAddresses: 'share:addresses'`, `shareCopy: 'share:copy'`, `nextFreePort: 'net:nextFreePort'`, `lastRun: 'server:lastRun'`, `openLink: 'app:openLink'`
  - `src/preload/index.ts`, `src/main/index.ts`
- Test: `test/shareAddresses.spec.ts`, `test/nextFreePort.spec.ts`, `test/lastRun.spec.ts`

**Interfaces:**
- `export function shareAddresses(server: Pick<Profile['server'], 'port' | 'basePath'>, hostname: string): { test: string; colleagues: string }`
  - **Base path:** `''` or `/` gives nothing. Otherwise it gets a leading `/` and loses a trailing `/`.
  - **Host:** lower-cased, with trailing dots and a final `.local` removed.
  - `test` = `http://localhost:${port}${base}`.
  - `colleagues` = `http://${host}.local:${port}${base}`.

  The IPC passes `os.hostname()`.
- `share:copy(text: string)` writes the clipboard in main (`clipboard.writeText`).
- `export async function nextFreePort(from: number, probe: (p: number) => Promise<boolean> = isPortInUse, tries = 50): Promise<number | null>`. It checks `from` to `from + tries - 1`, never above 65535, and returns the first port the probe reports free, or `null`.
- `export interface LastRun { endedAt: number; how: 'stopped' | 'crashed'; reason?: string }`
- `export function lastRunFrom(prev: ServerState, next: ServerState, now: number): { profileId: string; run: LastRun } | null`
  - It fires when `prev.status` is `starting`, `running` or `stopping`, `next.status` is `stopped` or `crashed`, and `prev.profileId` is set.
  - `reason` = `next.lastError ?? undefined`.

  Main stores runs in `electron-store` `last-runs`, keyed by profile id, and `server:lastRun(profileId)` returns `LastRun | null`.
- **`links.ts`:** `export const LINKS = { install: 'https://xenon-6e6.pages.dev/docs/xenon-control#what-you-need' } as const`. `app:openLink(name: keyof typeof LINKS)` opens only those names.

- [ ] **Step 1: Write the failing tests** (Review Focus 5):
  - **`shareAddresses`** with port 4723:
    - `''` → `http://localhost:4723`
    - `/` → `http://localhost:4723`
    - `/wd/hub` → `http://localhost:4723/wd/hub`
    - `/wd/hub/` → `http://localhost:4723/wd/hub`
    - `wd/hub` → `http://localhost:4723/wd/hub`
    - host `Lab-Mac.local` → colleagues `http://lab-mac.local:4723/wd/hub`
    - host `lab-mac` → the same
    - host `lab-mac.local.` → the same
  - **`nextFreePort`:**
    - a probe busy for 4724 and 4725 → 4726;
    - all 50 busy → `null`;
    - from 65530 it checks only up to 65535.
  - **`lastRunFrom`:**
    - running → stopped gives `how: 'stopped'`;
    - running → crashed gives `how: 'crashed'` and the reason;
    - stopped → stopped gives `null`;
    - starting → crashed gives `crashed`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement and wire.** Main records the last run in the supervisor's state listener (`index.ts`, near line 162).
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(mac-app): test addresses, next free port and last run for Home`.

### Task 10: `homeState` and `quickFix`

**Files:**
- Create: `src/renderer/src/homeState.ts`, `src/renderer/src/quickFix.ts`, `copy/home.ts`
- Test: `test/homeState.spec.ts`, `test/quickFix.spec.ts`

**Interfaces:**
- **`quickFix.ts`:**
  - `export type Blocker = { kind: 'port-in-use'; port: number } | { kind: 'not-installed' } | { kind: 'invalid'; issue: ValidationIssue; count: number } | { kind: 'runtime'; check: 'node' | 'appium' } | { kind: 'other'; reason: string }`
  - `export function blockerOf(readiness: PreflightResult | null, issues: ValidationIssue[], port: number): Blocker | null`. It decides in this order:
    1. issues → `invalid`;
    2. a blocker equal to `portInUseMessage(port)` → `port-in-use`;
    3. a blocker equal to `NOT_INSTALLED_MESSAGE` → `not-installed`;
    4. a blocking non-ok `node`/`appium` check → `runtime`;
    5. readiness not ok → `other` with `firstBlocker`;
    6. otherwise `null`.
  - `export type FixAction = { kind: 'set-port'; port: number } | { kind: 'setup' } | { kind: 'focus'; path: string } | { kind: 'link'; link: 'install' } | { kind: 'go'; place: Place }`
  - `export function quickFix(b: Blocker, ctx: { freePort: number | null }): { label: string; action: FixAction }`. Labels and actions per the spec's quick-fix table:
    - port in use with a free port → `Use port ${n}`; with no free port → `See Setup`;
    - not installed → `Set up this Mac`;
    - invalid → `Fix it`, focusing `issue.path`;
    - runtime → `How to install`, `link: 'install'`;
    - other → `See Setup`.
- **`homeState.ts`:**
  - `export type HomeKind = 'checking' | 'first-run' | 'setting-up' | 'cant-start' | 'ready' | 'starting' | 'running' | 'stopping' | 'crashed' | 'other-running'`
  - `export interface HomeAction { id: 'setup' | 'start' | 'stop' | 'open-dashboard' | 'try-again' | 'see-logs' | 'switch-profile' | 'quick-fix'; label: string }`
  - `export interface HomeView { kind: HomeKind; title: string; sentence?: string; detail?: string; primary?: HomeAction; secondary?: HomeAction; footer?: string; checklist?: { label: string; done: boolean }[]; blocker?: Blocker }`
  - `export interface HomeInput { server: ServerState; profile: Profile; profileName(id: string): string | null; readiness: PreflightResult | null; checking: boolean; installing: boolean; issues: ValidationIssue[]; lastRun: LastRun | null; lastProblem: string | null; now: number }`
  - `export function needsSetup(readiness: PreflightResult | null, profile: Profile): boolean`. It is true when the blockers include `NOT_INSTALLED_MESSAGE`, or when node and appium are ok but a driver the profile's platform needs is missing. A needed driver is missing when the `drivers` check's detail lacks `uiautomator2` for Android or `xcuitest` for iOS.
  - `export function homeState(i: HomeInput): HomeView`. The first matching state wins:

    | # | When | Kind | Title | Sentence and detail | Primary | Secondary | Footer / checklist |
    |---|---|---|---|---|---|---|---|
    | 1 | server active and `server.profileId !== profile.id` | `other-running` | `“${name}” is running` | `Only one profile runs at a time. Stop it to start this one.` | `Switch to it` | | |
    | 2 | `starting` | `starting` | `Starting…` | `Usually under 10 seconds.` | `Stop` | | |
    | 3 | `running` | `running` | `Running` | `runningFor(now - startedAt)` | `Open dashboard` | `Stop` | |
    | 4 | `stopping` | `stopping` | `Stopping — saving recordings and releasing phones…` | | | | |
    | 5 | `installing` | `setting-up` | `Setting up this Mac…` | | | | |
    | 6 | `crashed` and `server.profileId` is `profile.id` or null | `crashed` | `Xenon stopped unexpectedly` | sentence `crashReason(…)`; detail `Last message: “${lastProblem}”` (truncated to 120 characters with `…`, only when present) | `Start again` (`start`) | `See what happened` (`see-logs`) | |
    | 7 | `needsSetup` | `first-run` | `Let’s get this Mac ready` | `A one-time setup, about 2 minutes.` | `Set up this Mac` | | the checklist below |
    | 8 | `blockerOf` is non-null | `cant-start` | `Can’t start yet` | `blockedReason(decideStart(…))`, or the `firstBlocker` | `quick-fix` with the `quickFix` label | `Try again` | `Something else? See Setup for every check.` |
    | 9 | readiness null | `checking` | `Checking this Mac…` | | | | |
    | 10 | otherwise | `ready` | `Ready to start` | `readySummary(profile)` | `Start` | | `lastRunLine(lastRun, now)` |

    In row 1, `name` is `profileName(server.profileId)`.

    The first-run checklist lists Node.js, Appium, Xenon, then `Android support` when the platform isn't `ios` and `iPhone support` when it isn't `android`. Each item says whether it is done.
  - `export function runningFor(ms: number): string` → `for under a minute`, `for 5 min`, `for 1 h 12 min`.
  - `export function readySummary(p: Profile): string`. The phones are `Android phones and iPhones`, `Android phones` or `iPhones`. Then ` · this Mac only`, or ` · shared with ${hubHostname}` when `hub` is set.
  - `export function lastRunLine(run: LastRun | null, now: number): string | null`
    - The format is `Last run: ${day} ${HH:MM} · ${how}`.
    - `day` is `today`, `yesterday`, or `D Mon` from a fixed English month list (`3 Oct`).
    - `how` is `stopped normally` or `stopped unexpectedly`.
  - `export function crashReason(server: ServerState, lastProblem: string | null, port: number): string`. It looks at `lastProblem ?? server.lastError`:
    - `/EADDRINUSE|address already in use/i` → `Port ${port} was taken by another app.`
    - `/unknown option|not a valid|invalid (plugin )?(arg|option|config)/i` → `Appium refused this profile’s settings.`
    - otherwise → `Appium closed on its own.` With technical details on, Home also shows `server.lastError` in a `data-raw` block.

  The `checking` and `other-running` states are additions the spec doesn't cover (Review Focus 1). Their copy is final as written here.

- [ ] **Step 1: Write the failing tests:**
  - every row of the table, with exact strings;
  - the precedence pairs: `crashed` beats `first-run`; `installing` beats `crashed`; `other-running` beats everything;
  - `needsSetup` for an Android-only profile missing only `xcuitest` → `false`;
  - each `quickFix` row, including port in use with `freePort: null`;
  - `blockerOf` precedence (invalid over port in use);
  - `runningFor(59_000)`, `runningFor(300_000)` and `runningFor(4_320_000)`;
  - `lastRunLine` today, yesterday and older, at a fixed `now`;
  - `crashReason` for each pattern, and `Appium exited with code SIGKILL` → `Appium closed on its own.`;
  - a crash with `lastProblem: null` has no `detail`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.** All strings come from `copy/home.ts`.
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(mac-app): a Home model that knows what to say and what to offer`.

### Task 11: The Home screen, Copy Test Address and the Part C slots

**Files:**
- Create:
  - `screens/Home.tsx`
  - `components/AddressCard.tsx`
  - `components/slots/HomeLiveStrip.tsx`, `components/slots/FirstSignInCard.tsx`. Both render `null`.
- Modify:
  - `AppShell.tsx`: Home replaces its interim version. `See what happened` goes to Logs; Task 19 adds the jump to the line.
  - `src/shared/types.ts`: `MenuAction` += `'copy-test-address'`.
  - `menu.ts`: Server → Copy Test Address `Shift+Cmd+C`, and the tray item.
  - `hooks/useServer.ts`: last run fetched on status change.
- Test: e2e

**Interfaces:**
- Home renders `homeState`. The `Last message` quote is in mono inside a `data-raw` element.
  - The `checklist` and setup steps use A3's plain step rows (`stepLabel`, `rowState`, `rowDetail`) while installing.
  - The running state renders `HomeLiveStrip`, then `AddressCard`, then the primary button, then `FirstSignInCard`.
- **`AddressCard`:**
  - A label `Test address`, the address in mono, and `Copy` (`data-testid="copy-test-address"`).
  - Under it, `Colleagues on your network: ${colleagues}`, with `Copy` (`copy-colleague-address`).
  - Copying calls `share:copy` and toasts `Copied`.
- **Quick fix actions:**
  - `set-port`: `update` the profile's port, `flush()`, then `refreshNow()`.
  - `setup`: the existing `handleInstall`.
  - `focus`: `go('settings')` plus `focusSetting(path)`.
  - `link`: `app:openLink('install')`.
  - `go`: change place.
- **Copy Test Address** (menu, tray and ⇧⌘C) copies the running profile's address while the server is active, and the selected profile's otherwise (Review Focus 1).

- [ ] **Step 1: Write the failing e2e tests:**
  - `'Home is ready on a set-up Mac'`: title `Ready to start`; `Start` focusable.
  - `'a port in use offers Use port N and it works'`:
    - occupy the profile's port in the test process, so Home shows `Can’t start yet`;
    - click `Use port ${port+1}` (or the next free port);
    - Home shows `Ready to start`, and the Settings port shows the new value.
  - `'a profile without Xenon shows the first-run checklist'`:
    - set the Appium folder (technical details) to an empty temp dir;
    - the title is `Let’s get this Mac ready`, the `Xenon` item has `— not installed yet`, and `Set up this Mac` is visible.
  - `'running shows the test address and copies it'`:
    - start on `freePort`;
    - `copy-test-address` copies, then `app.evaluate(({ clipboard }) => clipboard.readText())` equals `http://localhost:${freePort}/wd/hub`.
  - `'a killed server shows Stopped unexpectedly'`:
    - start, then `process.kill(state.pid, 'SIGKILL')`;
    - Home shows `Xenon stopped unexpectedly` and `Start again`, and the Logs place shows its dot.
  - `'another profile running: Home says so and offers to switch'`:
    - start profile A, create and select profile B;
    - Home shows `“Local server” is running`;
    - `Switch to it` selects A;
    - ⇧⌘C (from B, before switching) copied A's address.
  - `'Home fits the smallest window'`: at 900 × 600 (`win.setSize` through `app.evaluate`), in the `ready` and `running` states, `main#content` has `scrollHeight <= clientHeight`.
  - `'keyboard only: launch to Start'`:
    - from launch, only `Tab` and `Enter` presses;
    - focus reaches Home's `Start`, `Enter` starts, and the status becomes `Running`.
  - For `ready`, `cant-start`, `first-run`, `running` and `crashed`:
    - `findJargon` → `[]` with technical details off;
    - `expectAccessible(page, 'home-<state>')` in light and dark.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.** `npm test && npm run test:e2e`.
- [ ] **Step 5: Commit.** `feat(mac-app): Home says if you can test now and offers the next step`.

**Ship** with this live check:
- Every Home state on port 4799, in light and dark: first run (fresh sandbox HOME), can't start (occupy 4799 with `python3 -m http.server 4799`, then Use port 4800), ready, starting, running, stopping, stopped unexpectedly (`kill -9` the Appium pid).
- Paste the copied address into `curl -s <address>/status`; it answers.

---

## Item B4 — Setup (branch `feat/xenon-control-setup-screen`)

### Task 12: `setupRows`, a plain sentence for every check

**Files:**
- Create: `src/renderer/src/setupRows.ts`, `copy/setup.ts`
- Modify:
  - `src/shared/types.ts`: `ToolCheck.code?: CheckCode`
  - `src/main/ToolchainInspector.ts` and `src/main/toolchainRules.ts` (`RuleVerdict.code`), so every returned check sets `code`
- Test: `test/setupRows.spec.ts`, `test/toolchainRules.spec.ts` (extend with codes)

**Interfaces:**
- `export type CheckCode = 'ok' | 'missing' | 'unsupported' | 'list-failed' | 'no-sdk-root' | 'not-needed' | 'stale'`
  - `node`: `missing`, or `unsupported` for a wrong version.
  - `appium`: `missing`, or `unsupported` when too old.
  - `drivers`: `missing` when Appium is absent, `list-failed`, or `ok`. The detail stays as it is, and the found drivers are read from it.
  - `adb`: `missing`, or `no-sdk-root`.
  - `xcode`: `missing`.
  - `go-ios`: `not-needed`, `missing`, `stale` or `ok`.
- `export interface SetupRow { id: string; group: 'mac' | 'xenon' | 'phones'; label: string; tone: 'ok' | 'attention' | 'info'; sentence: string; action?: { kind: 'setup' } | { kind: 'recheck' } | { kind: 'link'; link: 'install' }; technical: { detail: string; command?: string; remediation?: string } }`
- `export function setupRows(r: PreflightResult, profile: Profile, installedVersion: string | null | undefined): SetupRow[]`
  - Rows appear only for the phones the profile uses:
    - Android tools and Android support when the platform isn't `ios`;
    - Xcode, iOS support and iPhone support when it isn't `android`;
    - iPhone support only when `iosDeviceType` isn't `simulated`.
  - The `drivers` check becomes two rows, Android support (uiautomator2) and iOS support (xcuitest).
  - The plugin becomes the Xenon row.
  - `technical.detail` is the check's `detail`, and `technical.remediation` its `remediation`.

  | Row (group) | Outcome | Tone | Sentence | Action | Command |
  |---|---|---|---|---|---|
  | Node.js (mac) | ok | ok | `Node.js is ready.` | | |
  | Node.js (mac) | missing | attention | `Node.js isn’t installed on this Mac. Appium needs it.` | link | `brew install node@22` |
  | Node.js (mac) | unsupported | attention | `This Mac’s Node.js version doesn’t work with Appium 3.` | link | `brew install node@22` |
  | Appium (mac) | ok | ok | `Appium is ready.` | | |
  | Appium (mac) | missing | attention | `Appium isn’t installed on this Mac. Xenon needs Appium 3.1.1 or newer.` | link | `npm i -g appium` |
  | Appium (mac) | unsupported | attention | `This Mac’s Appium is too old. Xenon needs Appium 3.1.1 or newer.` | link | `npm i -g appium@latest` |
  | Android tools (mac) | ok | ok | `Android tools are ready.` | | |
  | Android tools (mac) | missing | attention | `Android tools aren’t installed. You need them only for Android phones on this Mac.` | link | |
  | Android tools (mac) | no-sdk-root | attention | `Android tools were found, but not where Xenon looks for them.` | link | |
  | Xcode (mac) | ok | ok | `Xcode is ready.` | | |
  | Xcode (mac) | missing | attention | `Xcode isn’t installed. You need it only for iPhones and simulators.` | link | `xcode-select --install` |
  | Xenon (xenon) | installed | ok | `Xenon ${v} is installed` | | |
  | Xenon (xenon) | not installed | attention | `Xenon isn’t installed yet` | setup | |
  | Android support (phones) | has uiautomator2 | ok | `Android support is installed.` | | |
  | Android support (phones) | lacks it | attention | `Android support isn’t installed yet.` | setup | `appium driver install uiautomator2` |
  | iOS support (phones) | has xcuitest | ok | `iOS support is installed.` | | |
  | iOS support (phones) | lacks it | attention | `iOS support isn’t installed yet.` | setup | `appium driver install xcuitest` |
  | Android/iOS support | list-failed | attention | `Couldn’t check which phone support is installed.` | recheck | |
  | Android/iOS support | Appium missing | info | `Needs Appium first.` | | |
  | iPhone support (phones) | ok | ok | `iPhone support is ready.` | | |
  | iPhone support (phones) | missing | attention | `iPhone support isn’t installed yet.` | setup | |
  | iPhone support (phones) | stale | attention | `iPhone support needs updating — Xenon was updated.` | setup | |

  `installedVersion === undefined` (still loading) gives the Xenon row tone `info` and the sentence `Checking Xenon…`.
- `export function checkedAgo(at: number, now: number): string` gives `Checked just now.` (under 60 s), `Checked 1 minute ago.`, `Checked ${n} minutes ago.`, `Checked 1 hour ago.` or `Checked ${n} hours ago.`

- [ ] **Step 1: Write the failing tests.**
  - One case per table row: tone, exact sentence, action and command.
  - Relevance: an `android` profile gets no Xcode, iOS or iPhone rows; `iosDeviceType: 'simulated'` gets no iPhone row.
  - The `code` of each `assessIphoneSupport` verdict.
  - `checkedAgo` at 0 s, 59 s, 60 s, 5 min and 2 h.
  - With technical details off, `findJargon` (from `test/e2e/jargon.ts`) on every sentence → `[]`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(mac-app): every Setup check in one plain sentence`.

### Task 13: The Setup screen

**Files:**
- Create: `screens/Setup.tsx`, `components/slots/SetupUpdateRow.tsx`, `components/slots/SetupHubRow.tsx` (both render `null`)
- Modify: `AppShell.tsx`, which mounts it; `navigation.ts`, where `setupNeedsAttention` becomes true for any `setupRows` row with tone `attention` (unit test: an iOS-only profile with no Android tools gets no badge)
- Delete: `components/HealthPanel.tsx`
- Test: e2e

**Interfaces:**
- **Header:** `Setup`, with a `Check again` button that bumps the recheck tick. Under it, `Everything this Mac needs to run tests. ${checkedAgo}` (the time of the last completed check).
- **Groups:** `This Mac`, `Xenon` (its rows, then `SetupUpdateRow` and `SetupHubRow`) and `Phones`, as `Group`s of `StatusRow`s. Each row is `data-testid="setup-row-<id>"`, and the Xenon row is also `plugin-version`.
- **Row actions:**
  - `setup` runs Set up;
  - `recheck` re-checks;
  - `link` shows `How to install`.
- **With technical details on**, each row also shows:
  - its detail and the remediation, in mono;
  - the command with `Copy` (`share:copy`);
  - the resolved Appium folder with its source.
- **Set up button:**
  - `Set up this Mac`, with the hint `Installs or updates whatever is missing.`, under the groups.
  - Its A3 step rows and summary appear inline beneath it.
  - It is disabled while the server runs, with A3's hint text.

- [ ] **Step 1: Write the failing e2e tests:**
  - `'Setup lists plain checks'`: `setup-row-node` and `setup-row-appium` contain `is ready.`
  - `'technical details show a row's command with Copy, and the Android folder'`: replaces Part A's 475, now with technical details on.
  - Migrate Part A's 463, 490, 517 and 545 to Setup's selectors. `plugin-version` stands in for the old footer.
  - `findJargon` → `[]` with technical details off, and `expectAccessible` in both themes.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(mac-app): Setup in three plain checklists`.

**Ship** with this live check:
- Setup in light and dark, with technical details off and on.
- With the fresh sandbox HOME, `Set up this Mac` installs Xenon into the sandbox Appium folder, showing its steps inline.

---

## Item B5 — Settings (branch `feat/xenon-control-settings`)

### Task 14: The Cloud key and the proxy password move into the Keychain

**Files:**
- Create: `src/main/proxyEnv.ts`
- Modify:
  - `src/shared/types.ts`: `SecretKey` += `'CLOUD_KEY' | 'PROXY_PASSWORD'`
  - `src/shared/secrets.ts`: descriptors
  - `src/main/profileSecrets.ts`: migration
  - `src/main/LaunchBuilder.ts`
- Test: `test/profileSecrets.spec.ts`, `test/LaunchBuilder.spec.ts`, `test/proxyEnv.spec.ts`

**Interfaces:**
- **Descriptors:**
  - `{ key: 'CLOUD_KEY', label: 'Cloud access key', description: 'The cloud provider key Xenon passes as CLOUD_KEY.' }`
  - `{ key: 'PROXY_PASSWORD', label: 'Proxy password', description: 'The password for the proxy in this profile’s proxy settings.' }`

  These descriptions are technical text, shown only with technical details on. Task 17 has the plain wording.
- **`proxyEnv.ts`:**
  - `export function proxyUrl(proxy: unknown, password: string): string | null`
    - It returns null unless `proxy` is an object with a string `host` and a string `auth.username`.
    - Otherwise it gives `${protocol ?? 'http'}://${enc(username)}:${enc(password)}@${host}${port ? ':' + port : ''}`, where `enc` is `encodeURIComponent`.
- **`moveSecretsToKeychain`** also moves:
  - `settings.cloud.apiKey` to `CLOUD_KEY`;
  - `settings.proxy.auth.password` to `PROXY_PASSWORD`.

  It follows the same rules as the settings in `SECRET_SETTINGS`:
  - The Keychain value wins when one is stored.
  - A store happens only when `safeToStore`.
  - When a value is moved, the key is added to the profile's `secretRefs` and the property is removed.
- **`buildLaunchPlan` and `buildConfigYaml`:**
  - `cloud.apiKey` is never written to the config.
  - `cloud.username` is removed from the config. When it is set, it goes to env `CLOUD_USERNAME`.
  - `CLOUD_KEY` is injected like any secret in `secretRefs`.
  - **The proxy password.** Suppose `PROXY_PASSWORD` is in `secretRefs`, has a value, and `proxyUrl(settings.proxy, value)` isn't null. Then the config has no `proxy`, and env `HTTP_PROXY` and `HTTPS_PROXY` both get that URL. They win over the same names in the profile's env.
  - `PROXY_PASSWORD` itself is never put in the env.
  - A proxy without a stored password stays a `proxy` option as it is today.

- [ ] **Step 1: Write the failing tests.**
  - **`proxyUrl`:**
    - `{ host: 'squid.lab', port: 3128, auth: { username: 'qa' } }` with `p@ss:w/rd` → `http://qa:p%40ss%3Aw%2Frd@squid.lab:3128`;
    - with `protocol: 'https'` → it starts with `https://`;
    - no host → `null`;
    - no username → `null`.
  - **Migration:**
    - `cloud.apiKey: 'k'` → the vault holds `CLOUD_KEY = 'k'`, `secretRefs` contains `CLOUD_KEY`, and `cloud` has no `apiKey` left;
    - the same for `proxy.auth.password`;
    - a different value already in the Keychain → the profile's value is dropped and the stored one kept;
    - two profiles with different keys → only the first is stored, and the second keeps its value, as `safeToStore` decides.
  - **Launch:**
    - the YAML has no `apiKey`, `password` or `username` under `cloud`/`proxy`;
    - env has `CLOUD_KEY`, `CLOUD_USERNAME`, `HTTP_PROXY` and `HTTPS_PROXY`, and no `PROXY_PASSWORD`;
    - a proxy without a password keeps `proxy` in the YAML;
    - `envKeys` lists the names without values.
  - **Schema pin:** `resources/schema.json` `properties.cloud` has no `$ref` and no `required`, so Appium doesn't demand `apiKey`.
  - **Exports:** `profileExportJson` contains neither value.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.** `npm test`.
- [ ] **Step 5: Commit.** `fix(mac-app): the cloud key and proxy password live in the Keychain, not in files`.

### Task 15: The `essentials` catalog

**Files:**
- Create: `src/renderer/src/essentials.ts`, `copy/settings.ts`
- Test: `test/essentials.spec.ts`

**Interfaces:**
- `export type EssentialGroup = 'Phones' | 'Tests' | 'Recording & history' | 'Sharing & sign-in' | 'AI help'`
- `export type EssentialControl = { kind: 'segmented'; options: { value: string; label: string }[] } | { kind: 'switch' } | { kind: 'number'; unit: NumberUnit; min?: number; max?: number; step?: number; integer?: boolean; suffix?: string } | { kind: 'text'; placeholder?: string } | { kind: 'secret'; secret: SecretKey }`
- `export interface EssentialCtx { defaults: Record<string, unknown>; hubOpen: boolean; secretsSaved: Partial<Record<SecretKey, boolean>> }`. The defaults are the effective schema's property defaults; `secretsSaved` comes from `secrets.status`.
- `export interface EssentialRow { id: string; group: EssentialGroup; label: string; help?: string; optionKey: string; control: EssentialControl; when?(p: Profile, ctx: EssentialCtx): boolean; read(p: Profile, ctx: EssentialCtx): unknown; write(p: Profile, value: unknown): Profile }`
- `export const ESSENTIALS: readonly EssentialRow[]`, in the spec's order.
  - **The ids** are `platform`, `androidDeviceType`, `bootedEmulators`, `iosDeviceType`, `bootedSimulators`, `maxSessions`, `port`, `deviceAvailabilityTimeoutMs`, `enableDashboard`, `buildCleanupDays`, `signIn`, `hub`, `hubAddress`, `hubAccessKey`, `hubToken`, `enableSelfHealing`, `aiProvider`, `geminiKey`, `openaiKey`, `anthropicKey` and `aiBaseUrl`.
  - **Labels** are from the spec table. `enableDashboard` has help `video, steps and logs, in the dashboard`. The key labels are `Gemini key`, `OpenAI key` and `Claude key`, then `Ollama address`, `Hub address`, `Access key` and `Token`.
  - **Segmented values:**
    - `platform`: android `Android`, ios `iPhone`, both `Both`.
    - `androidDeviceType`: real `Real phones`, simulated `Emulators`, both `Both`.
    - `iosDeviceType`: real `Real iPhones`, simulated `Simulators`, both `Both`.
    - `aiProvider`: gemini `Gemini`, openai `OpenAI`, anthropic `Claude`, ollama `Ollama`.
  - **Number controls:**
    - `maxSessions`: integer, 1 to 99.
    - `port`: integer, 1 to 65535. It reads and writes `server.port`.
    - `deviceAvailabilityTimeoutMs`: `minutes-from-ms`, step 0.5, suffix `min`.
    - `buildCleanupDays`: integer, minimum 1, suffix `days`.
  - **When rules:**
    - `androidDeviceType` when the platform isn't `ios`.
    - `bootedEmulators` when the platform isn't `ios` and `androidDeviceType` isn't `real`.
    - `iosDeviceType` when the platform isn't `android`.
    - `bootedSimulators` when the platform isn't `android` and `iosDeviceType` isn't `real`.
    - `hubAddress`, `hubAccessKey` and `hubToken` when the `hub` row reads on.
    - `aiProvider` when self-healing is on.
    - Each key row when its provider is selected (unset means `gemini`, Xenon's default).
    - `aiBaseUrl` when `ollama` is selected.
  - **Reads:**
    - An unset option reads its `ctx.defaults` value. `platform` falls back to `both`.
    - Reading never writes.
  - **Writes:**
    - Number `undefined` deletes the key.
    - `signIn`: `true` deletes `authDisabled` and `false` sets it to `true`. It reads as `!(authDisabled ?? false)`.
    - `hub` reads as `(typeof hub === 'string' && hub !== '') || ctx.hubOpen`. Writing `false` deletes `hub` and leaves `secretRefs` alone. Writing `true` returns the profile unchanged, and the screen sets `hubOpen`.
    - `hubAddress` writes the trimmed text, or deletes `hub` when it is empty. Validation is Part A's hub-origin rule.
    - **Secret rows:** `read` gives `{ saved: boolean; used: boolean }`, from `ctx.secretsSaved` and `secretRefs`. `write(p, true)` adds the key to `secretRefs`. Saving the value itself is the screen's job, through `secrets.set`.
- `export function visibleRows(p: Profile, ctx: EssentialCtx): EssentialRow[]`
- `export function dashboardCanOverride(description: string | undefined): boolean` → `/dashboard/i.test(d) && /replaces this one/i.test(d)`

- [ ] **Step 1: Write the failing tests:**
  - for every row, `read` then `write` round-trips its option;
  - `deviceAvailabilityTimeoutMs` reads `300000` (the default) as 300000, and Review Focus 3 through `toDisplay`;
  - `signIn` inverts;
  - the `hub` cases (Review Focus 4):
    - on with `hubOpen: false` and no hub → reads `false`;
    - `write(true)` leaves the profile deep-equal;
    - an empty `hubAddress` deletes `hub` and never stores `''`;
    - `write(false)` keeps `secretRefs` containing the hub keys;
  - `visibleRows` for platform `android` has no iOS rows;
  - `androidDeviceType: 'real'` hides `bootedEmulators`;
  - self-healing off hides `aiProvider` and the keys;
  - an unset provider shows `geminiKey`;
  - `dashboardCanOverride` is true for the bundled `buildCleanupDays` and `aiProvider` descriptions, and false for `maxSessions`;
  - every label passes `findJargon` → `[]`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(mac-app): the Essentials catalog in plain words`.

### Task 16: `optionCatalog` and the All settings model

**Files:**
- Create: `src/renderer/src/optionCatalog.ts`, `src/renderer/src/allSettings.ts`
- Modify: `src/renderer/src/settingsFilter.ts`, which is replaced by `allSettings.ts`'s search; delete it and its test
- Test: `test/optionCatalog.spec.ts`, `test/allSettings.spec.ts`

**Interfaces:**
- `export type CatalogGroup = 'Phones' | 'Tests' | 'Recording & history' | 'Sharing & sign-in' | 'AI help' | 'Phone health' | 'Network' | 'Storage & logs' | 'More'`
- `export interface CatalogEntry { label: string; help: string; group: CatalogGroup }`
- `export const OPTION_CATALOG: Readonly<Record<string, CatalogEntry>>` has one entry for each of the 52 options in `resources/schema.json`, grouped as follows:

  | Group | Options |
  |---|---|
  | Phones | platform, androidDeviceType, iosDeviceType, simulators, emulators, bootedSimulators, bootedEmulators, adbRemote, derivedDataPath, skipChromeDownload |
  | Tests | maxSessions, deviceAvailabilityTimeoutMs, deviceAvailabilityQueryIntervalMs, newCommandTimeoutSec, autowait, sessionHeartbeatIntervalMs |
  | Recording & history | enableDashboard, buildCleanupDays, buildCleanupMaxCount, buildCleanupSchedule, deleteBuildAssets, recordingCleanupDays, recordingCleanupMaxCount, recordingFailedCleanupDays, maxConcurrentRecordings, recordingsAssetsPath, sessionMetrics, streaming |
  | Sharing & sign-in | authDisabled, hub, remoteMachineProxyIP, bindHostOrIp, sendNodeDevicesToHubIntervalMs, checkStaleDevicesIntervalMs |
  | AI help | enableSelfHealing, aiProvider, aiModel, aiBaseUrl, geminiApiKey, openaiApiKey, anthropicApiKey |
  | Phone health | healthCheckIntervalMs, healthCheckSchedule, checkBlockedDevicesIntervalMs, removeDevicesFromDatabaseBeforeRunningThePlugin |
  | Network | proxy, tlsRejectUnauthorized, interceptor, cloud |
  | Storage & logs | databaseProvider, databaseUrl, enableJsonLogging |

  - **Labels and help:** the implementer writes them under the copy rules. A label is a short noun phrase in sentence case. Help is one plain sentence that tells a tester what changes.
  - **Essentials options** use the same label as their Essentials row. For `authDisabled`, use `Ask people to sign in`, matching the inverted switch.
- `export function fallbackEntry(key: string, description: string | undefined): CatalogEntry`. Its label is `humanize(key)` from `src/shared/humanize.ts`, its help is the first sentence of `description` (or `''`), and its group is `More`.
- `export interface AllSettingsField extends FormField { entry: CatalogEntry; rawKey: string; overridable: boolean }`
- `export interface AllSettingsSection { group: CatalogGroup; fields: AllSettingsField[] }`
- `export function allSettingsSections(schema: XenonSchema, opts: { technical: boolean; query: string }): AllSettingsSection[]`
  - It builds the fields with Part A's `buildForm`, flattens them, drops retired keys (A5), attaches each entry (or fallback) and re-groups them in the `CatalogGroup` order above.
  - The query matches label and help without regard to case, and the raw key too when `technical` is on.
  - Empty groups are dropped.

- [ ] **Step 1: Write the failing tests.**
  - **Completeness:** every property of `resources/schema.json` has an entry with a non-empty label and help.
  - **No jargon:** `findJargon(label + ' ' + help, keys)` → `[]` for every entry.
  - **Matches Essentials:** each Essentials row's label equals its catalog label (the `port` row has no catalog entry).
  - **Fallback:** `fallbackEntry('fooBarMs', 'Does a thing. More text.')` → `{ label: 'Foo bar ms', help: 'Does a thing.', group: 'More' }`.
  - **An option the catalog doesn't know:** a schema with an extra `newThing` property → a `More` section containing it.
  - **Search:**
    - `query: 'sign in'` finds `authDisabled`;
    - `query: 'maxSessions'` finds nothing without technical details and finds it with them.
  - **Retired keys:** they don't appear.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(mac-app): a plain label and help line for every Xenon option`.

### Task 17: The Settings screens

**Files:**
- Create, in `screens/settings/`:
  - `Settings.tsx`: Tabs Essentials | All settings | Keys & accounts.
  - `Essentials.tsx`
  - `AllSettings.tsx`
  - `Technical.tsx`
  - `KeysAndAccounts.tsx`
  - `FieldEditor.tsx`, which holds `SettingsForm`'s per-kind editors.
- Create: `components/slots/ConnectAgentsGroup.tsx` (renders `null`), `copy/keys.ts`
- Modify: `AppShell.tsx`
- Delete: `components/SettingsForm.tsx`, `components/SecretsPanel.tsx`, `components/SettingsNav.tsx`
- Test: e2e

**Interfaces:**
- **Essentials:**
  - It renders `visibleRows` in `Group`s, using `Segmented`, `Switch`, `NumberField`, `TextField` and `SecretField`. Each row wrapper has `data-setting-key={optionKey}`.
  - Under a row it shows Part A's validation message, and `The dashboard can override this.` when `dashboardCanOverride` holds for that option's schema description.
  - With technical details on, each row also shows its raw name (mono) and Xenon's description.
  - **Saving a key** in a secret row calls `secrets.set`, then `write(p, true)`. That turns on "Used by this profile".
  - **Hub on** sets `hubOpen` and focuses Hub address.
  - At the bottom: `ConnectAgentsGroup`, then the **Show technical details** switch (Task 8's copy).
- **All settings:**
  - Search (`settings-search`, placeholder `Search settings`).
  - The sections from `allSettingsSections`, each field through `FieldEditor` with its catalog label and help. With technical details on, it also shows the raw key and description, and the `schema-source` line.
  - With technical details on, a **Technical** group at the end:
    - Base path;
    - Appium folder (`appium-home`; blank means automatic, with the placeholder `auto: <resolved>`);
    - Keep-alive timeout;
    - Environment variables (`EnvVarsEditor`, keeping A5's secret-name warning);
    - `Preview launch` (`preview-button`) and `Export config`.
- **Keys & accounts:** every `SecretKey` in this order: Gemini, OpenAI, Claude, hub access key, hub token, password-reset email, cloud access key, proxy password, then the database file (technical details only). Each has:
  - its plain label and purpose from `copy/keys.ts`;
  - `Saved` / `Not set`;
  - a `SecretField` with `Save`;
  - `Clear`, which confirms with `Clear the ${label}?` (buttons `Clear` / `Cancel`);
  - a `Used by this profile` `Switch` bound to `secretRefs`.
- **`copy/keys.ts`** gives these labels and purposes:

  | Secret | Label | Purpose |
  |---|---|---|
  | Gemini | `Gemini key` | `Lets AI repair broken element lookups with Gemini.` |
  | OpenAI | `OpenAI key` | `Lets AI repair broken element lookups with OpenAI.` |
  | Claude | `Claude key` | `Lets AI repair broken element lookups with Claude.` |
  | Hub access key | `Hub access key` | `Lets this Mac join a lab hub. Used with the hub token.` |
  | Hub token | `Hub token` | `Lets this Mac join a lab hub. Used with the access key.` |
  | SMTP | `Email for password resets` | `Sends password-reset emails to people who sign in.` |
  | Cloud | `Cloud access key` | `Lets Xenon use phones from your cloud provider.` |
  | Proxy | `Proxy password` | `The password for the proxy this server uses.` |
  | Database | `Database file` | `Where Xenon keeps its data.` |

- [ ] **Step 1: Write the failing e2e tests** (migrating Part A's 94, 111, 206, 222, 241, 378, 401, 412 and 449 into the right tabs):
  - `'Essentials shows the everyday options in plain words'`.
  - `'choosing Android hides the iPhone rows'`.
  - `'wait for a free phone is in minutes and saves milliseconds'`: type `2.5` and blur; `window.xenon.profiles.list()` shows `deviceAvailabilityTimeoutMs: 150000`.
  - `'Ask people to sign in writes authDisabled'`: off → `authDisabled: true`.
  - `'the hub switch reveals address and keys, and off keeps the keys'`.
  - `'saving a Gemini key turns Used by this profile on'`.
  - `'All settings search finds by label, and by raw name only with technical details'`.
  - `'technical details show raw names in Essentials'`: `maxSessions` is visible.
  - For each of the three tabs: `findJargon` → `[]` with technical details off, and `expectAccessible` in both themes.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.** `npm test && npm run test:e2e`.
- [ ] **Step 5: Commit.** `feat(mac-app): Settings as Essentials, All settings and Keys & accounts`.

**Ship** with these live checks:
- Every Settings tab in light and dark, with technical details off and on.
- **Proxy check** (spec section 5):
  1. Run a local recording proxy in the scratchpad: `live/proxy.cjs`, a Node `http` server on 127.0.0.1:3128. It logs each request's `Proxy-Authorization` and answers 502.
  2. In the sandbox profile, set the proxy to `{ host: '127.0.0.1', port: 3128, auth: { username: 'qa' } }`, save `PROXY_PASSWORD = p@ss:w/rd` in Keys & accounts and turn on Used by this profile. Set `hub` to `http://<this Mac's hostname>.local:5999`, which is not loopback, so Xenon's hub calls take the proxy.
  3. Start on port 4799.
  4. **Pass:** within 60 s the proxy logs a request whose header decodes to `qa:p@ss:w/rd`. The generated config file contains no `proxy` and no password.
  5. **Fail:** follow the spec's fallback. Keep the password in the `proxy` option, show the note `The proxy password is kept in this profile’s settings file.` under Proxy password, and record in the ledger that Goal 4 is unmet for the proxy.

---

## Item B6 — Logs (branch `feat/xenon-control-logs`)

### Task 18: The log model

**Files:**
- Create: `src/renderer/src/logView.ts`, `copy/logs.ts`
- Modify:
  - `src/shared/types.ts`: `LogLine.always?: boolean`
  - `src/main/ProcessSupervisor.ts`: the `StopEscalator` log, `Process exited` and `Process error` lines get `always: true`
  - `src/main/index.ts`: `logs:saveAs`
  - `src/shared/ipc.ts`, `src/preload/index.ts`
- Test: `test/logView.spec.ts`, `test/processSupervisor.spec.ts` (extend)

**Interfaces:**
- `export type LogLevel = 'error' | 'warn' | 'info'`
- `export function lineLevel(l: LogLine): LogLevel`
  - `/\b(error|fatal|uncaught|exception|EADDRINUSE)\b/i` → `error`;
  - `/\b(warn|warning|deprecated)\b/i` → `warn`;
  - otherwise `info`, whatever the stream.
- `export function visibleLines(lines: UiLogLine[], o: { show: 'everything' | 'problems'; technical: boolean; query: string }): UiLogLine[]`
  - `system` lines without `always` are hidden unless `technical`.
  - `problems` keeps only `warn` and `error`.
  - The query is a case-insensitive substring.
- `export function formatTime(ts: number): string` → local `HH:MM:SS`.
- `export function lastProblemLine(lines: UiLogLine[]): UiLogLine | null`. It returns the last `error` line, else the last `stderr` line, else `null`. Home's `lastProblem` is its `text`.
- `export function logsAsText(lines: UiLogLine[]): string` → `${formatTime(ts)} ${text}` lines joined by `\n`.
- `logs:saveAs(text: string)` opens a save dialog, with the default name `xenon-log-YYYY-MM-DD-HHMM.txt`, and returns `boolean`.

- [ ] **Step 1: Write the failing tests:**
  - each level pattern;
  - `Launching: …` hidden without technical details and shown with them;
  - a `system` line with `always` always shown;
  - problems filtering;
  - query;
  - `formatTime` at a fixed local time;
  - `lastProblemLine` preferring an error over a later stderr line;
  - the supervisor marks the exit line `always`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(mac-app): a log model with problems, times and system lines`.

### Task 19: The Logs screen, and jumping to the crash line

**Files:**
- Create: `screens/Logs.tsx`
- Modify:
  - `AppShell.tsx`: `logsFocus: { lineId: number } | null`, set by Home's `See what happened`.
  - `screens/Home.tsx`: it passes `lastProblemLine(logs)?.text` and the line id.
- Delete: `components/LogConsole.tsx`
- Test: e2e

**Interfaces:**
- **Toolbar:**
  - `Show`: a `Segmented` with Everything / Problems only;
  - search (`placeholder="Search logs"`);
  - `Copy` (all visible lines through `share:copy`; toast `Copied`);
  - `Save as…`;
  - `Clear`;
  - with technical details on, `Open log folder`.
- A `${n} lines` count stays.
- **Rows:** time, an icon for warn/error (`TriangleAlert` / `CircleX`, with `aria-label` `Warning` / `Error`), and the ANSI-parsed text in mono. Rows keep the `log-row` class.
- **Empty:** `No output yet…` and the `Start server` link through `requestStart` (Part A's 344).
- **With `logsFocus`**, Logs opens on Problems only, scrolls the line into view and briefly highlights it (no motion when reduced motion is on).

- [ ] **Step 1: Write the failing e2e tests** (migrating Part A's 199, 344 and 371):
  - `'Problems only hides ordinary lines'`.
  - `'system lines show only with technical details'`: after a start, `Launching:` is absent, then present with technical details on.
  - `'See what happened opens Problems only at the crash line'`: kill the server as in Task 11, click `See what happened`; `Problems only` is checked and the quoted line is in view.
  - `'Copy copies the visible lines'`: the clipboard holds `HH:MM:SS` lines.
  - `findJargon` → `[]` for the Logs chrome with technical details off (log rows are `data-raw`); `expectAccessible` in both themes.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(mac-app): Logs with problems only, times, copy and save`.

**Ship** with this live check:
- Logs in light and dark, with technical details off and on.
- Kill the 4799 server, then follow See what happened from Home.
- Save as… writes a file with times.

---

## Item B7 — Release 0.3.0 (branch `chore/xenon-control-0.3.0`)

### Task 20: Docs, version and release build

**Files:**
- Modify: `mac-app/package.json` and `package-lock.json` (version), `mac-app/README.md`, `website/docs/xenon-control.md`, `CHANGELOG.md`
- Create: `website/static/img/xenon-control/{home,setup,settings,logs}-{light,dark}.png`

- [ ] **Step 1: Bump the version.** `cd mac-app && npm version 0.3.0 --no-git-tag-version`.
- [ ] **Step 2: Take the screenshots** with the live script on the sandbox profile (port 4799). Use Home running, Setup, Settings → Essentials and Logs, each in light and dark, 1120 × 760.
- [ ] **Step 3: Rewrite `website/docs/xenon-control.md`** for the new app. Keep its sections ("What you need" keeps its anchor, which `LINKS.install` points to), and cover:
  - the sidebar and places;
  - Home's states and quick fixes;
  - Setup;
  - Essentials, All settings and Keys & accounts, including the Cloud access key and proxy password living in the Keychain;
  - Logs;
  - Profiles;
  - Show technical details, with where Port, the Appium folder, launch preview and export config now live;
  - Appearance.

  Add the screenshots. Update `mac-app/README.md` the same way, briefly, and add a `CHANGELOG.md` entry for Xenon Control 0.3.0.
- [ ] **Step 4: Run the checks.** `npm test && npm run typecheck && npm run build && npm run sync:tokens:check && npm run test:e2e`. All pass.
- [ ] **Step 5: Commit.** `chore(mac-app): 0.3.0 — docs and screenshots for the redesign`.
- [ ] **Step 6: Ship, but don't merge.**
  - Run the per-PR procedure up to the PR with green checks.
  - Build the release locally with `npm run dist`.
  - Hand the user the DMG and zip paths, and the release checklist:
    1. a VoiceOver pass on Home, Setup and Settings (spec section 5);
    2. a Finder smoke test of the DMG;
    3. publish the release, then merge the PR.
