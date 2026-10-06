# Xenon Control — Safe and Current (Part A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Xenon Control (`mac-app/`) safe and in step with Xenon 2.17. Secrets stay out of logs, Xenon gets to shut down cleanly, iPhones get set up, the option list follows the installed plugin, Start can be trusted, and setup installs where it says. Ship 0.2.0.

**Architecture:** An Electron main process (`src/main`) owns the child process, the toolchain checks and setup. A React renderer (`src/renderer/src`) owns the UI. They talk through typed IPC (`src/shared/ipc.ts`, `src/preload/index.ts`). Every behaviour change goes into a small **pure** module with vitest tests. Electron and React files only wire those modules in.

**Tech Stack:** Electron 3x + electron-vite, React 18, Tailwind, TypeScript, vitest (node env), Playwright `_electron` e2e, js-yaml.

**Spec:** `docs/superpowers/specs/2026-10-06-xenon-control-safe-and-current-design.md`

## Global Constraints

- Work only in `mac-app/`, plus `website/docs/xenon-control.md`, root `CHANGELOG.md` and `.github/workflows/mac-app.yml` (A8).
- `src/shared/**` must not import Node or Electron (the renderer bundles it).
- Unit tests live at `mac-app/test/<name>.spec.ts`, run in the vitest node environment, and import with relative paths (`../src/...`), as the existing specs do. There is no React testing library: anything React-side that needs a test goes into a pure `.ts` module first.
- **Copy rule (QA-tester audience):** user-facing text added or changed here never contains option keys, env-var names, CLI commands, `APPIUM_HOME`, `WDA` or signal names in its main sentence. Paths and versions go in a check's `detail`.
- Exact copy in this plan and the spec is final. Use it verbatim.
- The `bootedSimulators: true` profile default does not change.
- Node range stays `^20.19 || ^22.12 || >=24`. The Appium floor becomes `3.1.1`.
- Each PR item gets its own branch off the latest `origin/main`, then one PR. No attribution lines in commits or PRs.

### Per-PR shipping procedure (referenced by every item as "Ship")

1. `cd mac-app && npm test && npm run typecheck && npm run build`. All pass.
2. `npm run test:e2e`. It needs this Mac's real toolchain: Appium and the Xenon plugin installed. All pass.
3. Live check in the built app, using the steps listed under the item. Capture before/after evidence (screenshots or log excerpts) for the PR body.
4. `git push -u origin <branch>`, then `gh pr create --base main` with a summary, the spec section, and the evidence.
5. Merge only on green (`gh pr checks <n> --watch`, then `gh pr merge --merge --delete-branch`). Sync `main` before starting the next item.

### Workspace setup (once per branch)

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git fetch origin
git worktree add .claude/worktrees/<branch-slug> -b <branch> origin/main
cd .claude/worktrees/<branch-slug>/mac-app && npm ci
```

## Review Focus

1. **Stop or Quit while already stopping, or while still starting.** A second request must neither restart the timers nor send SIGINT again. Quitting during a Stop waits for that same Stop. *(Pinned in Task 2 and Task 3.)*
2. **The installed plugin is a symlink to a source checkout** (`--source=local`), or its `appium.schema` is missing, `"./schema.json"`, or points at a non-object. Reading must follow the symlink, accept `./`, and fall back to the bundled list otherwise. *(Pinned in Task 8.)*
3. **Export env values that aren't URLs**, such as `NO_PROXY=localhost,127.0.0.1` or a malformed `http://a b@c`, must pass through unchanged without throwing. *(Pinned in Task 12.)*
4. **Readiness re-checking on window focus must not flicker Start off.** While a newer check runs, the previous result for that profile stays in force. *(Pinned in Task 15.)*
5. **A hub address with only a trailing slash** (`http://hub-mac:4723/`) is an origin and must pass, while `/wd/hub`, `?x=1` and `#a` fail. *(Pinned in Task 11.)*

---

## Item 0 — Spec and plan PR

### Task 0: Publish the docs

- [ ] **Step 1:** In worktree `.claude/worktrees/xenon-control-a` (branch `docs/xenon-control-safe-and-current`), commit the spec edits and this plan: `git add docs/superpowers && git commit -m "docs: plan for Xenon Control safe-and-current (Part A)"`.
- [ ] **Step 2:** Push and open the PR "docs: Xenon Control safe-and-current spec + plan". Merge on green.

---

## Item A1 — Hide secrets in logs (branch `fix/xenon-control-log-filters`)

### Task 1: Always write Xenon's log filters

**Files:**
- Create: `mac-app/src/main/logFilters.ts`
- Modify: `mac-app/src/main/LaunchBuilder.ts` (`buildConfigYaml`, server block)
- Test: `mac-app/test/logFilters.spec.ts`

**Interfaces:**
- Produces: `export interface LogFilterRule { pattern: string; flags: string; replacer: string }` and `export const XENON_LOG_FILTERS: readonly LogFilterRule[]` in `logFilters.ts`.

