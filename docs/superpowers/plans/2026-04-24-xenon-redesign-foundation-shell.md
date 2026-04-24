# Xenon Redesign — Foundation + Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Tailwind, adopt the reference design-token palette (with backwards-compat aliases), and rebuild the TopBar + Sidebar + App shell so every route sits under the new reference-style chrome.

**Architecture:** Keep every page body untouched. Only the outermost shell (`App.tsx`, `header/`, `sidebar/`) is rewritten. Tokens are renamed (`--bg-canvas` → `--bg`, etc.); the legacy names are preserved as aliases so existing component CSS keeps resolving until those pages are redesigned in later plans.

**Tech Stack:** React 17, Vite 5, Tailwind 3.4 (JIT, arbitrary-value classes), PostCSS 8, Autoprefixer 10, lucide-react, react-router-dom 6.

**Scope note:** This is Plan 1 of the full-app redesign. It corresponds to Phases 1 + 2 of `docs/superpowers/specs/2026-04-24-xenon-dashboard-redesign-design.md`. Phase 3 (Overview page body) and Phases 4–6 will get their own plans.

---

## File Structure

**Create:**
- `web/tailwind.config.js` — Tailwind content scan + empty theme extend
- `web/postcss.config.js` — wires tailwindcss + autoprefixer into Vite

**Rewrite:**
- `web/src/tokens.css` — reference token palette + legacy aliases
- `web/src/index.css` — Tailwind directives + fonts + reference body/scrollbar/pulse
- `web/src/components/sidebar/sidebar.tsx` — icon-only 56px fixed sidebar with active accent bar + tooltips
- `web/src/components/header/header.tsx` — reference TopBar: logo, search, status, profile menu
- `web/src/App.tsx` — new shell wrapper using Tailwind utilities

**Delete:**
- `web/src/components/sidebar/sidebar.css` (replaced by Tailwind utilities)
- `web/src/components/header/header.css` (replaced by Tailwind utilities)

**Untouched:**
- Every page component (overview, devices, apps, builds, settings, etc.) and their `*.css` files.
- `App.css` — dead rules become unused but remain until Phase 6 cleanup.

---

## Task 1: Install Tailwind + PostCSS + Autoprefixer

**Files:** `web/package.json`, `web/package-lock.json`

- [ ] **Step 1: Run npm install**

From repo root:

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon/web && npm install -D tailwindcss@^3.4.17 postcss@^8.4.49 autoprefixer@^10.4.20
```

Expected: installs without errors, updates `package.json` devDependencies with the three packages.

- [ ] **Step 2: Verify install**

Run: `cd web && npx tailwindcss --help | head -3`
Expected: prints "Usage: tailwindcss [--input input.css] ..."

- [ ] **Step 3: Commit**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/package.json web/package-lock.json
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "$(cat <<'EOF'
chore(web): install tailwindcss, postcss, autoprefixer

Foundation for the dashboard redesign. No code uses these yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add Tailwind + PostCSS config

**Files:** Create `web/tailwind.config.js`, `web/postcss.config.js`

- [ ] **Step 1: Create tailwind.config.js**

Write `web/tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 2: Create postcss.config.js**

Write `web/postcss.config.js`:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Verify build still works (no CSS changes yet)**

Run: `cd web && npm run build`
Expected: build succeeds. Warnings about missing `@tailwind` directives are OK at this point because `index.css` hasn't been updated yet.

- [ ] **Step 4: Commit**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/tailwind.config.js web/postcss.config.js
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "$(cat <<'EOF'
chore(web): add tailwind + postcss config

Content scan covers index.html and src/**/*.{ts,tsx}. No theme extend
beyond font families — reference design uses arbitrary-value classes
for colors (bg-[var(--surface)] etc).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Rewrite tokens.css (new palette + legacy aliases)

**Files:** `web/src/tokens.css` (full rewrite)

- [ ] **Step 1: Replace tokens.css contents**

Write `web/src/tokens.css`:

