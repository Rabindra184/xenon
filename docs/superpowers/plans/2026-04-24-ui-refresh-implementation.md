# Xenon UI Refresh (v1.5.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Xenon dashboard as a clean modern-enterprise "Command Center" ops tool (dark-only, GitHub forest-green palette) without regressing any feature or URL.

**Architecture:** Feature-flagged phased migration. A single boolean `themeV2` flag (localStorage, URL-overridable) gates the new CSS token scope via `<html data-theme="v2">`. Legacy tokens stay as compat aliases during rollout. Seven independently shippable phases; each merges to `main` behind the flag.

**Tech Stack:** React 17 + TypeScript 4.9 + Vite 5 + Router v6. Existing primitives use `class-variance-authority` + `clsx` + `tailwind-merge` (no Tailwind runtime — just utility helpers for class composition). Icons: `lucide-react`. Tests: Jest + React Testing Library.

**Reference spec:** `docs/superpowers/specs/2026-04-24-ui-refresh-design.md`

**Working directory for all tasks:** `/Users/rabindrabiswal/Workspace/XAenon/xenon`. All paths are relative to it unless noted.

**Before you start each phase:** create a branch `feat/ui-refresh-phase-<N>-<slug>` off `main`. Each phase becomes one PR.

---

## Phase 1 — Tokens + primitives

**Goal:** Establish new tokens scoped under `[data-theme="v2"]` with old tokens as compat aliases, and land all new shared UI primitives. No behavior change; no existing screen changes.

**Branch:** `feat/ui-refresh-phase-1-tokens-primitives`

### Task 1.1: Feature flag plumbing

**Files:**
- Create: `web/src/lib/theme-flag.ts`
- Modify: `web/src/index.tsx`

- [ ] **Step 1: Write the flag helper**

Create `web/src/lib/theme-flag.ts`:

```ts
const KEY = 'xenon.themeV2';

export function isThemeV2(): boolean {
  try {
    const url = new URLSearchParams(window.location.search);
    const override = url.get('themeV2');
    if (override === '0' || override === 'off') return false;
    if (override === '1' || override === 'on') return true;

    const stored = window.localStorage.getItem(KEY);
    if (stored === 'off') return false;
    // Default ON during and after phase 2.
    return true;
  } catch {
    return true;
  }
}

export function applyThemeFlag(): void {
  const on = isThemeV2();
  document.documentElement.setAttribute('data-theme', on ? 'v2' : 'v1');
}

export function setThemeV2(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // ignore quota errors
  }
  applyThemeFlag();
}
```

- [ ] **Step 2: Apply the flag at mount**

Edit `web/src/index.tsx` — add before `ReactDOM.render(...)`:

```ts
import { applyThemeFlag } from './lib/theme-flag';
applyThemeFlag();
```

- [ ] **Step 3: Verify in dev**

Run `cd web && npm run start`. In browser DevTools, confirm `<html data-theme="v2">` is set. Toggle `?themeV2=0` in the URL and confirm the attribute becomes `v1`.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/theme-flag.ts web/src/index.tsx
git commit -m "feat(web): add themeV2 feature flag"
```

### Task 1.2: New token scope + compat aliases

**Files:**
- Create: `web/src/tokens.css`
- Modify: `web/src/index.css`

- [ ] **Step 1: Create the new token file**

Create `web/src/tokens.css`:

```css
/* Xenon Theme v2 — dark-only, Command Center direction.
 * Scoped under [data-theme="v2"] so the v1 theme stays intact during rollout.
 */

html[data-theme="v2"] {
  /* Surfaces */
  --bg-canvas: #0d1117;
  --bg-surface: #161b22;
  --bg-elevated: #1c2128;
  --bg-subtle: #0d1117;

  --border-default: #21262d;
  --border-strong: #30363d;
  --border-muted: #1c2128;

  /* Text */
  --text-primary: #e6edf3;
  --text-secondary: #c9d1d9;
  --text-muted: #8b949e;
  --text-subtle: #6e7681;

  /* Accent (forest green) */
  --accent: #3fb950;
  --accent-bold: #238636;
  --accent-subtle: rgba(63, 185, 80, 0.1);
  --accent-border: rgba(63, 185, 80, 0.3);

  /* Status — foreground */
  --status-ready-fg: #3fb950;
  --status-busy-fg: #d29922;
  --status-reserved-fg: #58a6ff;
  --status-error-fg: #f85149;
  --status-offline-fg: #8b949e;

  /* Status — background (10% alpha of fg) */
  --status-ready-bg: rgba(63, 185, 80, 0.1);
  --status-busy-bg: rgba(210, 153, 34, 0.1);
  --status-reserved-bg: rgba(88, 166, 255, 0.1);
  --status-error-bg: rgba(248, 81, 73, 0.1);
  --status-offline-bg: rgba(139, 148, 158, 0.08);

  /* Status — border (30% alpha of fg) */
  --status-ready-border: rgba(63, 185, 80, 0.3);
  --status-busy-border: rgba(210, 153, 34, 0.3);
  --status-reserved-border: rgba(88, 166, 255, 0.3);
  --status-error-border: rgba(248, 81, 73, 0.3);
  --status-offline-border: rgba(139, 148, 158, 0.25);

  /* Spacing (4px grid) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;

  /* Radii */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;

  /* Shadows (subtle — no glow) */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.25);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.35);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.45);

  /* Motion */
  --motion-fast: 150ms cubic-bezier(0.2, 0, 0, 1);
  --motion-slow: 250ms cubic-bezier(0.2, 0, 0, 1);

  /* ——— Compat aliases — map legacy tokens onto new values ——— */
  --bg-page: var(--bg-canvas);
  --bg-card: var(--bg-surface);
  --bg-card-hover: var(--bg-elevated);
  --color-primary: var(--accent);
  --color-amber: var(--status-busy-fg);
  --color-red: var(--status-error-fg);
  --color-blue: var(--status-reserved-fg);
  --color-sky: var(--status-reserved-fg);
  --color-purple: #8b5cf6;
  --border-subtle: var(--border-muted);
  --border-visible: var(--border-default);
  --text-dim: var(--text-subtle);
  --text-body: var(--text-secondary);
  --text-bright: var(--text-primary);
  --primary: var(--accent);
  --primary-hover: var(--accent-bold);
  --primary-glow: var(--accent-subtle);
  --bg-app: var(--bg-canvas);
  --bg-glass: rgba(22, 27, 34, 0.7);
  --text-main: var(--text-secondary);
  --border-light: var(--border-muted);
  --border-medium: var(--border-default);
  --status-ready: var(--status-ready-fg);
  --status-busy: var(--status-busy-fg);
  --status-offline: var(--status-offline-fg);
  --status-error: var(--status-error-fg);
  --space-xs: var(--space-1);
  --space-sm: var(--space-2);
  --space-md: var(--space-4);
  --space-lg: var(--space-6);
  --space-xl: var(--space-8);
  --space-xxl: var(--space-12);
  --fs-xs: 11px;
  --fs-sm: 12px;
  --fs-md: 14px;
  --fs-lg: 16px;
  --fs-xl: 20px;
  --fs-xxl: 24px;
  --glass-blur: blur(20px);
}

/* Disable glow/pulse effects under v2 regardless of existing rules */
html[data-theme="v2"] .scanline,
html[data-theme="v2"] .header-container::after {
  display: none !important;
}

html[data-theme="v2"] .animate-pulse-success,
html[data-theme="v2"] .animate-pulse-running {
  animation: none !important;
}

html[data-theme="v2"] .text-glow {
  text-shadow: none !important;
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  html[data-theme="v2"] * {
    transition: none !important;
    animation: none !important;
  }
}
```

- [ ] **Step 2: Import tokens at the top of `index.css`**

Edit `web/src/index.css` — add as the first non-font line:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@400;600;700&display=swap');
@import './tokens.css';
```

(Keep everything else in `index.css` intact — the v1 `:root` block continues to apply when `data-theme` is not `v2`.)

- [ ] **Step 3: Smoke test**

`cd web && npm run start`. Load the dashboard. Pages should render, just with a subtly different surface color. Toggle `?themeV2=0` and confirm the old palette returns.

- [ ] **Step 4: Commit**

```bash
git add web/src/tokens.css web/src/index.css
git commit -m "feat(web): add v2 token scope with compat aliases"
```

### Task 1.3: StatusDot + StatusCode primitives

**Files:**
- Create: `web/src/components/ui/StatusDot.tsx`
- Create: `web/src/components/ui/StatusCode.tsx`
- Create: `web/src/components/ui/status.css`
- Create: `web/src/components/ui/status.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ui/status.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { StatusDot } from './StatusDot';
import { StatusCode } from './StatusCode';

describe('StatusDot', () => {
  it('applies status class from kind prop', () => {
    const { container } = render(<StatusDot kind="ready" />);
    expect(container.firstChild).toHaveClass('status-dot-ready');
  });
});

describe('StatusCode', () => {
  it('renders uppercase label with status class', () => {
    render(<StatusCode kind="busy">busy</StatusCode>);
    const code = screen.getByText(/BUSY/);
    expect(code).toHaveClass('status-code-busy');
  });

  it('renders its own dot when showDot is true', () => {
    const { container } = render(<StatusCode kind="reserved" showDot>reserved</StatusCode>);
    expect(container.querySelector('.status-dot-reserved')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd web && npx jest src/components/ui/status.test.tsx --no-coverage 2>&1 | tail -20
```

Expected: FAIL with "Cannot find module './StatusDot'".

- [ ] **Step 3: Implement the primitives**

Create `web/src/components/ui/StatusDot.tsx`:

```tsx
import * as React from 'react';
import './status.css';

export type StatusKind = 'ready' | 'busy' | 'reserved' | 'error' | 'offline';

export interface StatusDotProps {
  kind: StatusKind;
  size?: number;
  className?: string;
}

export const StatusDot: React.FC<StatusDotProps> = ({ kind, size = 6, className }) => (
  <span
    className={`status-dot status-dot-${kind}${className ? ' ' + className : ''}`}
    style={{ width: size, height: size }}
    aria-hidden
  />
);
```

Create `web/src/components/ui/StatusCode.tsx`:

```tsx
import * as React from 'react';
import { StatusDot, StatusKind } from './StatusDot';
import './status.css';

export interface StatusCodeProps {
  kind: StatusKind;
  showDot?: boolean;
  children: React.ReactNode;
}

export const StatusCode: React.FC<StatusCodeProps> = ({ kind, showDot, children }) => (
  <span className={`status-code status-code-${kind}`}>
    {showDot && <StatusDot kind={kind} />}
    <span className="status-code-label">{String(children).toUpperCase()}</span>
  </span>
);
```

Create `web/src/components/ui/status.css`:

```css
.status-dot {
  display: inline-block;
  border-radius: 50%;
  vertical-align: middle;
}
.status-dot-ready    { background: var(--status-ready-fg); }
.status-dot-busy     { background: var(--status-busy-fg); }
.status-dot-reserved { background: var(--status-reserved-fg); }
.status-dot-error    { background: var(--status-error-fg); }
.status-dot-offline  { background: var(--status-offline-fg); }

.status-code {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.1em;
  font-weight: 600;
}
.status-code-label { line-height: 1; }
.status-code-ready    { color: var(--status-ready-fg); }
.status-code-busy     { color: var(--status-busy-fg); }
.status-code-reserved { color: var(--status-reserved-fg); }
.status-code-error    { color: var(--status-error-fg); }
.status-code-offline  { color: var(--status-offline-fg); }
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd web && npx jest src/components/ui/status.test.tsx --no-coverage
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ui/StatusDot.tsx web/src/components/ui/StatusCode.tsx web/src/components/ui/status.css web/src/components/ui/status.test.tsx
git commit -m "feat(web): add StatusDot + StatusCode primitives"
```

### Task 1.4: Button rewrite (v2 variants, preserve exports)

**Files:**
- Modify: `web/src/components/ui/button.tsx`
- Modify: `web/src/components/ui/button.css`
- Create: `web/src/components/ui/button.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/ui/button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { Button } from './button';

describe('Button v2', () => {
  it('defaults to primary variant', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-primary');
  });

  it('supports outline variant via `secondary`', () => {
    render(<Button variant="secondary">Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-secondary');
  });

  it('supports ghost variant', () => {
    render(<Button variant="ghost">Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-ghost');
  });

  it('supports danger variant', () => {
    render(<Button variant="danger">Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-danger');
  });

  it('supports sm size', () => {
    render(<Button size="sm">Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-size-sm');
  });

  it('legacy `default` variant still maps to primary for back-compat', () => {
    render(<Button variant="default">Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-primary');
  });
});
```

- [ ] **Step 2: Run test — verify failure**

```bash
cd web && npx jest src/components/ui/button.test.tsx --no-coverage
```

Expected: FAIL (old classes are `button-variant-default` not `btn-primary`).

- [ ] **Step 3: Rewrite the Button**

Replace `web/src/components/ui/button.tsx`:

```tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';
import './button.css';

const buttonVariants = cva('btn-base', {
  variants: {
    variant: {
      default: 'btn-primary',
      primary: 'btn-primary',
      secondary: 'btn-secondary',
      outline: 'btn-secondary',
      ghost: 'btn-ghost',
      link: 'btn-link',
      destructive: 'btn-danger',
      danger: 'btn-danger',
    },
    size: {
      default: 'btn-size-md',
      md: 'btn-size-md',
      sm: 'btn-size-sm',
      lg: 'btn-size-lg',
      icon: 'btn-size-icon',
    },
  },
  defaultVariants: {
    variant: 'primary',
    size: 'md',
  },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
);
Button.displayName = 'Button';

export { Button, buttonVariants };
```

