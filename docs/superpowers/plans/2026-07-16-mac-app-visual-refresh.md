# Xenon Control Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the Xenon Control mac app to the dashboard's dark graphite + emerald identity and land the structural UX upgrades (segmented controls, chip/table editors, settings nav+search, menu bar, toasts, richer sidebar) from the approved spec.

**Architecture:** A `tokens.css` ported from `web/src/tokens.css` is the single color source; Tailwind maps semantic names onto those CSS variables and every component uses only semantic classes. New shared primitives live in `mac-app/src/renderer/src/components/ui/`. Menu-bar actions flow main → renderer over a new `evt:menuAction` IPC event.

**Tech Stack:** Electron 33, React 18, Tailwind 3 (CSS-var mapped), electron-vite, vitest (node env, `test/*.spec.ts`), Playwright e2e (`test/e2e/app.e2e.spec.ts`), @fontsource/inter + @fontsource/jetbrains-mono.

**Spec:** `docs/superpowers/specs/2026-07-16-mac-app-visual-refresh-design.md`

## Global Constraints

- Dark-only: `color-scheme: dark`; after Task 2 no `dark:` variant and no raw `slate-*`/`white` color class remains under `mac-app/src/renderer`.
- All colors come from `tokens.css` variables via the Tailwind semantic names defined in Task 1 — no new hex values in components.
- Fonts are bundled (fontsource imports); the renderer makes no network requests.
- Every task ends with: `npm run typecheck && npx vitest run` green, and (where stated) `npm run build && npx playwright test` green. Working dir for all commands: `mac-app/`.
- All existing e2e tests must stay green; tasks that intentionally change a tested behavior update that test in the same task.
- Commit after every task (small, focused commits on `feat/mac-app-visual-refresh`).
- Never commit `temp-appium/*` changes.

---

### Task 1: Design tokens, Tailwind mapping, fonts

**Files:**
- Create: `mac-app/src/renderer/src/tokens.css`
- Modify: `mac-app/tailwind.config.mjs`, `mac-app/src/renderer/src/styles.css`, `mac-app/src/renderer/src/main.tsx`, `mac-app/package.json` (deps)

**Interfaces:**
- Produces Tailwind semantic classes used by ALL later tasks:
  `bg-app`, `bg-surface`, `bg-surface2`, `border-line`, `border-line-strong`,
  `text-ink`, `text-muted`, `text-dim`,
  `accent` palette (`bg-accent`, `text-accent`, `border-accent`, `bg-accent-dim`),
  `warn`, `danger`, `info` (each usable as bg/text/border), and
  `font-sans` = Inter, `font-mono` = JetBrains Mono.
- Produces `.focus-ring` utility class (green focus ring) for interactive elements.

- [ ] **Step 1: Install bundled fonts**

Run: `npm i @fontsource/inter @fontsource/jetbrains-mono`
Expected: added to `dependencies` in `mac-app/package.json`.

- [ ] **Step 2: Create tokens.css** (ported from `web/src/tokens.css`, launcher subset)

```css
/* Xenon design tokens — ported from web/src/tokens.css (keep in sync). */
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

  --accent-subtle: rgba(34, 197, 94, 0.1);
  --accent-border: rgba(34, 197, 94, 0.3);
}
```

- [ ] **Step 3: Map Tailwind to the tokens** — replace `theme.extend.colors` in `tailwind.config.mjs`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface-2)',
        line: { DEFAULT: 'var(--border)', strong: 'var(--border-strong)' },
        ink: 'var(--text)',
        muted: 'var(--text-muted)',
        dim: 'var(--text-dim)',
        accent: { DEFAULT: 'var(--green)', dim: 'var(--green-dim)', fg: '#052e14' },
        warn: 'var(--amber)',
        danger: 'var(--red)',
        info: 'var(--blue)'
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
};
```

(Note: `darkMode` key removed — the app is dark-only.)

- [ ] **Step 4: Update styles.css** — import tokens, set base styles and the focus utility:

```css
@import './tokens.css';
@tailwind base;
@tailwind components;
@tailwind utilities;

:root { color-scheme: dark; }

html, body, #root { height: 100%; margin: 0; }

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  background: var(--bg);
  color: var(--text);
}

.titlebar-drag { -webkit-app-region: drag; }
.titlebar-no-drag { -webkit-app-region: no-drag; }

@layer utilities {
  .focus-ring {
    @apply outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-1 focus-visible:ring-offset-app;
  }
}
```

- [ ] **Step 5: Import fonts in main.tsx** (before `./styles.css`):

```ts
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
```

- [ ] **Step 6: Verify build + tests**

Run: `npm run typecheck && npx vitest run && npm run build && npx playwright test`
Expected: all green (app still mostly old-styled; only base body colors shift).

- [ ] **Step 7: Commit** — `git add mac-app && git commit -m "feat(mac-app): design tokens, semantic Tailwind mapping, bundled Inter/JetBrains Mono"`

---

### Task 2: Semantic class sweep (the reskin)

**Files:**
- Modify: every file under `mac-app/src/renderer/src/` that uses color classes:
  `App.tsx`, `components/{ProfileList,SettingsForm,SecretsPanel,EnvVarsEditor,HealthPanel,LogConsole,StatusBar,LaunchPreview}.tsx`

**Interfaces:**
- Consumes Task 1's semantic classes. Produces the fully dark app; later tasks style new components with the same vocabulary.

- [ ] **Step 1: Apply the mapping table to every renderer file.** Replace old → new (delete every `dark:` variant in the same pass — the new class is the only one):

| Old | New |
|---|---|
| `bg-white`, `dark:bg-slate-950` | `bg-app` |
| `bg-slate-50`, `dark:bg-slate-900/60`, `bg-slate-100 (chips)` | `bg-surface` |
| `bg-slate-800`, `dark:bg-slate-800`, input backgrounds | `bg-surface2` |
| `bg-slate-900` (log/code panels) | `bg-app` with `border border-line` |
| `border-slate-200`, `dark:border-slate-700/800` | `border-line` |
| `border-slate-300`, `dark:border-slate-600` | `border-line-strong` |
| `text-slate-900`, `dark:text-slate-100` | `text-ink` |
| `text-slate-500/600`, `dark:text-slate-300/400` | `text-muted` |
| `text-slate-400` | `text-dim` |
| `emerald-*` (status/running/start) | `accent` / `accent-dim` |
| `rose-*` | `danger` (bg tints: `bg-danger/10`, borders: `border-danger/30`) |
| `amber-*` | `warn` (tints as above) |
| `sky-*` (log system lines) | `info` |
| `bg-accent/10 text-accent` (active profile) | keep, now green |
| hover `hover:bg-slate-100 dark:hover:bg-slate-800` | `hover:bg-surface2` |

Also: add `focus-ring` to every `<button>`, `<input>`, `<select>`, `<textarea>`.
LogConsole panel + LaunchPreview `pre`/`code` blocks get `font-mono` (already) on `bg-app border border-line rounded-lg`.

- [ ] **Step 2: Grep-verify the sweep is complete**

Run: `grep -rnE "slate-|dark:|bg-white|rose-|emerald-|sky-|amber-" src/renderer/src --include=*.tsx --include=*.ts | grep -v tokens.css`
Expected: no output.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build && npx playwright test`
Expected: 14/14 e2e green.