- [ ] **Step 1: Write the failing tests** in `test/logFilters.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { XENON_LOG_FILTERS } from '../src/main/logFilters';
import { buildConfigYaml } from '../src/main/LaunchBuilder';
// makeProfile: copy the helper from test/LaunchBuilder.spec.ts

const docRules = () => {
  const md = readFileSync(resolve(__dirname, '../../website/docs/authentication.md'), 'utf8');
  const block = md.match(/```yaml\n(server:\n  log-filters:[\s\S]*?)```/)![1];
  return (yaml.load(block) as any).server['log-filters'];
};
const apply = (line: string) =>
  XENON_LOG_FILTERS.reduce((t, r) => t.replace(new RegExp(r.pattern, r.flags), r.replacer), line);

describe('XENON_LOG_FILTERS', () => {
  it('matches the rules documented in authentication.md', () => {
    expect(XENON_LOG_FILTERS).toEqual(docRules());
  });
  it('redacts a session token, a password, an apiKey and a lease token', () => {
    expect(apply('{"alwaysMatch":{"xe:token":"eyJhbGciOi.abc-123","platformName":"Android"}}'))
      .toBe('{"alwaysMatch":{"xe:token":"**REDACTED**","platformName":"Android"}}');
    expect(apply('{"email":"qa@lab.test","password":"s3cr\\"et!"}'))
      .toBe('{"email":"qa@lab.test","password":"**REDACTED**"}');
    expect(apply("cloud: { apiKey: 'k-123-xyz', url: 'https://x' }"))
      .toBe("cloud: { apiKey: '**REDACTED**', url: 'https://x' }");
    expect(apply('{"leaseToken":"lt_9f8e","udid":"emulator-5554"}'))
      .toBe('{"leaseToken":"**REDACTED**","udid":"emulator-5554"}');
  });
});

describe('buildConfigYaml log-filters', () => {
  it('writes both rules under server and they survive the YAML round trip', () => {
    const doc = yaml.load(buildConfigYaml(makeProfile())) as any;
    expect(doc.server['log-filters']).toEqual(XENON_LOG_FILTERS);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** `npx vitest run test/logFilters.spec.ts`. Expected: FAIL, cannot resolve `../src/main/logFilters`.
- [ ] **Step 3: Implement.**
  - Copy the two rules into `XENON_LOG_FILTERS` exactly as `authentication.md` gives them. Use plain strings with escaped backslashes; the first test is the oracle.
  - Add a comment linking to `website/docs/authentication.md` ("log-filters").
  - In `buildConfigYaml`, add `'log-filters': XENON_LOG_FILTERS` to `server`, after `'use-plugins'`.
- [ ] **Step 4: Run the tests again and confirm they pass.** `npx vitest run test/logFilters.spec.ts test/LaunchBuilder.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -am "fix(mac-app): always give Appium Xenon's log filters, so tokens and passwords stay out of logs"` (add the new files first).

**Ship** with this live check:
- Start a server and open a session with `xe:token` set (e.g. `curl` a `POST /wd/hub/session`).
- The Logs tab and the newest file under the app's logs folder show `**REDACTED**`, never the token.
- Launch Preview shows `log-filters`.

---

## Item A2 — Clean shutdown (branch `fix/xenon-control-clean-stop`)

### Task 2: Stop escalation with Xenon-sized waits

**Files:**
- Create: `mac-app/src/main/stopEscalation.ts`
- Modify: `mac-app/src/main/ProcessSupervisor.ts` (`STOP_GRACE_MS`, `stop()`, `exit` handler), `mac-app/src/renderer/src/serverStatus.ts`, `mac-app/src/renderer/src/components/StatusBar.tsx`
- Test: `mac-app/test/stopEscalation.spec.ts`

**Interfaces:**
- Produces, in `stopEscalation.ts`:
  - `export const STOP_GRACE_MS = 30_000`
  - `export const STOP_TERM_GRACE_MS = 5_000`
  - `export class StopEscalator { constructor(opts: { kill(signal: NodeJS.Signals): void; log(text: string): void; graceMs?: number; termGraceMs?: number }); begin(): void; exited(): void; force(): void; get active(): boolean }`
- Produces, in `ProcessSupervisor`:
  - `whenStopped(): Promise<void>`. It resolves when no child is running, at once if none.
  - `forceStop(): void`. It sends SIGKILL now if a child is running.
- Produces, in `serverStatus.ts`: `export const STATUS_HINT: Partial<Record<ServerStatus, string>> = { stopping: 'Saving recordings and releasing phones…' }`.

- [ ] **Step 1: Write the failing tests** with `vi.useFakeTimers()` and a `kill` spy:
  - `begin sends SIGINT once and logs "Stopping Xenon…"`
  - `no SIGTERM before 30 s; SIGTERM at 30 s with log "Xenon is taking longer than usual to stop…"`
  - `SIGKILL at 35 s with log "Forcing Xenon to stop."`
  - `exited() cancels pending escalation`: no signal after `exited()`, even after advancing 60 s.
  - `a second begin() while active sends nothing and does not reset timers`: SIGTERM still fires at 30 s from the *first* begin.
  - `force() sends SIGKILL immediately and cancels timers`.
  - `exited() before begin() is a no-op, and begin() after exited() starts a fresh escalation` (Review Focus 1).
- [ ] **Step 2: Run and confirm they fail.** `npx vitest run test/stopEscalation.spec.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement `StopEscalator`,** then wire it in:
  - In `ProcessSupervisor`, delete the local `STOP_GRACE_MS` and `stopTimer`.
  - `stop()` sets `status: 'stopping'` and calls `escalator.begin()`, with `kill` bound to the current child and `log` to `pushLog('system', …)`.
  - The `exit` handler calls `escalator.exited()` and resolves the waiters of `whenStopped()`.
  - Keep `killNow()` as it is for now; Task 3 replaces its use.
- [ ] **Step 4: Status copy.**
  - `StatusBar.tsx` drops its private `STATUS_META` and imports `STATUS_DOT` and `STATUS_LABEL` from `serverStatus.ts`.
  - Add `export function statusBarLabel(status: ServerStatus): string` to `serverStatus.ts`. It returns the label, or, when `STATUS_HINT` has an entry, the label without its trailing "…" + " — " + the hint with a lower-case first letter. StatusBar renders it; the sidebar card keeps `STATUS_LABEL`.
  - New `test/serverStatus.spec.ts`: `statusBarLabel('stopping') === 'Stopping — saving recordings and releasing phones…'` and `statusBarLabel('running') === 'Running'`.
- [ ] **Step 5: Run the tests and confirm they pass.** `npx vitest run test/stopEscalation.spec.ts test/serverStatus.spec.ts`. Expected: PASS.
- [ ] **Step 6: Commit.** `fix(mac-app): give Xenon 30 s to stop cleanly before escalating`.

### Task 3: Quit waits for a clean stop

**Files:**
- Create: `mac-app/src/main/quitFlow.ts`
- Modify: `mac-app/src/main/index.ts` (`before-quit` handler, around lines 435-438)
- Test: `mac-app/test/quitFlow.spec.ts`

**Interfaces:**
- Consumes: `supervisor.isActive()`, `supervisor.stop()`, `supervisor.whenStopped()`, `supervisor.forceStop()` (Task 2).
- Produces: `export type QuitDecision = 'quit' | 'stop-then-quit' | 'wait' | 'force-then-quit'` and `export function decideQuit(s: { serverActive: boolean; stopping: boolean; quitPending: boolean }): QuitDecision`.

- [ ] **Step 1: Write the failing tests:**
  - not active → `'quit'`
  - active, not stopping, no quit pending → `'stop-then-quit'`
  - active and stopping (a Stop already pressed), no quit pending → `'wait'` (Review Focus 1)
  - quit already pending (second ⌘Q) → `'force-then-quit'`, whether stopping or not
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement `decideQuit`, then wire `before-quit`.**
  - Keep a module-level `quitPending` flag.
  - For anything but `'quit'`, call `event.preventDefault()`, show and focus `mainWindow`, set `quitPending = true`, and act:
    - `'stop-then-quit'` → `supervisor.stop()`
    - `'wait'` → nothing new
    - `'force-then-quit'` → `supervisor.forceStop()`
  - Then `await supervisor.whenStopped()`, set a `readyToQuit` flag, and call `app.quit()`. `before-quit` returns early when `readyToQuit`.
  - `markQuitting()` still runs first.
  - Remove `killNow()` if it has no remaining callers.
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `fix(mac-app): quitting waits for Xenon to stop; a second ⌘Q forces it`.

