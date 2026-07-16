# Dashboard UI/UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 24 findings from `docs/superpowers/specs/2026-07-16-dashboard-uiux-audit-design.md` (P0 broken → P2 polish) across the Xenon React dashboard.

**Architecture:** Pure frontend changes in `web/src` (React 17 + Tailwind + component CSS). No backend/API changes. Fixes are grouped by component locality into 14 tasks; each task is independently verifiable and committed separately on branch `fix/dashboard-uiux-audit`.

**Tech Stack:** React 17, Vite 5, Tailwind utilities + per-component `.css`, lucide-react icons, `pretty-ms`.

## Global Constraints

- Branch: `fix/dashboard-uiux-audit` (already created; spec committed). One consolidated PR at the end. NEVER `git add -A` or `git add .` — stage explicit paths only.
- Supported viewport range is **1280–1440 only**. Use `min-width` media queries only, never `max-width` (CLAUDE.md).
- The running server serves `lib/public`, NOT `web/src`. A change is only visible after `npm run build:xenon && npm run build:copy` from the repo root. Don't rebuild per task — rebuild in the final verification task (browser verification steps within tasks are code-level assertions + unit tests until then).
- Web unit tests: `cd web && npx vitest run` (vitest configured in `web`). Root plugin tests (`npm test`) are untouched by these changes.
- Copy rules (canonical names): nav label = page title. "Apps" (not "App Repository"/"Centralized Artifact Registry"), "Settings" (not "Infrastructure Control"), "Sessions" for `/builds`. Healing is **6-tier** (Resilio, native retry, fuzzy XML, OCR, visual AI, LLM).
- Date format app-wide: `MMM d, HH:mm:ss` (e.g. `Jul 16, 14:45:00`) via shared `formatDateTime` util.
- All lucide icon-only buttons need `aria-label`.
- Do not restructure components beyond what a task specifies. Match surrounding code style.

---

### Task 1: Apps page — fix invisible filter input + canonical naming

**Files:**
- Modify: `web/src/components/apps/apps.tsx`

**Interfaces:**
- Consumes: `.device-explorer-*` classes defined in `web/src/components/device-explorer/device-explorer.css`
- Produces: nothing downstream.

**Background:** `apps.tsx` reuses `device-explorer-container`, `device-explorer-header-*`, and `device-explorer-header-text-filter` classes but only imports `apps.css` (line 22). `device-explorer.css` (which styles those classes dark, lines 129–154) is only imported by `device-explorer.tsx`, so on a direct load of `/apps` the filter input renders as an unstyled white browser-default input with near-white theme text — invisible typing.

- [ ] **Step 1: Add the missing stylesheet import**

In `web/src/components/apps/apps.tsx`, after line 22 (`import './apps.css';`) add:

```tsx
import '../device-explorer/device-explorer.css';
```

- [ ] **Step 2: Canonical naming — header**

Replace (lines 181–185):

```tsx
      <PageHeader
        icon={Package}
        title="App Repository"
        subtitle="Manage signed builds available for installation across your device fleet."
      />
```

with:

```tsx
      <PageHeader
        icon={Package}
        title="Apps"
        subtitle="Signed builds available for installation across your device fleet."
      />
```

- [ ] **Step 3: Canonical naming — empty state**

Find the empty-state `<h2>` at ~line 408 containing `Centralized Artifact Registry` and replace the text with `No apps yet`. Find the CTA button text `Ingest Your First Artifact` (~lines 417–428) and replace with `Upload your first app`. Keep surrounding copy that explains `.apk`/`.ipa` upload; trim marketing tone: replace the sentence beginning "The Xenon Registry is a secure, high-performance vault…" with:

```
Upload .apk or .ipa artifacts to enable versioned installs across your device fleet.
```

(Adjust the exact JSX to preserve the existing `<code>` styling of `.apk` / `.ipa` if present.)

- [ ] **Step 4: Verify + commit**

Run: `cd web && npx tsc --noEmit -p tsconfig.json 2>/dev/null || npx tsc --noEmit` (use the web tsconfig that `npm run build:xenon` uses; if no standalone tsconfig works, run `npx vite build --mode development` as a compile check).
Expected: no type errors.

```bash
git add web/src/components/apps/apps.tsx
git commit -m "fix(apps): import device-explorer styles so filter input is visible; canonical Apps naming"
```

---

### Task 2: Profile — unstick API Tokens loading, add error/identity states

**Files:**
- Modify: `web/src/pages/profile/api-tokens-tab.tsx`
- Modify: `web/src/pages/profile/profile-page.tsx`

**Interfaces:**
- Consumes: `listTokens()`, `getAccessKey()` from `web/src/api-service/profile.ts` (they `throw` on non-OK).
- Produces: nothing downstream.

- [ ] **Step 1: Make `refresh()` failure-safe**

In `api-tokens-tab.tsx` replace (lines 20–26):

```tsx
  async function refresh() {
    setLoading(true);
    const [ak, t] = await Promise.all([getAccessKey(), listTokens()]);
    setAccessKey(ak);
    setTokens(t);
    setLoading(false);
  }
```

with:

```tsx
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [ak, t] = await Promise.all([getAccessKey(), listTokens()]);
      setAccessKey(ak);
      setTokens(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tokens');
    } finally {
      setLoading(false);
    }
  }
```

(Place the `error` state declaration with the other `useState` calls at lines 14–18, not inside the function.)

- [ ] **Step 2: Render the error state**

In the render (lines 75–81), extend the ternary chain — before the `tokens.length === 0` branch add:

```tsx
      ) : error ? (
        <div className="text-sm text-[var(--red)] py-6 text-center border border-dashed border-[var(--border)] rounded-md">
          {error}{' '}
          <button className="underline text-[var(--text)]" onClick={refresh}>
            Retry
          </button>
        </div>
```

- [ ] **Step 3: Add page header + identity to profile-page.tsx**