Replace `web/src/components/ui/button.css`:

```css
.btn-base {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  letter-spacing: -0.005em;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast);
  white-space: nowrap;
  user-select: none;
}
.btn-base:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-size-sm { height: 26px; padding: 0 10px; font-size: 11px; }
.btn-size-md { height: 32px; padding: 0 14px; font-size: 12px; }
.btn-size-lg { height: 40px; padding: 0 18px; font-size: 14px; }
.btn-size-icon { height: 32px; width: 32px; padding: 0; }

.btn-primary {
  background: var(--accent-bold);
  color: #ffffff;
  border-color: var(--accent-bold);
}
.btn-primary:hover:not(:disabled) { background: #2ea043; border-color: #2ea043; }

.btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border-color: var(--border-strong);
}
.btn-secondary:hover:not(:disabled) {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border-color: transparent;
}
.btn-ghost:hover:not(:disabled) {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.btn-link {
  background: transparent;
  color: var(--status-reserved-fg);
  border: none;
  padding: 0;
  height: auto;
}
.btn-link:hover:not(:disabled) { text-decoration: underline; }

.btn-danger {
  background: transparent;
  color: var(--status-error-fg);
  border-color: var(--status-error-border);
}
.btn-danger:hover:not(:disabled) {
  background: var(--status-error-bg);
  border-color: var(--status-error-fg);
}

/* v1 compat — legacy class names still used throughout the codebase */
html[data-theme="v2"] .button-base { all: unset; }
html[data-theme="v2"] .button-variant-default,
html[data-theme="v2"] .button-variant-outline,
html[data-theme="v2"] .button-variant-ghost,
html[data-theme="v2"] .button-variant-link,
html[data-theme="v2"] .button-variant-destructive { /* no-op — handled by new variant classes */ }
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd web && npx jest src/components/ui/button.test.tsx --no-coverage
```

Expected: 6 passing.

- [ ] **Step 5: Smoke — confirm existing callers still render**

`cd web && npm run start`. Navigate to Settings and API Keys — buttons should render. Toggle `?themeV2=0` and confirm the v1 buttons still render (the CVA mapping retains `default`, `outline`, etc.).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ui/button.tsx web/src/components/ui/button.css web/src/components/ui/button.test.tsx
git commit -m "feat(web): rewrite Button for v2 variants, preserve legacy names"
```

### Task 1.5: Pill primitive

**Files:**
- Create: `web/src/components/ui/Pill.tsx`
- Create: `web/src/components/ui/pill.css`
- Create: `web/src/components/ui/pill.test.tsx`

- [ ] **Step 1: Test**

```tsx
// web/src/components/ui/pill.test.tsx
import { render, screen } from '@testing-library/react';
import { Pill } from './Pill';

describe('Pill', () => {
  it('renders children inside a pill', () => {
    render(<Pill>team-qa</Pill>);
    expect(screen.getByText('team-qa')).toHaveClass('pill');
  });
  it('applies tone class', () => {
    render(<Pill tone="accent">a</Pill>);
    expect(screen.getByText('a')).toHaveClass('pill-accent');
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd web && npx jest src/components/ui/pill.test.tsx --no-coverage
```

- [ ] **Step 3: Implement**

```tsx
// web/src/components/ui/Pill.tsx
import * as React from 'react';
import './pill.css';

export type PillTone = 'neutral' | 'accent' | 'ready' | 'busy' | 'reserved' | 'error' | 'offline';

export interface PillProps {
  tone?: PillTone;
  children: React.ReactNode;
  title?: string;
}

export const Pill: React.FC<PillProps> = ({ tone = 'neutral', children, title }) => (
  <span className={`pill pill-${tone}`} title={title}>
    {children}
  </span>
);
```

```css
/* web/src/components/ui/pill.css */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pill-neutral { background: var(--bg-elevated); color: var(--text-secondary); }
.pill-accent { background: var(--accent-subtle); color: var(--accent); border: 1px solid var(--accent-border); }
.pill-ready    { background: var(--status-ready-bg);    color: var(--status-ready-fg);    border: 1px solid var(--status-ready-border); }
.pill-busy     { background: var(--status-busy-bg);     color: var(--status-busy-fg);     border: 1px solid var(--status-busy-border); }
.pill-reserved { background: var(--status-reserved-bg); color: var(--status-reserved-fg); border: 1px solid var(--status-reserved-border); }
.pill-error    { background: var(--status-error-bg);    color: var(--status-error-fg);    border: 1px solid var(--status-error-border); }
.pill-offline  { background: var(--status-offline-bg);  color: var(--status-offline-fg);  border: 1px solid var(--status-offline-border); }
```

- [ ] **Step 4: Run — expect pass, then commit**

```bash
cd web && npx jest src/components/ui/pill.test.tsx --no-coverage
git add web/src/components/ui/Pill.tsx web/src/components/ui/pill.css web/src/components/ui/pill.test.tsx
git commit -m "feat(web): add Pill primitive"
```

### Task 1.6: Card primitive

**Files:**
- Create: `web/src/components/ui/Card.tsx`
- Create: `web/src/components/ui/card.css`

- [ ] **Step 1: Implement**

```tsx
// web/src/components/ui/Card.tsx
import * as React from 'react';
import './card.css';

export interface CardProps {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  action?: React.ReactNode;
  padded?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ header, footer, action, padded = true, className, children }) => (
  <div className={`card${className ? ' ' + className : ''}`}>
    {(header || action) && (
      <div className="card-header">
        <div className="card-header-title">{header}</div>
        {action && <div className="card-header-action">{action}</div>}
      </div>
    )}
    <div className={padded ? 'card-body' : 'card-body-flush'}>{children}</div>
    {footer && <div className="card-footer">{footer}</div>}
  </div>
);
```

```css
/* web/src/components/ui/card.css */
.card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-default);
}
.card-header-title {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  font-family: 'Inter', sans-serif;
}
.card-header-action {
  font-size: 11px;
  color: var(--status-reserved-fg);
}
.card-body { padding: 14px; }
.card-body-flush { padding: 0; }
.card-footer {
  padding: 10px 14px;
  border-top: 1px solid var(--border-default);
  color: var(--text-muted);
  font-size: 11px;
}
```

- [ ] **Step 2: Manual smoke via a unit test**

```tsx
// web/src/components/ui/card.test.tsx
import { render, screen } from '@testing-library/react';
import { Card } from './Card';

test('Card renders header + body + footer', () => {
  render(<Card header="Title" footer="Foot">Body</Card>);
  expect(screen.getByText('Title')).toBeInTheDocument();
  expect(screen.getByText('Body')).toBeInTheDocument();
  expect(screen.getByText('Foot')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run + commit**

```bash
cd web && npx jest src/components/ui/card.test.tsx --no-coverage
git add web/src/components/ui/Card.tsx web/src/components/ui/card.css web/src/components/ui/card.test.tsx
git commit -m "feat(web): add Card primitive"
```

### Task 1.7: KeyValueRow primitive

**Files:**
- Create: `web/src/components/ui/KeyValueRow.tsx`
- Create: `web/src/components/ui/key-value-row.css`
- Create: `web/src/components/ui/key-value-row.test.tsx`

- [ ] **Step 1: Test + implement**

```tsx
// web/src/components/ui/key-value-row.test.tsx
import { render, screen } from '@testing-library/react';
import { KeyValueRow } from './KeyValueRow';

test('renders label + value', () => {
  render(<KeyValueRow label="Battery" value="92%" />);
  expect(screen.getByText('Battery')).toBeInTheDocument();
  expect(screen.getByText('92%')).toBeInTheDocument();
});
test('uses mono class when mono=true', () => {
  render(<KeyValueRow label="Host" value="10.0.1.42" mono />);
  expect(screen.getByText('10.0.1.42')).toHaveClass('kv-value-mono');
});
```

```tsx
// web/src/components/ui/KeyValueRow.tsx
import * as React from 'react';
import './key-value-row.css';

export interface KeyValueRowProps {
  label: React.ReactNode;
  value: React.ReactNode;
  mono?: boolean;
  valueClassName?: string;
}

export const KeyValueRow: React.FC<KeyValueRowProps> = ({ label, value, mono, valueClassName }) => (
  <div className="kv-row">
    <span className="kv-label">{label}</span>
    <span className={`kv-value${mono ? ' kv-value-mono' : ''}${valueClassName ? ' ' + valueClassName : ''}`}>
      {value}
    </span>
  </div>
);
```

```css
/* web/src/components/ui/key-value-row.css */
.kv-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  min-height: 18px;
}
.kv-label { color: var(--text-muted); }
.kv-value { color: var(--text-secondary); font-weight: 500; }
.kv-value-mono { font-family: 'JetBrains Mono', monospace; font-size: 11px; }
```

- [ ] **Step 2: Run + commit**

```bash
cd web && npx jest src/components/ui/key-value-row.test.tsx --no-coverage
git add web/src/components/ui/KeyValueRow.tsx web/src/components/ui/key-value-row.css web/src/components/ui/key-value-row.test.tsx
git commit -m "feat(web): add KeyValueRow primitive"
```

### Task 1.8: Popover + Menu primitive

**Files:**
- Create: `web/src/components/ui/Popover.tsx`
- Create: `web/src/components/ui/Menu.tsx`
- Create: `web/src/components/ui/popover.css`

- [ ] **Step 1: Implement Popover (click-outside, Esc-to-close, anchored)**

```tsx
// web/src/components/ui/Popover.tsx
import * as React from 'react';
import './popover.css';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement>;
  placement?: 'bottom-start' | 'bottom-end' | 'top-end';
  children: React.ReactNode;
}

export const Popover: React.FC<PopoverProps> = ({
  open, onClose, anchorRef, placement = 'bottom-end', children,
}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });

  React.useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const top = placement.startsWith('top') ? r.top - 8 : r.bottom + 4;
    const left = placement.endsWith('end') ? r.right : r.left;
    setPos({ top: Math.round(top), left: Math.round(left) });
  }, [open, anchorRef, placement]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', esc);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className={`popover popover-${placement}`}
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
    >
      {children}
    </div>
  );
};
```

```tsx
// web/src/components/ui/Menu.tsx
import * as React from 'react';
import './popover.css';

export interface MenuItemProps {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export const MenuItem: React.FC<MenuItemProps> = ({ icon, children, onClick, danger, disabled }) => (
  <button
    type="button"
    className={`menu-item${danger ? ' menu-item-danger' : ''}`}
    onClick={onClick}
    disabled={disabled}
  >
    {icon && <span className="menu-item-icon">{icon}</span>}
    <span className="menu-item-label">{children}</span>
  </button>
);

export const MenuDivider: React.FC = () => <div className="menu-divider" />;

export const Menu: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="menu">{children}</div>
);
```

```css
/* web/src/components/ui/popover.css */
.popover {
  position: fixed;
  z-index: 9000;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  min-width: 180px;
  padding: 4px;
}
.popover-bottom-end { transform: translateX(-100%); }
.popover-top-end { transform: translate(-100%, -100%); }

.menu { display: flex; flex-direction: column; gap: 0; }
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  width: 100%;
}
.menu-item:hover:not(:disabled) { background: var(--bg-subtle); color: var(--text-primary); }
.menu-item:disabled { opacity: 0.4; cursor: not-allowed; }
.menu-item-danger { color: var(--status-error-fg); }
.menu-item-icon { display: inline-flex; align-items: center; color: var(--text-muted); }
.menu-divider { height: 1px; background: var(--border-default); margin: 4px 0; }
```

- [ ] **Step 2: Smoke test**

```tsx
// web/src/components/ui/popover.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { Popover } from './Popover';
import { Menu, MenuItem } from './Menu';

test('Popover opens/closes on Escape', () => {
  function Harness() {
    const anchor = React.useRef<HTMLButtonElement>(null);
    const [open, setOpen] = React.useState(true);
    return (
      <>
        <button ref={anchor}>anchor</button>
        <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor}>
          <Menu><MenuItem onClick={() => {}}>one</MenuItem></Menu>
        </Popover>
      </>
    );
  }
  render(<Harness />);
  expect(screen.getByText('one')).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByText('one')).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run + commit**

```bash
cd web && npx jest src/components/ui/popover.test.tsx --no-coverage
git add web/src/components/ui/Popover.tsx web/src/components/ui/Menu.tsx web/src/components/ui/popover.css web/src/components/ui/popover.test.tsx
git commit -m "feat(web): add Popover + Menu primitives"
```

### Task 1.9: SegmentedControl primitive

**Files:**
- Create: `web/src/components/ui/SegmentedControl.tsx`
- Create: `web/src/components/ui/segmented-control.css`

- [ ] **Step 1: Implement + test**

```tsx
// web/src/components/ui/SegmentedControl.tsx
import * as React from 'react';
import './segmented-control.css';

export interface Segment<T extends string> {
  value: T;
  label: React.ReactNode;
  count?: number;
}

export interface SegmentedControlProps<T extends string> {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}

export function SegmentedControl<T extends string>({
  segments, value, onChange, size = 'md',
}: SegmentedControlProps<T>) {
  return (
    <div className={`seg seg-${size}`} role="tablist">
      {segments.map((s) => (
        <button
          key={s.value}
          role="tab"
          aria-selected={s.value === value}
          className={`seg-btn${s.value === value ? ' seg-btn-active' : ''}`}
          onClick={() => onChange(s.value)}
          type="button"
        >
          <span>{s.label}</span>
          {typeof s.count === 'number' && <span className="seg-count">{s.count}</span>}
        </button>
      ))}
    </div>
  );
}
```

```css
/* web/src/components/ui/segmented-control.css */
.seg {
  display: inline-flex;
  gap: 2px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 2px;
}
.seg-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  border-radius: calc(var(--radius-md) - 2px);
  cursor: pointer;
  transition: background var(--motion-fast), color var(--motion-fast);
}
.seg-btn:hover { color: var(--text-primary); }
.seg-btn-active { background: var(--bg-elevated); color: var(--text-primary); }
.seg-count {
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
}
.seg-sm .seg-btn { height: 24px; padding: 0 10px; font-size: 11px; }
.seg-md .seg-btn { height: 30px; padding: 0 12px; font-size: 12px; }
```

```tsx
// web/src/components/ui/segmented-control.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl } from './SegmentedControl';

test('SegmentedControl highlights active and fires onChange', () => {
  const fn = jest.fn();
  render(
    <SegmentedControl
      segments={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]}
      value="a"
      onChange={fn}
    />,
  );
  expect(screen.getByRole('tab', { name: 'A' })).toHaveClass('seg-btn-active');
  fireEvent.click(screen.getByRole('tab', { name: 'B' }));
  expect(fn).toHaveBeenCalledWith('b');
});
```

- [ ] **Step 2: Run + commit**

```bash
cd web && npx jest src/components/ui/segmented-control.test.tsx --no-coverage
git add web/src/components/ui/SegmentedControl.tsx web/src/components/ui/segmented-control.css web/src/components/ui/segmented-control.test.tsx
git commit -m "feat(web): add SegmentedControl primitive"
```

### Task 1.10: Table primitive

**Files:**
- Create: `web/src/components/ui/Table.tsx`
- Create: `web/src/components/ui/table.css`

- [ ] **Step 1: Implement**

```tsx
// web/src/components/ui/Table.tsx
import * as React from 'react';
import './table.css';

export const Table: React.FC<React.HTMLAttributes<HTMLTableElement>> = ({ className, ...rest }) => (
  <table className={`tbl${className ? ' ' + className : ''}`} {...rest} />
);
export const THead: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = (p) => <thead {...p} />;
export const TBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = (p) => <tbody {...p} />;
export const TR: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = (p) => <tr {...p} />;
export const TH: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = (p) => <th {...p} />;
export const TD: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = (p) => <td {...p} />;
```

```css
/* web/src/components/ui/table.css */
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
}
.tbl thead th {
  text-align: left;
  padding: 8px 12px;
  font-weight: 600;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-subtle);
}
.tbl tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-default);
  color: var(--text-secondary);
  vertical-align: middle;
}
.tbl tbody tr:last-child td { border-bottom: none; }
.tbl tbody tr:hover { background: var(--bg-elevated); }
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/ui/Table.tsx web/src/components/ui/table.css
git commit -m "feat(web): add Table primitive"
```

### Task 1.11: EmptyState primitive

**Files:**
- Create: `web/src/components/ui/EmptyState.tsx`
- Create: `web/src/components/ui/empty-state.css`

- [ ] **Step 1: Implement**

```tsx
// web/src/components/ui/EmptyState.tsx
import * as React from 'react';
import './empty-state.css';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => (
  <div className="empty-state">
    {icon && <div className="empty-state-icon">{icon}</div>}
    <div className="empty-state-title">{title}</div>
    {description && <div className="empty-state-desc">{description}</div>}
    {action && <div className="empty-state-action">{action}</div>}
  </div>
);
```

```css
/* web/src/components/ui/empty-state.css */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 40px 24px;
  color: var(--text-muted);
  gap: 8px;
}
.empty-state-icon { color: var(--text-subtle); margin-bottom: 4px; }
.empty-state-title { color: var(--text-primary); font-size: 14px; font-weight: 600; }
.empty-state-desc { color: var(--text-muted); font-size: 12px; max-width: 360px; }
.empty-state-action { margin-top: 12px; }
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/ui/EmptyState.tsx web/src/components/ui/empty-state.css
git commit -m "feat(web): add EmptyState primitive"
```

### Task 1.12: Capture v1/v2 baseline screenshots

- [ ] **Step 1: Capture**

Create directory: `mkdir -p web/screenshots/phase-1`.

Run `cd web && npm run start`. Manually capture `/devices`, `/builds`, `/settings` in both themes (toggle `?themeV2=0` and `?themeV2=1`). Save as `web/screenshots/phase-1/<route>-v1.png` and `...-v2.png`. Under v2 the screens should render identically to v1 since no screen has been rebuilt yet — this is intentional. This baseline is what later phases diff against.

- [ ] **Step 2: Commit**

```bash
git add web/screenshots/phase-1
git commit -m "docs(web): phase-1 baseline screenshots"
```

### Task 1.13: Open the phase-1 PR

- [ ] **Step 1:**

```bash
git push -u origin feat/ui-refresh-phase-1-tokens-primitives
gh pr create --title "feat(web): phase-1 UI refresh — tokens + primitives" --body "$(cat <<'EOF'
## Summary
- New v2 token scope under \`[data-theme="v2"]\`; v1 tokens unchanged
- Compat aliases so existing screens render identically under v2
- New primitives: Button (rewritten, exports preserved), Card, Pill, StatusDot, StatusCode, KeyValueRow, Popover, Menu, SegmentedControl, Table, EmptyState
- Feature flag \`themeV2\` via localStorage + \`?themeV2=\` URL param

## Test plan
- [ ] Every existing screen renders without regression in both themes
- [ ] Toggling \`?themeV2=0\` and reload restores v1 palette
- [ ] All new component tests pass (\`cd web && npx jest src/components/ui/\`)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 2 — App shell

**Goal:** Rebuild `Header` and `Sidebar` under `[data-theme="v2"]` with v1 fallback preserved. Add the `/overview` route as a placeholder. No behavior changes; visual-only on v1.

**Branch:** `feat/ui-refresh-phase-2-shell`

### Task 2.1: Sidebar state hook

**Files:**
- Create: `web/src/hooks/useSidebarState.ts`
- Create: `web/src/hooks/useSidebarState.test.ts`

- [ ] **Step 1: Test**

```ts
// web/src/hooks/useSidebarState.test.ts
import { renderHook, act } from '@testing-library/react-hooks';
import { useSidebarState } from './useSidebarState';