**Ship** with these live checks:
1. Start, run one Android and one iPhone session, then press Stop. The Logs tab shows Xenon's drain and teardown. The status bar shows the stopping text. Afterwards `pgrep -fl "goIOS/ios"` and `pgrep -fl "adb.*logcat"` show nothing from that run.
2. Start, then press ⌘Q. The window stays up until Xenon has stopped, then the app quits.
3. Start, press ⌘Q twice. The app quits within a few seconds.

---

## Item A7 — Install where it says (branch `fix/xenon-control-setup-home`)

### Task 4: Setup resolves the Appium folder like everything else

**Files:**
- Create: `mac-app/src/main/setupRequest.ts`
- Modify:
  - `mac-app/src/main/index.ts`: the `IPC.setupInstall` handler, and `IPC.resolvedAppiumHome`, which adds `display`.
  - `mac-app/src/preload/index.ts`: `setup.install` and `server.resolvedAppiumHome` types.
  - `mac-app/src/renderer/src/App.tsx`: `handleInstall`, and pass `appiumHomeDisplay` to `HealthPanel`.
  - `mac-app/src/renderer/src/components/HealthPanel.tsx`: the Set up card copy.
  - `mac-app/src/shared/paths.ts`: create it.
- Test: `mac-app/test/setupRequest.spec.ts`

**Interfaces:**
- Produces, in `setupRequest.ts`:
  - `export interface SetupRequest { profile: Profile; pluginSource?: 'local' | 'npm'; drivers?: Array<'uiautomator2' | 'xcuitest'> }`
  - `export function toSetupOptions(req: SetupRequest, resolveHome: (p: Profile) => string): SetupOptions`. Defaults: `pluginSource: 'local'`, `drivers: ['uiautomator2', 'xcuitest']`.
- Produces, in `src/shared/paths.ts`: `export function tildify(p: string, home: string): string`. It replaces a leading `home` with `~`.
- Preload `setup.install(req: { profile: Profile; pluginSource?; drivers? }): Promise<SetupResult>`, with `SetupResult` added in Task 5. Until then, `Promise<boolean>`.
- `server.resolvedAppiumHome(p)` returns `{ path: string; source: string; display: string }`.

- [ ] **Step 1: Write the failing tests:**
  - `toSetupOptions` passes the profile to `resolveHome` and uses its return value, for a blank field (stub returns `/auto/home`), an explicit field (stub returns `/explicit`), and a profile whose `appiumHome` is whitespace.
  - The defaults apply.
  - `tildify('/Users/qa/.appium', '/Users/qa') === '~/.appium'`, and `tildify('/opt/x', '/Users/qa') === '/opt/x'`.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement and wire.**
  - The handler becomes `(_e, req: SetupRequest) => setupService.install(toSetupOptions(req, resolveAppiumHome))`, keeping the existing `invalidateAppiumHome(); await warmAppiumHome();` after it.
  - `handleInstall` sends `{ profile: draft, pluginSource: 'local', drivers: ['uiautomator2', 'xcuitest'] }`.
  - The Set up card text becomes `Installs into the Appium folder this profile uses: {display}.`
- [ ] **Step 4: Run and confirm they pass.** Also run `npm run typecheck`.
- [ ] **Step 5: Commit.** `fix(mac-app): set up installs into the Appium folder the profile launches from`.

**Ship** with this live check: on a fresh `--user-data-dir`, leave the folder field blank, press Set up, then Start. It starts without editing anything, and the Set up card names the same folder as the header.

---

## Item A3 — Honest iPhone setup (branch `fix/xenon-control-iphone-setup`)

### Task 5: Setup runs the go-ios installer for iOS profiles

**Files:**
- Modify:
  - `mac-app/src/main/setupPlan.ts`: add the go-ios plan.
  - `mac-app/src/main/SetupService.ts`: run it, and return `SetupResult`.
  - `mac-app/src/main/setupRequest.ts`: add `platform`.
  - `mac-app/src/main/installedPluginVersion.ts`: add `installedPluginDir`.
  - `mac-app/src/shared/types.ts`: add `SetupResult`.
  - `mac-app/src/preload/index.ts`.
- Test: `mac-app/test/setupPlan.spec.ts` (extend), `mac-app/test/setupRequest.spec.ts` (extend)

**Interfaces:**
- Produces, in `installedPluginVersion.ts`: `export function installedPluginDir(appiumHome: string): string`, which returns `path.join(appiumHome, 'node_modules', NPM_PLUGIN)`. `readInstalledPluginVersion` uses it.
- Produces, in `setupPlan.ts`:
  - `export const GO_IOS_SCRIPT = ['lib', 'src', 'scripts', 'install-go-ios.js'] as const`
  - `export type GoIosPlan = { kind: 'run'; step: SetupStep } | { kind: 'skip'; detail: string } | { kind: 'not-needed' }`
  - `export function planGoIosStep(input: { platform: string | undefined; pluginDir: string; scriptExists: boolean }): GoIosPlan`
  - Step id `'install-go-ios'`. `args` is `[<pluginDir>/lib/src/scripts/install-go-ios.js]`, run with the `node` binary.
- `SetupOptions` gains `platform: 'ios' | 'android' | 'both'`, from `profile.settings.platform`, defaulting to `'both'` in `toSetupOptions`.
- Produces, in `types.ts`: `export interface SetupResult { ok: boolean; failedStep: string | null }`. `SetupService.install` returns it.

- [ ] **Step 1: Write the failing tests:**
  - `planGoIosStep` returns `'not-needed'` for `android`.
  - It returns `run` for `ios` and `both` when the script exists, with the joined script path.
  - It returns `skip` when the script is missing, with detail exactly `This Xenon version can't set up iPhones from here. Update Xenon, then run Set up again.`
  - `platform` undefined is treated as `'both'`.
  - `toSetupOptions` maps `settings.platform`.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.**
  - In `install()`, run the go-ios step after the drivers and before `verify-plugin`.
  - `run` → `which('node')`, then `runStep('install-go-ios', nodeBin, step.args, env)`.
  - `skip` → emit `{ step: 'install-go-ios', done: true, ok: true, detail }`.
  - `not-needed` → nothing.
  - Track the first failing step id and return `{ ok, failedStep }` everywhere `install` returned a boolean. The `locate-appium` failure gives `failedStep: 'locate-appium'`.
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `fix(mac-app): set up installs go-ios for iPhone profiles`.

### Task 6: An "iPhone support" check that tells the truth

**Files:**
- Modify:
  - `mac-app/src/main/toolchainRules.ts`: add `assessIphoneSupport`.
  - `mac-app/src/main/ToolchainInspector.ts`: replace `checkGoIos`; `checkAll` gains `appiumHome`.
  - `mac-app/src/main/index.ts`: `toolchainCheck` passes `resolveAppiumHome(profile)` when a profile is given.