`profile-page.tsx` currently has no header and shows no identity. Find how `password-tab.tsx` obtains `me` (it renders `me.teams` at lines 37–58 — reuse the same hook/api call). Add at the top of the page (above the sub-nav + body row):

```tsx
import { PageHeader } from '../../components/ui/page-header';
import { UserCircle } from 'lucide-react';
```

```tsx
      <PageHeader
        icon={UserCircle}
        title="Profile"
        subtitle={me ? `${me.name || me.email} — ${me.role ?? ''}` : 'Your account settings.'}
      />
```

Match the actual `me` shape found in step 3 exploration (fields exist on `/xenon/api/auth/me`: `name`, `email`, `role`). If fetching `me` in `profile-page.tsx` requires adding a small `useEffect` + `useState`, copy the exact fetch pattern `password-tab.tsx` uses.

- [ ] **Step 4: Verify + commit**

Run the web compile check (same as Task 1 Step 4). Expected: clean.

```bash
git add web/src/pages/profile/api-tokens-tab.tsx web/src/pages/profile/profile-page.tsx
git commit -m "fix(profile): tokens tab error handling unsticks perpetual loading; add page header with identity"
```

---

### Task 3: Device Control — 1280px overflow (tabs, log toolbar, omni panels)

**Files:**
- Modify: `web/src/components/device-control/device-control.css`
- Modify: `web/src/components/omni-inspector/omni-inspector.css`

**Interfaces:** none produced; pure CSS.

**Background (from exploration):**
- `.tab-btn` (device-control.css:354–374) has `flex: 1 1 0; min-width: 0; white-space: nowrap` and NO overflow handling → labels clip at 1280.
- `.log-toolbar` (686–696) is `display:flex; justify-content:space-between` with fixed-width children and no wrap → EXPORT clips.
- `.control-view-main.omni-mode .device-preview-column` (186–194) re-pins `min-width: 320px`; embedded omni panels need 220+12+260=492px inside a 450px-min column → right panel clips. `omni-inspector.css` has no media queries.
- `.omni-details-tab` (938–979) has `flex:1` with no `min-width:0`/ellipsis → "AI INSIGHT"/"CODE GEN" clip.

- [ ] **Step 1: Tab labels ellipsize instead of clipping**

In `device-control.css`, inside `.tab-btn` (lines 354–374) reduce `padding: 8px 10px;` → `padding: 8px 6px;` and `letter-spacing: 0.08em;` → `letter-spacing: 0.04em;`. Then add after the `.tab-btn > svg` rule (~line 380):

```css
.tab-btn > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 2: Log toolbar wraps instead of clipping**

In `.log-toolbar` (686–696) add `flex-wrap: wrap;` and `row-gap: 6px;`. In `.log-filter-group, .log-actions-group` (698–703) add `min-width: 0;` and `flex-wrap: wrap;`.

- [ ] **Step 3: Omni-mode fits 1280**

In `device-control.css` replace (lines 190–194):

```css
.control-view-main.omni-mode .device-preview-column {
  min-width: 320px;
}
```

with:

```css
.control-view-main.omni-mode .device-preview-column {
  min-width: 0;
  flex-shrink: 1;
}
.control-view-main.omni-mode .device-stream-canvas {
  max-width: 100%;
}
```

In `omni-inspector.css` reduce the embedded panel floors (lines 1110–1128): `.omni-inspector-container.omni-embedded .omni-tree-panel { min-width: 220px }` → `min-width: 180px`; `.omni-inspector-container.omni-embedded .omni-details-panel { min-width: 260px }` → `min-width: 230px`.

- [ ] **Step 4: Omni inner tabs ellipsize**

In `omni-inspector.css` `.omni-details-tab` (938–979) add `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`.

- [ ] **Step 5: Compute the new intrinsic minimum and record it**

Per CLAUDE.md, sum the omni-mode floors (rail 56 + main padding 48 + preview min 0/canvas + gap 20 + tree 180 + gap 12 + details 230 + column padding) and confirm < 1280. Write the arithmetic in the commit message body.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/device-control/device-control.css web/src/components/omni-inspector/omni-inspector.css
git commit -m "fix(device-control): eliminate 1280px clipping in tabs, log toolbar, and omni panels"
```

---

### Task 4: Session Detail — structured log rows + readable first error

**Files:**
- Modify: `web/src/components/session-detail/log-derive.ts`
- Modify: `web/src/components/session-detail/log-row.tsx`
- Modify: `web/src/components/session-detail/failure-summary.tsx`
- Modify: `web/src/components/session-detail/session-detail-page.tsx`
- Test: `web/src/components/session-detail/log-derive.test.ts` (create)

**Interfaces:**
- Produces: `logDisplayTitle(log: LogLike): string` and `logDisplaySubtitle(log: LogLike): string | null` in `log-derive.ts`.
- SessionLog rows have fields `command_name`, `title`, `subtitle`, `body`, `response` (see prisma SessionLog model).

- [ ] **Step 1: Write failing tests**

Create `web/src/components/session-detail/log-derive.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { logDisplayTitle, logDisplaySubtitle } from './log-derive';

describe('log display derivation', () => {
  const dbRow = {
    id: 'slog-3',
    session_id: 'sess-audit-2',
    command_name: 'findElement',
    title: 'Find Element',
    subtitle: 'accessibility id: btn_place_order',
    response: '{"error":"no such element"}',
  };

  it('prefers title over raw JSON', () => {
    expect(logDisplayTitle(dbRow as any)).toBe('Find Element');
  });

  it('falls back to command_name then a generic label', () => {
    expect(logDisplayTitle({ command_name: 'click' } as any)).toBe('click');
    expect(logDisplayTitle({} as any)).toBe('Command');
  });

  it('exposes the subtitle when present', () => {
    expect(logDisplaySubtitle(dbRow as any)).toBe('accessibility id: btn_place_order');
    expect(logDisplaySubtitle({} as any)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd web && npx vitest run src/components/session-detail/log-derive.test.ts`