- [ ] **Step 4: Commit** — `git commit -am "feat(mac-app): dark graphite reskin via semantic token classes"`

---

### Task 3: UI primitives — Button and Toast

**Files:**
- Create: `mac-app/src/renderer/src/components/ui/Button.tsx`, `mac-app/src/renderer/src/components/ui/toastStore.ts`, `mac-app/src/renderer/src/components/ui/Toaster.tsx`
- Test: `mac-app/test/toastStore.spec.ts`
- Modify: `App.tsx` (mount `<Toaster />`, fire toasts on export/import), `LaunchPreview.tsx` (toast on copy + save), `LogConsole.tsx` (toast on copy), `SecretsPanel.tsx` (toast on save/clear), `StatusBar.tsx`, `HealthPanel.tsx` (adopt Button)

**Interfaces:**
- Produces `Button`: `({ variant?: 'primary'|'danger'|'ghost'; size?: 'sm'|'md'; icon?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>)`.
- Produces `toast(message: string, kind?: 'success'|'error')` (module fn, importable anywhere), `subscribeToasts(cb: (toasts: Toast[]) => void): () => void`, `dismissToast(id: number)`, `type Toast = { id: number; message: string; kind: 'success'|'error' }`, and `_resetToasts()` for tests.
- Produces `<Toaster />` rendered once at app root.