- Create: `mac-app/src/main/goIosPin.ts`
- Test: `mac-app/test/toolchainRules.spec.ts` (extend), `mac-app/test/goIosPin.spec.ts`

**Interfaces:**
- Produces, in `toolchainRules.ts`: `export function assessIphoneSupport(i: { platform: string | undefined; binaryExists: boolean; installedVersion: string | null; pinnedVersion: string | null }): RuleVerdict`.
- Produces, in `goIosPin.ts`: `export function loadGoIosPin(pluginDir: string): string | null`.
  - It uses `createRequire(path.join(pluginDir, 'package.json'))('./lib/src/scripts/goIosVersion.js').GO_IOS_VERSION`.
  - It returns `null` on any throw or a non-string value.
- `checkAll(profile?: Profile, appiumHome?: string)`. The go-ios check keeps `id: 'go-ios'`, uses `label: 'iPhone support'`, and is `blocking: false`.

- [ ] **Step 1: Write the failing tests.** Exact `assessIphoneSupport` outcomes:
  - platform `android` → `{ status: 'ok', detail: 'Not needed for Android-only profiles.' }`
  - binary missing → `{ status: 'warn', detail: 'Not installed yet', remediation: "iPhones won't work until setup finishes. Run Set up on this tab." }`
  - binary present, versions `v1.0.134` and `v1.2.1` → `{ status: 'warn', detail: 'go-ios v1.0.134, Xenon expects v1.2.1', remediation: 'Xenon was updated. Run Set up again to update iPhone support.' }`
  - present and matching → `{ status: 'ok', detail: 'Ready for iPhones (go-ios v1.2.1)' }`
  - present, pin `null` → `{ status: 'ok', detail: 'Ready for iPhones' }`
  - present, version file missing, pin `v1.2.1` → the outdated warning, with detail `go-ios (unknown version), Xenon expects v1.2.1`

  For `loadGoIosPin`, use a temp-dir fixture with `package.json` and `lib/src/scripts/goIosVersion.js` (`exports.GO_IOS_VERSION = 'v1.2.1'`):
  - The fixture returns `'v1.2.1'`.
  - A missing file returns `null`.
  - A file that throws returns `null`.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.**
  - `checkGoIos(profile, appiumHome)` reads `existsSync(<xenonCacheDir()>/goIOS/ios)`.
  - The installed version is the trimmed contents of `<xenonCacheDir()>/goIOS/.go-ios-version`, or `null`.
  - The pin is `loadGoIosPin(installedPluginDir(appiumHome))` when `appiumHome` is given, else `null`.
  - Return `{ id: 'go-ios', label: 'iPhone support', ...assessIphoneSupport(...), blocking: false }`.
  - `HealthPanel` re-checks only when `profile.settings.platform` changes. Drop `bootedSimulators` and `simulators` from `settingsKey` in Task 11, when the WDA check goes.
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `fix(mac-app): the iPhone support check says when setup is needed`.

### Task 7: Setup progress shows each step once, then a summary

**Files:**
- Create: `mac-app/src/renderer/src/setupProgress.ts`
- Modify: `mac-app/src/renderer/src/components/HealthPanel.tsx` (the progress state and row rendering), `mac-app/src/renderer/src/App.tsx` (`handleInstall` toasts)
- Test: `mac-app/test/setupProgress.spec.ts`

**Interfaces:**
- Produces:
  - `export function mergeProgress(rows: SetupProgress[], p: SetupProgress): SetupProgress[]`. It replaces the row with the same `step`, else appends.
  - `export function stepLabel(step: string): string`
  - `export function setupSummary(r: SetupResult): { message: string; kind: 'success' | 'error' }`

- [ ] **Step 1: Write the failing tests:**
  - `mergeProgress` keeps one row per step and the latest state wins.
  - Order follows first appearance.
  - `stepLabel` maps exactly:
    - `locate-appium` → `Finding Appium`
    - `plugin-source` → `Choosing where to get Xenon`
    - `uninstall-plugin` → `Removing the old Xenon`
    - `install-plugin` → `Installing Xenon`
    - `update-plugin` → `Updating Xenon`
    - `install-driver:uiautomator2` → `Installing Android support`
    - `install-driver:xcuitest` → `Installing iOS support`
    - `install-go-ios` → `Installing real-iPhone support`
    - `verify-plugin` → `Checking the install`
    - unknown ids are returned unchanged
  - `setupSummary({ ok: true, failedStep: null })` → `{ message: 'Setup finished', kind: 'success' }`.
  - `setupSummary({ ok: false, failedStep: 'install-go-ios' })` → `{ message: "Setup didn't finish: Installing real-iPhone support failed. See the steps on the Health tab.", kind: 'error' }`.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement and wire.**
  - HealthPanel uses `setProgress((prev) => mergeProgress(prev, p))`.
  - Rows show `stepLabel(step)`. The raw command or detail goes in a muted second line only when `!ok`.
  - `handleInstall` calls `const r = await window.xenon.setup.install(...)`, then `toast(setupSummary(r).message, setupSummary(r).kind)`.
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `fix(mac-app): setup lists each step once and says how it ended`.

**Ship** with these live checks on a Mac with a real iPhone:
1. `mv ~/.cache/xenon/goIOS ~/.cache/xenon/goIOS.bak`. Health shows the "Not installed yet" warning.
2. Set up. The rows read in plain words, once each. The toast says "Setup finished", and the check shows "Ready for iPhones (go-ios v1.2.1)".
3. Start an iPhone session.
4. Restore the backup only if the new install failed.

---

## Item A4 — Option list matches the installed plugin (branch `feat/xenon-control-installed-schema`)

### Task 8: Read the installed plugin's option list

**Files:**
- Create: `mac-app/src/main/installedSchema.ts`
- Modify: `mac-app/src/main/SchemaService.ts`, `mac-app/src/shared/types.ts`
- Test: `mac-app/test/installedSchema.spec.ts`, `mac-app/test/schemaService.spec.ts`

**Interfaces:**
- Consumes: `installedPluginDir(appiumHome)` (Task 5).
- Produces, in `installedSchema.ts`: `export function readInstalledSchema(appiumHome: string): { schema: XenonSchema; version: string } | null`.
  - It reads `<pluginDir>/package.json` (following a symlink).
  - It takes `appium.schema` as a string, resolves it against the plugin dir (accepting `./`), and parses it.
  - It returns `null` unless `properties` is a plain object and `version` is a string.
- Produces, in `types.ts`: `export interface EffectiveSchemaInfo { source: 'installed' | 'bundled'; pluginVersion: string; installedVersion: string | null }`.
- Produces, in `SchemaService`:
  - `effectiveSchema(appiumHome: string): { schema: XenonSchema; info: EffectiveSchemaInfo }`. It caches by `${appiumHome}|${installedVersion}`. The bundled `pluginVersion` comes from `meta.pluginVersion`.
  - `requiredDefaults(appiumHome: string): Record<string, unknown>`, which is `requiredDefaults(effectiveSchema(appiumHome).schema)`.

