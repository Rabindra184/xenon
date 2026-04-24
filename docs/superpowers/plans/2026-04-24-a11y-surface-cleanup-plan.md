# A11y + Surface Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out three polish items deferred from today's three primitive-adoption PRs: introduce a minimal `.surface-card` class so `teams.tsx`/`api-keys.tsx` can stop overloading `.setting-card`; make the webhook Trigger Events grid keyboard-operable; and clear reservation modal name errors as the user types.

**Architecture:** 4 commits, bundled in one PR. New `.surface-card` CSS class (4 lines) in `web/src/components/ui/surface.css`, imported globally from `web/src/index.tsx`. 6 className renames in teams/api-keys. 7 CSS rule blocks deleted from `settings.css`. Webhook events grid wrapped in `<fieldset>` with `role="group"`; each event gets `role="checkbox"` + `aria-checked` + `tabIndex` + `onKeyDown`. Reservation modal's Reserved By `onChange` clears `nameError` on keystroke.

**Tech Stack:** React 17, CSS, no new dependencies, no new tests.

---

## File Structure

**Create:**
- `web/src/components/ui/surface.css` — new class `.surface-card` (global, no React component)

**Modify:**
- `web/src/index.tsx` — add import for surface.css
- `web/src/components/settings/teams.tsx` — rename 4 classNames
- `web/src/components/settings/api-keys.tsx` — rename 2 classNames
- `web/src/components/settings/settings.css` — delete 7 rule blocks + 3 orphan comments
- `web/src/components/webhook-settings/webhook-settings.tsx` — fieldset wrapper + a11y attrs on each event
- `web/src/components/reservation-modal/reservation-modal.tsx` — 2-line onChange edit

No existing files deleted, no new tests.

---

## Task 1: Add `.surface-card` class

**Files:**
- Create: `web/src/components/ui/surface.css`
- Modify: `web/src/index.tsx`

- [ ] **Step 1: Create `surface.css`**

Create `/Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/components/ui/surface.css` with this exact content:

```css
.surface-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
}
```

- [ ] **Step 2: Import from `index.tsx`**

Open `/Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/index.tsx`. The current file (11 lines) is:

```tsx
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import './index.css';
import App from './App';

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root'),
);
```

Add a single import line after `import './index.css';`:

```tsx
import './components/ui/surface.css';
```

Final file should be:

```tsx
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import './index.css';
import './components/ui/surface.css';
import App from './App';

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root'),
);
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon/web && npm run build
```
Expected: clean build. The new CSS rule should appear in the bundled stylesheet; verify by running `grep -r "\.surface-card" build/assets/` — should return at least one hit.

- [ ] **Step 4: Commit**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git add web/src/components/ui/surface.css web/src/index.tsx
git commit -m "feat(web): add surface-card class for generic elevated surfaces"
```

---

## Task 2: Migrate 6 generic-surface usages

**Files:**
- Modify: `web/src/components/settings/teams.tsx` (4 lines)
- Modify: `web/src/components/settings/api-keys.tsx` (2 lines)

- [ ] **Step 1: Rename classNames in `teams.tsx`**

In `/Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/components/settings/teams.tsx`, find and replace the 4 `className="setting-card"` occurrences with `className="surface-card"`. Use `replace_all` since this exact string appears only on the 4 intended lines (verified via grep — no other `"setting-card"` literal in this file).

Specifically rename at:
- Line 140 (empty-state wrapper with textAlign+padding)
- Line 148 (table wrapper with padding:0 + overflowX)
- Line 416 (members list panel with padding:12)
- Line 475 (devices list panel with padding:12)

Keep the inline `style` attributes intact — they provide per-usage padding/layout overrides.

- [ ] **Step 2: Rename classNames in `api-keys.tsx`**

In `/Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/components/settings/api-keys.tsx`, find and replace the 2 `className="setting-card"` occurrences with `className="surface-card"`:
- Line 220 (empty-state wrapper)
- Line 228 (table wrapper)

- [ ] **Step 3: Verify no stale `.setting-card` classNames remain outside the settings-card pattern**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
grep -rn '"setting-card"' web/src
```
Expected: only `web/src/components/ui/SettingCard.tsx:21:  <div className="setting-card">` (the primitive's own JSX). No hits in teams.tsx, api-keys.tsx, or anywhere else.

- [ ] **Step 4: Verify build + tests still pass**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon/web && npm run build && npx vitest run
```
Expected: clean build, 75/75 tests pass. At this point the 6 migrated surfaces will render with less chrome than before — no scanline, no gradient border — because `.surface-card` has none of that. This is the intentional visual delta.

- [ ] **Step 5: Commit**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git add web/src/components/settings/teams.tsx web/src/components/settings/api-keys.tsx
git commit -m "refactor(web): migrate generic setting-card usages to surface-card"
```

---

## Task 3: Delete orphan `.setting-card` CSS

**Files:**
- Modify: `web/src/components/settings/settings.css`

- [ ] **Step 1: Pre-flight grep**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
grep -rn '"setting-card"' web/src
```
Expected: exactly one hit, `web/src/components/ui/SettingCard.tsx:21`. If any other file still references the class, STOP — migration incomplete, do not delete the CSS.

- [ ] **Step 2: Delete Block A (first `.setting-card` + hover, lines 68-84)**

Open `web/src/components/settings/settings.css`. Find and delete this exact block:

```css
.setting-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: 20px;
    transition: all 0.2s ease;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow: hidden;
}