- [ ] **Step 1: Write failing toastStore tests** (`test/toastStore.spec.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetToasts, dismissToast, subscribeToasts, toast } from '../src/renderer/src/components/ui/toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetToasts();
  });

  it('notifies subscribers when a toast is added', () => {
    const seen: unknown[][] = [];
    subscribeToasts((t) => seen.push([...t]));
    toast('Profile exported');
    expect(seen.at(-1)).toMatchObject([{ message: 'Profile exported', kind: 'success' }]);
  });

  it('auto-dismisses after 4 seconds', () => {
    let current: unknown[] = [];
    subscribeToasts((t) => (current = t));
    toast('bye');
    vi.advanceTimersByTime(4100);
    expect(current).toEqual([]);
  });

  it('dismisses manually by id and unsubscribes cleanly', () => {
    let current: Array<{ id: number }> = [];
    const off = subscribeToasts((t) => (current = t as never));
    toast('a');
    dismissToast(current[0].id);
    expect(current).toEqual([]);
    off();
  });
});
```

- [ ] **Step 2: Run to verify RED** — `npx vitest run test/toastStore.spec.ts` → FAIL (module not found).

- [ ] **Step 3: Implement toastStore.ts**

```ts
export type ToastKind = 'success' | 'error';
export interface Toast { id: number; message: string; kind: ToastKind }

const AUTO_DISMISS_MS = 4000;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<(t: Toast[]) => void>();

function emit() { for (const l of listeners) l(toasts); }

export function toast(message: string, kind: ToastKind = 'success'): void {
  const t = { id: nextId++, message, kind };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => dismissToast(t.id), AUTO_DISMISS_MS);
}

export function dismissToast(id: number): void {
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) emit();
}

export function subscribeToasts(cb: (t: Toast[]) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function _resetToasts(): void { toasts = []; nextId = 1; }
```

- [ ] **Step 4: Verify GREEN** — `npx vitest run test/toastStore.spec.ts` → 3 passing.

- [ ] **Step 5: Implement Button.tsx and Toaster.tsx**

```tsx
// Button.tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../cn';

const VARIANTS = {
  primary: 'bg-accent text-accent-fg font-medium hover:bg-accent-dim',
  danger: 'bg-danger text-white font-medium hover:bg-danger/80',
  ghost: 'border border-line-strong text-ink hover:bg-surface2'
} as const;
const SIZES = { sm: 'px-2 py-1 text-xs rounded', md: 'px-3 py-1.5 text-sm rounded-md' } as const;

export function Button({
  variant = 'ghost',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: { variant?: keyof typeof VARIANTS; size?: keyof typeof SIZES; icon?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn('inline-flex items-center gap-1.5 focus-ring disabled:opacity-50', VARIANTS[variant], SIZES[size], className)}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
```

```tsx
// Toaster.tsx
import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { dismissToast, subscribeToasts, type Toast } from './toastStore';
import { cn } from '../../cn';

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  return (
    <div className="pointer-events-none fixed bottom-14 right-4 z-[60] flex flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className={cn(
            'pointer-events-auto flex items-center gap-2 rounded-md border px-3 py-2 text-sm shadow-lg',
            'bg-surface2 border-line-strong text-ink'
          )}
        >
          {t.kind === 'success' ? <CheckCircle2 size={14} className="text-accent" /> : <XCircle size={14} className="text-danger" />}
          {t.message}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Wire it** — mount `<Toaster />` last inside App's root div. Fire `toast(...)`:
  - App `profiles.export(...)` → `.then((ok) => ok && toast('Profile exported'))`
  - App `importProfiles` → `toast(\`Imported ${importedIds.length} profile(s)\`)` when non-empty
  - LaunchPreview Copy → `toast('Config copied')`; Save config → `ok && toast('Config saved')`
  - LogConsole Copy → `toast('Logs copied')`
  - SecretsPanel save → `toast('Secret stored in Keychain')`; clear → `toast('Secret cleared')`
  Replace hand-rolled `<button>`s in StatusBar (Preview/Dashboard → `Button` ghost; Start → `variant="primary"`; Stop → `variant="danger"`), HealthPanel (Re-check ghost sm, Install primary), LaunchPreview footer, LogConsole Copy (ghost sm).

- [ ] **Step 7: e2e — toast appears after export.** Add to `test/e2e/app.e2e.spec.ts` (after the launch-preview test):

```ts
test('copying the preview config shows a toast', async () => {
  await page.getByTestId('preview-button').click();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByText('Config copied')).toBeVisible();
  await page.keyboard.press('Escape');
});
```

- [ ] **Step 8: Verify all** — `npm run typecheck && npx vitest run && npm run build && npx playwright test` → green.

- [ ] **Step 9: Commit** — `git commit -am "feat(mac-app): Button primitive and toast feedback system"`

---

### Task 4: Segmented control + green toggle

**Files:**
- Create: `mac-app/src/renderer/src/components/ui/Segmented.tsx`
- Modify: `mac-app/src/renderer/src/components/SettingsForm.tsx` (select→segmented for ≤4 enum values; toggle already green from Task 2 sweep)
- Modify: `mac-app/test/e2e/app.e2e.spec.ts` ("persists a setting change" test)

**Interfaces:**
- Produces `Segmented`: `{ options: string[]; value: string | undefined; onChange: (v: string | undefined) => void; 'aria-label'?: string }`. Renders a `role="radiogroup"` of `role="radio"` buttons; clicking the active option again does nothing; options are the enum values plus no "(default)" entry — an unset value shows no selection and the field's default is used (matches current select semantics where `''` = default).

- [ ] **Step 1: Implement Segmented.tsx**

```tsx
import { cn } from '../../cn';

export function Segmented({
  options,
  value,
  onChange,
  'aria-label': ariaLabel
}: {
  options: string[];
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  'aria-label'?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-md border border-line-strong bg-surface p-0.5">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(active ? undefined : opt)}
            className={cn(
              'focus-ring rounded px-2.5 py-1 text-xs font-medium transition-colors',
              active ? 'bg-accent/15 text-accent' : 'text-muted hover:text-ink'
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
```

(Clicking the active option clears back to default — replaces the select's "(default)" entry.)

- [ ] **Step 2: Use it in SettingsForm** — in `FieldControl`, `case 'select'`: if `field.enum && field.enum.length <= 4` return `<Segmented options={field.enum} value={effective as string | undefined} onChange={onChange} aria-label={field.label} />`; else keep the (restyled) `<select>`.

- [ ] **Step 3: Update the e2e persistence test** to drive the segmented control:

```ts
test('persists a setting change through the store', async () => {
  await openTab('Settings');
  const android = page.getByRole('radio', { name: 'android', exact: true }).first();
  await android.click();
  await expect(android).toHaveAttribute('aria-checked', 'true');
  await openTab('Health');
  await openTab('Settings');
  await expect(page.getByRole('radio', { name: 'android', exact: true }).first()).toHaveAttribute('aria-checked', 'true');
});
```

- [ ] **Step 4: Verify** — `npm run typecheck && npm run build && npx playwright test` → green.
- [ ] **Step 5: Commit** — `git commit -am "feat(mac-app): segmented controls for small enums"`

---

### Task 5: Sidebar shell — brand, profile badges, status card

**Files:**
- Modify: `mac-app/src/renderer/src/App.tsx` (title bar → thin drag strip; sidebar gains brand header + status card), `mac-app/src/renderer/src/components/ProfileList.tsx` (row badges)

**Interfaces:**
- Consumes `Profile.settings.platform` (`'ios'|'android'|'both'|undefined`), `Profile.server.port`, `ServerState` (already in App).
- Produces sidebar test hooks: `data-testid="sidebar-brand"`, `data-testid="sidebar-status"`.
- ProfileList gains prop `serverState: ServerState` is NOT needed — running dot stays via `runningId`. New optional row subtitle comes from the profile itself.

- [ ] **Step 1: Title bar & brand.** In App.tsx replace the centered-title bar with a 40px drag-only strip (`className="titlebar-drag h-10 shrink-0"` — no text), and add at the top of `<aside>` (below the strip, so it clears the traffic lights):

```tsx
<div data-testid="sidebar-brand" className="mb-4 flex items-center gap-2 px-1">
  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 font-mono text-sm font-semibold text-accent">X</div>
  <span className="text-sm font-semibold tracking-wide text-ink">Xenon Control</span>
</div>
```

The `<aside>` becomes `w-64 bg-surface border-r border-line` and the whole left column top (strip + brand) stays inside the drag region except interactive children (`titlebar-no-drag` on the profile list container).

- [ ] **Step 2: Profile row badges.** In ProfileList rows, under the name line add:

```tsx
<span className="flex items-center gap-1.5 text-[10px] text-dim">
  <span className="rounded bg-surface2 px-1 py-px font-mono uppercase">{platformLabel(p)}</span>
  <span className="font-mono">:{p.server.port}</span>
</span>
```

with `function platformLabel(p: Profile): string { const v = p.settings.platform; return v === 'ios' ? 'iOS' : v === 'android' ? 'Android' : 'Both'; }` in the same file. Rows become two-line (`flex-col items-start`, actions absolutely positioned right or kept in the first line — keep first-line layout: name+dot left, actions right; badge line below).

- [ ] **Step 3: Status card.** In App.tsx sidebar bottom (`mt-auto`), replace the `schema: plugin …` line:

```tsx
<div data-testid="sidebar-status" className="mt-auto rounded-lg border border-line bg-surface2 p-3 text-xs">
  <div className="flex items-center gap-2">
    <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[serverState.status])} />
    <span className="font-medium text-ink">{STATUS_LABEL[serverState.status]}</span>
    {serverState.port != null && serverState.status === 'running' && (
      <span className="font-mono text-muted">:{serverState.port}</span>
    )}
  </div>
  {serverState.status === 'running' && serverState.startedAt && (
    <div className="mt-1 text-dim">up {formatUptime(now - serverState.startedAt)}</div>
  )}
  <div className="mt-1 text-dim">plugin {meta?.pluginVersion ?? '…'}</div>
</div>
```

with, in App.tsx:

```ts
const STATUS_DOT: Record<ServerState['status'], string> = {
  stopped: 'bg-dim', starting: 'bg-warn animate-pulse', running: 'bg-accent',
  stopping: 'bg-warn animate-pulse', crashed: 'bg-danger'
};
const STATUS_LABEL: Record<ServerState['status'], string> = {
  stopped: 'Stopped', starting: 'Starting…', running: 'Running', stopping: 'Stopping…', crashed: 'Crashed'
};
export function formatUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
```

and a 1s ticker only while running: `const [now, setNow] = useState(Date.now()); useEffect(() => { if (serverState.status !== 'running') return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [serverState.status]);`

- [ ] **Step 4: Unit test formatUptime** (`mac-app/test/uptime.spec.ts`) — write BEFORE implementing Step 3's helper, watch it fail, then implement:

```ts
import { describe, expect, it } from 'vitest';
import { formatUptime } from '../src/renderer/src/App';

describe('formatUptime', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatUptime(5_000)).toBe('5s');
    expect(formatUptime(65_000)).toBe('1m 5s');
    expect(formatUptime(3_720_000)).toBe('1h 2m');
  });
  it('clamps negative deltas to zero', () => {
    expect(formatUptime(-100)).toBe('0s');
  });
});
```

(If importing App.tsx pulls JSX into the node test env and fails, move `formatUptime` + the STATUS maps to a new `src/renderer/src/serverStatus.ts` and import from there in both App.tsx and the test.)

- [ ] **Step 5: e2e** — the boot test asserts `getByText('Xenon Control')` (still present, now in sidebar); add:

```ts
test('sidebar shows brand, platform badge and status card', async () => {
  await expect(page.getByTestId('sidebar-brand')).toBeVisible();
  await expect(page.getByTestId('sidebar-status')).toContainText('Stopped');
  await expect(page.getByText('Both', { exact: true }).first()).toBeVisible();
});
```

- [ ] **Step 6: Verify** — `npm run typecheck && npx vitest run && npm run build && npx playwright test` → green.
- [ ] **Step 7: Commit** — `git commit -am "feat(mac-app): branded sidebar with profile badges and server status card"`

---

### Task 6: Tab semantics + footer status bar polish

**Files:**
- Modify: `mac-app/src/renderer/src/App.tsx` (tabs), `mac-app/src/renderer/src/components/StatusBar.tsx`
- Modify: `mac-app/test/e2e/app.e2e.spec.ts` (`openTab` helper)

**Interfaces:**
- Tabs render `role="tablist"` container; each tab `role="tab"` + `aria-selected`. E2E selects tabs via `getByRole('tab', { name })`.

- [ ] **Step 1: Tabs.** Tab bar div gets `role="tablist"`; each tab button gets `role="tab"` and `aria-selected={tab === t.id}`, `focus-ring`, active style `border-accent text-accent`, inactive `border-transparent text-muted hover:text-ink`.

- [ ] **Step 2: Update `openTab`** in the e2e file:

```ts
async function openTab(name: 'Settings' | 'Secrets & Env' | 'Health' | 'Logs') {
  await page.getByRole('tab', { name, exact: true }).click();
}
```

Also update the "logs tab is reachable" test to use `getByRole('tab', { name: 'Logs' })`.

- [ ] **Step 3: Status bar.** Height `py-3`; when running, dashboard URL is a clickable text link next to the status label: `<button onClick={() => window.xenon.server.openDashboard(state.dashboardUrl!)} className="focus-ring font-mono text-xs text-accent hover:underline">{state.dashboardUrl}</button>` (keep the existing Dashboard `Button` too — remove it in favor of the link to reduce clutter). Buttons already converted in Task 3.

- [ ] **Step 4: Verify** — `npm run build && npx playwright test` → green.
- [ ] **Step 5: Commit** — `git commit -am "feat(mac-app): proper tab semantics and status-bar dashboard link"`

---

### Task 7: Application menu + keyboard shortcuts

**Files:**
- Create: `mac-app/src/main/menu.ts`
- Test: `mac-app/test/menu.spec.ts`
- Modify: `mac-app/src/shared/ipc.ts` (`evtMenuAction: 'evt:menuAction'`), `mac-app/src/preload/index.ts` (`onMenuAction`), `mac-app/src/main/index.ts` (build/refresh menu), `mac-app/src/renderer/src/App.tsx` (handle actions), `mac-app/src/renderer/src/env.d.ts` if the window type needs the new method (check `env.d.ts` — it references `XenonApi`, so preload change flows through automatically).

**Interfaces:**
- Produces `type MenuAction = 'new-profile' | 'import-profiles' | 'export-profile' | 'toggle-server' | 'open-dashboard' | 'launch-preview' | 'tab-settings' | 'tab-secrets' | 'tab-health' | 'tab-logs'` (exported from `src/shared/types.ts`).
- Produces `buildMenuTemplate(opts: { serverStatus: ServerState['status']; hasDashboard: boolean; send: (a: MenuAction) => void }): Electron.MenuItemConstructorOptions[]` — pure, unit-testable (electron import type-only).
- Preload produces `onMenuAction: (cb: (a: MenuAction) => void) => () => void`.

- [ ] **Step 1: Write failing menu test** (`test/menu.spec.ts`):

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildMenuTemplate } from '../src/main/menu';

function flat(items: any[]): any[] {
  return items.flatMap((i) => [i, ...(i.submenu ? flat(i.submenu as any[]) : [])]);
}

describe('buildMenuTemplate', () => {
  it('wires shortcuts to menu actions', () => {
    const send = vi.fn();
    const items = flat(buildMenuTemplate({ serverStatus: 'stopped', hasDashboard: false, send }));
    const byLabel = Object.fromEntries(items.filter((i) => i.label).map((i) => [i.label, i]));
    expect(byLabel['New Profile'].accelerator).toBe('Cmd+N');
    expect(byLabel['Start Server'].accelerator).toBe('Cmd+Return');
    expect(byLabel['Settings'].accelerator).toBe('Cmd+1');
    byLabel['New Profile'].click();
    expect(send).toHaveBeenCalledWith('new-profile');
  });

  it('disables dashboard when not running and flips Start/Stop label', () => {
    const send = vi.fn();
    const stopped = flat(buildMenuTemplate({ serverStatus: 'stopped', hasDashboard: false, send }));
    expect(stopped.find((i) => i.label === 'Open Dashboard').enabled).toBe(false);
    const running = flat(buildMenuTemplate({ serverStatus: 'running', hasDashboard: true, send }));
    expect(running.find((i) => i.label === 'Stop Server')).toBeTruthy();
    expect(running.find((i) => i.label === 'Open Dashboard').enabled).toBe(true);
  });
});
```

- [ ] **Step 2: RED** — `npx vitest run test/menu.spec.ts` → FAIL (module not found).

- [ ] **Step 3: Implement menu.ts**

```ts
import type { MenuItemConstructorOptions } from 'electron';
import type { MenuAction, ServerState } from '@shared/types';

export function buildMenuTemplate(opts: {
  serverStatus: ServerState['status'];
  hasDashboard: boolean;
  send: (a: MenuAction) => void;
}): MenuItemConstructorOptions[] {
  const { serverStatus, hasDashboard, send } = opts;
  const active = serverStatus === 'running' || serverStatus === 'starting' || serverStatus === 'stopping';
  return [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Profile', accelerator: 'Cmd+N', click: () => send('new-profile') },
        { label: 'Import Profiles…', click: () => send('import-profiles') },
        { label: 'Export Profile…', click: () => send('export-profile') },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Server',
      submenu: [
        {
          label: active ? 'Stop Server' : 'Start Server',
          accelerator: 'Cmd+Return',
          click: () => send('toggle-server')
        },
        { label: 'Launch Preview', accelerator: 'Cmd+P', enabled: !active, click: () => send('launch-preview') },
        { label: 'Open Dashboard', accelerator: 'Cmd+D', enabled: hasDashboard, click: () => send('open-dashboard') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Settings', accelerator: 'Cmd+1', click: () => send('tab-settings') },
        { label: 'Secrets & Env', accelerator: 'Cmd+2', click: () => send('tab-secrets') },
        { label: 'Health', accelerator: 'Cmd+3', click: () => send('tab-health') },
        { label: 'Logs', accelerator: 'Cmd+4', click: () => send('tab-logs') }
      ]
    },
    { role: 'windowMenu' }
  ];
}
```

Add to `src/shared/types.ts`:

```ts
export type MenuAction =
  | 'new-profile' | 'import-profiles' | 'export-profile'
  | 'toggle-server' | 'open-dashboard' | 'launch-preview'
  | 'tab-settings' | 'tab-secrets' | 'tab-health' | 'tab-logs';
```

- [ ] **Step 4: GREEN** — `npx vitest run test/menu.spec.ts` → passing.

- [ ] **Step 5: Wire main process.** In `src/main/index.ts`:

```ts
import { buildMenuTemplate } from './menu';

function refreshMenu(state: ServerState): void {
  const template = buildMenuTemplate({
    serverStatus: state.status,
    hasDashboard: state.status === 'running' && !!state.dashboardUrl,
    send: (a) => broadcast(IPC.evtMenuAction, a)
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
```

Call `refreshMenu(supervisor.getState())` inside `app.whenReady()` (before `createWindow()`), and add `refreshMenu(state)` in the existing `supervisor.on('state', …)` handler next to `updateTray(state)`.

- [ ] **Step 6: Preload + renderer.** Preload: `onMenuAction: (cb: (a: MenuAction) => void) => subscribe(IPC.evtMenuAction, cb)`. In App.tsx's mount effect, subscribe and handle:

```ts
const offMenu = window.xenon.onMenuAction((a) => {
  if (a === 'tab-settings') setTab('settings');
  else if (a === 'tab-secrets') setTab('secrets');
  else if (a === 'tab-health') setTab('health');
  else if (a === 'tab-logs') setTab('logs');
  else if (a === 'new-profile') void createProfile();
  else if (a === 'import-profiles') void importProfiles();
  else if (a === 'export-profile') draftRef.current && window.xenon.profiles.export(draftRef.current.id).then((ok) => ok && toast('Profile exported'));
  else if (a === 'launch-preview') setPreviewOpen(true);
  else if (a === 'open-dashboard') stateRef.current.dashboardUrl && window.xenon.server.openDashboard(stateRef.current.dashboardUrl);
  else if (a === 'toggle-server') stateRef.current.status === 'stopped' || stateRef.current.status === 'crashed' ? void startRef.current() : void handleStopRef.current();
});
```

Because this effect runs once, keep `draftRef`/`stateRef`/`startRef`/`handleStopRef` `useRef`s updated via a small effect (`useEffect(() => { draftRef.current = draft; stateRef.current = serverState; }, [draft, serverState])`; assign `startRef.current = handleStart; handleStopRef.current = handleStop;` each render). Return `offMenu()` in the cleanup.

- [ ] **Step 7: Verify** — `npm run typecheck && npx vitest run && npm run build && npx playwright test` → green (menu accelerators are native; covered by the unit test + Task 11 live pass).
- [ ] **Step 8: Commit** — `git commit -am "feat(mac-app): application menu with server and tab shortcuts"`

---

### Task 8: Settings search + sticky section nav

**Files:**
- Create: `mac-app/src/renderer/src/settingsFilter.ts`, `mac-app/src/renderer/src/components/SettingsNav.tsx`
- Test: `mac-app/test/settingsFilter.spec.ts`
- Modify: `mac-app/src/renderer/src/components/SettingsForm.tsx`

**Interfaces:**
- Produces `filterSections(sections: FormSection[], query: string): FormSection[]` — case-insensitive match on `field.label` OR `field.key`; sections with zero matching fields are dropped; empty query returns input unchanged.
- SettingsForm renders `<section id={\`settings-${section.id}\`}>` anchors; SettingsNav props: `{ sections: FormSection[]; activeId: string | null; onJump: (id: string) => void }`.

- [ ] **Step 1: Write failing filterSections tests** (`test/settingsFilter.spec.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { filterSections } from '../src/renderer/src/settingsFilter';
import type { FormSection } from '../src/renderer/src/schemaForm';

const sections: FormSection[] = [
  { id: 'a', title: 'Platform', fields: [
    { key: 'platform', label: 'Platform', kind: 'select', required: true },
    { key: 'iosDeviceType', label: 'iOS Device Type', kind: 'select', required: true }
  ] },
  { id: 'b', title: 'AI', fields: [{ key: 'aiProvider', label: 'AI Provider', kind: 'select', required: false }] }
];

describe('filterSections', () => {
  it('returns input unchanged for an empty query', () => {
    expect(filterSections(sections, '  ')).toBe(sections);
  });
  it('matches on label case-insensitively', () => {
    const out = filterSections(sections, 'ios device');
    expect(out).toHaveLength(1);
    expect(out[0].fields.map((f) => f.key)).toEqual(['iosDeviceType']);
  });
  it('matches on raw key name and drops empty sections', () => {
    const out = filterSections(sections, 'aiprov');
    expect(out.map((s) => s.id)).toEqual(['b']);
  });
});
```

- [ ] **Step 2: RED** — `npx vitest run test/settingsFilter.spec.ts` → FAIL.

- [ ] **Step 3: Implement settingsFilter.ts**

```ts
import type { FormSection } from './schemaForm';

export function filterSections(sections: FormSection[], query: string): FormSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections;
  return sections
    .map((s) => ({ ...s, fields: s.fields.filter(
      (f) => f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q)
    ) }))
    .filter((s) => s.fields.length > 0);
}
```

- [ ] **Step 4: GREEN** — `npx vitest run test/settingsFilter.spec.ts`.

- [ ] **Step 5: SettingsNav + wiring.** SettingsForm gains a `query` state, a search input (`placeholder="Search settings…"`, `data-testid="settings-search"`) above the form, renders `filterSections(sections, query)`, and shows `No settings match ‘{query}’.` (`text-muted`) when the filtered list is empty. Layout becomes `flex gap-6`: left `<SettingsNav>` (`w-40 shrink-0 sticky top-0 self-start`, hidden while searching), right the form. SettingsNav:

```tsx
import { cn } from '../cn';
import type { FormSection } from '../schemaForm';

export function SettingsNav({ sections, activeId, onJump }: {
  sections: FormSection[]; activeId: string | null; onJump: (id: string) => void;
}) {
  return (
    <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
      {sections.map((s) => (
        <button
          key={s.id}
          onClick={() => onJump(s.id)}
          className={cn(
            'focus-ring rounded px-2 py-1 text-left text-xs',
            s.id === activeId ? 'bg-accent/10 text-accent' : 'text-muted hover:text-ink'
          )}
        >
          {s.title}
        </button>
      ))}
    </nav>
  );
}
```

`onJump`: `document.getElementById(\`settings-${id}\`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })`. Scroll-spy: an `IntersectionObserver` in SettingsForm over the section elements (`rootMargin: '0px 0px -70% 0px'`), storing the first intersecting section id as `activeId`.

- [ ] **Step 6: e2e**

```ts
test('settings search filters fields by key name', async () => {
  await openTab('Settings');
  await page.getByTestId('settings-search').fill('adbRemote');
  await expect(page.getByText('ADB Remote')).toBeVisible();
  await expect(page.getByText('Max Sessions')).not.toBeVisible();
  await page.getByTestId('settings-search').fill('zzz-no-match');
  await expect(page.getByText(/No settings match/)).toBeVisible();
  await page.getByTestId('settings-search').fill('');
  await expect(page.getByText('Max Sessions')).toBeVisible();
});
```

- [ ] **Step 7: Verify** — full suite green. **Step 8: Commit** — `git commit -am "feat(mac-app): settings search and sticky section navigation"`

---

### Task 9: Chip editor (string lists) + table editor (object arrays)

**Files:**
- Create: `mac-app/src/renderer/src/components/ui/ChipListEditor.tsx`, `mac-app/src/renderer/src/components/ui/ObjectTableEditor.tsx`, `mac-app/src/renderer/src/editorModel.ts`
- Test: `mac-app/test/editorModel.spec.ts`
- Modify: `mac-app/src/renderer/src/components/SettingsForm.tsx` (stringList→chips; json arrays→table+JSON toggle), `mac-app/src/renderer/src/schemaForm.ts` (expose `itemColumns`), `mac-app/test/e2e/app.e2e.spec.ts` (JSON test targets the escape hatch; add round-trip tests)

**Interfaces:**
- `editorModel.ts` produces:
  - `addChip(list: string[], raw: string): string[]` — trims, ignores empty and duplicates.
  - `removeChip(list: string[], index: number): string[]`
  - `rowsToValue(rows: Array<Record<string, string>>): Array<Record<string, string>> | undefined` — drops rows whose values are all empty; returns `undefined` when nothing remains.
  - `columnsFor(field: FormField): string[] | null` — `field.itemColumns ?? null`.
- `schemaForm.ts`: `FormField` gains optional `itemColumns?: string[]` — populated for `kind: 'json'` array fields whose `items.properties` exist (e.g. simulators → `['name', 'sdk']`, from schema.json).
- `ChipListEditor` props: `{ value: string[]; onChange: (v: string[] | undefined) => void; placeholder?: string }` (empty list commits `undefined`).
- `ObjectTableEditor` props: `{ columns: string[]; value: Array<Record<string, string>>; onChange: (v: Array<Record<string, string>> | undefined) => void }`, plus an internal "Edit as JSON" toggle that swaps in the existing `JsonField`.

- [ ] **Step 1: Write failing editorModel tests** (`test/editorModel.spec.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { addChip, removeChip, rowsToValue } from '../src/renderer/src/editorModel';

describe('editorModel', () => {
  it('addChip trims, dedupes and ignores empty input', () => {
    expect(addChip([], '  device-1  ')).toEqual(['device-1']);
    expect(addChip(['a'], 'a')).toEqual(['a']);
    expect(addChip(['a'], '   ')).toEqual(['a']);
  });
  it('removeChip removes by index', () => {
    expect(removeChip(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });
  it('rowsToValue drops all-empty rows and returns undefined when nothing remains', () => {
    expect(rowsToValue([{ name: 'iPhone 15', sdk: '17.0' }, { name: '', sdk: '' }]))
      .toEqual([{ name: 'iPhone 15', sdk: '17.0' }]);
    expect(rowsToValue([{ name: '', sdk: '' }])).toBeUndefined();
  });
});
```

- [ ] **Step 2: RED**, then implement `editorModel.ts`:

```ts
import type { FormField } from './schemaForm';

export function addChip(list: string[], raw: string): string[] {
  const v = raw.trim();
  if (!v || list.includes(v)) return list;
  return [...list, v];
}

export function removeChip(list: string[], index: number): string[] {
  return list.filter((_, i) => i !== index);
}

export function rowsToValue(rows: Array<Record<string, string>>): Array<Record<string, string>> | undefined {
  const kept = rows.filter((r) => Object.values(r).some((v) => v.trim() !== ''));
  return kept.length ? kept : undefined;
}

export function columnsFor(field: FormField): string[] | null {
  return field.itemColumns ?? null;
}
```

- [ ] **Step 3: GREEN** — `npx vitest run test/editorModel.spec.ts`.

- [ ] **Step 4: schemaForm itemColumns.** Array items in `schema.json` use `$ref` (`simulators` → `#/definitions/SimulatorConfig` with properties `name, sdk`; `emulators` → `EmulatorConfig` with `avdName`), so resolve refs. In `schemaForm.ts` add:

```ts
function resolveRef(
  p: JsonSchemaProperty | undefined,
  definitions: Record<string, JsonSchemaProperty>
): JsonSchemaProperty | undefined {
  const ref = (p as { $ref?: string } | undefined)?.$ref;
  if (ref?.startsWith('#/definitions/')) return definitions[ref.slice('#/definitions/'.length)];
  return p;
}
```

and change the array branch of `fieldFromProperty`:

```ts
if (t === 'array') {
  const items = resolveRef(prop.items as JsonSchemaProperty | undefined, definitions);
  if (items && typeOf(items) === 'string') return { ...base, kind: 'stringList' };
  const cols = items?.properties ? Object.keys(items.properties) : undefined;
  return { ...base, kind: 'json', itemColumns: cols };
}
```

Add `itemColumns?: string[]` to `FormField`. Unit-test in `schemaForm.spec.ts` (write first, watch fail):

```ts
it('exposes item columns for object-array fields by resolving $ref items', () => {
  const byKey = Object.fromEntries(allFields.map((f) => [f.key, f]));
  expect(byKey.simulators.itemColumns).toEqual(['name', 'sdk']);
  expect(byKey.emulators.itemColumns).toEqual(['avdName']);
});
```

(If a json field declares no resolvable `items.properties`, `itemColumns` stays undefined and it keeps the plain JSON editor.)

- [ ] **Step 5: ChipListEditor**

```tsx
import { useState } from 'react';
import { X } from 'lucide-react';
import { addChip, removeChip } from '../../editorModel';

export function ChipListEditor({ value, onChange, placeholder }: {
  value: string[]; onChange: (v: string[] | undefined) => void; placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const next = addChip(value, draft);
    if (next !== value) onChange(next);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface2 px-2 py-1.5">
      {value.map((chip, i) => (
        <span key={chip} className="inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-ink">
          {chip}
          <button
            onClick={() => onChange(removeChip(value, i).length ? removeChip(value, i) : undefined)}
            aria-label={`Remove ${chip}`}
            className="focus-ring text-dim hover:text-danger"
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={placeholder ?? 'add + Enter'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        onBlur={commit}
        className="focus-ring min-w-[8rem] flex-1 bg-transparent text-xs text-ink placeholder:text-dim"
      />
    </div>
  );
}
```

- [ ] **Step 6: ObjectTableEditor** (rows state derived from value; commits via `rowsToValue` on blur/remove; "Edit as JSON" toggle renders `JsonField` — import it after exporting it from SettingsForm.tsx or move `JsonField` into `components/ui/JsonField.tsx` and re-import in SettingsForm):

```tsx
import { useEffect, useState } from 'react';
import { Plus, Trash2, Braces } from 'lucide-react';
import { rowsToValue } from '../../editorModel';
import { JsonField } from './JsonField';

export function ObjectTableEditor({ columns, value, onChange }: {
  columns: string[]; value: Array<Record<string, string>>; onChange: (v: Array<Record<string, string>> | undefined) => void;
}) {
  const [rows, setRows] = useState<Array<Record<string, string>>>(value);
  const [jsonMode, setJsonMode] = useState(false);
  useEffect(() => setRows(value), [value]);

  const set = (i: number, col: string, v: string) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [col]: v } : row)));
  const commit = (next = rows) => onChange(rowsToValue(next));

  if (jsonMode) {
    return (
      <div>
        <JsonField value={value.length ? value : undefined} onChange={(v) => onChange(v as never)} />
        <button onClick={() => setJsonMode(false)} className="focus-ring mt-1 text-xs text-accent">Edit as table</button>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-line bg-surface2 p-2">
      {rows.length > 0 && (
        <table className="w-full text-xs">
          <thead><tr>{columns.map((c) => <th key={c} className="pb-1 text-left font-medium text-muted">{c}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c} className="pr-2">
                    <input value={row[c] ?? ''} onChange={(e) => set(i, c, e.target.value)} onBlur={() => commit()}
                      className="focus-ring w-full rounded border border-line bg-app px-1.5 py-1 font-mono" />
                  </td>
                ))}
                <td className="w-6">
                  <button onClick={() => { const next = rows.filter((_, j) => j !== i); setRows(next); commit(next); }}
                    aria-label="Remove row" className="focus-ring text-dim hover:text-danger"><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-1 flex items-center gap-3">
        <button onClick={() => setRows((r) => [...r, Object.fromEntries(columns.map((c) => [c, '']))])}
          className="focus-ring inline-flex items-center gap-1 text-xs text-accent"><Plus size={13} /> Add row</button>
        <button onClick={() => setJsonMode(true)} className="focus-ring inline-flex items-center gap-1 text-xs text-dim hover:text-ink">
          <Braces size={12} /> Edit as JSON</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Wire SettingsForm.** Move `JsonField` to `components/ui/JsonField.tsx` (same code, exported). In `FieldControl`:
  - `case 'stringList'`: `return <ChipListEditor value={list} onChange={onChange} />;`
  - `case 'json'`: `const cols = columnsFor(field); return cols ? <ObjectTableEditor columns={cols} value={Array.isArray(effective) ? effective as never : []} onChange={onChange} /> : <JsonField value={effective} onChange={onChange} />;`

- [ ] **Step 8: Update e2e.** The invalid-JSON test now enters JSON mode first:

```ts
test('invalid JSON in a settings field shows an inline error and keeps the draft', async () => {
  await openTab('Settings');
  await page.getByRole('button', { name: 'Edit as JSON' }).first().click();
  const jsonField = page.getByPlaceholder('JSON').first();
  await jsonField.fill('[{"name": }]');
  await jsonField.blur();
  await expect(page.getByText(/Invalid JSON/).first()).toBeVisible();
  await expect(jsonField).toHaveValue('[{"name": }]');
  await jsonField.fill('');
  await jsonField.blur();
  await expect(page.getByText(/Invalid JSON/)).not.toBeVisible();
  await page.getByRole('button', { name: 'Edit as table' }).first().click();
});
```

Add round-trips:

```ts
test('chip editor round-trips a string-array setting', async () => {
  await openTab('Settings');
  await page.getByTestId('settings-search').fill('adbRemote');
  const chipInput = page.getByPlaceholder('add + Enter').first();
  await chipInput.fill('192.168.1.50:5555');
  await chipInput.press('Enter');
  await expect(page.getByText('192.168.1.50:5555')).toBeVisible();
  await openTab('Health');
  await openTab('Settings');
  await page.getByTestId('settings-search').fill('adbRemote');
  await expect(page.getByText('192.168.1.50:5555')).toBeVisible();
  await page.getByRole('button', { name: 'Remove 192.168.1.50:5555' }).click();
  await page.getByTestId('settings-search').fill('');
});

test('table editor round-trips an object-array setting', async () => {
  await openTab('Settings');
  await page.getByRole('button', { name: 'Add row' }).first().click();
  const cell = page.locator('table input').first();
  await cell.fill('iPhone 15');
  await cell.blur();
  await openTab('Health');
  await openTab('Settings');
  await expect(page.locator('table input').first()).toHaveValue('iPhone 15');
  await page.getByRole('button', { name: 'Remove row' }).first().click();
});
```

- [ ] **Step 9: Verify** — full unit + e2e green. **Step 10: Commit** — `git commit -am "feat(mac-app): chip and table editors replace raw JSON/textarea inputs"`

---

### Task 10: Logs & Health polish, empty states, a11y sweep

**Files:**
- Modify: `mac-app/src/renderer/src/components/LogConsole.tsx` (Clear + line count), `mac-app/src/renderer/src/components/HealthPanel.tsx` (status chips + SetupProgress), `mac-app/src/renderer/src/App.tsx` (empty-state CTA, logs clear plumbing, crashed badge on Logs tab), `mac-app/src/renderer/src/components/ProfileList.tsx` (focus-reveal actions)

**Interfaces:**
- LogConsole gains prop `onClear: () => void`; App passes `() => setLogs([])`.
- HealthPanel consumes `window.xenon.onSetupProgress` (already exposed) — `SetupProgress` type from `@shared/types` (check its exact fields there before rendering; render `step`/`detail`-like fields as a mono list).

- [ ] **Step 1: LogConsole.** Toolbar adds `Clear` (ghost sm Button, calls `onClear`) and a count badge: `<span className="font-mono text-[11px] text-dim">{filtered.length.toLocaleString()}{filter ? ` / ${logs.length.toLocaleString()}` : ''} lines</span>`. Empty state (no logs at all): keep hint text plus — when server stopped — a small primary Button "Start server" that calls a new optional `onStart?: () => void` prop passed from App (`handleStart`).

- [ ] **Step 2: HealthPanel.** Status chip per row using token tints (`ok → bg-accent/10 text-accent border-accent/30`, `warn → warn tints`, `fail → danger tints`, label text `ok/warn/fail`). Subscribe to setup progress while installing:

```ts
const [progress, setProgress] = useState<SetupProgress[]>([]);
useEffect(() => window.xenon.onSetupProgress((p) => setProgress((prev) => [...prev, p])), []);
```

Render `progress` under the install button while `installing` (mono, `text-xs`, `max-h-40 overflow-auto`); clear it (`setProgress([])`) when a new install starts.

- [ ] **Step 3: Empty state CTA.** App's `!ready` branch when `profiles.length === 0`:

```tsx
<div className="flex flex-1 flex-col items-center justify-center gap-3">
  <p className="text-sm text-muted">No profiles yet.</p>
  <Button variant="primary" onClick={createProfile} icon={<Plus size={14} />}>New Profile</Button>
</div>
```

- [ ] **Step 4: Crashed badge.** Tab button for Logs shows a danger dot when `serverState.status === 'crashed'`: `{t.id === 'logs' && crashed && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-danger" />}`.

- [ ] **Step 5: Focus-reveal actions.** In ProfileList, change the action span's hidden state from `hidden group-hover:flex` to `flex opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100` (buttons stay focusable for keyboard users).

- [ ] **Step 6: e2e**

```ts
test('log console clear button and line count', async () => {
  await openTab('Logs');
  await expect(page.getByText(/0 lines/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
});
```

- [ ] **Step 7: Verify** — full suite green. **Step 8: Commit** — `git commit -am "feat(mac-app): logs/health polish, empty states, keyboard-accessible row actions"`

---

### Task 11: Final verification & PR

**Files:** none (verification only; screenshots to scratchpad)

- [ ] **Step 1:** `npm run typecheck && npx vitest run && npm run build && npx playwright test` — everything green, output pristine.
- [ ] **Step 2:** Grep gate re-run (Task 2 Step 2 command) — still empty.
- [ ] **Step 3: Live pass** — drive the built app with the Playwright driver script (as used in the review): screenshot Settings / Secrets / Health / Logs / Preview modal / empty state / Start→Running→Stop with logs. Eyeball each against the spec's Enterprise quality bar; verify menu shortcuts (⌘1–4, ⌘⏎, ⌘N) live since e2e can't drive native menus.
- [ ] **Step 4:** Push and open the PR (one consolidated PR): summary of spec, before/after screenshots, test counts. Do NOT merge without review.