- [ ] **Step 1: Write the failing tests.** Use temp-dir fixtures under `os.tmpdir()`:
  - A valid install returns the installed schema and version.
  - `"schema": "./schema.json"` works.
  - A plugin dir that is a **symlink** to a fixture "checkout" works (Review Focus 2).
  - Each of these returns `null`: no `package.json`; no `appium.schema`; the schema file missing; invalid JSON; `properties` an array.
  - `SchemaService.effectiveSchema` returns `source: 'installed'` with the installed version.
  - It returns `source: 'bundled'` with `installedVersion` set when the plugin is installed but unreadable.
  - It returns `source: 'bundled'` with `installedVersion: null` when the plugin isn't installed.
  - `SchemaService` needs its bundled directory injectable for the test: constructor `new SchemaService(resourcesDirFn = resourcesDir)`.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.** `installedVersion` uses `readInstalledPluginVersion`. Update the existing callers of the old no-argument `schemaService.requiredDefaults()` in `index.ts` (supervisor deps, `launchPreview`, `exportConfigYaml`) to pass `resolveAppiumHome(profile)`, so the build stays green. Task 9 then replaces the supervisor dep.
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(mac-app): read the option list of the Xenon installed in the profile's Appium folder`.

### Task 9: Launch with the effective option list

**Files:**
- Create: `mac-app/src/shared/humanize.ts`. Move `humanize` and its proper-noun map out of `renderer/src/schemaForm.ts`; `schemaForm` imports it.
- Modify:
  - `mac-app/src/main/LaunchBuilder.ts`: `BuildContext.schema?`, pruning, `LaunchPlan.skippedSettings`.
  - `mac-app/src/main/ProcessSupervisor.ts`: deps and the skipped-settings log line.
  - `mac-app/src/main/index.ts`: supervisor deps, the `launchPreview` and `exportConfigYaml` handlers.
- Test: `mac-app/test/LaunchBuilder.spec.ts` (extend), `mac-app/test/configDefaults.spec.ts` (extend)

**Interfaces:**
- `BuildContext.schema?: XenonSchema`. When present, drop every key in the merged settings that isn't in `schema.properties`.
- `LaunchPlan.skippedSettings: string[]` lists only the keys that were in `profile.settings` and were dropped. App defaults such as `streaming` are dropped silently.
- `SupervisorDeps.requiredDefaults()` is replaced by `schemaFor(profile: Profile): XenonSchema`. The supervisor passes `schema` and `requiredDefaults(schema)` to `buildLaunchPlan`.
- `export function skippedSettingsLine(keys: string[]): string | null` in `LaunchBuilder.ts`. It returns `null` for an empty list, else `Skipped ${n} setting${n === 1 ? '' : 's'} your installed Xenon doesn't support: ${keys.map(humanize).join(', ')}.`

- [ ] **Step 1: Write the failing tests:**
  - With a schema lacking `sessionMetrics`, a profile that sets `sessionMetrics: true` gets a config without it, and `skippedSettings` is `['sessionMetrics']`.
  - With a schema lacking `streaming`, the app default is dropped and isn't reported.
  - Without `ctx.schema`, behaviour is unchanged (the existing tests still pass).
  - `requiredDefaults` over a schema **without** `required` writes no legacy defaults and no `enableJsonLogging`.
  - With `required` present, it writes them as today.
  - `skippedSettingsLine(['sessionMetrics'])` returns `"Skipped 1 setting your installed Xenon doesn't support: Session Metrics."`. Use whatever `humanize` actually returns; assert via `humanize('sessionMetrics')`.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement and wire.**
  - `index.ts` sets `schemaFor: (p) => schemaService.effectiveSchema(resolveAppiumHome(p)).schema`.
  - The preview and YAML export use the same schema and defaults.
  - The supervisor pushes `skippedSettingsLine(plan.skippedSettings)` as a system line when it isn't null.
- [ ] **Step 4: Run and confirm they pass.** Run all specs; the `schemaForm` tests must still pass after the `humanize` move.
- [ ] **Step 5: Commit.** `feat(mac-app): launch only the settings the installed Xenon knows; JSON logging follows its env var again`.

### Task 10: The form follows the installed plugin, and the bundled copy is checked in CI

**Files:**
- Create: `mac-app/src/renderer/src/schemaSource.ts`
- Modify:
  - `mac-app/src/main/index.ts`: `schemaGet` takes a profile.
  - `mac-app/src/preload/index.ts`: `getSchema(p?: Profile)` returns `{ schema; meta; secretDescriptors; info: EffectiveSchemaInfo }`.
  - `mac-app/src/renderer/src/App.tsx`: refetch the schema when the profile id, its Appium folder or the installed plugin version changes, and after setup.
  - `mac-app/src/renderer/src/components/SettingsForm.tsx`: the source line above the search box.
  - `mac-app/scripts/sync-schema.mjs`: add `--check`.
  - `mac-app/package.json`: add the script `"sync:schema:check": "node scripts/sync-schema.mjs --check"`.
- Test: `mac-app/test/schemaSource.spec.ts`

**Interfaces:**
- Produces: `export function schemaSourceLine(info: EffectiveSchemaInfo): string`.

- [ ] **Step 1: Write the failing tests.** The exact strings:
  - installed `2.17.0` → `Showing the options of Xenon 2.17.0, installed in this profile's Appium folder.`
  - bundled `2.17.0`, installed `null` → `Xenon isn't installed yet. Showing the options of Xenon 2.17.0 until Set up installs it.`
  - bundled `2.17.0`, installed `2.9.4` → `Showing the options that came with this app (Xenon 2.17.0). Your installed Xenon 2.9.4 didn't provide its own list, so a few may not apply.`
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.**
  - With no profile, the `schemaGet` handler uses `effectiveSchema(defaultAppiumHome())`.
  - The App's existing plugin-version effect (around `App.tsx:158-190`) also calls `getSchema(draft)` whenever the version it reads differs from the last one.
  - `sync-schema.mjs --check` compares bytes. It exits 1 with `[sync-schema] resources/schema.json is out of date; run npm run sync:schema` when they differ or the file is missing, and copies nothing.
- [ ] **Step 4: Run and confirm they pass.** Also run `node scripts/sync-schema.mjs && node scripts/sync-schema.mjs --check`, which should exit 0.
- [ ] **Step 5: Commit.** `feat(mac-app): the settings form says which Xenon its options come from`.