.setting-card:hover {
    border-color: var(--border-strong);
    background: var(--bg-elevated);
}
```

Leave the blank line around it so `.status-pill` that follows still has clean separation.

- [ ] **Step 3: Delete Block B (Hardened Container Architecture comment + second copy, lines 183-200)**

Find and delete:

```css
/* Hardened Container Architecture */
.setting-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-lg);
    padding: 20px;
    position: relative;
    transition: all 0.2s ease;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.setting-card:hover {
    border-color: var(--border-strong);
    background: var(--bg-elevated);
}
```

The orphan comment goes because its content is gone.

- [ ] **Step 4: Delete Block C (Obsidian Glassmorphism + scanline + gradient, lines 709-749)**

Find and delete:

```css
/* --- Premium UX: Obsidian Glassmorphism --- */
.setting-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-default);
    position: relative;
}

/* Scanline texture overlay */
.setting-card::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0.15;
    z-index: 0;
    background: linear-gradient(to bottom,
            rgba(255, 255, 255, 0),
            rgba(255, 255, 255, 0) 50%,
            rgba(0, 0, 0, 0.15) 50%,
            rgba(0, 0, 0, 0.15));
    background-size: 100% 4px;
    border-radius: inherit;
}

.setting-card::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: var(--radius-lg);
    padding: 1px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0));
    -webkit-mask:
        linear-gradient(#fff 0 0) content-box,
        linear-gradient(#fff 0 0);
    mask:
        linear-gradient(#fff 0 0) content-box,
        linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
}
```

Both pseudo-elements and both orphan comments go.

- [ ] **Step 5: Verify no `.setting-card` rules remain in settings.css**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
grep -n '^\.setting-card' web/src/components/settings/settings.css
```
Expected: empty output.

Also verify the primitive's copy is intact and unaffected:

```bash
grep -n '^\.setting-card' web/src/components/ui/setting-card.css
```
Expected: 2 hits (`.setting-card {` and `.setting-card:hover {`). Plus 2 for pseudo-elements (`.setting-card::after`, `.setting-card::before`) and 3 for descendant rules (`.setting-card-header`, `.setting-card h4`, etc.). Any of these presence is fine — the primitive owns them.

- [ ] **Step 6: Verify build + tests**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon/web && npm run build && npx vitest run
```
Expected: 75/75 tests pass, clean build.

- [ ] **Step 7: Commit**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git add web/src/components/settings/settings.css
git commit -m "refactor(web): remove remaining orphan setting-card CSS"
```

---

## Task 4: Webhook a11y + reservation nameError reset

**Files:**
- Modify: `web/src/components/webhook-settings/webhook-settings.tsx`
- Modify: `web/src/components/reservation-modal/reservation-modal.tsx`

- [ ] **Step 1: Webhook events grid a11y**

In `/Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/components/webhook-settings/webhook-settings.tsx`, find the current events-grid block (currently lines 185–203 inside the FieldGroup):

```tsx
          <FieldGroup label="Trigger Events">
            <div className="events-grid">
              {AVAILABLE_EVENTS.map((event) => (
                <div
                  key={event.id}
                  className={`event-checkbox ${
                    selectedEvents.includes(event.id) ? 'selected' : ''
                  }`}
                  onClick={() => toggleEvent(event.id)}
                >
                  {event.icon}
                  <span>{event.label}</span>
                  {selectedEvents.includes(event.id) && (
                    <CheckCircle size={14} className="check-icon" />
                  )}
                </div>
              ))}
            </div>
          </FieldGroup>
```

Replace with:

```tsx
          <FieldGroup label="Trigger Events">
            <fieldset
              role="group"
              aria-label="Trigger Events"
              style={{ border: 'none', margin: 0, padding: 0 }}
            >
              <div className="events-grid">
                {AVAILABLE_EVENTS.map((event) => {
                  const isSelected = selectedEvents.includes(event.id);
                  return (
                    <div
                      key={event.id}
                      role="checkbox"
                      aria-checked={isSelected}
                      tabIndex={0}
                      className={`event-checkbox ${isSelected ? 'selected' : ''}`}
                      onClick={() => toggleEvent(event.id)}
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          e.preventDefault();
                          toggleEvent(event.id);
                        }
                      }}
                    >
                      {event.icon}
                      <span>{event.label}</span>
                      {isSelected && <CheckCircle size={14} className="check-icon" />}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          </FieldGroup>
```

Notes:
- `isSelected` is extracted once per event to avoid calling `selectedEvents.includes(event.id)` three times per render
- The `<fieldset>` has inline `border/margin/padding: 0` to neutralize default browser chrome; the `.events-grid` keeps its existing CSS grid layout
- `aria-checked` is on each event div; `aria-label="Trigger Events"` on the fieldset satisfies screen-reader group labeling without needing an FieldGroup API change

- [ ] **Step 2: Reservation nameError reset**

In `/Users/rabindrabiswal/Workspace/XAenon/xenon/web/src/components/reservation-modal/reservation-modal.tsx`, find the Reserved By input's onChange (inside the first FieldGroup). It currently reads:

```tsx
          <input
            id="reservation-reserved-by"
            type="text"
            className="reservation-input"
            placeholder="Enter your name or ID"
            value={reservedBy}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReservedBy(e.target.value)}
            disabled={loading}
          />
```

Replace with:

```tsx
          <input
            id="reservation-reserved-by"
            type="text"
            className="reservation-input"
            placeholder="Enter your name or ID"
            value={reservedBy}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setReservedBy(e.target.value);
              if (nameError) setNameError(null);
            }}
            disabled={loading}
          />
```

No other changes — the handleReserve validation still sets `nameError` on the next empty-submit attempt.

- [ ] **Step 3: Verify build + tests**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon/web && npm run build && npx vitest run
```
Expected: clean build, 75/75 tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git add web/src/components/webhook-settings/webhook-settings.tsx web/src/components/reservation-modal/reservation-modal.tsx
git commit -m "fix(web): keyboard-operable webhook events; clear reservation name error on input"
```

---

## Final verification

- [ ] **Step 1: Full-tree grep for orphan references**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
grep -rn '"setting-card"' web/src
```
Expected: exactly 1 hit (`web/src/components/ui/SettingCard.tsx:21`).

```bash
grep -rn '\.setting-card' web/src/components/settings/settings.css
```
Expected: empty.

```bash
grep -rn '"surface-card"' web/src
```
Expected: 6 hits (4 in teams.tsx, 2 in api-keys.tsx), plus 1 selector in `web/src/components/ui/surface.css`.

- [ ] **Step 2: Full test run**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon/web && npm test
```
Expected: 75/75 passing.

- [ ] **Step 3: Full build**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon/web && npm run build
```
Expected: clean, no new warnings.

- [ ] **Step 4: Manual a11y smoke test (optional if a browser is available)**

- Open the webhook settings page in dev
- Tab through the form — focus should land on each `.event-checkbox` sequentially
- Press Space on a focused event — it should toggle selected state
- Press Enter on a focused event — it should also toggle

- Open a reservation modal
- Click Reserve without filling name — "Please enter your name/ID" appears under Reserved By
- Type any character in the Reserved By field — error disappears immediately

- Navigate to teams or api-keys empty state — should render as a plain surface card (background + border + radius), without the scanline or gradient border decorations that the old `.setting-card` applied

- [ ] **Step 5: Push branch**

```bash
cd /Users/rabindrabiswal/Workspace/XAenon/xenon
git push -u origin fix/web-a11y-surface-cleanup
```

Open PR manually at:
`https://github.com/Rabindra184/xenon/pull/new/fix/web-a11y-surface-cleanup`

PR title: `fix(web): a11y + surface cleanup after primitive adoption`