Expected: FAIL — `logDisplayTitle` is not exported.

- [ ] **Step 3: Implement in `log-derive.ts`**

Add:

```ts
export function logDisplayTitle(log: LogLike): string {
  const l = log as any;
  const t = typeof l.title === 'string' && l.title.trim() ? l.title.trim() : null;
  const c = typeof l.command_name === 'string' && l.command_name.trim() ? l.command_name.trim() : null;
  return t ?? c ?? 'Command';
}

export function logDisplaySubtitle(log: LogLike): string | null {
  const s = (log as any).subtitle;
  return typeof s === 'string' && s.trim() ? s.trim() : null;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd web && npx vitest run src/components/session-detail/log-derive.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Use them in `log-row.tsx`**

Replace the raw preview span (lines 59–61):

```tsx
              <span className="font-mono text-[11px] text-[var(--text-dim)] truncate min-w-0 flex-1">
                {preview}
              </span>
```

with a title + subtitle pair (keep truncation):

```tsx
              <span className="min-w-0 flex-1 flex items-baseline gap-2 truncate">
                <span className="text-[12px] text-[var(--text)] shrink-0">{logDisplayTitle(log)}</span>
                {logDisplaySubtitle(log) && (
                  <span className="font-mono text-[11px] text-[var(--text-dim)] truncate">
                    {logDisplaySubtitle(log)}
                  </span>
                )}
              </span>
```

Import the two helpers; remove the now-unused `preview` variable/`logInlinePreview` import if nothing else uses it (check `log-derive.ts` consumers first — keep `logInlinePreview` exported for other callers if any). The expanded `JsonBlock` (lines 74–78) stays as-is.

- [ ] **Step 6: Fix First-error blob + overflow in `failure-summary.tsx`**

Replace (lines 113–119):

```tsx
  <div className="text-sm text-[var(--text-muted)]">
    {firstError?.message
      ? firstError.message
      : firstError
      ? <code className="font-mono text-xs">{JSON.stringify(firstError).slice(0, 400)}</code>
      : <span className="text-[var(--text-dim)]">(no logs captured before failure)</span>}
  </div>
```

with structured fields (title/subtitle/response — same shape as SessionLog rows):

```tsx
  <div className="text-sm text-[var(--text-muted)] min-w-0">
    {firstError?.message ? (
      <span className="break-words">{firstError.message}</span>
    ) : firstError ? (
      <dl className="space-y-1 text-xs">
        <div className="flex gap-2 min-w-0">
          <dt className="text-[var(--text-dim)] shrink-0 uppercase text-[10px] tracking-widest">Command</dt>
          <dd className="font-mono break-all">{(firstError as any).command_name || (firstError as any).title || '—'}</dd>
        </div>
        {(firstError as any).subtitle && (
          <div className="flex gap-2 min-w-0">
            <dt className="text-[var(--text-dim)] shrink-0 uppercase text-[10px] tracking-widest">Target</dt>
            <dd className="font-mono break-all">{(firstError as any).subtitle}</dd>
          </div>
        )}
        {(firstError as any).response && (
          <div className="flex gap-2 min-w-0">
            <dt className="text-[var(--text-dim)] shrink-0 uppercase text-[10px] tracking-widest">Response</dt>
            <dd className="font-mono break-all">{String((firstError as any).response).slice(0, 400)}</dd>
          </div>
        )}
      </dl>
    ) : (
      <span className="text-[var(--text-dim)]">(no logs captured before failure)</span>
    )}
  </div>