**Ship** with this live check:
1. Install an older plugin into a scratch folder: `APPIUM_HOME=/tmp/xc-old appium plugin install --source=npm @xenon-device-management/xenon@2.9.4`.
2. Point a profile at `/tmp/xc-old` with `sessionMetrics` set in its saved settings, using Import of a profile JSON.
3. The Settings line names 2.9.4, and Start succeeds with the "Skipped 1 setting…" log line.
4. Point the profile back at the normal folder. Session metrics returns.

---

## Item A5 — Retire dead and misleading settings (branch `fix/xenon-control-retired-settings`)

### Task 11: Retired keys, the stale simulator warning, hub origin

**Files:**
- Create: `mac-app/src/shared/retiredSettings.ts`
- Modify:
  - `mac-app/src/renderer/src/schemaForm.ts`: skip retired keys in `buildForm`.
  - `mac-app/src/main/LaunchBuilder.ts`: `sanitizeSettings` drops retired keys; fix the comment at lines 35-41.
  - `mac-app/src/main/toolchainRules.ts`: delete `WDA_POOL_SIZE`, `WDA_POOL_RANGE`, `WdaPressureInput`, `assessWdaPressure` and its `REMEDIATION`.
  - `mac-app/src/main/ToolchainInspector.ts`: delete `checkSimulatorPorts` and its entry in `checkAll`.
  - `mac-app/src/renderer/src/components/HealthPanel.tsx`: `settingsKey` uses only `platform`.
  - `mac-app/src/renderer/src/validation.ts`: the hub rule.
- Test: `mac-app/test/schemaForm.spec.ts`, `test/LaunchBuilder.spec.ts`, `test/toolchainRules.spec.ts` (delete the `assessWdaPressure` block), new `test/validation.spec.ts`

**Interfaces:**
- Produces: `export const RETIRED_SETTINGS: ReadonlySet<string> = new Set(['databaseProvider'])`.

- [ ] **Step 1: Write the failing tests:**
  - `buildForm` over the repo `schema.json` has no field with key `databaseProvider`.
  - `buildConfigYaml` for a profile with `databaseProvider: 'postgresql'` omits it.
  - Hub validation:
    - These pass: `http://hub-mac:4723`, `http://hub-mac:4723/`, `https://10.0.0.5`.
    - These fail: `http://hub-mac:4723/wd/hub`, `http://hub-mac:4723?x=1`, `http://hub-mac:4723/#a`, `ftp://hub`, `hub-mac:4723`.
    - The message is exactly `Use only the hub's address, like http://hub-mac:4723, without /wd/hub or other paths.`
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.**
  - Hub rule: `new URL(hub)` must have an http(s) protocol and `pathname === '/'`, and the raw string must contain neither `?` nor `#`. A URL parser drops a bare `?` or `#`, so check the string, not `search` or `hash`.
  - The `LaunchBuilder` comment says the plugin honours `authDisabled` since #225, and that the env bridge is kept for older plugins.
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `fix(mac-app): retire the database type and the stale simulator warning; hub address must be an origin`.

### Task 12: Exports leave out every secret-looking value

**Files:**
- Modify: `mac-app/src/main/profileSecrets.ts` (`withoutSecrets`, `profileExportJson`)
- Test: `mac-app/test/profileSecrets.spec.ts` (extend)

**Interfaces:**
- Produces, in `profileSecrets.ts`:
  - `export function isSecretLikeEnvName(name: string): boolean`. It is true for `/(_KEY|_TOKEN|_SECRET|_PASSWORD)$/i`, for `OTEL_EXPORTER_OTLP_HEADERS`, and for every name `secretForEnvName` already knows.
  - `export function stripUrlCredentials(value: string): string`.
  - `export function exportableProfile(p: Profile): { profile: Profile; strippedEnv: string[] }`.
- `profileExportJson` writes `{ type: 'xenon-control-profile', version: 1, profile, strippedEnv }`. `strippedEnv` is sorted and omitted when empty.

- [ ] **Step 1: Write the failing tests:**
  - Dropped: `CLOUD_KEY`, `XENON_IP_HASH_SECRET`, `XENON_BOOTSTRAP_ADMIN_PASSWORD`, `OTEL_EXPORTER_OTLP_HEADERS`, `MY_TOKEN`.
  - Kept: `XENON_MCP_TOKEN_TTL_SEC`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `XENON_PUBLIC_URL`.
  - `HTTPS_PROXY=http://u:p@proxy:3128` is kept as `http://proxy:3128` and is **not** listed in `strippedEnv`.
  - `NO_PROXY=localhost,127.0.0.1` and `X=http://a b@c` are unchanged and nothing throws (Review Focus 3).
  - `settings.cloud.apiKey` is removed and other `cloud` fields are kept. `settings.proxy.auth.password` is removed and `username` is kept.
  - `strippedEnv` lists the dropped names, sorted.
  - An export without drops has no `strippedEnv` key.
  - `importFrom` of an export with `strippedEnv` still imports the profile.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.** `stripUrlCredentials` only rewrites values that `new URL()` parses with an `http:`, `https:` or `socks*:` protocol and a non-empty username or password. Anything else is returned as is.
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `fix(mac-app): profile exports leave out keys, tokens, passwords and proxy credentials`.

### Task 13: Plugin detection by package, Appium 3.1.1, hub secret wording

**Files:**
- Modify:
  - `mac-app/src/main/setupPlan.ts`: add `parseExtensionList` and `xenonPluginName`.
  - `mac-app/src/main/SetupService.ts`: use both; delete the private parsing.
  - `mac-app/src/main/ToolchainInspector.ts`: `isPluginInstalled`, `checkAppium`.
  - `mac-app/src/main/toolchainRules.ts`: add `appiumSatisfiesXenon`.
  - `mac-app/src/shared/secrets.ts`: the hub descriptions.
- Test: `mac-app/test/setupPlan.spec.ts`, `mac-app/test/toolchainRules.spec.ts`

**Interfaces:**
- `export function parseExtensionList(stdout: string): Record<string, { pkgName?: string; installed?: boolean }>`. It slices to the outermost braces and returns `{}` on failure.
- `export function xenonPluginName(manifest: ReturnType<typeof parseExtensionList>): string | null`. It matches `pkgName === NPM_PLUGIN && installed !== false`.
- `export const XENON_APPIUM_MIN = '3.1.1'` and `export function appiumSatisfiesXenon(version: string): boolean`.