```css
/* Xenon design tokens — reference palette. */

:root {
  /* ===== Primary surface palette (reference names) ===== */
  --bg: #0a0d0c;
  --surface: #111514;
  --surface-2: #161b1a;
  --border: #1f2624;
  --border-strong: #2a3331;

  /* Text */
  --text: #e6ebe9;
  --text-muted: #8a938f;
  --text-dim: #5b6460;

  /* Accents */
  --green: #22c55e;
  --green-dim: #16a34a;
  --amber: #f59e0b;
  --red: #ef4444;
  --blue: #3b82f6;

  /* ===== Legacy aliases — used by page CSS until each page is
     redesigned in a later plan. Removed in Phase 6 cleanup. ===== */

  /* Surfaces */
  --bg-canvas: var(--bg);
  --bg-surface: var(--surface);
  --bg-elevated: var(--surface-2);
  --bg-subtle: var(--bg);
  --border-default: var(--border);
  --border-muted: var(--border);

  /* Text */
  --text-primary: var(--text);
  --text-secondary: var(--text);
  --text-subtle: var(--text-dim);

  /* Accent (forest green family) */
  --accent: var(--green);
  --accent-bold: var(--green-dim);
  --accent-subtle: rgba(34, 197, 94, 0.1);
  --accent-border: rgba(34, 197, 94, 0.3);

  /* Status — foreground */
  --status-ready-fg: var(--green);
  --status-busy-fg: var(--amber);
  --status-reserved-fg: var(--blue);
  --status-error-fg: var(--red);
  --status-offline-fg: var(--text-muted);

  /* Status — background */
  --status-ready-bg: rgba(34, 197, 94, 0.1);
  --status-busy-bg: rgba(245, 158, 11, 0.1);
  --status-reserved-bg: rgba(59, 130, 246, 0.1);
  --status-error-bg: rgba(239, 68, 68, 0.1);
  --status-offline-bg: rgba(138, 147, 143, 0.08);

  /* Status — border */
  --status-ready-border: rgba(34, 197, 94, 0.3);
  --status-busy-border: rgba(245, 158, 11, 0.3);
  --status-reserved-border: rgba(59, 130, 246, 0.3);
  --status-error-border: rgba(239, 68, 68, 0.3);
  --status-offline-border: rgba(138, 147, 143, 0.25);

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

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.25);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.35);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.45);

  /* Motion */
  --motion-fast: 150ms cubic-bezier(0.2, 0, 0, 1);
  --motion-slow: 250ms cubic-bezier(0.2, 0, 0, 1);
}

/* Legacy glow suppressions kept from previous tokens.css */
.scanline,
.header-container::after {
  display: none !important;
}
```

- [ ] **Step 2: Build and verify**

Run: `cd web && npm run build`
Expected: build succeeds. No TypeScript errors (this file is pure CSS).

- [ ] **Step 3: Commit**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/src/tokens.css
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "$(cat <<'EOF'
feat(web): adopt reference design tokens with legacy aliases

New primary names (--bg, --surface, --green, etc) match the reference
palette verbatim. Existing page CSS continues to resolve via aliases
(--bg-canvas → var(--bg), --accent → var(--green), etc) — aliases
will be removed in phase 6 once all pages are redesigned.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update index.css with Tailwind + reference body styles

**Files:** `web/src/index.css` (full rewrite)

- [ ] **Step 1: Replace index.css contents**

Write `web/src/index.css`:

```css
/* @import url() FONT IMPORTS MUST ALWAYS BE AT THE VERY TOP OF THIS FILE, ABOVE THE TAILWIND IMPORTS — DO NOT DELETE THIS COMMENT */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
@import './tokens.css';

/* CRITICAL: THE FOLLOWING TAILWIND DIRECTIVES MUST NEVER BE DELETED OR REORDERED — DO NOT DELETE THIS COMMENT */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* END TAILWIND DIRECTIVES — ALL OTHER CSS MUST GO BELOW THIS LINE */

* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-feature-settings: 'cv11', 'ss01';
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  line-height: 1.5;
}

body {
  overflow: hidden;
}

h1, h2, h3, h4, h5, h6, .brand-font {
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
}

.font-mono,
code,
.code-font {
  font-family: 'JetBrains Mono', ui-monospace, 'Menlo', 'Monaco', 'Consolas', monospace;
}

code,
.code-font {
  font-size: 0.9em;
  background: var(--surface-2);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  color: var(--green);
}

button {
  font-family: inherit;
  cursor: pointer;
  transition: background var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast);
}

a {
  color: var(--blue);
  text-decoration: none;
  transition: color var(--motion-fast);
}

a:hover {
  color: #79b8ff;
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: var(--radius-md);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--border-strong);
}

/* Native checkbox reset — preserved from previous index.css */
input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  cursor: pointer;
  position: relative;
  transition: background var(--motion-fast), border-color var(--motion-fast);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

input[type="checkbox"]:hover {
  border-color: var(--green);
}

input[type="checkbox"]:checked {
  background: var(--green);
  border-color: var(--green);
}

input[type="checkbox"]:checked::after {
  content: "✓";
  color: var(--bg);
  font-size: 11px;
  font-weight: 700;
}

input[type="checkbox"]:focus {
  outline: none;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.25);
}

/* Subtle grid utility */
.bg-grid {
  background-image:
    linear-gradient(to right, rgba(255, 255, 255, 0.02) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
  background-size: 32px 32px;
}

/* Pulse dot — used by status indicators */
@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}
.pulse-dot {
  animation: pulse-dot 2s ease-in-out infinite;
}

.fade-in {
  animation: fadeIn 0.2s ease-out forwards;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 2: Build and inspect output**

Run: `cd web && npm run build`
Expected: build succeeds. `web/build/assets/index-*.css` exists and contains Tailwind's preflight/base layer (search for `* {` and `::backdrop`).

Run: `grep -c 'backdrop' web/build/assets/index-*.css`
Expected: at least 1 (Tailwind preflight is emitted).

- [ ] **Step 3: Run the existing vitest suite**

Run: `cd web && npm test -- --run`
Expected: all currently-green tests still pass. (Any pre-existing skips/failures are unchanged — don't fix unrelated tests.)

- [ ] **Step 4: Commit**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/src/index.css
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "$(cat <<'EOF'
feat(web): wire tailwind into index.css + reference body styles

Adds @tailwind base/components/utilities, switches body background
to var(--bg), adopts reference's pulse-dot keyframes and bg-grid
utility. Existing .fade-in animation and native checkbox styles
preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Manual smoke test of Phase 1 foundation

**Files:** None (verification only)

- [ ] **Step 1: Start dev server**

From repo root:

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon/web && npm start
```

Expected: Vite dev server on :3000, no errors, no warnings about unknown `@tailwind` directives.

- [ ] **Step 2: Verify the app loads**

Open http://localhost:3000/xenon/ (or allow the browser to auto-open). Expected:
- Login/api-key gate screen renders with the legacy shell (no visual redesign yet — that's Phase 2).
- After logging in, every existing route (`/overview`, `/devices`, `/builds`, `/settings`, etc.) loads with no console errors and no 404/500 in the Network tab.
- Dark-mode appearance is indistinguishable from pre-redesign — any slight color shift (e.g., bg goes from `#0d1117` to `#0a0d0c`) is expected and intentional.

- [ ] **Step 3: Stop dev server**

Ctrl+C in the dev terminal.

- [ ] **Step 4: No commit** — this is a verification step only.

---

## Task 6: Build new Sidebar (icon-only 56px reference style)

**Files:** `web/src/components/sidebar/sidebar.tsx` (full rewrite)

- [ ] **Step 1: Replace sidebar.tsx**

Write `web/src/components/sidebar/sidebar.tsx`:

```tsx
import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutGrid,
  Smartphone,
  AppWindow,
  MonitorPlay,
  Bell,
  Settings as SettingsIcon,
  Brain,
  ShieldCheck,
  Users,
  Key,
  BookOpen,
} from 'lucide-react';

type NavItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
};

const items: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid, path: '/overview' },
  { id: 'devices', label: 'Devices', icon: Smartphone, path: '/devices' },
  { id: 'apps', label: 'Apps', icon: AppWindow, path: '/apps' },
  { id: 'sessions', label: 'Sessions', icon: MonitorPlay, path: '/builds' },
  { id: 'notifications', label: 'Notifications', icon: Bell, path: '/notifications' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, path: '/settings' },
  { id: 'ai', label: 'AI', icon: Brain, path: '/ai-settings' },
  { id: 'maintenance', label: 'Maintenance', icon: ShieldCheck, path: '/maintenance' },
  { id: 'teams', label: 'Teams', icon: Users, path: '/teams' },
  { id: 'apikeys', label: 'API Keys', icon: Key, path: '/api-keys' },
];

const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <aside className="fixed inset-y-0 left-0 z-30 w-14 border-r border-[var(--border)] bg-[var(--surface)] flex flex-col items-center py-3">
      <nav className="flex-1 flex flex-col gap-1 w-full items-center">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.path)}
              className="group relative w-full flex justify-center py-2.5"
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
            >
              <span
                className={`absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r transition-all ${active ? 'bg-[var(--green)]' : 'bg-transparent'}`}
              />
              <Icon
                className={`h-[18px] w-[18px] transition-colors ${active ? 'text-[var(--text)]' : 'text-[var(--text-dim)] group-hover:text-[var(--text)]'}`}
              />
              <span className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-[var(--surface-2)] border border-[var(--border-strong)] px-2 py-1 text-xs text-[var(--text)] opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
      <button
        type="button"
        className="group relative w-full flex justify-center py-2.5 mt-2"
        aria-label="API Docs"
        onClick={() => window.open(window.location.origin + '/xenon/api-docs', '_blank')}
      >
        <BookOpen className="h-[18px] w-[18px] text-[var(--text-dim)] group-hover:text-[var(--text)] transition-colors" />
        <span className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-[var(--surface-2)] border border-[var(--border-strong)] px-2 py-1 text-xs text-[var(--text)] opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
          API Docs
        </span>
      </button>
    </aside>
  );
};

export { Sidebar };
export default Sidebar;
```

- [ ] **Step 2: Delete the old sidebar.css**

```bash
rm /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/components/sidebar/sidebar.css
```

- [ ] **Step 3: Verify the sidebar compiles**

Run: `cd web && npm run build 2>&1 | tail -20`
Expected: build succeeds. If TypeScript reports errors about `useSidebarState` (removed import), check that nothing else in the codebase imports from the old `sidebar.css` or reuses `useSidebarState` — if it does, leave the hook file alone (not our concern) but make sure the new sidebar doesn't use it.

- [ ] **Step 4: Commit**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/src/components/sidebar/sidebar.tsx
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon rm web/src/components/sidebar/sidebar.css
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "$(cat <<'EOF'
feat(web): rebuild sidebar to match reference design

56px fixed icon-only sidebar with left-edge green accent bar for
active route, hover tooltips in the right margin, and a Docs entry
at the bottom. Dropped the pin/expand behavior — reference design
is icon-only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Build new TopBar (reference Header replacement)

**Files:** `web/src/components/header/header.tsx` (full rewrite)

- [ ] **Step 1: Replace header.tsx**

Write `web/src/components/header/header.tsx`:

```tsx
import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Search, Shield } from 'lucide-react';

function useRelativeTime() {
  const [tick, setTick] = useState(0);
  const [startedAt] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);
  // Silence unused-var by referencing tick in the calc.
  const secs = Math.floor((Date.now() - startedAt) / 1000) + tick * 0;
  if (secs < 10) return 'Updated just now';
  if (secs < 60) return `Updated ${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `Updated ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `Updated ${hrs}h ago`;
}

const Header: React.FC = () => {
  const navigate = useNavigate();
  const rel = useRelativeTime();
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
    <header className="fixed top-0 left-14 right-0 z-20 h-14 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-md">
      <div className="flex items-center h-full px-4 gap-4">
        {/* Logo */}
        <button
          type="button"
          onClick={() => navigate('/overview')}
          className="flex items-center gap-3 min-w-0 cursor-pointer"
          aria-label="Xenon home"
        >
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-[var(--green)] flex items-center justify-center text-black font-bold text-sm">
              X
            </div>
            <div className="flex flex-col leading-tight text-left">
              <span className="text-[13px] font-semibold tracking-wide text-[var(--text)]">
                XENON
              </span>
              <span className="text-[9px] text-[var(--text-dim)] tracking-widest uppercase">
                Device Ops
              </span>
            </div>
          </div>
          <span className="font-mono text-[11px] text-[var(--text-dim)] px-1.5 py-0.5 rounded border border-[var(--border)]">
            v{__XENON_VERSION__}
          </span>
        </button>

        {/* Search */}
        <div className="flex-1 max-w-xl mx-auto">
          <button
            type="button"
            onClick={openPalette}
            className="relative w-full h-9 flex items-center text-left"
          >
            <div className="w-full h-9 pl-9 pr-14 rounded-md bg-[var(--surface)] border border-[var(--border)] text-sm text-[var(--text-dim)] hover:border-[var(--border-strong)] hover:text-[var(--text)] transition-colors flex items-center">
              Search devices, sessions, settings…
            </div>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-dim)]" />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-[var(--text-dim)] border border-[var(--border)] rounded px-1.5 py-0.5">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          <span className="hidden md:inline text-xs text-[var(--text-dim)] font-mono">
            {rel}
          </span>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--green)]/10 border border-[var(--green)]/20">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--green)] pulse-dot" />
            <span className="text-[11px] font-medium text-[var(--green)]">Online</span>
          </div>
          <div className="relative" ref={ddRef}>
            <button
              type="button"
              className="flex items-center gap-2 h-9 px-2.5 rounded-md border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface)] transition-colors"
              onClick={() => setDropdownOpen((o) => !o)}
            >
              <Shield className="h-4 w-4 text-[var(--text-muted)]" />
              <span className="text-sm text-[var(--text)]">Administrator</span>
              <ChevronDown className="h-3.5 w-3.5 text-[var(--text-dim)]" />
            </button>
            {dropdownOpen && (
              <div className="absolute top-full right-0 mt-2 w-64 rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-lg overflow-hidden">
                <div className="px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-1">
                    Workspace
                  </div>
                  <div className="flex items-center justify-between text-xs text-[var(--text)]">
                    <span className="text-[var(--text-muted)]">Registry</span>
                    <span>Default</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[var(--text)] mt-1">
                    <span className="text-[var(--text-muted)]">Node</span>
                    <span>Root · Primary</span>
                  </div>
                </div>
                <div className="h-px bg-[var(--border)]" />
                <div className="px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-1">
                    System
                  </div>
                  <div className="flex items-center justify-between text-xs text-[var(--text)]">
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" />
                      Stable
                    </span>
                    <span className="font-mono text-[var(--text-muted)]">
                      v{__XENON_VERSION__}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
```

- [ ] **Step 2: Delete header.css**

```bash
rm /Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/components/header/header.css
```

- [ ] **Step 3: Verify build**

Run: `cd web && npm run build 2>&1 | tail -10`
Expected: build succeeds. No TS errors about missing `./header.css` (we removed its import by rewriting the file).

- [ ] **Step 4: Commit**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/src/components/header/header.tsx
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon rm web/src/components/header/header.css
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "$(cat <<'EOF'
feat(web): rebuild top bar to match reference design

Fixed 56px top bar sitting right of the sidebar with a green X logo
box, inline XENON / Device Ops wordmark, version pill, command-palette
search trigger (⌘K), live "Updated Nm ago" stamp, green Online pill
with pulse dot, and profile dropdown. Uses Tailwind arbitrary-value
utilities referencing the new tokens.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Update App.tsx to use the new shell layout

**Files:** `web/src/App.tsx`

- [ ] **Step 1: Replace App.tsx**

Write `web/src/App.tsx`:

```tsx
import * as React from 'react';
import { BrowserRouter } from 'react-router-dom';
import './App.css';
import Header from './components/header/header';
import { AppRoutes } from './routes';

import { ToastProvider } from './components/ui/toast';

import Sidebar from './components/sidebar/sidebar';
import { ApiKeyGate } from './components/ApiKeyGate';
import CommandPalette from './components/command-palette/command-palette';

function App() {
  return (
    <ApiKeyGate>
      <ToastProvider>
        <BrowserRouter basename="/xenon">
          <div className="min-h-screen w-full bg-[var(--bg)] text-[var(--text)]">
            <Sidebar />
            <Header />
            <main className="pl-14 pt-14 h-screen overflow-y-auto">
              <AppRoutes />
            </main>
            <CommandPalette />
          </div>
        </BrowserRouter>
      </ToastProvider>
    </ApiKeyGate>
  );
}

export default App;
```

Rationale:
- `pl-14` = 56px left padding, matching sidebar width.
- `pt-14` = 56px top padding, matching top bar height.
- `h-screen overflow-y-auto` on `<main>` lets page bodies scroll independently (body itself still has `overflow: hidden` from `index.css`, which is what keeps the shell stuck).
- Sidebar and Header remain as-is in the React tree (fixed-positioned); CommandPalette is rendered last so its portal sits on top.

- [ ] **Step 2: Build**

Run: `cd web && npm run build 2>&1 | tail -10`
Expected: success.

- [ ] **Step 3: Run test suite**

Run: `cd web && npm test -- --run`
Expected: all tests that were green before still pass. No existing test targets the removed `app-layout` class directly (verified via grep before writing this plan).

- [ ] **Step 4: Commit**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/src/App.tsx
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "$(cat <<'EOF'
feat(web): rewire app shell to new sidebar + topbar

<main> now gets pl-14 pt-14 to clear the fixed sidebar (56px) and
top bar (56px). Route bodies scroll inside <main>; body keeps
overflow:hidden from index.css so the shell stays stuck.

Old .app-layout / .app-main-container / .app-content CSS in App.css
is now dead but untouched — will be removed in the phase 6 cleanup
plan along with other orphaned page CSS.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Playwright verification of the new shell

**Files:** `web/screenshots/shell-redesign/` (created by the script)

- [ ] **Step 1: Build and install plugin fresh**

From repo root:

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon && npm run build:xenon && npm run build
```

Expected: both succeed. `lib/public/` contains the new assets.

- [ ] **Step 2: Start Appium server with plugin**

In a separate terminal (or background job), run:

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon && APPIUM_HOME=/tmp/xenon-home appium plugin install --source=local $(pwd) 2>/dev/null; APPIUM_HOME=/tmp/xenon-home npx appium server -ka 800 --use-plugins=xenon -pa /wd/hub --plugin-xenon-platform=both --plugin-xenon-enable-dashboard >/tmp/xenon-server.log 2>&1 &
```

Wait for "Dashboard available at http://localhost:4723/xenon/" in `/tmp/xenon-server.log` (`tail -f`, should show within ~5s).

- [ ] **Step 3: Write a shell-only screenshot script**

Write `/tmp/xenon-verify/shell-check.mjs`:

```js
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:4723/xenon';
const BOOT_KEY = fs.readFileSync(process.env.HOME + '/.cache/xenon/bootstrap-key.txt', 'utf8').trim();
const OUT = '/Users/rabindrabiswal/Workspace/XAenon/xenon/web/screenshots/shell-redesign';
fs.mkdirSync(OUT, { recursive: true });

const routes = ['/overview', '/devices', '/apps', '/builds', '/notifications', '/settings', '/ai-settings', '/maintenance', '/teams', '/api-keys'];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();

p.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
p.on('response', (r) => { if (r.status() >= 500) console.error('HTTP', r.status(), r.url()); });

await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(500);
const inp = await p.$('input[type="password"]');
if (inp) {
  await inp.fill(BOOT_KEY);
  await p.click('button[type="submit"], button:has-text("Sign in")');
  await p.waitForTimeout(1500);
}

for (const r of routes) {
  await p.goto(BASE + r, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  const safe = r.replace(/\//g, '_');
  const file = path.join(OUT, `1440${safe}.png`);
  await p.screenshot({ path: file, fullPage: true });
  console.log('wrote', file);
}

// Mobile viewport for shell check only on overview
await p.setViewportSize({ width: 390, height: 844 });
await p.goto(BASE + '/overview', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
await p.screenshot({ path: path.join(OUT, '390_overview.png'), fullPage: true });
console.log('wrote mobile overview');

await b.close();
```

- [ ] **Step 4: Run the script**

```bash
mkdir -p /tmp/xenon-verify && cd /tmp/xenon-verify && npm init -y >/dev/null 2>&1 && npm install playwright >/dev/null 2>&1 && npx playwright install chromium >/dev/null 2>&1 && node /tmp/xenon-verify/shell-check.mjs
```

Expected: prints "wrote .../1440_overview.png" for each of the 10 routes plus the mobile overview. No "PAGE ERROR" or "HTTP 5xx" lines in stderr.

- [ ] **Step 5: Review screenshots**

Open `/Users/rabindrabiswal/Workspace/XAenon/xenon/web/screenshots/shell-redesign/1440_overview.png`. Verify:

- Fixed 56px sidebar on the left, icons only, green accent bar on the `Overview` row.
- Fixed 56px top bar across the top: green X logo, "XENON / Device Ops" wordmark, `v0.3.0` pill, search bar with ⌘K, "Updated …", green "Online" pill, "Administrator" dropdown.
- Page body (still legacy-styled Overview) sits below the top bar and to the right of the sidebar, with 56px clearance on both.
- No horizontal scrollbar, no overlap.

For each other route, verify:
- Same shell, different active sidebar icon.
- Route body renders (even if legacy-styled). No obvious clipping under the top bar.

- [ ] **Step 6: Stop the appium server**

```bash
pkill -f 'appium server' 2>/dev/null || true
```

- [ ] **Step 7: Commit screenshots (optional)**

If the project tracks `web/screenshots/`:

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon add web/screenshots/shell-redesign
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon commit -m "$(cat <<'EOF'
chore(web): capture shell-redesign screenshots

Reference baseline showing the new sidebar + top bar across all 10
routes at 1440x900 plus Overview at 390x844.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If `.gitignore` covers `web/screenshots/`, skip the commit.

---

## Task 10: Final verification & PR-readiness checklist

**Files:** None (verification only)

- [ ] **Step 1: Full repo build**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon && npm run build:all
```

Expected: both `build:xenon` and `build` succeed.

- [ ] **Step 2: Run web test suite**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon/web && npm test -- --run
```

Expected: same pass/fail count as before this plan started.

- [ ] **Step 3: Run backend unit tests (light smoke)**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon && npm test 2>&1 | tail -20
```

Expected: no regressions from UI-only changes. If any test fails that references the web bundle (e.g., `src/public` snapshot tests), investigate — but the redesign shouldn't touch backend test targets.

- [ ] **Step 4: Verify git log**

```bash
git -C /Users/rabindrabiswal/Workspace/XAenon/xenon log --oneline -12
```

Expected: 7 new commits (Tasks 1–4, 6–8) all with the `Co-Authored-By: Claude Opus 4.7 (1M context)` trailer, plus optional Task-9 screenshot commit.

- [ ] **Step 5: No commit** — plan complete.

---

## Self-Review Notes

Ran the self-review checklist after drafting:

1. **Spec coverage** — §3 (Tailwind install) covered by Tasks 1–2; §3.2 (tokens) by Task 3; §3.3 (fonts) by Task 4; §4.1 (TopBar) by Task 7; §4.2 (Sidebar) by Task 6; §4.3 (App shell) by Task 8; §9 (testing) by Tasks 5, 9, 10. Out-of-scope: §5 Overview page, §6 other pages, §7 data strategy — deferred to Plans 2+.
2. **Placeholder scan** — no TBDs; every step contains actual code or an exact command.
3. **Type consistency** — new `Sidebar` exports both `default` and named `{ Sidebar }` matching the current import sites (App.tsx and any potential re-import); Header is default-only, matching the import in App.tsx. `NavItem.icon` is `React.ComponentType` in the sidebar, consistent with how `Icon` is rendered as `<Icon className=… />` in the loop.
4. **Unused `useSidebarState`** — the hook file stays (Phase 2 doesn't touch hooks/); future plans can remove it when confirmed orphan. Noted in Task 6 Step 3.