```

- [ ] **Step 7: Kill the grid blowout**

In `session-detail-page.tsx` line 170, the two-column grid `grid-cols-1 lg:grid-cols-[1fr_340px]` — add `min-w-0` to the first column's wrapper element (the direct child holding the failure summary), and add `overflow-x-hidden` to the scroll container on line 156 (`flex-1 overflow-y-auto` → `flex-1 overflow-y-auto overflow-x-hidden`).

- [ ] **Step 8: Verify + commit**

Run: `cd web && npx vitest run` — expected: all pass, plus compile check.

```bash
git add web/src/components/session-detail/log-derive.ts web/src/components/session-detail/log-derive.test.ts web/src/components/session-detail/log-row.tsx web/src/components/session-detail/failure-summary.tsx web/src/components/session-detail/session-detail-page.tsx
git commit -m "fix(session-detail): structured log rows and first-error fields instead of raw JSON; stop horizontal blowout"
```

---

### Task 5: Runbooks — real remediation content, list markers, neutral back-link

**Files:**
- Modify: `web/src/components/runbooks/runbook-content.ts`
- Modify: `web/src/components/runbooks/runbook-page.tsx`

- [ ] **Step 1: Replace the TODO in the Timeout runbook**

In `runbook-content.ts` (Timeout entry starts ~line 47) find the remediation string containing `TODO: document remediation steps for timeout failures` and replace with real content:

```
Increase `newCommandTimeout` only if the app legitimately needs long idle gaps. Otherwise: (1) check the last command in Text Logs — if it's a find, fix the selector or add an explicit wait; (2) verify the device wasn't thermally throttled or offline during the run (Device health badges); (3) if the same command times out across runs, file a bug against the test, or against the driver if the call obviously stalled.
```

Adapt to the entry's data shape (if remediation is an array of steps, write it as 3 steps). Audit the other entries (Hub Restart, Infrastructure, Unknown) for any other placeholder text and give each at least 2 concrete remediation steps consistent with its "Likely causes".

- [ ] **Step 2: Bullet markers for "Likely causes"**

In `runbook-page.tsx` find the list rendering "Likely causes" — the `<ul>`/`<li>` have no markers (Tailwind preflight removes them). Add `list-disc pl-5 space-y-1` to the `<ul>` className (or `list-disc list-inside`, matching file style).

- [ ] **Step 3: Neutral back-link**

In `runbook-page.tsx` the top bar hardcodes "Back to builds". Change the label to `Back` and make it `history.back()`-based if it currently hardcodes a route (`useNavigate()(-1)` with react-router). Keep the fallback: if `window.history.length <= 1`, navigate to `/overview`.

- [ ] **Step 4: Verify + commit**

Compile check.

```bash
git add web/src/components/runbooks/runbook-content.ts web/src/components/runbooks/runbook-page.tsx
git commit -m "fix(runbooks): real remediation content (no TODO), list markers, referrer-aware back link"
```

---

### Task 6: Device Control — stream timeout/error state + text-selection

**Files:**
- Modify: `web/src/components/device-control/device-control.tsx`
- Modify: `web/src/components/device-control/device-control.css`

**Background:** `onError` (lines ~752–758) schedules an infinite 2s retry (`setStreamRetryCount`). No cap, no timeout, no error UI. Placeholder text is selectable.

- [ ] **Step 1: Add capped retries + watchdog**

Near the other stream state (`streamLoaded`, `streamRetryCount`, `streamStarting`) add:

```tsx
const [streamFailed, setStreamFailed] = useState(false);
const MAX_STREAM_RETRIES = 10; // ~20s at the 2s retry cadence
```

Change the `<img>` `onError` to stop after the cap:

```tsx
onError={() => {
  setStreamLoaded(false);
  if (streamRetryCount >= MAX_STREAM_RETRIES) {
    setStreamFailed(true);
    return;
  }
  setTimeout(() => setStreamRetryCount((prev) => prev + 1), 2000);
}}
```

Add a watchdog for the never-fires-onLoad case — alongside the existing stream effects:

```tsx
useEffect(() => {
  if (streamLoaded || streamFailed) return;
  const t = setTimeout(() => setStreamFailed(true), 30000);
  return () => clearTimeout(t);
}, [streamLoaded, streamFailed, streamRetryCount]);
```

- [ ] **Step 2: Error UI with Retry**

In the placeholder block (lines 736–745), render the failed state first:

```tsx
{streamFailed ? (
  <div className="device-stream-placeholder" style={{ position: 'absolute', zIndex: 10 }}>
    <AlertTriangle size={40} color="var(--red, #f87171)" />
    <p style={{ marginTop: 16 }}>Stream unavailable</p>
    <button
      className="btn-premium btn-sm"
      style={{ marginTop: 12 }}
      onClick={() => {
        setStreamFailed(false);
        setStreamRetryCount(0);
      }}
    >
      Retry
    </button>
  </div>
) : (streamStarting || !streamLoaded) && (
  /* existing spinner placeholder unchanged */
)}
```

Import `AlertTriangle` from `lucide-react` (extend the existing lucide import). Also gate the `<img>` render: when `streamFailed` render nothing instead of the `<img>` (prevents background retry churn).

- [ ] **Step 3: Disable text selection on the canvas**

In `device-control.css` `.device-stream-canvas` (lines 230–245) add `user-select: none; -webkit-user-select: none;`.

- [ ] **Step 4: Verify + commit**

Compile check.

```bash
git add web/src/components/device-control/device-control.tsx web/src/components/device-control/device-control.css
git commit -m "fix(device-control): stream failure state with capped retries and Retry action; disable canvas text selection"
```

---

### Task 7: Copy & naming sweep (settings, selector-health, api-keys, ai-settings)

**Files:**
- Modify: `web/src/components/settings/settings.tsx`
- Modify: `web/src/components/settings/api-keys.tsx`
- Modify: `web/src/components/settings/ai-settings.tsx`
- Modify: `web/src/components/selector-health/selector-detail-page.tsx`

- [ ] **Step 1: settings.tsx**

Line 211–215: `title="Infrastructure Control"` → `title="Settings"` (keep icon + subtitle).
Line 282: `placeholder="e.g. 0 * * * * (At internal min 0)"` → `placeholder="e.g. 0 * * * * (hourly, at minute 0)"`.
Lines 344–348: replace the description paragraph with:

```tsx
            <p className="setting-card-description">
              Automatically intercept and recover from failing locators using Xenon&apos;s 6-tier
              strategy: etalon recovery, native retry, fuzzy XML, OCR, visual AI, and LLM —
              before failing a test.
            </p>
```

- [ ] **Step 2: api-keys.tsx subtitle spacing**

Lines 229–235: the JSX newline between `<code>xenon:accessKey</code>` and `). Keys` renders a stray space. Rewrite so the paren hugs the code element:

```tsx
        subtitle={
          <>
            Issue scoped credentials for humans (dashboard login) and machines (CI, WebDriver
            clients via <code>xenon:accessKey</code>). Keys are shown only once at creation —
            copy the value before closing the dialog.
          </>
        }
```

(If the rendered output already collapses correctly after reformatting, verify by string-checking the built HTML in the final task; the key change is ensuring no whitespace-only JSX text node sits between `</code>` and `)`.)

- [ ] **Step 3: ai-settings.tsx truth-sync**

Lines 172–201: replace the hardcoded stale descriptions using `getModelDefault` (lines 67–80) so cards can't drift:

```tsx
      description: `${getModelDefault('gemini')} — Multimodal reasoning`,
```

and equivalents for openai/anthropic/ollama (`'GPT-4o — OpenAI v1 compatible'` → `` `${getModelDefault('openai')} — OpenAI v1 compatible` ``, `'Claude Sonnet 4.6 — Advanced analysis'` → `` `${getModelDefault('anthropic')} — Advanced analysis` ``, ollama: `` `Local / self-hosted — no API key required` `` stays).
Lines 271–283 (status pill): a provider that is configured but not selected currently reads "NOT SET". Change the non-active branch to distinguish:

```tsx
                        ) : provider.isConfigured ? (
                          <span className="provider-status provider-status--ready">
                            <CheckCircle2 size={11} />
                            READY
                          </span>
                        ) : (
                          <span className="provider-status provider-status--off">
                            <Lock size={10} />
                            NOT SET
                          </span>
                        )}