describe('useSidebarState', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to collapsed', () => {
    const { result } = renderHook(() => useSidebarState());
    expect(result.current.state).toBe('collapsed');
  });

  it('pin toggles persistent state', () => {
    const { result } = renderHook(() => useSidebarState());
    act(() => result.current.togglePin());
    expect(result.current.state).toBe('pinned-open');
    expect(localStorage.getItem('xenon.sidebar')).toBe('pinned-open');
  });

  it('hover sets expanded', () => {
    const { result } = renderHook(() => useSidebarState());
    act(() => result.current.setHover(true));
    expect(result.current.state).toBe('expanded');
  });
});
```

Note: if `@testing-library/react-hooks` isn't installed, adapt to use `@testing-library/react`'s `renderHook` which exists in v13+; since web is on v11, install the hook helper: `cd web && npm install -D @testing-library/react-hooks@8.0.1`. If that conflicts, collapse to a component-wrapped render.

- [ ] **Step 2: Implement**

```ts
// web/src/hooks/useSidebarState.ts
import { useCallback, useEffect, useState } from 'react';

export type SidebarState = 'collapsed' | 'expanded' | 'pinned-open';
const KEY = 'xenon.sidebar';

export function useSidebarState() {
  const [persisted, setPersisted] = useState<SidebarState>(() => {
    try {
      const v = window.localStorage.getItem(KEY);
      return v === 'pinned-open' ? 'pinned-open' : 'collapsed';
    } catch { return 'collapsed'; }
  });
  const [hover, setHover] = useState(false);

  useEffect(() => {
    try { window.localStorage.setItem(KEY, persisted); } catch {}
  }, [persisted]);

  const togglePin = useCallback(() => {
    setPersisted((s) => (s === 'pinned-open' ? 'collapsed' : 'pinned-open'));
  }, []);

  const state: SidebarState =
    persisted === 'pinned-open' ? 'pinned-open' : hover ? 'expanded' : 'collapsed';

  return { state, isPinned: persisted === 'pinned-open', setHover, togglePin };
}
```

- [ ] **Step 3: Run + commit**

```bash
cd web && npx jest src/hooks/useSidebarState.test.ts --no-coverage
git add web/src/hooks/useSidebarState.ts web/src/hooks/useSidebarState.test.ts
git commit -m "feat(web): sidebar state hook"
```

### Task 2.2: Sidebar rebuild (v2-aware)

**Files:**
- Modify: `web/src/components/sidebar/sidebar.tsx`
- Modify: `web/src/components/sidebar/sidebar.css`

The old sidebar behavior must remain intact under v1. Strategy: render the v2 layout only when `document.documentElement.getAttribute('data-theme') === 'v2'`; otherwise render the current icon-only layout unchanged.

- [ ] **Step 1: Split existing sidebar into v1/v2 branches**

Replace `web/src/components/sidebar/sidebar.tsx`:

```tsx
import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Smartphone, Hammer, AppWindow, Bell,
  Settings as SettingsIcon, Brain, ShieldCheck, Users, Key, BookOpen,
  PinOff, Pin,
} from 'lucide-react';
import { isThemeV2 } from '../../lib/theme-flag';
import { useSidebarState } from '../../hooks/useSidebarState';
import './sidebar.css';

// ——— v1 (unchanged from pre-refresh) ———
import { getEnabledNavItems } from '../../config/navigation';

interface V1ItemProps {
  icon: React.ReactNode; label: string; path: string; active?: boolean; onClick: () => void;
}
const V1Item: React.FC<V1ItemProps> = ({ icon, label, active, onClick }) => (
  <div className="sidebar-item-wrapper group" onClick={onClick}>
    {active && <div className="sidebar-active-indicator" />}
    <div className={`sidebar-icon-container ${active ? 'active' : ''}`}>{icon}</div>
    <div className="sidebar-tooltip">{label}</div>
  </div>
);

const SidebarV1: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const items = getEnabledNavItems();
  const isActive = (p: string) => location.pathname === p;
  return (
    <aside className="app-sidebar">
      <div className="sidebar-nav">
        {items.map((it) => (
          <V1Item key={it.id} icon={it.icon} label={it.label} path={it.path}
            active={isActive(it.path)} onClick={() => navigate(it.path)} />
        ))}
      </div>
      <div className="sidebar-footer">
        <V1Item icon={<SettingsIcon size={18} />} label="Settings" path="/settings"
          active={isActive('/settings')} onClick={() => navigate('/settings')} />
        <V1Item icon={<Brain size={18} />} label="AI Engine" path="/ai-settings"
          active={isActive('/ai-settings')} onClick={() => navigate('/ai-settings')} />
        <V1Item icon={<ShieldCheck size={18} />} label="Maintenance" path="/maintenance"
          active={isActive('/maintenance')} onClick={() => navigate('/maintenance')} />
        <V1Item icon={<Users size={18} />} label="Teams" path="/teams"
          active={isActive('/teams')} onClick={() => navigate('/teams')} />
        <V1Item icon={<Key size={18} />} label="API Keys" path="/api-keys"
          active={isActive('/api-keys')} onClick={() => navigate('/api-keys')} />
        <V1Item icon={<BookOpen size={18} />} label="API Docs" path="/xenon/api-docs"
          active={false}
          onClick={() => window.open(window.location.origin + '/xenon/api-docs', '_blank')} />
      </div>
    </aside>
  );
};

// ——— v2 ———
interface V2NavRow {
  id: string; label: string; icon: React.ReactNode; path?: string; onClick?: () => void;
  count?: number; external?: boolean;
}

interface V2NavGroup {
  heading: string; rows: V2NavRow[];
}