- [ ] **Step 1: Write the failing tests:**
  - `parseExtensionList` handles warnings before and after the JSON.
  - `xenonPluginName`:
    - `{ xenon: { pkgName: '@xenon-device-management/xenon' } }` → `'xenon'`
    - `{ 'xenon-fork': { pkgName: 'xenon-fork' } }` → `null`
    - `{ images: { pkgName: '@appium/images-plugin' } }` → `null`
  - `appiumSatisfiesXenon`:
    - `3.1.0` → false
    - `3.1.1` → true
    - `3.2.0` → true
    - `4.0.0` → true
    - `2.19.0` → false
    - `v3.1.1` → true
    - `garbage` → false
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.**
  - `isPluginInstalled` runs `plugin list --installed --json` and returns `xenonPluginName(parseExtensionList(stdout)) !== null`.
  - In `checkAppium`, `good = ok && appiumSatisfiesXenon(out)`. The remediation when not good is `Xenon needs Appium 3.1.1 or newer.`
  - Hub descriptions in `secrets.ts`:
    - Access key: `Needed when this Mac joins a hub, and on a hub or standalone server that hands out device leases. Paired with the hub token.`
    - Token: `Paired with the hub access key. Needed when this Mac joins a hub, and on a hub or standalone server that hands out device leases.`
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `fix(mac-app): detect Xenon by its package and require Appium 3.1.1`.

**Ship** with these live checks:
- The Database section no longer offers the database type.
- Health has no simulator-ports row.
- A hub of `http://x:4723/wd/hub` shows the new message.
- Export a profile with `CLOUD_KEY` and a proxy URL with credentials. The JSON has neither, and lists `CLOUD_KEY` in `strippedEnv`.

---

## Item A6 — A Start button you can trust (branch `fix/xenon-control-start-readiness`)

### Task 14: Error toasts stay; imports always answer

**Files:**
- Create: `mac-app/src/renderer/src/importFeedback.ts`
- Modify:
  - `mac-app/src/renderer/src/components/ui/toastStore.ts`: only `success` auto-dismisses.
  - `mac-app/src/renderer/src/components/ui/Toaster.tsx`: an icon per kind, `AlertTriangle` for errors.
  - `mac-app/src/main/index.ts`: the `profileImport` result.
  - `mac-app/src/preload/index.ts`.
  - `mac-app/src/renderer/src/App.tsx`: `importProfiles`.
- Test: `mac-app/test/toastStore.spec.ts` (extend), `mac-app/test/importFeedback.spec.ts`

**Interfaces:**
- `profiles.import()` returns `{ profiles: Profile[]; importedIds: string[]; files: string[]; unreadable: string[] }`. Both lists hold basenames, and both are empty when the dialog was cancelled.
- `export function importFeedback(r: { importedIds: string[]; files: string[]; unreadable: string[] }): { message: string; kind: 'success' | 'error' } | null`

- [ ] **Step 1: Write the failing tests:**
  - An `error` toast is still present after `vi.advanceTimersByTime(10_000)`. A `success` toast is gone after 4000 ms.
  - `importFeedback` cases:
    - cancelled → `null`
    - 2 imported → `{ 'Imported 2 profiles', success }`
    - 1 imported + 1 unreadable → `{ "Imported 1 profile. Couldn't read 1 file.", success }`
    - 0 imported, `['a.json']` readable → `{ 'No profiles found in a.json', error }`
    - 0 imported, `['a.json','b.json']` readable → `{ 'No profiles found in a.json and 1 more file', error }`
    - 0 imported, 2 unreadable → `{ "Couldn't read 2 files", error }`
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement and wire.** `importProfiles` toasts `importFeedback(...)` when it's non-null.
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `fix(mac-app): error toasts stay until dismissed; importing always says what happened`.

### Task 15: Readiness model and plain preflight reasons

**Files:**
- Create: `mac-app/src/renderer/src/readiness.ts`
- Modify: `mac-app/src/main/ToolchainInspector.ts` (the two `preflight` blocker strings)
- Test: `mac-app/test/readiness.spec.ts`

**Interfaces:**
- Produces, in `readiness.ts`:
  - `export class ReadinessTracker { begin(profileId: string): number; complete(profileId: string, token: number, result: PreflightResult): boolean; get(profileId: string): PreflightResult | null; pending(profileId: string): boolean }`. `complete` returns false and stores nothing for a stale token. `get` keeps the last completed result while a newer check is pending.
  - `export type StartDecision = { ok: true } | { ok: false; kind: 'active' } | { ok: false; kind: 'invalid'; issue: ValidationIssue; count: number } | { ok: false; kind: 'not-ready'; reason: string } | { ok: false; kind: 'checking' }`
  - `export function decideStart(i: { status: ServerStatus; issues: ValidationIssue[]; readiness: PreflightResult | null; checking: boolean }): StartDecision`. The order is:
    1. active (`starting`, `running`, `stopping`) → `active`
    2. issues → `invalid` with the first issue
    3. `readiness` null and checking → `checking`
    4. readiness not ok → `not-ready` with `firstBlocker(readiness)`
    5. otherwise ok
  - `export function firstBlocker(r: PreflightResult): string`. It returns `blockers[0]`, else the first blocking non-ok check's `remediation ?? detail`, else `'Not ready to start yet.'`.
  - `export function blockedReason(d: StartDecision): string | null`:
    - `invalid` → `Fix ${count} setting${count === 1 ? '' : 's'} first: ${issue.label}`
    - `not-ready` → `reason`
    - `checking` → `Checking…`
    - otherwise → `null`

- [ ] **Step 1: Write the failing tests:**
  - Tracker: a stale token is discarded. Results are keyed per profile, so profile B's result never shows on A.
  - While a newer check is pending, `get()` still returns the previous result (Review Focus 4).
  - Every `decideStart` branch, including the precedence of `invalid` over `not-ready`.
  - Every `blockedReason` string exactly.
  - `firstBlocker` falls back through each option.
- [ ] **Step 2: Run and confirm they fail.**
- [ ] **Step 3: Implement.** The `preflight` blocker strings become exactly:
  - `Port ${port} is already in use by another app. Choose another port or close that app.`
  - `Run Set up on the Health tab first. Xenon isn't installed in the Appium folder this profile uses.`
- [ ] **Step 4: Run and confirm they pass.**
- [ ] **Step 5: Commit.** `fix(mac-app): a readiness model that knows why Start is off`.

### Task 16: One start path, live readiness, reasons on screen

**Files:**
- Create: `mac-app/src/renderer/src/useReadiness.ts`, `mac-app/src/renderer/src/focusSetting.ts`
- Modify:
  - `mac-app/src/renderer/src/App.tsx`: replace the `preflight` state and `runPreflight`; add `requestStart`; route the menu, ⌘⏎ and the Logs CTA through it; add `startError` state; delete the inline "Cannot start yet" banner and show the readiness blockers in its place from `useReadiness`.
  - `mac-app/src/renderer/src/components/StatusBar.tsx`: props.
  - `mac-app/src/renderer/src/components/HealthPanel.tsx`: an `onRecheck` prop.
  - `mac-app/src/renderer/src/components/SettingsForm.tsx`: `data-setting-key` on each field wrapper.
  - The header port input in `App.tsx`: `data-setting-key="server.port"`.