```

Add a `.provider-status--ready` CSS rule next to the existing `provider-status--active` rule (same file's stylesheet — find where `provider-status--active` is defined and copy it with a dimmer green, e.g. `color: var(--text-muted); border-color: var(--border);`). Also: when `isActive && !provider.isConfigured` (the audit's "ACTIVE but 0/4 configured" case), append a warning suffix — render `ACTIVE — NO KEY` instead of `ACTIVE`:

```tsx
                        {isActive ? (
                          <span className="provider-status provider-status--active">
                            <CheckCircle2 size={11} />
                            {provider.isConfigured ? 'ACTIVE' : 'ACTIVE — NO KEY'}
                          </span>
                        ) : ...
```

- [ ] **Step 4: selector-detail-page.tsx "Hotspots list"**

Find the banner text `or open this row from the Hotspots list` and change "Hotspots list" → "Active tab on Selector Health" (grep for `Hotspots` in `web/src`).

- [ ] **Step 5: Verify + commit**

Compile check.

```bash
git add web/src/components/settings/settings.tsx web/src/components/settings/api-keys.tsx web/src/components/settings/ai-settings.tsx web/src/components/selector-health/selector-detail-page.tsx
git commit -m "fix(copy): canonical Settings title, 6-tier healing, cron hint, api-keys spacing, ai-settings truth-sync"
```

---

### Task 8: Shared date formatter + adoption

**Files:**
- Modify: `web/src/utils/time.ts`
- Modify: `web/src/components/builds/derive.ts`
- Modify: `web/src/pages/users.tsx`
- Test: `web/src/utils/time.test.ts` (create)

**Interfaces:**
- Produces: `formatDateTime(iso: string | Date | null | undefined): string` → `"Jul 16, 14:45:00"`, `'—'` for nullish/invalid.
- `formatAbsoluteTime` in `builds/derive.ts` becomes a re-export/delegate so its 3 call sites (build-list-rail.tsx:115, session-row.tsx:89, session-detail-page.tsx:117) pick the format up without edits.

- [ ] **Step 1: Failing test**

Create `web/src/utils/time.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatDateTime } from './time';

describe('formatDateTime', () => {
  it('formats as "MMM d, HH:mm:ss"', () => {
    expect(formatDateTime('2026-07-16T14:45:00')).toBe('Jul 16, 14:45:00');
  });
  it('returns em dash for nullish/invalid', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
  });
});
```

- [ ] **Step 2: Run to verify failure**

`cd web && npx vitest run src/utils/time.test.ts` — FAIL (not exported).

- [ ] **Step 3: Implement in `web/src/utils/time.ts`**

```ts
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
```

- [ ] **Step 4: Run to verify pass**

`cd web && npx vitest run src/utils/time.test.ts` — PASS.

- [ ] **Step 5: Delegate `formatAbsoluteTime`**

In `web/src/components/builds/derive.ts` replace the body of `formatAbsoluteTime` (lines 33–44) with:

```ts
export function formatAbsoluteTime(iso: string | Date | null | undefined): string {
  return formatDateTime(iso);
}
```

adding `import { formatDateTime } from '../../utils/time';`.

- [ ] **Step 6: Adopt in users.tsx**

Line 112: `new Date(u.lastLoginAt).toLocaleString()` → `formatDateTime(u.lastLoginAt)` with import `import { formatDateTime } from '../utils/time';`. (Leave time-only `toLocaleTimeString` call sites — screenshots, profiling — as they intentionally show times.)

- [ ] **Step 7: Verify + commit**

`cd web && npx vitest run` — all pass.

```bash
git add web/src/utils/time.ts web/src/utils/time.test.ts web/src/components/builds/derive.ts web/src/pages/users.tsx
git commit -m "feat(web): shared formatDateTime (MMM d, HH:mm:ss) adopted by builds, sessions, users"
```

---

### Task 9: Devices cards — utilization/host formatting + telemetry alignment

**Files:**
- Modify: `web/src/components/device-card/device-card/device-card.tsx`
- Modify: `web/src/components/device-card/health-badges.tsx`

- [ ] **Step 1: Utilization row**

Lines 213–216: rename label and show a dash when zero:

```tsx
          <KeyValueRow
            label="Time in use"
            value={
              device.totalUtilizationTimeMilliSec
                ? prettyMilliseconds(device.totalUtilizationTimeMilliSec, { compact: true })
                : '—'
            }
          />
```

- [ ] **Step 2: Host row consistency**

Line 218: normalize protocol/port display:

```tsx
        <KeyValueRow label="Host" value={formatHost(device.ip || device.host)} mono />
```

Add above the component (module scope):

```tsx
function formatHost(raw?: string): string {
  if (!raw) return '—';
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return raw;
  }
}
```

- [ ] **Step 3: Telemetry placeholder so cards align**

In `health-badges.tsx` replace `if (!showBattery && !showThermal) return null;` (line 35) with a muted placeholder pill matching the existing badge markup (copy the badge JSX used for battery, swap icon for `Activity` or similar from lucide, text `No telemetry`, tone classes for the dim/neutral variant used elsewhere in the file):

```tsx
  if (!showBattery && !showThermal) {
    return (
      <div className={/* same wrapper className as the badges row below */}>
        <span className={/* same pill className with the neutral/dim tone */} title="Device does not report battery or thermal data">
          No telemetry
        </span>
      </div>
    );
  }