const SidebarV2: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, isPinned, setHover, togglePin } = useSidebarState();
  const expanded = state !== 'collapsed';
  const isActive = (p: string) => location.pathname === p || location.pathname.startsWith(p + '/');

  const groups: V2NavGroup[] = [
    {
      heading: 'WORKSPACE',
      rows: [
        { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={16} />, path: '/overview' },
        { id: 'devices', label: 'Devices', icon: <Smartphone size={16} />, path: '/devices' },
        { id: 'sessions', label: 'Sessions', icon: <Hammer size={16} />, path: '/builds' },
        { id: 'apps', label: 'Apps', icon: <AppWindow size={16} />, path: '/apps' },
        { id: 'notifications', label: 'Notifications', icon: <Bell size={16} />, path: '/notifications' },
      ],
    },
    {
      heading: 'ADMIN',
      rows: [
        { id: 'settings', label: 'Settings', icon: <SettingsIcon size={16} />, path: '/settings' },
        { id: 'ai', label: 'AI Engine', icon: <Brain size={16} />, path: '/ai-settings' },
        { id: 'maint', label: 'Maintenance', icon: <ShieldCheck size={16} />, path: '/maintenance' },
        { id: 'teams', label: 'Teams', icon: <Users size={16} />, path: '/teams' },
        { id: 'keys', label: 'API Keys', icon: <Key size={16} />, path: '/api-keys' },
      ],
    },
  ];

  return (
    <aside
      className={`sb2${expanded ? ' sb2-expanded' : ''}${isPinned ? ' sb2-pinned' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="sb2-groups">
        {groups.map((g) => (
          <div key={g.heading} className="sb2-group">
            {expanded && <div className="sb2-heading">{g.heading}</div>}
            {g.rows.map((r) => {
              const active = r.path ? isActive(r.path) : false;
              return (
                <button
                  key={r.id}
                  type="button"
                  className={`sb2-row${active ? ' sb2-row-active' : ''}`}
                  onClick={() => {
                    if (r.onClick) r.onClick();
                    else if (r.path) navigate(r.path);
                  }}
                  title={!expanded ? r.label : undefined}
                >
                  <span className="sb2-icon">{r.icon}</span>
                  {expanded && <span className="sb2-label">{r.label}</span>}
                  {expanded && typeof r.count === 'number' && <span className="sb2-count">{r.count}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="sb2-footer">
        <button
          type="button"
          className="sb2-row"
          onClick={() => window.open(window.location.origin + '/xenon/api-docs', '_blank')}
          title={!expanded ? 'API Docs' : undefined}
        >
          <span className="sb2-icon"><BookOpen size={16} /></span>
          {expanded && <span className="sb2-label">API Docs</span>}
        </button>
        {expanded && (
          <button type="button" className="sb2-pin" onClick={togglePin} title={isPinned ? 'Unpin' : 'Pin open'}>
            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
            <span>{isPinned ? 'Unpin' : 'Pin'}</span>
          </button>
        )}
      </div>
    </aside>
  );
};

export const Sidebar: React.FC = () => (isThemeV2() ? <SidebarV2 /> : <SidebarV1 />);
export default Sidebar;
```

- [ ] **Step 2: Append v2 styles to `sidebar.css`** (keep everything currently in the file above these v2 rules):

```css
/* ——— v2 sidebar ——— */
html[data-theme="v2"] .app-sidebar { display: none; }

.sb2 {
  width: 56px;
  background: var(--bg-canvas);
  border-right: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  height: calc(100vh - 44px);
  position: fixed;
  left: 0;
  top: 44px;
  z-index: 1000;
  padding: 12px 6px;
  transition: width var(--motion-fast);
  overflow: hidden;
}
.sb2.sb2-expanded { width: 200px; }
.sb2.sb2-pinned { width: 200px; }

.sb2-groups { display: flex; flex-direction: column; gap: 16px; flex: 1; }
.sb2-group { display: flex; flex-direction: column; gap: 2px; }
.sb2-heading {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--text-subtle);
  padding: 4px 10px;
}
.sb2-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  font-weight: 500;
  border-radius: var(--radius-sm);
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: background var(--motion-fast), color var(--motion-fast);
  position: relative;
}
.sb2-row:hover { background: var(--bg-elevated); color: var(--text-primary); }
.sb2-row-active { background: var(--accent-subtle); color: var(--accent); }
.sb2-row-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: var(--accent);
  border-radius: 0 2px 2px 0;
}
.sb2-icon { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; color: inherit; }
.sb2-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sb2-count {
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  padding: 0 6px;
  border-radius: 10px;
}

.sb2-footer {
  border-top: 1px solid var(--border-default);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sb2-pin {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  padding: 4px 10px;
  margin-top: 4px;
  cursor: pointer;
}
.sb2-pin:hover { background: var(--bg-elevated); color: var(--text-primary); }
```

- [ ] **Step 3: Adjust layout gutter when expanded**

Edit `web/src/App.css` — append:

```css
html[data-theme="v2"] .app-main-container { margin-top: 44px; height: calc(100vh - 44px); }
html[data-theme="v2"] .app-content { margin-left: 56px; transition: margin-left var(--motion-fast); }
html[data-theme="v2"] body:has(.sb2.sb2-pinned) .app-content { margin-left: 200px; }
```

- [ ] **Step 4: Smoke**

`cd web && npm run start`. Sidebar should hover-expand and pin. Route highlighting should follow location. Toggle `?themeV2=0` and confirm v1 sidebar renders.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/sidebar/sidebar.tsx web/src/components/sidebar/sidebar.css web/src/App.css
git commit -m "feat(web): v2 sidebar (expandable, pinnable, grouped)"
```

### Task 2.3: Header rebuild (v2-aware)

**Files:**
- Modify: `web/src/components/header/header.tsx`
- Modify: `web/src/components/header/header.css`

- [ ] **Step 1: Rewrite Header**

Replace `web/src/components/header/header.tsx`:

```tsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Search, Shield } from 'lucide-react';
import { isThemeV2 } from '../../lib/theme-flag';
import './header.css';

// v1 header preserved as-is below v2 renderer
// (keep the existing implementation inline for backwards compat)

const HeaderV2: React.FC = () => {
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const ddRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const openPalette = () => window.dispatchEvent(new CustomEvent('xenon.open-command-palette'));

  return (
    <div className="hdr2">
      <div className="hdr2-left" onClick={() => navigate('/')}>
        <img src="logo.svg" alt="Xenon" className="hdr2-logo" />
        <span className="hdr2-version">v{__XENON_VERSION__}</span>
      </div>

      <button type="button" className="hdr2-search" onClick={openPalette}>
        <Search size={13} />
        <span className="hdr2-search-placeholder">Search devices, sessions, settings…</span>
        <span className="hdr2-kbd">⌘K</span>
      </button>

      <div className="hdr2-right">
        <div className="hdr2-status">
          <span className="status-dot status-dot-ready" />
          <span>Online</span>
        </div>
        <div className="hdr2-profile-wrap" ref={ddRef}>
          <button type="button" className="hdr2-profile" onClick={() => setDropdownOpen((o) => !o)}>
            <span className="hdr2-avatar"><Shield size={14} /></span>
            <span className="hdr2-profile-name">Administrator</span>
            <ChevronDown size={12} />
          </button>
          {dropdownOpen && (
            <div className="hdr2-profile-menu">
              <div className="hdr2-menu-section">
                <div className="hdr2-menu-head">Workspace</div>
                <div className="hdr2-menu-row"><span>Registry</span><span>Default</span></div>
                <div className="hdr2-menu-row"><span>Node</span><span>Root · Primary</span></div>
              </div>
              <div className="hdr2-menu-divider" />
              <div className="hdr2-menu-section">
                <div className="hdr2-menu-head">System</div>
                <div className="hdr2-menu-row"><span>● Stable</span><span>v{__XENON_VERSION__}</span></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Preserve v1 header literally
const HeaderV1: React.FC = () => {
  const navigate = useNavigate();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  return (
    <div className="header-container">
      <div className="header-left">
        <div className="header-logo-container" onClick={() => navigate('/')}>
          <img src="logo.svg" alt="Xenon Logo" className="header-logo-image" />
        </div>
      </div>
      <div className="header-right">
        <div className="header-actions">
          <div className="header-status-pill">
            <div className="status-dot"></div>
            <span>System Online</span>
          </div>
        </div>
        <div className="profile-dropdown-container" ref={dropdownRef}>
          <button className={`profile-trigger ${dropdownOpen ? 'open' : ''}`} onClick={() => setDropdownOpen(!dropdownOpen)}>
            <div className="avatar-preview"><Shield size={16} /></div>
            <div className="profile-info-compact">
              <span className="profile-name">Administrator</span>
              <span className="profile-role">Root Node</span>
            </div>
            <ChevronDown size={14} className={`chevron-icon ${dropdownOpen ? 'rotate' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  );
};

const Header: React.FC = () => (isThemeV2() ? <HeaderV2 /> : <HeaderV1 />);
export default Header;
```

Vite build constant `__XENON_VERSION__` needs to be declared. Edit `web/vite.config.ts` (or create if missing — check first with `cat web/vite.config.ts`) and add under `defineConfig`:

```ts
import pkg from './package.json';
export default defineConfig({
  // ...existing...
  define: {
    __XENON_VERSION__: JSON.stringify(pkg.version),
  },
});
```

And declare the type in `web/src/react-app-env.d.ts`:

```ts
declare const __XENON_VERSION__: string;
```

- [ ] **Step 2: Append v2 header styles** to `web/src/components/header/header.css`:

```css
/* ——— v2 header ——— */
html[data-theme="v2"] .header-container { display: none; }

.hdr2 {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 44px;
  background: var(--bg-canvas);
  border-bottom: 1px solid var(--border-default);
  z-index: 5000;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  font-family: 'Inter', sans-serif;
}
.hdr2-left { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.hdr2-logo { height: 20px; }
.hdr2-version {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--text-subtle);
}
.hdr2-search {
  flex: 1;
  max-width: 420px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 0 10px;
  height: 28px;
  color: var(--text-subtle);
  cursor: pointer;
  font-size: 12px;
}
.hdr2-search:hover { border-color: var(--border-strong); color: var(--text-muted); }
.hdr2-search-placeholder { flex: 1; text-align: left; }
.hdr2-kbd {
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}
.hdr2-right { display: flex; align-items: center; gap: 12px; margin-left: auto; }
.hdr2-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--status-ready-fg);
  font-size: 11px;
  font-weight: 500;
}
.hdr2-profile-wrap { position: relative; }
.hdr2-profile {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 3px 10px 3px 4px;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  height: 28px;
}
.hdr2-profile:hover { border-color: var(--border-strong); }
.hdr2-avatar {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}
.hdr2-profile-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 240px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  padding: 8px;
  z-index: 5100;
}
.hdr2-menu-section { padding: 6px 4px; }
.hdr2-menu-head {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--text-subtle);
  margin-bottom: 4px;
}
.hdr2-menu-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 6px;
  font-size: 12px;
  color: var(--text-secondary);
}
.hdr2-menu-divider { height: 1px; background: var(--border-default); margin: 6px 4px; }
```

- [ ] **Step 3: Smoke** — `cd web && npm run start`. Header should render slim; clicking the search area fires the custom event (no palette yet). V1 still works via `?themeV2=0`.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/header/header.tsx web/src/components/header/header.css web/src/react-app-env.d.ts
# also vite.config.ts if you edited/created it
git add web/vite.config.ts 2>/dev/null || true
git commit -m "feat(web): v2 header (slim, with palette trigger)"
```

### Task 2.4: /overview route with placeholder

**Files:**
- Create: `web/src/components/overview/overview.tsx`
- Create: `web/src/components/overview/overview.css`
- Modify: `web/src/routes/index.tsx`

- [ ] **Step 1: Placeholder component**

```tsx
// web/src/components/overview/overview.tsx
import * as React from 'react';
import './overview.css';

const Overview: React.FC = () => (
  <div className="ov">
    <div className="ov-header">
      <div>
        <div className="ov-crumb">WORKSPACE</div>
        <h1 className="ov-title">Overview</h1>
      </div>
    </div>
    <div className="ov-placeholder">Overview will land in phase 3.</div>
  </div>
);

export default Overview;
```

```css
/* web/src/components/overview/overview.css */
.ov { padding: 20px 24px; font-family: 'Inter', sans-serif; }
.ov-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px; }
.ov-crumb {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--text-subtle);
  margin-bottom: 4px;
}
.ov-title {
  color: var(--text-primary);
  font-family: 'Inter', sans-serif;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0;
}
.ov-placeholder {
  padding: 60px 20px;
  text-align: center;
  color: var(--text-muted);
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}
```

- [ ] **Step 2: Register the route**

Edit `web/src/routes/index.tsx` — add the lazy import beside the others:

```tsx
const Overview = lazy(() => import('../components/overview/overview'));
```

And add the route before the first existing route, and change the `/` redirect:

```tsx
<Route path="/" element={<Navigate to="/overview" replace />} />
<Route
  path="/overview"
  element={
    <div className="app-body-container">
      <Overview />
    </div>
  }
/>
```

Leave every other route in place.

- [ ] **Step 3: Smoke**

`cd web && npm run start`. Open `/`. It should redirect to `/overview` and show the placeholder. Under v1 (`?themeV2=0`), `/` still redirects there but renders against v1 tokens — this is OK (it's a placeholder until phase 3).

- [ ] **Step 4: Commit + push phase 2**

```bash
git add web/src/components/overview/overview.tsx web/src/components/overview/overview.css web/src/routes/index.tsx
git commit -m "feat(web): add /overview route placeholder; redirect / to /overview"
git push -u origin feat/ui-refresh-phase-2-shell
gh pr create --title "feat(web): phase-2 UI refresh — shell + overview stub" --body "$(cat <<'EOF'
## Summary
- New v2 Header (slim, ⌘K trigger, profile dropdown) and v2 Sidebar (expandable, pinnable, grouped with counts)
- v1 versions preserved verbatim and rendered when \`themeV2\` is off
- New \`/overview\` route with placeholder; \`/\` now redirects to \`/overview\`

## Test plan
- [ ] V2: hover sidebar to expand, pin/unpin persists via localStorage
- [ ] V2: clicking the header search fires \`xenon.open-command-palette\` event
- [ ] V1: \`?themeV2=0\` still renders the original header + sidebar
- [ ] All existing routes reachable

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 3 — Overview page (real widgets)

**Goal:** Replace the overview placeholder with real KPI tiles, fleet table, and activity stream. Uses only existing REST endpoints + socket events.

**Branch:** `feat/ui-refresh-phase-3-overview`

### Task 3.1: Inventory the data sources

- [ ] **Step 1:** Confirm the exact shape of existing endpoints by reading:
  - `web/src/api-service/index.ts`
  - `web/src/hooks/useSocket.ts`
  - `web/src/interfaces/IDevice.ts`, `ISession.ts`, `IBuild.ts`
  Don't commit anything — this is a read-only pass to confirm the field names used in the next steps. Record any mismatches; they become small patches in Task 3.4.

### Task 3.2: KPI tile component

**Files:**
- Create: `web/src/components/overview/KpiTile.tsx`

- [ ] **Step 1: Implement**

```tsx
// web/src/components/overview/KpiTile.tsx
import * as React from 'react';

export interface KpiTileProps {
  label: string;
  value: React.ReactNode;
  subline?: React.ReactNode;
  tone?: 'neutral' | 'ready' | 'busy' | 'error';
}

export const KpiTile: React.FC<KpiTileProps> = ({ label, value, subline, tone = 'neutral' }) => (
  <div className="kpi">
    <div className="kpi-label">{label}</div>
    <div className="kpi-value">{value}</div>
    {subline && <div className={`kpi-sub kpi-sub-${tone}`}>{subline}</div>}
  </div>
);
```

Add CSS to `overview.css`:

```css
.kpi {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 14px;
}
.kpi-label { color: var(--text-muted); font-size: 11px; margin-bottom: 6px; }
.kpi-value {
  color: var(--text-primary);
  font-family: 'Inter', sans-serif;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.kpi-sub { font-size: 10px; margin-top: 4px; }
.kpi-sub-neutral { color: var(--text-muted); }
.kpi-sub-ready { color: var(--status-ready-fg); }
.kpi-sub-busy { color: var(--status-busy-fg); }
.kpi-sub-error { color: var(--status-error-fg); }
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/overview/KpiTile.tsx web/src/components/overview/overview.css
git commit -m "feat(web): KpiTile component"
```

### Task 3.3: Fleet table + Activity stream components

**Files:**
- Create: `web/src/components/overview/FleetTable.tsx`
- Create: `web/src/components/overview/ActivityStream.tsx`

- [ ] **Step 1: FleetTable**

```tsx
// web/src/components/overview/FleetTable.tsx
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { IDevice } from '../../interfaces/IDevice';
import { StatusDot, StatusKind } from '../ui/StatusDot';
import { StatusCode } from '../ui/StatusCode';

// StatusKind is re-exported from ./StatusDot; StatusCode is in its own file.
// If you prefer a barrel, add web/src/components/ui/index.ts and re-export both.

function kindOf(d: IDevice): StatusKind {
  if (d.offline) return 'offline';
  if (d.userBlocked) return 'error';
  if (d.busy) return 'busy';
  if (d.reservedUntil && Date.now() < d.reservedUntil) return 'reserved';
  return 'ready';
}

function priority(d: IDevice): number {
  const k = kindOf(d);
  return ({ busy: 0, reserved: 1, ready: 2, error: 3, offline: 4 } as Record<StatusKind, number>)[k];
}

export const FleetTable: React.FC<{ devices: IDevice[]; limit?: number }> = ({ devices, limit = 6 }) => {
  const navigate = useNavigate();
  const sorted = [...devices].sort((a, b) => priority(a) - priority(b)).slice(0, limit);
  return (
    <div className="ov-fleet">
      {sorted.map((d) => {
        const k = kindOf(d);
        return (
          <div
            key={`${d.host}|${d.udid}`}
            className="ov-fleet-row"
            onClick={() => navigate(`/devices/${d.udid}/control`)}
          >
            <StatusDot kind={k} />
            <span className="ov-fleet-name">{d.name}</span>
            <span className="ov-fleet-udid">{d.udid}</span>
            <StatusCode kind={k}>{k}</StatusCode>
          </div>
        );
      })}
    </div>
  );
};
```

CSS additions to `overview.css`:

```css
.ov-fleet { display: flex; flex-direction: column; }
.ov-fleet-row {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.ov-fleet-row:hover { background: var(--bg-elevated); }
.ov-fleet-row:nth-child(even) { background: var(--bg-subtle); }
.ov-fleet-row:nth-child(even):hover { background: var(--bg-elevated); }
.ov-fleet-name { color: var(--text-primary); font-size: 12px; font-weight: 500; }
.ov-fleet-udid { color: var(--text-subtle); font-family: 'JetBrains Mono', monospace; font-size: 10px; }
```

- [ ] **Step 2: ActivityStream** (consumes the existing socket stream — import the same socket instance used by `session-dashboard`)

```tsx
// web/src/components/overview/ActivityStream.tsx
import * as React from 'react';

export interface ActivityEvent {
  id: string;
  ts: number;
  kind: 'heal' | 'session' | 'device' | 'node' | 'build';
  message: React.ReactNode;
}

export const ActivityStream: React.FC<{ events: ActivityEvent[]; max?: number }> = ({ events, max = 20 }) => (
  <div className="ov-activity">
    {events.slice(0, max).map((e) => (
      <div key={e.id} className="ov-activity-row">
        <span className="ov-activity-ts">{new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <span className="ov-activity-msg">{e.message}</span>
      </div>
    ))}
  </div>
);
```

CSS additions to `overview.css`:

```css
.ov-activity { display: flex; flex-direction: column; gap: 8px; padding: 10px 14px; }
.ov-activity-row { display: flex; gap: 10px; font-size: 11px; }
.ov-activity-ts {
  color: var(--text-subtle);
  font-family: 'JetBrains Mono', monospace;
  width: 44px;
  flex-shrink: 0;
}
.ov-activity-msg { color: var(--text-secondary); }
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/overview/FleetTable.tsx web/src/components/overview/ActivityStream.tsx web/src/components/overview/overview.css
git commit -m "feat(web): FleetTable + ActivityStream components"
```

### Task 3.4: Wire Overview to stores

**Files:**
- Modify: `web/src/components/overview/overview.tsx`
- Possibly: `web/src/components/overview/use-overview-data.ts` (new)

- [ ] **Step 1: Data hook**

Create `web/src/components/overview/use-overview-data.ts`:

```ts
import { useEffect, useState } from 'react';
import XenonApiService from '../../api-service';
import { IDevice } from '../../interfaces/IDevice';
import { ISession } from '../../interfaces/ISession';
import { useSocket } from '../../hooks/useSocket';
import { ActivityEvent } from './ActivityStream';

export interface OverviewData {
  devices: IDevice[];
  activeSessions: ISession[];
  queuedSessions: number;
  healsToday: number;
  healSuccessPct: number;
  failures24h: number;
  failuresDelta: number;
  activity: ActivityEvent[];
}

// Starting minimal — each endpoint is wrapped defensively so a missing field doesn't
// crash the tile; values settle to 0 / [] and the tile shows '—'.
export function useOverviewData(): OverviewData {
  const [devices, setDevices] = useState<IDevice[]>([]);
  const [sessions, setSessions] = useState<ISession[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      XenonApiService.getDevices().catch(() => []),
      XenonApiService.getSessions().catch(() => []),
    ]).then(([d, s]) => {
      if (cancelled) return;
      setDevices(d as IDevice[]);
      setSessions(s as ISession[]);
    });
    return () => { cancelled = true; };
  }, []);

  useSocket((evt: { type: string; payload: any }) => {
    if (!evt || !evt.type) return;
    const now = Date.now();
    if (evt.type === 'device.update') {
      setDevices((prev) => prev.map((d) => d.udid === evt.payload.udid ? { ...d, ...evt.payload } : d));
    }
    if (evt.type === 'session.create') {
      setSessions((prev) => [evt.payload, ...prev]);
      setActivity((a) => [
        { id: evt.payload.id + ':start', ts: now, kind: 'session', message: `Session ${evt.payload.id?.slice(0,6) || ''}… started` },
        ...a,
      ].slice(0, 20));
    }
    if (evt.type === 'session.end') {
      setActivity((a) => [
        { id: evt.payload.id + ':end', ts: now, kind: 'session', message: `Session ${evt.payload.id?.slice(0,6) || ''}… ended` },
        ...a,
      ].slice(0, 20));
    }
    if (evt.type === 'heal') {
      setActivity((a) => [
        { id: `heal:${now}`, ts: now, kind: 'heal', message: `Heal ${evt.payload?.tier || ''} on ${evt.payload?.selector || 'element'}` },
        ...a,
      ].slice(0, 20));
    }
  });

  const activeSessions = sessions.filter((s) => s.status === 'running');
  const queued = sessions.filter((s) => s.status === 'requested' || s.status === 'allocated').length;
  const healsToday = activity.filter((e) => e.kind === 'heal').length;
  const healSuccessPct = 0; // backfill if backend exposes it; until then show '—' in the tile

  return {
    devices,
    activeSessions,
    queuedSessions: queued,
    healsToday,
    healSuccessPct,
    failures24h: 0, // backfill later
    failuresDelta: 0,
    activity,
  };
}
```

Reality-check: the actual socket event names and field names may differ. Read `web/src/hooks/useSocket.ts` and `web/src/dashboard/event-manager.ts` **before coding** and adjust the `evt.type` values and `evt.payload` access accordingly. Do not guess.

- [ ] **Step 2: Overview page**

Replace `web/src/components/overview/overview.tsx`:

```tsx
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { Card } from '../ui/Card';
import { KpiTile } from './KpiTile';
import { FleetTable } from './FleetTable';
import { ActivityStream } from './ActivityStream';
import { useOverviewData } from './use-overview-data';
import './overview.css';

const fmtPct = (n: number) => (Number.isFinite(n) ? `${Math.round(n)}%` : '—');

const Overview: React.FC = () => {
  const navigate = useNavigate();
  const data = useOverviewData();
  const online = data.devices.filter((d) => !d.offline).length;
  const total = data.devices.length;
  const uptimePct = total ? (online / total) * 100 : 0;

  return (
    <div className="ov">
      <div className="ov-header">
        <div>
          <div className="ov-crumb">WORKSPACE</div>
          <h1 className="ov-title">Overview</h1>
        </div>
        <div className="ov-actions">
          <Button variant="primary" onClick={() => navigate('/builds?new=1')}>+ New session</Button>
        </div>
      </div>

      <div className="ov-kpis">
        <KpiTile
          label="Devices online"
          value={<><span>{online}</span><span className="ov-kpi-total"> / {total}</span></>}
          subline={`● ${fmtPct(uptimePct)} fleet uptime`}
          tone="ready"
        />
        <KpiTile
          label="Active sessions"
          value={data.activeSessions.length}
          subline={data.queuedSessions ? `▸ ${data.queuedSessions} queued` : 'No queue'}
          tone={data.queuedSessions ? 'busy' : 'neutral'}
        />
        <KpiTile
          label="Heals today"
          value={data.healsToday}
          subline={data.healSuccessPct ? `● ${fmtPct(data.healSuccessPct)} success` : '—'}
          tone="ready"
        />
        <KpiTile
          label="Failures (24h)"
          value={data.failures24h}
          subline={data.failuresDelta ? `▲ ${data.failuresDelta > 0 ? '+' : ''}${data.failuresDelta} vs yesterday` : '—'}
          tone={data.failuresDelta > 0 ? 'error' : 'neutral'}
        />
      </div>

      <div className="ov-grid">
        <Card
          header="Fleet status"
          action={<a href="/devices" onClick={(e) => { e.preventDefault(); navigate('/devices'); }}>View all →</a>}
          padded={false}
        >
          <FleetTable devices={data.devices} />
        </Card>
        <Card header="Recent activity" padded={false}>
          <ActivityStream events={data.activity} />
        </Card>
      </div>
    </div>
  );
};
export default Overview;
```

Add layout CSS to `overview.css`:

```css
.ov-actions { display: flex; gap: 6px; }
.ov-kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 20px;
}
.ov-kpi-total { color: var(--text-subtle); font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 500; }
.ov-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; }
```

- [ ] **Step 3: Smoke**

`cd web && npm run start`. Open `/overview`. KPIs should show real counts from your local devices/sessions. Fleet table populates. Activity stream builds up as events arrive.

- [ ] **Step 4: Screenshot + commit**

Capture `/overview` into `web/screenshots/phase-3/overview-v2.png`.

```bash
git add web/src/components/overview/ web/screenshots/phase-3
git commit -m "feat(web): wire Overview to real data"
git push -u origin feat/ui-refresh-phase-3-overview
gh pr create --title "feat(web): phase-3 UI refresh — Overview page" --body "$(cat <<'EOF'
## Summary
- Wired Overview: KPIs (devices online, active sessions, heals, failures) + Fleet table + Activity stream
- All data from existing REST endpoints + socket stream; no backend changes

## Test plan
- [ ] KPIs reflect live device/session counts
- [ ] Fleet rows navigate to \`/devices/:udid/control\` on click
- [ ] Socket events appear in the activity stream
- [ ] \`+ New session\` button routes to Builds with a \`?new=1\` param (no-op until later)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 4 — ⌘K command palette

**Goal:** Global keyboard-invoked palette with navigation + fuzzy entity search across devices, sessions, teams, keys, apps.

**Branch:** `feat/ui-refresh-phase-4-palette`

### Task 4.1: Fuzzy scorer (TDD)

**Files:**
- Create: `web/src/components/command-palette/fuzzy.ts`
- Create: `web/src/components/command-palette/fuzzy.test.ts`

- [ ] **Step 1: Write tests**

```ts
// web/src/components/command-palette/fuzzy.test.ts
import { fuzzyScore } from './fuzzy';

describe('fuzzyScore', () => {
  it('returns 0 when no match', () => {
    expect(fuzzyScore('xyz', 'hello world')).toBe(0);
  });
  it('returns > 0 when every char of query appears in order', () => {
    expect(fuzzyScore('hw', 'hello world')).toBeGreaterThan(0);
  });
  it('prefix match outscores mid-string match', () => {
    expect(fuzzyScore('set', 'settings')).toBeGreaterThan(fuzzyScore('set', 'resetter'));
  });
  it('is case insensitive', () => {
    expect(fuzzyScore('IPH', 'iphone 15 pro')).toBeGreaterThan(0);
  });
  it('exact match gets a large bonus', () => {
    expect(fuzzyScore('iphone', 'iphone')).toBeGreaterThan(fuzzyScore('iphone', 'iphone 15'));
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd web && npx jest src/components/command-palette/fuzzy.test.ts --no-coverage
```

- [ ] **Step 3: Implement**

```ts
// web/src/components/command-palette/fuzzy.ts
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 10_000;
  if (t.startsWith(q)) return 5_000 - (t.length - q.length);

  let ti = 0, score = 0, streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const nextIdx = t.indexOf(c, ti);
    if (nextIdx === -1) return 0;
    if (nextIdx === ti) {
      streak += 1;
      score += 20 + streak * 5;
    } else {
      streak = 0;
      score += 10 - Math.min(nextIdx - ti, 10);
    }
    ti = nextIdx + 1;
  }
  return Math.max(score, 1);
}
```

- [ ] **Step 4: Run — expect pass + commit**

```bash
cd web && npx jest src/components/command-palette/fuzzy.test.ts --no-coverage
git add web/src/components/command-palette/fuzzy.ts web/src/components/command-palette/fuzzy.test.ts
git commit -m "feat(web): fuzzy scoring for command palette"
```

### Task 4.2: Command index

**Files:**
- Create: `web/src/components/command-palette/command-index.ts`
- Create: `web/src/components/command-palette/command-index.test.ts`

- [ ] **Step 1: Test**

```ts
// web/src/components/command-palette/command-index.test.ts
import { CommandIndex } from './command-index';

const sampleDevices = [
  { udid: 'ABC-1', name: 'iPhone 15 Pro', host: 'mac-1:4723' },
  { udid: 'XYZ-9', name: 'Pixel 8', host: 'linux-1:4723' },
] as any;

describe('CommandIndex', () => {
  it('returns navigation items for "set"', () => {
    const idx = new CommandIndex();
    const res = idx.search('set', 8);
    expect(res.some((r) => r.kind === 'nav' && r.label.toLowerCase().includes('set'))).toBe(true);
  });

  it('finds device by partial name', () => {
    const idx = new CommandIndex();
    idx.setDevices(sampleDevices);
    const res = idx.search('iph', 8);
    expect(res.some((r) => r.kind === 'device' && r.label === 'iPhone 15 Pro')).toBe(true);
  });

  it('caps results', () => {
    const idx = new CommandIndex();
    idx.setDevices(sampleDevices);
    const res = idx.search('e', 2);
    expect(res.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// web/src/components/command-palette/command-index.ts
import { fuzzyScore } from './fuzzy';

export type CommandKind = 'nav' | 'device' | 'session' | 'team' | 'key' | 'app';

export interface CommandItem {
  id: string;
  kind: CommandKind;
  label: string;
  sub?: string;
  path: string;
}

const NAV_ITEMS: CommandItem[] = [
  { id: 'nav:overview', kind: 'nav', label: 'Overview', path: '/overview' },
  { id: 'nav:devices', kind: 'nav', label: 'Devices', path: '/devices' },
  { id: 'nav:builds', kind: 'nav', label: 'Sessions', path: '/builds' },
  { id: 'nav:apps', kind: 'nav', label: 'Apps', path: '/apps' },
  { id: 'nav:notifications', kind: 'nav', label: 'Notifications', path: '/notifications' },
  { id: 'nav:settings', kind: 'nav', label: 'Settings', path: '/settings' },
  { id: 'nav:ai-settings', kind: 'nav', label: 'AI Engine', path: '/ai-settings' },
  { id: 'nav:maintenance', kind: 'nav', label: 'Maintenance', path: '/maintenance' },
  { id: 'nav:teams', kind: 'nav', label: 'Teams', path: '/teams' },
  { id: 'nav:api-keys', kind: 'nav', label: 'API Keys', path: '/api-keys' },
];

export class CommandIndex {
  private devices: CommandItem[] = [];
  private sessions: CommandItem[] = [];
  private teams: CommandItem[] = [];
  private keys: CommandItem[] = [];
  private apps: CommandItem[] = [];

  setDevices(list: { udid: string; name?: string }[]) {
    this.devices = list.map((d) => ({
      id: `device:${d.udid}`, kind: 'device', label: d.name || d.udid, sub: d.udid,
      path: `/devices/${d.udid}/control`,
    }));
  }
  setSessions(list: { id: string; name?: string }[]) {
    this.sessions = list.map((s) => ({
      id: `session:${s.id}`, kind: 'session', label: s.name || s.id, sub: s.id, path: `/builds?session=${s.id}`,
    }));
  }
  setTeams(list: { id: string; name?: string }[]) {
    this.teams = list.map((t) => ({ id: `team:${t.id}`, kind: 'team', label: t.name || t.id, sub: t.id, path: `/teams?team=${t.id}` }));
  }
  setKeys(list: { id: string; name?: string }[]) {
    this.keys = list.map((k) => ({ id: `key:${k.id}`, kind: 'key', label: k.name || k.id, sub: k.id, path: `/api-keys?key=${k.id}` }));
  }
  setApps(list: { id: string; name?: string }[]) {
    this.apps = list.map((a) => ({ id: `app:${a.id}`, kind: 'app', label: a.name || a.id, path: `/apps?app=${a.id}` }));
  }

  search(query: string, max = 8): CommandItem[] {
    const all = [...NAV_ITEMS, ...this.devices, ...this.sessions, ...this.teams, ...this.keys, ...this.apps];
    if (!query.trim()) return NAV_ITEMS.slice(0, max);
    return all
      .map((it) => {
        const a = fuzzyScore(query, it.label);
        const b = it.sub ? fuzzyScore(query, it.sub) : 0;
        return { it, score: Math.max(a, b) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map((x) => x.it);
  }
}
```

- [ ] **Step 3: Run + commit**

```bash
cd web && npx jest src/components/command-palette/command-index.test.ts --no-coverage
git add web/src/components/command-palette/command-index.ts web/src/components/command-palette/command-index.test.ts
git commit -m "feat(web): command index"
```

### Task 4.3: Palette component + hook

**Files:**
- Create: `web/src/components/command-palette/command-palette.tsx`
- Create: `web/src/components/command-palette/command-palette.css`
- Create: `web/src/hooks/useCommandPalette.ts`
- Modify: `web/src/App.tsx` (mount at root)

- [ ] **Step 1: Hook**

```ts
// web/src/hooks/useCommandPalette.ts
import { useEffect, useState } from 'react';

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useCommandPalette(): { open: boolean; setOpen: (v: boolean) => void } {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !isEditableTarget(e.target)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onOpenEvent = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('xenon.open-command-palette', onOpenEvent as EventListener);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('xenon.open-command-palette', onOpenEvent as EventListener);
    };
  }, []);

  return { open, setOpen };
}
```

- [ ] **Step 2: Palette component**

```tsx
// web/src/components/command-palette/command-palette.tsx
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import XenonApiService from '../../api-service';
import { useCommandPalette } from '../../hooks/useCommandPalette';
import { CommandIndex, CommandItem } from './command-index';
import './command-palette.css';

const KIND_LABEL: Record<CommandItem['kind'], string> = {
  nav: 'Navigation', device: 'Devices', session: 'Sessions', team: 'Teams', key: 'API Keys', app: 'Apps',
};

export const CommandPalette: React.FC = () => {
  const { open, setOpen } = useCommandPalette();
  const [q, setQ] = React.useState('');
  const [cursor, setCursor] = React.useState(0);
  const navigate = useNavigate();
  const idxRef = React.useRef(new CommandIndex());
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    // Populate index — defensive: failures don't block nav-only search.
    Promise.all([
      XenonApiService.getDevices().catch(() => []),
      XenonApiService.getSessions().catch(() => []),
    ]).then(([d, s]) => {
      idxRef.current.setDevices(d as any);
      idxRef.current.setSessions(s as any);
    });
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  React.useEffect(() => {
    if (!open) { setQ(''); setCursor(0); }
  }, [open]);

  const results: CommandItem[] = React.useMemo(() => idxRef.current.search(q, 8), [q, open]);

  // Group results by kind for display, but keep the flat order for keyboard nav.
  const grouped = React.useMemo(() => {
    const m = new Map<CommandItem['kind'], CommandItem[]>();
    results.forEach((r) => { const arr = m.get(r.kind) || []; arr.push(r); m.set(r.kind, arr); });
    return m;
  }, [results]);

  if (!open) return null;

  const select = (it: CommandItem) => { navigate(it.path); setOpen(false); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); results[cursor] && select(results[cursor]); }
  };

  let flatIdx = -1;

  return (
    <div className="cp-overlay" onClick={() => setOpen(false)}>
      <div className="cp" onClick={(e) => e.stopPropagation()}>
        <div className="cp-input-row">
          <Search size={14} />
          <input
            ref={inputRef}
            className="cp-input"
            placeholder="Search devices, sessions, settings…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setCursor(0); }}
            onKeyDown={onKeyDown}
          />
          <span className="cp-esc">ESC</span>
        </div>
        <div className="cp-results">
          {results.length === 0 && <div className="cp-empty">No results.</div>}
          {Array.from(grouped.entries()).map(([kind, items]) => (
            <div key={kind} className="cp-group">
              <div className="cp-group-head">{KIND_LABEL[kind]}</div>
              {items.map((it) => {
                flatIdx += 1;
                const active = flatIdx === cursor;
                return (
                  <button
                    key={it.id}
                    type="button"
                    className={`cp-item${active ? ' cp-item-active' : ''}`}
                    onMouseEnter={() => setCursor(flatIdx)}
                    onClick={() => select(it)}
                  >
                    <span className="cp-item-label">{it.label}</span>
                    {it.sub && <span className="cp-item-sub">{it.sub}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
export default CommandPalette;
```

- [ ] **Step 3: Styles**

```css
/* web/src/components/command-palette/command-palette.css */
.cp-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 9000;
  display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh;
}
.cp {
  width: 560px; max-width: 90vw;
  background: var(--bg-surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.cp-input-row {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-bottom: 1px solid var(--border-default);
  color: var(--text-muted);
}
.cp-input {
  flex: 1; background: transparent; border: none; outline: none;
  color: var(--text-primary); font-family: 'Inter', sans-serif; font-size: 14px;
}
.cp-input::placeholder { color: var(--text-subtle); }
.cp-esc {
  font-family: 'JetBrains Mono', monospace; font-size: 10px;
  color: var(--text-muted);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  padding: 2px 6px; border-radius: var(--radius-sm);
}
.cp-results { max-height: 56vh; overflow-y: auto; padding: 8px; }
.cp-empty { padding: 16px; text-align: center; color: var(--text-muted); font-size: 12px; }
.cp-group { padding: 4px 0; }
.cp-group-head {
  font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em;
  color: var(--text-subtle); padding: 6px 8px;
}
.cp-item {
  display: flex; width: 100%; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: var(--radius-sm);
  background: transparent; border: none; cursor: pointer; text-align: left;
}
.cp-item-active, .cp-item:hover { background: var(--bg-elevated); }
.cp-item-label { color: var(--text-primary); font-size: 13px; font-weight: 500; }
.cp-item-sub {
  margin-left: auto;
  color: var(--text-subtle); font-family: 'JetBrains Mono', monospace; font-size: 10px;
}
```

- [ ] **Step 4: Mount at app root (v2 only)**

Edit `web/src/App.tsx`:

```tsx
// add imports
import CommandPalette from './components/command-palette/command-palette';
import { isThemeV2 } from './lib/theme-flag';

// inside the BrowserRouter, beneath <div className="app-main-container">...</div>:
{isThemeV2() && <CommandPalette />}
```

- [ ] **Step 5: Smoke**

`cd web && npm run start`. Press ⌘K (or Ctrl+K). Palette opens. Arrow keys move selection. Enter navigates. Esc closes. Type "team" → navigates to /teams. Type a device name → navigates to /devices/UDID/control.

- [ ] **Step 6: Commit + PR**

```bash
git add web/src/components/command-palette/ web/src/hooks/useCommandPalette.ts web/src/App.tsx
git commit -m "feat(web): ⌘K command palette (nav + entity search)"
git push -u origin feat/ui-refresh-phase-4-palette
gh pr create --title "feat(web): phase-4 UI refresh — command palette" --body "$(cat <<'EOF'
## Summary
- Global \`⌘K\` / \`Ctrl+K\` command palette with fuzzy search over Navigation, Devices, Sessions, Teams, API Keys, Apps
- Keyboard-first (arrows/Enter/Esc); respects input focus (no collision with typing)
- Zero new backend calls — uses existing REST endpoints

## Test plan
- [ ] \`⌘K\` opens; \`Esc\` closes; \`Enter\` navigates
- [ ] Typing text inside an \`<input>\` does not trigger the palette
- [ ] Empty query shows navigation items
- [ ] Device search by name and UDID works

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 5 — Device card + explorer filters

**Goal:** Rebuild the device card (spec section 4) as a functional component and add the new filter/toolbar to the device-explorer. V1 stays untouched.

**Branch:** `feat/ui-refresh-phase-5-card-filters`

### Task 5.1: Device card — status helper + functional rewrite

**Files:**
- Modify: `web/src/components/device-card/device-card/device-card.tsx`
- Modify: `web/src/components/device-card/device-card/device-card.css`

- [ ] **Step 1: Wrap existing component in a v2 branch**

The class component stays put (backwards compat under v1). Add a new functional component beside it and branch on `isThemeV2()` inside `DeviceCardWrapper`.

Replace `DeviceCardWrapper` at the bottom of `device-card.tsx`:

```tsx
import { isThemeV2 } from '../../../lib/theme-flag';
import DeviceCardV2 from './device-card-v2';

export default function DeviceCardWrapper(props: any) {
  const navigate = useNavigate();
  if (isThemeV2()) return <DeviceCardV2 device={props.device} reloadDevices={props.reloadDevices} navigate={navigate} />;
  return <DeviceCard {...props} navigate={navigate} />;
}
```

- [ ] **Step 2: Implement v2 card**

Create `web/src/components/device-card/device-card/device-card-v2.tsx`:

```tsx
import * as React from 'react';
import prettyMilliseconds from 'pretty-ms';
import { Copy, MoreHorizontal, Clock, Terminal } from 'lucide-react';
import { IDevice } from '../../../interfaces/IDevice';
import XenonApiService from '../../../api-service';
import { Button } from '../../ui/button';
import { Pill } from '../../ui/Pill';
import { StatusDot } from '../../ui/StatusDot';
import { StatusCode } from '../../ui/StatusCode';
import { KeyValueRow } from '../../ui/KeyValueRow';
import { Popover } from '../../ui/Popover';
import { Menu, MenuItem, MenuDivider } from '../../ui/Menu';
import ReservationModal from '../../reservation-modal/reservation-modal';
import TagManagerModal from '../../tag-manager-modal/tag-manager-modal';
import './device-card-v2.css';

interface Props {
  device: IDevice;
  reloadDevices: () => void;
  navigate: (path: string) => void;
}

function deriveKind(d: IDevice): 'ready' | 'busy' | 'reserved' | 'error' | 'offline' {
  if (d.offline) return 'offline';
  if (d.userBlocked) return 'error';
  if (d.busy) return 'busy';
  if (d.reservedUntil && Date.now() < d.reservedUntil) return 'reserved';
  return 'ready';
}

function middleEllipsis(s: string, head = 8, tail = 4) {
  if (!s || s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

const DeviceCardV2: React.FC<Props> = ({ device, reloadDevices, navigate }) => {
  const [showReservation, setShowReservation] = React.useState(false);
  const [showTagManager, setShowTagManager] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const moreRef = React.useRef<HTMLButtonElement>(null);

  const kind = deriveKind(device);
  const reserved = kind === 'reserved';
  const busyLocked = device.busy && device.session_id && !String(device.session_id).startsWith('manual_');

  const copyUdid = () => navigator.clipboard?.writeText(device.udid);
  const release = async () => { await XenonApiService.releaseReservation(device.udid, device.host); reloadDevices(); };
  const block = async () => { await XenonApiService.blockDevice(device.udid, device.host); reloadDevices(); };
  const unblock = async () => { await XenonApiService.unblockDevice(device.udid, device.host); reloadDevices(); };

  return (
    <div className={`dc2 dc2-${kind}`}>
      <div className="dc2-stripe" />
      <div className="dc2-header">
        <span className="dc2-platform">{device.platform.toUpperCase()} · {device.sdk}</span>
        <StatusCode kind={kind} showDot>{kind}</StatusCode>
      </div>

      <div className="dc2-name" title={device.name}>{device.name}</div>
      <div className="dc2-udid" title={device.udid}>{middleEllipsis(device.udid)}</div>

      {(device.teamId || (device.tags && device.tags.length > 0)) && (
        <div className="dc2-tags">
          {device.teamId && <Pill tone="accent" title={`Team ${device.teamId}`}>team</Pill>}
          {device.tags?.slice(0, 3).map((t) => <Pill key={t} tone="neutral" title={t}>{t}</Pill>)}
          {(device.tags?.length || 0) > 3 && <Pill tone="neutral">+{(device.tags?.length || 0) - 3}</Pill>}
        </div>
      )}

      <div className="dc2-metrics">
        {reserved ? (
          <div className="dc2-banner dc2-banner-reserved">
            <Clock size={12} />
            <span>RES · {device.reservedBy || 'anon'} ({device.reservedUntil ? prettyMilliseconds(device.reservedUntil - Date.now(), { compact: true }) : ''})</span>
          </div>
        ) : device.session_id ? (
          <div className="dc2-banner dc2-banner-session">
            <Terminal size={12} />
            <span>SID · {String(device.session_id)}</span>
          </div>
        ) : (
          <KeyValueRow label="Utilization" value={prettyMilliseconds(device.totalUtilizationTimeMilliSec || 0, { compact: true })} />
        )}
        {typeof device.batteryLevel === 'number' && <KeyValueRow label="Battery" value={`${device.batteryLevel}%`} />}
        {device.thermalStatus && device.thermalStatus !== 'Unknown' && <KeyValueRow label="Thermal" value={device.thermalStatus} />}
        <KeyValueRow label="Host" value={device.ip || device.host} mono />
      </div>

      <div className="dc2-actions">
        <Button
          variant="primary"
          size="sm"
          disabled={Boolean(busyLocked)}
          onClick={() => !busyLocked && navigate(`/devices/${device.udid}/control`)}
          title={busyLocked ? 'Locked: Appium session running' : 'Take control'}
          className="dc2-primary"
        >
          Control
        </Button>
        {reserved ? (
          <Button variant="secondary" size="sm" onClick={release}>Release</Button>
        ) : !device.userBlocked && !device.busy ? (
          <Button variant="secondary" size="sm" onClick={() => setShowReservation(true)}>Reserve</Button>
        ) : null}
        <button
          ref={moreRef}
          type="button"
          className="dc2-more"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="More actions"
        >
          <MoreHorizontal size={14} />
        </button>
        <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={moreRef}>
          <Menu>
            <MenuItem onClick={() => { setMenuOpen(false); setShowTagManager(true); }}>Manage tags…</MenuItem>
            {device.userBlocked
              ? <MenuItem onClick={() => { setMenuOpen(false); unblock(); }}>Exit maintenance</MenuItem>
              : <MenuItem onClick={() => { setMenuOpen(false); block(); }}>Enter maintenance</MenuItem>}
            <MenuDivider />
            <MenuItem icon={<Copy size={12} />} onClick={() => { setMenuOpen(false); copyUdid(); }}>Copy UDID</MenuItem>
          </Menu>
        </Popover>
      </div>

      {showReservation && (
        <ReservationModal
          device={device}
          onClose={() => setShowReservation(false)}
          onReserved={() => reloadDevices()}
        />
      )}
      {showTagManager && (
        <TagManagerModal
          device={device}
          onClose={() => setShowTagManager(false)}
          onUpdated={() => reloadDevices()}
        />
      )}
    </div>
  );
};
export default DeviceCardV2;
```

- [ ] **Step 3: Styles**

Create `web/src/components/device-card/device-card/device-card-v2.css`:

```css
.dc2 {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 12px 14px 14px 16px;
  font-family: 'Inter', sans-serif;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 200px;
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
}
.dc2:hover { border-color: var(--border-strong); box-shadow: var(--shadow-md); }

.dc2-stripe {
  position: absolute; left: 0; top: 12px; bottom: 12px; width: 2px; border-radius: 0 2px 2px 0;
}
.dc2-ready .dc2-stripe    { background: var(--status-ready-fg); }
.dc2-busy .dc2-stripe     { background: var(--status-busy-fg); }
.dc2-reserved .dc2-stripe { background: var(--status-reserved-fg); }
.dc2-error .dc2-stripe    { background: var(--status-error-fg); }
.dc2-offline .dc2-stripe  { background: var(--status-offline-fg); }

.dc2-header { display: flex; justify-content: space-between; align-items: center; }
.dc2-platform { color: var(--text-muted); font-size: 11px; font-weight: 500; }
.dc2-name { color: var(--text-primary); font-size: 15px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc2-udid { color: var(--text-subtle); font-family: 'JetBrains Mono', monospace; font-size: 11px; }

.dc2-tags { display: flex; gap: 4px; flex-wrap: wrap; }

.dc2-metrics {
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dc2-banner {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
}
.dc2-banner-reserved { color: var(--status-reserved-fg); background: var(--status-reserved-bg); }
.dc2-banner-session  { color: var(--status-busy-fg); background: var(--status-busy-bg); }

.dc2-actions { display: flex; gap: 6px; align-items: center; }
.dc2-primary { flex: 1; justify-content: center; }
.dc2-more {
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-muted);
  border-radius: var(--radius-md);
  width: 32px; height: 32px;
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
}
.dc2-more:hover { background: var(--bg-elevated); color: var(--text-primary); }
```

- [ ] **Step 4: Smoke**

`cd web && npm run start`. On `/devices` under v2, cards should render in the new layout. All 4 modals (reserve, tag manager, maintenance confirm, etc.) should still open. V1 still works via `?themeV2=0`.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/device-card/device-card/device-card.tsx web/src/components/device-card/device-card/device-card-v2.tsx web/src/components/device-card/device-card/device-card-v2.css
git commit -m "feat(web): v2 device card (functional, new layout)"
```

### Task 5.2: Device-explorer filter toolbar (v2)

**Files:**
- Modify: `web/src/components/device-explorer/device-explorer.tsx`
- Modify: `web/src/components/device-explorer/device-explorer.css`

- [ ] **Step 1: Read existing explorer** — before changes, read current file and note where the device list is mapped and the existing filter state lives. Don't touch v1 behavior. Add a v2-only toolbar above the grid.

- [ ] **Step 2: Add toolbar**

At the top of the explorer's render (inside a `isThemeV2()` conditional), add:

```tsx
import { SegmentedControl } from '../ui/SegmentedControl';
import { isThemeV2 } from '../../lib/theme-flag';

// inside the component
const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'busy' | 'reserved' | 'offline'>('all');
const [q, setQ] = useState('');

// counts (compute from devices array already in state)
const counts = {
  all: devices.length,
  ready: devices.filter((d) => !d.offline && !d.busy && !(d.reservedUntil && Date.now() < d.reservedUntil)).length,
  busy: devices.filter((d) => d.busy).length,
  reserved: devices.filter((d) => d.reservedUntil && Date.now() < d.reservedUntil).length,
  offline: devices.filter((d) => d.offline).length,
};

const filtered = devices.filter((d) => {
  if (q && !(`${d.name} ${d.udid}`.toLowerCase().includes(q.toLowerCase()))) return false;
  if (statusFilter === 'all') return true;
  if (statusFilter === 'busy') return d.busy;
  if (statusFilter === 'reserved') return d.reservedUntil && Date.now() < d.reservedUntil;
  if (statusFilter === 'offline') return d.offline;
  if (statusFilter === 'ready') return !d.offline && !d.busy && !(d.reservedUntil && Date.now() < d.reservedUntil);
  return true;
});

// ...
{isThemeV2() && (
  <div className="de2-toolbar">
    <SegmentedControl
      size="sm"
      value={statusFilter}
      onChange={(v) => setStatusFilter(v as any)}
      segments={[
        { value: 'all', label: 'All', count: counts.all },
        { value: 'ready', label: 'Ready', count: counts.ready },
        { value: 'busy', label: 'Busy', count: counts.busy },
        { value: 'reserved', label: 'Reserved', count: counts.reserved },
        { value: 'offline', label: 'Offline', count: counts.offline },
      ]}
    />
    <input
      className="de2-search"
      placeholder="Search by name or UDID…"
      value={q}
      onChange={(e) => setQ(e.target.value)}
    />
  </div>
)}
```

Switch the render loop from `devices` to `filtered` **only** when `isThemeV2()` is true — leave v1's code path untouched:

```tsx
const listForRender = isThemeV2() ? filtered : devices;
// ...then render listForRender
```

- [ ] **Step 3: Styles**

Append to `web/src/components/device-explorer/device-explorer.css`:

```css
html[data-theme="v2"] .de2-toolbar {
  display: flex; gap: 10px; align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-default);
}
html[data-theme="v2"] .de2-search {
  flex: 1;
  height: 28px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 0 10px;
  color: var(--text-primary);
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  outline: none;
}
html[data-theme="v2"] .de2-search:focus { border-color: var(--border-strong); }
```

- [ ] **Step 4: Smoke + screenshots + commit**

```bash
git add web/src/components/device-explorer/
git commit -m "feat(web): device-explorer toolbar (v2 only)"
```

Capture screenshots into `web/screenshots/phase-5/`:
- `devices-v2.png` — new card grid with toolbar
- `devices-v1.png` — old card grid (via `?themeV2=0`)
- `control-v2.png` — device detail/control page

```bash
git add web/screenshots/phase-5
git commit -m "docs(web): phase-5 screenshots"
git push -u origin feat/ui-refresh-phase-5-card-filters
gh pr create --title "feat(web): phase-5 UI refresh — device card + explorer" --body "$(cat <<'EOF'
## Summary
- Device card rewritten as a functional component for v2 (class component preserved for v1)
- Metric chips → key/value rows; 4 equal buttons → Control + Reserve + ⋯ overflow
- New device-explorer filter toolbar (status tabs + search) — v2 only

## Test plan
- [ ] All existing device actions still work: Control, Reserve, Release, Enter/Exit Maintenance, Manage tags
- [ ] ⋯ menu exposes Manage tags, Maintenance, Copy UDID
- [ ] Toolbar filters narrow the grid; search filters by name + UDID
- [ ] \`?themeV2=0\` falls back to the original card and explorer

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 6 — Remaining screens

**Goal:** Skin + targeted polish per the spec's screen-by-screen table. Each sub-PR is independent; land them in any order.

**Branch naming:** `feat/ui-refresh-phase-6-<slug>` per sub-PR.

### Task 6.1: Session dashboard polish

**Files:** `web/src/components/session-dashboard/*`

- [ ] **Step 1:** Read current `session-dashboard.tsx`. Identify its internal tab switcher.
- [ ] **Step 2:** Replace the tab switcher with `SegmentedControl` when `isThemeV2()`. Preserve value/onChange signatures.
- [ ] **Step 3:** Replace the empty-state block(s) with the `EmptyState` primitive.
- [ ] **Step 4:** Recolor `TraceWaterfall` bars using new status tokens: replace any hard-coded color strings with `var(--status-ready-fg)` / `--status-busy-fg` / `--status-error-fg`.
- [ ] **Step 5:** Commit + sub-PR.

```bash
git checkout -b feat/ui-refresh-phase-6-session-dashboard
# edits...
git add web/src/components/session-dashboard/
git commit -m "feat(web): session-dashboard v2 polish"
git push -u origin feat/ui-refresh-phase-6-session-dashboard
gh pr create --title "feat(web): phase-6a — session dashboard polish" --body "SegmentedControl tabs, EmptyState primitives, new trace palette. Behavior preserved."
```

### Task 6.2: Settings family (`settings`, `ai-settings`, `maintenance`)

**Files:** `web/src/components/settings/*`

- [ ] **Step 1:** Create a small `FieldGroup` primitive locally in `web/src/components/ui/FieldGroup.tsx`:

```tsx
// web/src/components/ui/FieldGroup.tsx
import * as React from 'react';
import './field-group.css';

export interface FieldGroupProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  error?: string;
}

export const FieldGroup: React.FC<FieldGroupProps> = ({ label, description, children, error }) => (
  <div className="fg">
    <label className="fg-label">{label}</label>
    {description && <div className="fg-desc">{description}</div>}
    <div className="fg-control">{children}</div>
    {error && <div className="fg-error">{error}</div>}
  </div>
);
```

```css
/* web/src/components/ui/field-group.css */
.fg { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.fg-label { color: var(--text-primary); font-size: 12px; font-weight: 600; font-family: 'Inter', sans-serif; }
.fg-desc { color: var(--text-muted); font-size: 11px; }
.fg-control { display: flex; flex-direction: column; }
.fg-error { color: var(--status-error-fg); font-size: 11px; }
```

- [ ] **Step 2:** In each settings screen, wrap form fields in `FieldGroup` (v2 only; v1 unchanged). Swap section containers to `Card`.

- [ ] **Step 3:** Commit + sub-PR.

```bash
git checkout -b feat/ui-refresh-phase-6-settings
# edits...
git add web/src/components/ui/FieldGroup.tsx web/src/components/ui/field-group.css web/src/components/settings/
git commit -m "feat(web): settings / ai-settings / maintenance v2 polish"
git push -u origin feat/ui-refresh-phase-6-settings
gh pr create --title "feat(web): phase-6b — settings polish" --body "FieldGroup + Card primitives applied to the settings family."
```

### Task 6.3: Tables (`api-keys`, `teams`)

- [ ] **Step 1:** Read current `api-keys.tsx` and `teams.tsx`. Note the current row structure.
- [ ] **Step 2:** Replace hand-rolled `<table>` markup with the new `Table`/`THead`/`TBody`/`TR`/`TH`/`TD` primitives **only when `isThemeV2()`**. Row-action menus swap to the shared `Popover`+`Menu`.
- [ ] **Step 3:** Confirm that the Teams detail view, member add/remove, and device assignment flows still work.
- [ ] **Step 4:** Commit + sub-PR.

```bash
git checkout -b feat/ui-refresh-phase-6-admin-tables
git add web/src/components/settings/api-keys.tsx web/src/components/settings/teams.tsx web/src/components/settings/settings.css
git commit -m "feat(web): api-keys / teams v2 tables + row menus"
git push -u origin feat/ui-refresh-phase-6-admin-tables
gh pr create --title "feat(web): phase-6c — admin tables (keys + teams)"
```

### Task 6.4: Modals (`ReservationModal`, `TagManagerModal`)

- [ ] **Step 1:** Introduce a tiny modal primitive at `web/src/components/ui/Modal.tsx`:

```tsx
// web/src/components/ui/Modal.tsx
import * as React from 'react';
import './modal.css';

export const Modal: React.FC<{ open: boolean; title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }>
= ({ open, title, onClose, children, footer }) => {
  React.useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">{title}</div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
};
```

```css
/* web/src/components/ui/modal.css */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 8000; display: flex; align-items: center; justify-content: center; }
.modal { background: var(--bg-elevated); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); width: 480px; max-width: 90vw; }
.modal-header { padding: 14px 16px; border-bottom: 1px solid var(--border-default); color: var(--text-primary); font-weight: 600; }
.modal-body { padding: 16px; color: var(--text-secondary); }
.modal-footer { padding: 12px 16px; border-top: 1px solid var(--border-default); display: flex; justify-content: flex-end; gap: 8px; }
```

- [ ] **Step 2:** In `reservation-modal.tsx` and `tag-manager-modal.tsx`, wrap the existing body inside `<Modal>` when `isThemeV2()` is true. Keep all existing field logic intact.
- [ ] **Step 3:** Commit + sub-PR.

```bash
git checkout -b feat/ui-refresh-phase-6-modals
git add web/src/components/ui/Modal.tsx web/src/components/ui/modal.css web/src/components/reservation-modal/ web/src/components/tag-manager-modal/
git commit -m "feat(web): shared Modal primitive + reservation/tag modals v2"
git push -u origin feat/ui-refresh-phase-6-modals
gh pr create --title "feat(web): phase-6d — modals"
```

### Task 6.5: Remaining screens — pure skin pass

For each of: `device-control`, `omni-inspector`, `terminal`, `webhook-settings`, `apps`, `ApiKeyGate` — open the file's `.css` and replace legacy tokens. Mapping:

| Legacy token | New token |
|---|---|
| `--bg-page` / `--bg-app` | `--bg-canvas` |
| `--bg-surface` (same name, different value now via aliases) | `--bg-surface` (no edit needed) |
| `--bg-card` | `--bg-surface` |
| `--bg-card-hover` | `--bg-elevated` |
| `--color-primary` | `--accent` |
| `--color-amber` | `--status-busy-fg` |
| `--color-red` | `--status-error-fg` |
| `--color-blue` / `--color-sky` | `--status-reserved-fg` |
| `--border-subtle` | `--border-muted` |
| `--border-visible` | `--border-default` |
| `--text-dim` | `--text-subtle` |
| `--text-muted` (same name, new value) | `--text-muted` |
| `--text-body` | `--text-secondary` |
| `--text-bright` | `--text-primary` |

Since compat aliases already map the old names to new values, no edits are strictly required for visual parity — but doing the substitution reduces churn in phase 7.

- [ ] **Step 1:** For each target CSS file, run the mapping by hand (don't do a regex replace — different names collide). Focus on:
  - `device-control/device-control.css`
  - `omni-inspector/omni-inspector.css`
  - `terminal/terminal.css`
  - `webhook-settings/webhook-settings.css`
  - `apps/apps.css`
  - `ApiKeyGate.tsx` styled blocks (if any inline styles — leave them for phase 7 cleanup)
- [ ] **Step 2:** Rebuild ANSI palette in `terminal.css` to the new colors (map the 16 ANSI slots to approximations of `--accent`, `--status-*`, and GitHub-dark-muted neutrals). Keep ANSI semantics — green is still green.
- [ ] **Step 3:** Smoke each screen; no behavior changes expected.
- [ ] **Step 4:** Commit + sub-PR.

```bash
git checkout -b feat/ui-refresh-phase-6-skin
git add web/src/components/device-control/ web/src/components/omni-inspector/ web/src/components/terminal/ web/src/components/webhook-settings/ web/src/components/apps/
git commit -m "feat(web): token migration across remaining screens"
git push -u origin feat/ui-refresh-phase-6-skin
gh pr create --title "feat(web): phase-6e — skin pass on remaining screens"
```

### Task 6.6: Phase 6 screenshots

- [ ] **Step 1:** `mkdir -p web/screenshots/phase-6` and capture one v2 shot per screen rebuilt above. Commit to a dedicated PR or fold into 6e.

---

## Phase 7 — Cleanup

**Goal:** Remove the flag, delete v1 CSS + v1 components, drop Outfit font, remove compat aliases. Final state: v2 is the only theme.

**Branch:** `feat/ui-refresh-phase-7-cleanup`

**Prerequisite:** Phases 1–6 shipped and stable for at least one release cycle.

### Task 7.1: Make v2 the only theme

**Files:** `web/src/lib/theme-flag.ts`, `web/src/index.tsx`, `web/src/index.css`, `web/src/tokens.css`

- [ ] **Step 1:** Simplify `theme-flag.ts`:

```ts
export function isThemeV2(): boolean { return true; }
export function applyThemeFlag(): void {
  document.documentElement.setAttribute('data-theme', 'v2');
}
export function setThemeV2(_on: boolean): void { /* no-op */ }
```

(Or delete the file entirely and inline the `setAttribute` into `index.tsx`, then remove the import sites.)

- [ ] **Step 2:** Delete v1 token block from `web/src/index.css`. Keep only the `@import` + global reset + scrollbar + checkbox base.

- [ ] **Step 3:** In `tokens.css`, change the selector from `html[data-theme="v2"]` to `:root`. Delete the compat-alias block now that every file uses new tokens directly. (If any callers still use legacy names, they break here — fix by migrating to new tokens.)

- [ ] **Step 4:** Remove Outfit from the Google Fonts `@import` in `index.css` (leave Inter + JetBrains Mono).

- [ ] **Step 5:** Delete v1 component branches:
  - `SidebarV1` block in `sidebar.tsx`
  - `HeaderV1` block in `header.tsx`
  - Class-based `DeviceCard` + the `isThemeV2()` branch in `DeviceCardWrapper` (rename `device-card-v2.tsx` → `device-card.tsx` and delete the old one)
  - All `html[data-theme="v2"] .<legacy-class> { display: none; }` rules
  - All `isThemeV2()` branches in `device-explorer.tsx` and the settings family (just use the v2 path directly)

- [ ] **Step 6:** Search and remove all `isThemeV2()` call sites:

```bash
cd web && grep -r "isThemeV2\|applyThemeFlag\|themeV2" src/ | sort -u
```

Each hit: remove the conditional, keep the v2 body. Delete the file `web/src/lib/theme-flag.ts` entirely when no consumers remain.

- [ ] **Step 7:** Build and run the whole app end-to-end. Every screen must render. Every interaction must work.

- [ ] **Step 8:** Commit

```bash
git add -A web/src/
git commit -m "chore(web): remove v1 theme + flag (v2 is the only theme)"
```

### Task 7.2: Version bump + changelog

**Files:** `package.json`, `web/package.json`, `package-lock.json`, `web/package-lock.json`

- [ ] **Step 1:** Bump root `package.json` version to `1.5.0`. Bump `web/package.json` to `0.3.0`. Regenerate lockfiles:

```bash
npm install
cd web && npm install
```

- [ ] **Step 2:** Commit:

```bash
git add package.json package-lock.json web/package.json web/package-lock.json
git commit -m "chore(release): 1.5.0 — UI refresh"
```

### Task 7.3: Open the cleanup PR

```bash
git push -u origin feat/ui-refresh-phase-7-cleanup
gh pr create --title "chore(release): 1.5.0 — UI refresh cleanup" --body "$(cat <<'EOF'
## Summary
- \`themeV2\` flag removed — v2 is the only theme
- v1 components, v1 CSS, Outfit font, and compat aliases deleted
- Version bumped to 1.5.0

## Test plan
- [ ] Full manual smoke across every route and modal
- [ ] Unit + a11y pass
- [ ] No references to \`isThemeV2\`, \`themeV2\`, or Outfit remain (\`grep\` clean)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Spec coverage check

| Spec section | Task(s) implementing it |
|---|---|
| §1 — Goals, non-goals, success criteria | Plan preamble + phase goals; feature flag in Task 1.1; screenshots in Tasks 1.12/3.4/5.2 |
| §2 — Tokens (surfaces, text, accent, status, type, spacing, radii, motion) | Task 1.2 |
| §2 — Compat aliases | Task 1.2 |
| §3 — Header rebuild | Task 2.3 |
| §3 — Sidebar rebuild (expand, pin, groups, counts) | Tasks 2.1, 2.2 |
| §3 — `/overview` route + redirect from `/` | Task 2.4 |
| §3 — Overview KPIs + Fleet + Activity | Tasks 3.2, 3.3, 3.4 |
| §3 — ⌘K palette (nav + entity search) | Tasks 4.1, 4.2, 4.3 |
| §4 — Device card rebuild | Task 5.1 |
| §4 — Device-explorer filter toolbar | Task 5.2 |
| §4 — Session dashboard polish | Task 6.1 |
| §4 — Settings family + FieldGroup | Task 6.2 |
| §4 — Admin tables (api-keys, teams) | Task 6.3 |
| §4 — Modals (reservation, tag manager) + Modal primitive | Task 6.4 |
| §4 — device-control / omni-inspector / terminal / webhooks / apps / ApiKeyGate skin | Task 6.5 |
| §4 — Shared primitives (Button, Card, Pill, StatusDot, StatusCode, KeyValueRow, Popover, Menu, SegmentedControl, Table, EmptyState) | Tasks 1.3–1.11 |
| §5 — Feature flag `themeV2` | Task 1.1 |
| §5 — Phase sequencing (1 PR per phase) | One branch per phase, each with its own `gh pr create` |
| §5 — Rollout removal | Task 7.1 |
| §5 — Screenshot baselines | Tasks 1.12, 3.4, 5.2, 6.6 |
| §5 — Outfit removal | Task 7.1 Step 4 |