- Test: `mac-app/test/e2e/app.e2e.spec.ts` (update and add)

**Interfaces:**
- Consumes: `ReadinessTracker`, `decideStart`, `blockedReason` (Task 15); `toast(msg, 'error')` (Task 14); `debounce` from `renderer/src/debounce.ts`.
- Produces:
  - `export function useReadiness(profile: Profile | null, ticks: { focus: number; setup: number; recheck: number; serverStopped: number }): { readiness: PreflightResult | null; checking: boolean; refreshNow(): Promise<PreflightResult | null> }`.
    - The re-check is debounced 400 ms on changes to `profile.id`, `server.port` or `server.appiumHome`, and on any tick.
    - `refreshNow` runs immediately and bypasses the debounce.
  - `export function focusSetting(path: string): void`. It scrolls `[data-setting-key="<path>"]` into view and focuses its first `input, textarea, select, button`.
- `StatusBar` props become `{ state; busy; blockedReason: string | null; startError: string | null; onStart; onStop; onPreview }`.
  - Show `blockedReason` as muted text left of Start, and as the Start `title`.
  - Show `startError` in danger text when not active.
  - Remove the old "N validation issues" text and the "Resolve preflight blockers first" title.

- [ ] **Step 1: Update and add the e2e tests (failing).**
  - In `'clearing the port shows an error and blocks Start…'`, also assert `await expect(page.getByText('Fix 1 setting first: Port')).toBeVisible()` and that the start button's `title` equals it.
  - New: `'⌘Return with an invalid port does not start and focuses the port field'`:
    - Clear the port and press `Meta+Enter`.
    - Status stays "Stopped".
    - `await expect(page.getByRole('spinbutton', { name: 'Port' })).toBeFocused()`.
  - New: `'a port in use blocks Start with a plain reason and clears on its own'`:
    - Occupy port 4799 with a `net.createServer().listen(4799)` in the test process.
    - Set the port to 4799.
    - Start shows the reason `Port 4799 is already in use by another app. Choose another port or close that app.`
    - Release the port and confirm Start re-enables within 2 s after window focus.
- [ ] **Step 2: Run and confirm they fail.** `npm run test:e2e -- -g "Port|⌘Return|port in use"`.
- [ ] **Step 3: Implement.**
  - `requestStart` calls `decideStart(...)`:
    - `active` → return.
    - `invalid` → `if (!issue.path.startsWith('server.')) setTab('settings')`, then `focusSetting(issue.path)` on the next frame.
    - `not-ready` → `setTab('health')`.
    - `checking`, or ok → `saver.flush()`, then `setBusy(true)`, then `const r = await refreshNow()`. If `!r?.ok`, go to Health and return.
  - Otherwise, `setStartError(null); setLogs([]); await window.xenon.server.start(draft)`.
  - The catch sets `startError` to the error message and calls `toast(message, 'error')`.
  - The ticks:
    - `focus` comes from the existing focus listener.
    - `setup` is bumped after `handleInstall`.
    - `recheck` is bumped by HealthPanel's Re-check.
    - `serverStopped` is bumped when the status moves from active to `stopped` or `crashed`.
- [ ] **Step 4: Run and confirm they pass.** `npm run test:e2e` (the full suite) and `npm test`.
- [ ] **Step 5: Commit.** `fix(mac-app): one start path; Start says why it's off and never sticks`.

**Ship** with these live checks:
- Occupy the port with `python3 -m http.server 4723`. The status bar says the port is in use.
- Stop the Python server and switch back to the app. Start enables by itself.
- Clear the port. Pressing ⌘⏎ focuses the port.
- Import a non-profile JSON. An error toast appears.

Once readiness gates Start, a start that throws (`requestStart`'s catch → error toast) can't be reached by a test, so it isn't automated. The reviewer checks that catch by reading it.

---

## Item A8 — Ship 0.2.0 (branch `chore/xenon-control-0.2.0`)

### Task 17: CI, version, docs, release build

**Files:**
- Create: `.github/workflows/mac-app.yml`
- Modify: `mac-app/package.json` and `mac-app/package-lock.json` (version), `mac-app/README.md`, `website/docs/xenon-control.md`, `CHANGELOG.md`

- [ ] **Step 1: Write the workflow.**
  - Name `mac-app`. Triggers: `pull_request` and `push` on `main`, with `paths: ['mac-app/**', 'schema.json', 'web/src/tokens.css', '.github/workflows/mac-app.yml']`.
  - One job, `test`, on `ubuntu-latest` with Node 22. `working-directory: mac-app`. Steps:
    1. `npm ci --ignore-scripts`. This skips the electron-builder postinstall, which isn't needed for unit tests.
    2. `npm run sync:schema:check`
    3. `npm run sync:tokens:check`
    4. `npm run typecheck`
    5. `npm test`
    6. `npx electron-vite build`

  `--ignore-scripts` skips Electron's binary download. Only the e2e run needs it, and e2e doesn't run in CI.
- [ ] **Step 2: Confirm the workflow locally.** Run the same commands in `mac-app/` in a clean clone (`git clone` of the branch into the scratch dir). All exit 0.
- [ ] **Step 3: Bump the version.** `cd mac-app && npm version 0.2.0 --no-git-tag-version`.
- [ ] **Step 4: Update the docs.**
  - `website/docs/xenon-control.md`: 0.1.3 becomes 0.2.0. Describe:
    - The Database URL as a Keychain secret handed to the server.
    - Log redaction.
    - Set up installing iPhone support (go-ios), and re-running it after Xenon upgrades.
    - Stop and Quit waiting up to about 35 s.
    - The option list following the installed Xenon, and the Settings line that says which.
    - Exports leaving out secret-looking values and listing them.
    - The Appium 3.1.1 floor.
  - Remove the "Booted-only discovery … WDA" text and the claim that the form is a copy that comes with the app.
  - `mac-app/README.md`: the option count (use the current `Object.keys(schema.properties).length`) and the same points, briefly.
  - `CHANGELOG.md`: the lines announcing mac-app 0.1.4/0.1.5 as released (2.15.0 around lines 468-472, 2.16.0 around lines 237-240) now say those fixes ship in Xenon Control 0.2.0.
- [ ] **Step 5: Run the checks.** `npm test && npm run typecheck && npm run build && npm run test:e2e`. All pass.
- [ ] **Step 6: Commit.** `chore(mac-app): 0.2.0 — CI job, docs, changelog`.
- [ ] **Step 7: Ship.**
  - Run the per-PR procedure. The CI must show the new `mac-app / test` check green.
  - After merging, build the release locally with `npm run dist`, following the README's signing notes.
  - **Stop there.** Hand the DMG and zip paths to the maintainer. Tagging and publishing the GitHub release is their call.