```

Use the file's actual wrapper/pill classNames (visible in lines 36–58) — do not invent new CSS.

- [ ] **Step 4: Verify + commit**

Compile check.

```bash
git add web/src/components/device-card/device-card/device-card.tsx web/src/components/device-card/health-badges.tsx
git commit -m "fix(devices): humanized time-in-use, normalized host, telemetry placeholder aligns cards"
```

---

### Task 10: Builds page — header, empty states, labeled badges

**Files:**
- Modify: `web/src/components/builds/builds-page.tsx`
- Modify: `web/src/components/builds/build-list-rail.tsx`
- Modify: `web/src/components/ui/count-badge.tsx`

- [ ] **Step 1: Page header**

In `builds-page.tsx` wrap the existing `<div className="flex h-full">` (line 87) in a column and add the standard header above it:

```tsx
import { PageHeader } from '../ui/page-header';
import { MonitorPlay } from 'lucide-react';
```

```tsx
  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={MonitorPlay}
        title="Sessions"
        subtitle="Builds and the test sessions recorded against them."
      />
      <div className="flex flex-1 min-h-0">
        {/* existing rail + section children unchanged */}
      </div>
    </div>
  );
```

(Keep the inner two-pane flex exactly as-is; only re-parent. `min-h-0` is required so the rail's internal scroll keeps working.)

- [ ] **Step 2: Honest empty state in the rail**

`build-list-rail.tsx` lines 96–99 — distinguish filtered vs truly empty. The component has the search text + time filter in scope (`query`/`search` state and the select value; use the actual variable names at lines 64–86):

```tsx
        {visible.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-[var(--text-dim)]">
            {hasActiveFilter ? 'No builds match.' : 'No builds yet — sessions will appear here after your first test run.'}
          </div>
        )}
```

where `hasActiveFilter` is `true` when the search input is non-empty or the time filter ≠ `'all'` (derive from the existing state variables).

- [ ] **Step 3: Label the count badges**

In `count-badge.tsx` add an optional `label` prop rendered as `title`/`aria-label`:

```tsx
export function CountBadge({ value, tone, label }: { value: number; tone: Tone; label?: string }) {
  return (
    <span title={label} aria-label={label} className={...existing...}>
      {value}
    </span>
  );
}
```

(Adapt to the component's actual prop/typing style at lines 8–21.) Then in `build-list-rail.tsx` lines 117–124 pass labels:

```tsx
  {b.passedCount  > 0 && <CountBadge value={b.passedCount}  tone="green" label={`${b.passedCount} passed`} />}
  {b.failedCount  > 0 && <CountBadge value={b.failedCount}  tone="red"   label={`${b.failedCount} failed`} />}
  {b.runningCount > 0 && <CountBadge value={b.runningCount} tone="amber" label={`${b.runningCount} running`} />}
```

- [ ] **Step 4: Verify + commit**

Compile check; `cd web && npx vitest run` still green.

```bash
git add web/src/components/builds/builds-page.tsx web/src/components/builds/build-list-rail.tsx web/src/components/ui/count-badge.tsx
git commit -m "fix(builds): standard page header, honest empty states, labeled count badges"
```

---

### Task 11: Users page — header, card, action row

**Files:**
- Modify: `web/src/pages/users.tsx`

- [ ] **Step 1: PageHeader**

Replace the plain header (lines 66–74) with the standard pattern:

```tsx
import { PageHeader } from '../components/ui/page-header';
import { Users as UsersIcon, Plus } from 'lucide-react';
```

```tsx
      <PageHeader
        icon={UsersIcon}
        title="Users"
        subtitle="Dashboard accounts, roles, and access status."
        action={
          <button type="button" className="page-header-action" onClick={() => setShowInvite(true)}>
            <Plus size={16} />
            <span>Invite user</span>
          </button>
        }
      />
```

Note: `PageHeader` renders its own `px-6` padding — adjust the page root (line 65 `px-8 py-6 max-w-5xl`) so the header spans full width with the table constrained below (move `max-w-5xl px-8 py-6` onto a wrapper around the table only).

- [ ] **Step 2: Card-contained table**

Wrap the `<table>` (lines 85+) in:

```tsx
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <table className="w-full text-sm">
```

Give header cells breathing room: `py-2` → `py-2.5 px-4` on `<th>`, `py-2` → `py-2.5 px-4` on `<td>` (all cells, keeping existing alignment classes). Loading/empty rows get the same horizontal padding.

- [ ] **Step 3: Action row never wraps**

Replace the actions cell (line 114) `className="py-2 text-right space-x-2"` with:

```tsx
                  <td className="py-2.5 px-4">
                    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
```

(close the `div` after the third button) and add `aria-label`s mirroring each `title` (`aria-label="Edit user"`, `aria-label="Send password-reset link"`, `aria-label="Delete user"`).

- [ ] **Step 4: Verify + commit**

Compile check.

```bash
git add web/src/pages/users.tsx
git commit -m "fix(users): standard header, carded table, non-wrapping labeled action row"
```

---

### Task 12: Auth pages — shared brand shell + accurate chips

**Files:**
- Create: `web/src/pages/auth-shell.tsx`
- Modify: `web/src/pages/login.tsx`
- Modify: `web/src/pages/forgot-password.tsx`
- Modify: `web/src/pages/reset-password.tsx`

**Interfaces:**
- Produces: `AuthShell({ children }: { children: React.ReactNode })` — renders the split layout: brand `<aside>` (left) + right pane centering `children`.

- [ ] **Step 1: Extract the shell**

Create `web/src/pages/auth-shell.tsx` by lifting login.tsx's layout (aside = lines 36–53) verbatim, with two copy fixes inside the move: chip `'5-tier Healing'` → `'6-tier Healing'`, and replace the jargon chip set with benefit-oriented labels:

```tsx
{['Self-healing tests', 'Live device streaming', 'Hub-node scaling', 'Proof-pack recording'].map((t) => (
```

Component skeleton:

```tsx
import React from 'react';

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full flex bg-[var(--bg)] text-[var(--text)]">
      <aside /* lifted verbatim from login.tsx lines 36–53, with the chip edits above */ />
      <main className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-sm px-6">{children}</div>
      </main>
    </div>
  );
}
```

Match login.tsx's actual outer-container classes when lifting (don't invent; copy). Include the "X" logo mark if login's aside already renders one; if not, add the same logo element the sidebar `Xenon home` button uses (find it in the layout component) above the "Xenon" heading.

- [ ] **Step 2: Use it in all three pages**

- `login.tsx`: replace its inline aside+wrapper with `<AuthShell>` around the existing form.
- `forgot-password.tsx`: replace the centered-only wrapper (line 27) with `<AuthShell>` around the existing `<form>` content (drop the form's own `max-w-sm px-6` since the shell provides it).
- `reset-password.tsx`: same replacement (root at lines 82–84); keep all state branches (invalid-link view included) inside the shell.

- [ ] **Step 3: Unify the primary button**

Ensure all three pages' submit buttons share the exact class string `mt-5 w-full h-10 rounded-md bg-[var(--green)] text-black font-medium text-sm disabled:opacity-50`.

- [ ] **Step 4: Verify + commit**

Compile check; `cd web && npx vitest run` (auth smoke test must stay green — it may assert on login markup; fix selectors if the test references moved nodes, without weakening assertions).

```bash
git add web/src/pages/auth-shell.tsx web/src/pages/login.tsx web/src/pages/forgot-password.tsx web/src/pages/reset-password.tsx
git commit -m "fix(auth): shared brand shell across login/forgot/reset; accurate 6-tier copy; unified primary button"
```

---

### Task 13: Overview + Maintenance + Notifications polish

**Files:**
- Modify: `web/src/components/overview/overview.tsx`
- Modify: `web/src/components/overview/session-trend.tsx`
- Modify: `web/src/components/settings/maintenance-settings.tsx` (+ its CSS if the notice uppercase is CSS-driven)
- Modify: `web/src/components/webhook-settings/webhook-settings.tsx` (+ its CSS)

- [ ] **Step 1: Overview H1**

`overview.tsx` lines 39–41: `{TENANT_NAME} <span ...>·</span> Overview` → just `Overview`. Keep the breadcrumb line above (it already provides the "Xenon /" context); the logo covers branding.

- [ ] **Step 2: Session-trend empty message**

In `session-trend.tsx`, when every bucket is zero render a message instead of the fake 2%-bars. Above the bars markup add:

```tsx
  const isEmpty = data.every((d) => d.sessions === 0 && (d as any).heals === 0);
```

(match the actual bucket field names — `sessions` confirmed at line 11; check for a heals field and drop the second clause if absent) and in the chart body:

```tsx
  {isEmpty ? (
    <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-dim)]">
      No sessions in the last 24 hours — activity will chart here.
    </div>
  ) : (
    /* existing bars */
  )}
```

Keep the x-axis labels row rendering in both branches if it lives outside the bars container.

- [ ] **Step 3: Maintenance notice sentence-case + balanced grid**

Find the CSS for `.maintenance-notice` / `.health-monitor-alert` (grep in `web/src/components/settings/*.css`); remove/override any `text-transform: uppercase` and reduce `letter-spacing` to normal for `.maintenance-notice`. In `maintenance-settings.tsx` line 129, if the grid class is `settings-grid`, add the two-column modifier used elsewhere (check `settings.css` for `settings-grid--two`; if only `--three` exists, add a `--two` rule `grid-template-columns: repeat(2, minmax(0,1fr));` beside it) so 4 cards sit 2×2.

- [ ] **Step 4: Notification trigger chips**

In the webhook CSS (grep `event-toggle--` in `web/src/components/webhook-settings/`), make the lead icon neutral: add

```css
.event-toggle .event-toggle__lead { color: var(--text-dim); }
.event-toggle.is-selected .event-toggle__lead { color: inherit; }
```

so the red/amber tone only colors the chip frame when selected, and the selection state is carried by the single trailing check + border (remove any per-tone rule that colors the lead icon red/amber in the unselected state if present).

- [ ] **Step 5: Verify + commit**

Compile check.

```bash
git add web/src/components/overview/overview.tsx web/src/components/overview/session-trend.tsx web/src/components/settings/maintenance-settings.tsx web/src/components/webhook-settings/webhook-settings.tsx
git add web/src/components/settings/*.css web/src/components/webhook-settings/*.css
git commit -m "fix(polish): Overview H1, session-trend empty state, maintenance notice case, neutral trigger-chip icons"
```

(Only add the CSS files actually modified.)

---

### Task 14: A11y sweep + command palette + mosaic picker

**Files:**
- Modify: `web/src/components/device-control/device-control.tsx`
- Modify: `web/src/components/omni-inspector/OmniInspector.tsx`
- Modify: `web/src/components/command-palette/command-palette.tsx`
- Modify: `web/src/components/mosaic/DevicePicker.tsx`
- Modify: `web/src/components/mosaic/DeviceMosaicView.tsx`

- [ ] **Step 1: Tablist semantics + labels (device-control.tsx)**

Tab bar (lines 813–849): add `role="tablist"` to `.interaction-tabs` div; each `.tab-btn` gets `role="tab"` and `aria-selected={activeTab === '<key>'}`. Lock/Unlock buttons (lines 803–808) get `aria-label="Lock device"` / `aria-label="Unlock device"`. Add `aria-label="Filter debug logs"` to the log filter input (line ~1152).

- [ ] **Step 2: Omni labels**

`OmniInspector.tsx`: element search input (lines 1068–1081) gets `aria-label="Search elements"`; inner detail tabs (1101–1124) get `role="tab"` + `aria-selected` and the container `role="tablist"`.

- [ ] **Step 3: Command palette completeness**

`command-palette.tsx` lines 31–45: the index supports teams/keys but never populates them. Extend the `Promise.all` with the API calls that exist on `XenonApiService` (verify exact names — grep `getTeams`/`getApiKeys`/`getKeys` in `web/src/api-service/`; wire whichever exist):

```tsx
Promise.all([
  XenonApiService.getDevices().catch(() => []),
  XenonApiService.getSessions().catch(() => []),
  XenonApiService.getApps().catch(() => []),
  XenonApiService.getTeams?.().catch(() => []) ?? [],
]).then(([d, s, a, t]: [any, any, any, any]) => {
  if (Array.isArray(d)) idxRef.current.setDevices(d);
  if (Array.isArray(s)) idxRef.current.setSessions(s);
  if (Array.isArray(a)) idxRef.current.setApps(a);
  if (Array.isArray(t)) idxRef.current.setTeams(t);
});
```

(If no teams API client method exists, add nothing new server-side — skip teams and note it in the commit body. Do NOT index API keys' secret material; index only key names if wired.)

- [ ] **Step 4: Mosaic picker offline truth + legend**

`DeviceMosaicView.tsx` `asPickerDevice` (lines 76–85): include `offline: !!d.offline` in the mapped object, and add `offline?: boolean` to the `PickerDevice` interface (DevicePicker.tsx lines 3–16). In `DevicePicker.tsx` dot logic (lines 178–183):

```tsx
                        <span
                          aria-hidden
                          className={`inline-block w-1.5 h-1.5 rounded-full ${
                            d.offline
                              ? 'bg-zinc-600'
                              : online
                              ? 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.7)]'
                              : 'bg-yellow-500'
                          }`}
                        />
```

Below the list (near the "Click a device to add…" hint), add a one-line legend:

```tsx
<div className="text-[10px] text-[var(--text-dim)] px-1 pt-2 flex items-center gap-3">
  <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" /> available</span>
  <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" /> in use</span>
  <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-zinc-600 inline-block" /> offline</span>
</div>
```

Also make offline devices non-selectable: extend the existing `blocked` computation (line 137) with `|| !!d.offline`.

- [ ] **Step 5: Verify + commit**

Compile check; `cd web && npx vitest run`.

```bash
git add web/src/components/device-control/device-control.tsx web/src/components/omni-inspector/OmniInspector.tsx web/src/components/command-palette/command-palette.tsx web/src/components/mosaic/DevicePicker.tsx web/src/components/mosaic/DeviceMosaicView.tsx
git commit -m "fix(a11y+ux): tab semantics and labels, palette indexes teams, mosaic picker honors offline with legend"
```

---

### Task 15: Build, live verification walk, cleanup, PR

**Files:** none created (verification + PR).

- [ ] **Step 1: Full rebuild + reinstall**

From repo root:

```bash
npm run build:xenon && npm run build:copy
```

Then reinstall the plugin into the server's APPIUM_HOME (`/Users/rabindrabiswal/.appium`) the same way `npm run dev` does (check package.json's `install-plugin` script; run the appium plugin install/update step only, not the full dev loop), and restart the Xenon server via the Xenon Control mac app (Stop → Start). Verify freshness: the changed asset hashes exist in `~/.appium/node_modules/@xenon-device-management/xenon/lib/public/assets/`.

- [ ] **Step 2: Walk every touched page at 1280 and 1440**

With browser preview at `http://127.0.0.1:4723/xenon/`, verify each acceptance criterion:
- `/apps`: filter input dark, typed text visible; header "Apps"; empty state "No apps yet" + "Upload your first app".
- `/profile` → API Tokens: shows empty state (not "Loading…"); header with identity.
- `/devices/<udid>/control` at **1280**: all 5 tab labels readable (ellipsis acceptable, no hard clip); Debug Logs EXPORT visible; OMNI-VISION right panel fully inside viewport; inner INFO/AI INSIGHT/CODE GEN tabs visible.
- Session detail (seeded `sess-audit-2`): log rows show "Find Element — accessibility id: btn_place_order" style lines; First error shows labeled fields; no horizontal scroll.
- `/runbooks/timeout`: no TODO; bulleted causes; "Back".
- Stream: with the device disconnected or stream blocked, error state + Retry appears within ~30s (if impractical to force, verify the code path with a temporary bad stream URL in devtools).
- `/builds`: header present; badges have tooltips; date format "Jul 16, …".
- `/users`, `/teams`, auth pages, `/overview`, `/maintenance`, `/notifications`, `/ai-settings`, `/settings`, `/devices`, `/devices/live` per their tasks.

- [ ] **Step 3: Viewport guard**

Run: `npm run test:viewport` against the running server. Expected: PASS. Run `cd web && npx vitest run` once more.

- [ ] **Step 4: Remove seeded audit rows**

```bash
sqlite3 /Users/rabindrabiswal/.cache/xenon/xenon-dev.db "DELETE FROM SessionLog WHERE session_id LIKE 'sess-audit-%'; DELETE FROM Session WHERE id LIKE 'sess-audit-%'; DELETE FROM Build WHERE id LIKE 'build-audit-%';"
```

Confirm: counts return 0.

- [ ] **Step 5: Push + PR**

```bash
git push -u origin fix/dashboard-uiux-audit
gh pr create --title "fix(dashboard): UI/UX audit remediation — 24 findings across all pages" --body "$(cat <<'EOF'
## Summary
Fixes all 24 findings from the 2026-07-16 dashboard UI/UX audit (spec: docs/superpowers/specs/2026-07-16-dashboard-uiux-audit-design.md).

- P0: invisible Apps filter input, stuck Profile tokens loading, 1280px device-control clipping, raw-JSON session logs/first-error, shipped runbook TODO, stream dead-end
- P1: canonical naming (Apps/Settings/Sessions), 6-tier copy, device card formatting, builds/users/profile headers, auth brand shell, maintenance/overview polish
- P2: shared date format, a11y labels + tab semantics, palette index, mosaic offline truth + legend, chip color logic

## Test plan
- [x] cd web && npx vitest run
- [x] npm run test:viewport at 1280/1440
- [x] Manual walk of every touched route at 1280 and 1440
EOF
)"
```

Report the PR URL. Do not merge without explicit approval.
