# FieldGroup Broad Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every remaining hand-rolled `label + input + hint/error` markup in `web/src/` onto either the existing `FieldGroup` primitive (modal fields) or a new `SettingCard` primitive (grid-of-settings cards), and delete all now-orphan CSS rules.

**Architecture:** Two sibling primitives under `web/src/components/ui/`. `FieldGroup` stays unchanged. `SettingCard` is new, owns the `.setting-card` visual and its `::after` scanline / `::before` border-gradient pseudo-elements. Six call sites migrate independently; single shared stylesheet (`web/src/components/settings/settings.css`) gets cleaned in the final settings-migration task.

**Tech Stack:** React 17, TypeScript 5, Vitest + @testing-library/react, Vite 5.

**Spec deviations discovered during planning:**

1. `stagger-N` classes are referenced in JSX but have **no CSS rules defined anywhere** (`grep -r ".stagger-" web/src/**/*.css` returns nothing). They are dead markers. SettingCard therefore omits the `staggerIndex` prop — no behavior would be preserved. Call sites drop the `stagger-*` className.
2. `ai-settings.tsx` is a third consumer of the `.setting-card` / `.setting-card-header` / `.section-description-dense` class set (2 cards — Provider Registry, Runtime Configuration). Deleting those CSS rules without migrating ai-settings would break it. Plan adds a task (Task 8) to migrate ai-settings too.
3. `maintenance-settings.tsx` and `settings.tsx` both import `./settings.css` (shared stylesheet, not per-file). CSS cleanup happens in `settings.css` alone, at the end of the settings-migration chain.

**Final scope:** 6 call sites, 15 fields total.
- FieldGroup × 6: reservation (3), tag-manager (1), webhook (2)
- SettingCard × 9: maintenance (4), settings (3), ai-settings (2)

---

## File Structure

**Create:**
- `web/src/components/ui/SettingCard.tsx` — new primitive
- `web/src/components/ui/setting-card.css` — new styles (absorbs `.setting-card*` and pseudo-elements)
- `web/src/components/ui/setting-card.test.tsx` — 5 tests
- `web/src/components/ui/field-group.test.tsx` — 4 tests for existing primitive

**Modify:**
- `web/src/components/reservation-modal/reservation-modal.tsx` — 3 FieldGroups
- `web/src/components/reservation-modal/reservation-modal.css` — delete `.reservation-form-group*`, `.error-message`
- `web/src/components/tag-manager-modal/tag-manager-modal.tsx` — 1 FieldGroup
- `web/src/components/tag-manager-modal/tag-manager-modal.css` — delete `.tag-input-section label`, `.input-hint`
- `web/src/components/webhook-settings/webhook-settings.tsx` — 2 FieldGroups
- `web/src/components/webhook-settings/webhook-settings.css` — delete `.events-selection label`
- `web/src/components/settings/maintenance-settings.tsx` — 4 SettingCards
- `web/src/components/settings/settings.tsx` — 3 SettingCards
- `web/src/components/settings/ai-settings.tsx` — 2 SettingCards
- `web/src/components/settings/settings.css` — delete all `.setting-card*`, `.section-description-dense`, `.setting-hint-clean` rules (consolidated — shared by all 3 settings files)

---

## Task 1: SettingCard primitive

**Files:**
- Create: `web/src/components/ui/SettingCard.tsx`
- Create: `web/src/components/ui/setting-card.css`
- Create: `web/src/components/ui/setting-card.test.tsx`

- [ ] **Step 1: Write failing tests**

Write `web/src/components/ui/setting-card.test.tsx`:

```tsx
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingCard } from './SettingCard';

describe('SettingCard', () => {
  it('renders icon and title', () => {
    render(
      <SettingCard icon={<span data-testid="icon">I</span>} title="Retention Window">
        <input />
      </SettingCard>,
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Retention Window' })).toBeInTheDocument();
  });

  it('renders description when provided, omits when not', () => {
    const { rerender, container } = render(
      <SettingCard icon={<span />} title="t" description="A prose description.">
        <input />
      </SettingCard>,
    );
    expect(screen.getByText('A prose description.')).toBeInTheDocument();
    expect(container.querySelector('.setting-card-description')).not.toBeNull();

    rerender(
      <SettingCard icon={<span />} title="t">
        <input />
      </SettingCard>,
    );
    expect(container.querySelector('.setting-card-description')).toBeNull();
  });

  it('renders children inside .setting-card-field', () => {
    const { container } = render(
      <SettingCard icon={<span />} title="t">
        <input data-testid="child" />
      </SettingCard>,
    );
    const field = container.querySelector('.setting-card-field');
    expect(field).not.toBeNull();
    expect(field?.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it('renders hint when provided, omits when not', () => {
    const { rerender, container } = render(
      <SettingCard icon={<span />} title="t" hint="Minimum safe value: 5000ms.">
        <input />
      </SettingCard>,
    );
    expect(screen.getByText('Minimum safe value: 5000ms.')).toBeInTheDocument();
    expect(container.querySelector('.setting-card-hint')).not.toBeNull();

    rerender(
      <SettingCard icon={<span />} title="t">
        <input />
      </SettingCard>,
    );
    expect(container.querySelector('.setting-card-hint')).toBeNull();
  });

  it('renders h4 heading (not other levels)', () => {
    render(
      <SettingCard icon={<span />} title="AI Self-Healing">
        <input />
      </SettingCard>,
    );
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
    expect(screen.getByRole('heading', { level: 4 })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/ui/setting-card.test.tsx`
Expected: FAIL — "Cannot find module './SettingCard'"

- [ ] **Step 3: Implement SettingCard**

Write `web/src/components/ui/SettingCard.tsx`:

```tsx
import * as React from 'react';
import './setting-card.css';

export interface SettingCardProps {
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}

export const SettingCard: React.FC<SettingCardProps> = ({
  icon,
  title,
  description,
  hint,
  children,
}) => (
  <div className="setting-card">
    <div className="setting-card-header">
      {icon}
      <h4>{title}</h4>
    </div>
    {description && <p className="setting-card-description">{description}</p>}
    <div className="setting-card-field">{children}</div>
    {hint && <div className="setting-card-hint">{hint}</div>}
  </div>
);
```

- [ ] **Step 4: Write CSS**

Write `web/src/components/ui/setting-card.css`:

```css
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

.setting-card::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.15;
  z-index: 0;
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0),
    rgba(255, 255, 255, 0) 50%,
    rgba(0, 0, 0, 0.15) 50%,
    rgba(0, 0, 0, 0.15)
  );
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

.setting-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--accent);
}

.setting-card-header svg {
  flex-shrink: 0;
}

.setting-card h4 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  font-family: 'Outfit', sans-serif;
  color: var(--text-primary);
}

.setting-card-description {
  color: var(--text-muted);
  font-size: 0.8rem;
  margin: 0;
  line-height: 1.5;
  max-width: 500px;
}

.setting-card-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  position: relative;
  z-index: 1;
}

.setting-card-hint {
  font-size: 0.75rem;
  color: var(--text-subtle);
  margin-top: 4px;
  font-style: italic;
  padding-left: 2px;
  position: relative;
  z-index: 1;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/ui/setting-card.test.tsx`
Expected: PASS (5/5)

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ui/SettingCard.tsx web/src/components/ui/setting-card.css web/src/components/ui/setting-card.test.tsx
git commit -m "feat(web): add SettingCard primitive for grid-of-settings cards"
```

---

## Task 2: FieldGroup tests

**Files:**
- Create: `web/src/components/ui/field-group.test.tsx`

- [ ] **Step 1: Write tests**

Write `web/src/components/ui/field-group.test.tsx`:

```tsx
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FieldGroup } from './FieldGroup';

describe('FieldGroup', () => {
  it('renders label text', () => {
    render(
      <FieldGroup label="Reserved By">
        <input />
      </FieldGroup>,
    );
    expect(screen.getByText('Reserved By')).toBeInTheDocument();
  });

  it('renders description when provided, omits when not', () => {
    const { rerender, container } = render(
      <FieldGroup label="t" description="Press Enter to add multiple tags">
        <input />
      </FieldGroup>,
    );
    expect(screen.getByText('Press Enter to add multiple tags')).toBeInTheDocument();
    expect(container.querySelector('.fg-desc')).not.toBeNull();

    rerender(
      <FieldGroup label="t">
        <input />
      </FieldGroup>,
    );
    expect(container.querySelector('.fg-desc')).toBeNull();
  });

  it('renders error when provided, omits when not', () => {
    const { rerender, container } = render(
      <FieldGroup label="t" error="Please enter your name">
        <input />
      </FieldGroup>,
    );
    expect(screen.getByText('Please enter your name')).toBeInTheDocument();
    expect(container.querySelector('.fg-error')).not.toBeNull();

    rerender(
      <FieldGroup label="t">
        <input />
      </FieldGroup>,
    );
    expect(container.querySelector('.fg-error')).toBeNull();
  });

  it('wires htmlFor to the label element', () => {
    const { container } = render(
      <FieldGroup label="Tag" htmlFor="tag-input">
        <input id="tag-input" />
      </FieldGroup>,
    );
    const label = container.querySelector('label');
    expect(label?.getAttribute('for')).toBe('tag-input');
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/ui/field-group.test.tsx`
Expected: PASS (4/4) — FieldGroup already implements all of this.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ui/field-group.test.tsx
git commit -m "test(web): add FieldGroup primitive unit tests"
```

---

## Task 3: Migrate reservation-modal

**Files:**
- Modify: `web/src/components/reservation-modal/reservation-modal.tsx`
- Modify: `web/src/components/reservation-modal/reservation-modal.css`

- [ ] **Step 1: Replace form groups with FieldGroups**

In `web/src/components/reservation-modal/reservation-modal.tsx`, add the FieldGroup import and replace the three `.reservation-form-group` blocks plus the bottom-of-form error banner.

Add to the import section (after line 6):

```tsx
import { FieldGroup } from '../ui/FieldGroup';
```

Replace lines 96–158 (the three `.reservation-form-group` blocks plus the `{error && ...}` block) with:

```tsx
        <FieldGroup
          label={
            <>
              <User
                size={14}
                style={{ marginRight: 6, verticalAlign: 'middle', color: 'var(--accent)' }}
              />
              Reserved By
            </>
          }
          htmlFor="reservation-reserved-by"
        >
          <input
            id="reservation-reserved-by"
            type="text"
            className="reservation-input"
            placeholder="Enter your name or ID"
            value={reservedBy}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReservedBy(e.target.value)}
            disabled={loading}
          />
        </FieldGroup>

        <FieldGroup
          label={
            <>
              <Clock
                size={14}
                style={{ marginRight: 6, verticalAlign: 'middle', color: 'var(--accent)' }}
              />
              Duration
            </>
          }
        >
          <div className="duration-selector">
            {DURATION_OPTIONS.map((opt) => (
              <div
                key={opt.value}
                className={`duration-option ${duration === opt.value ? 'active' : ''}`}
                onClick={() => setDuration(opt.value)}
              >
                {opt.label}
              </div>
            ))}
          </div>
        </FieldGroup>

        <FieldGroup
          label={
            <>
              <MessageSquare
                size={14}
                style={{ marginRight: 6, verticalAlign: 'middle', color: 'var(--accent)' }}
              />
              Reason (Optional)
            </>
          }
          htmlFor="reservation-reason"
          error={
            error ? (
              <>
                <AlertCircle size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                {error}
              </>
            ) : undefined
          }
        >
          <input
            id="reservation-reason"
            type="text"
            className="reservation-input"
            placeholder="e.g., Debugging flaky login test"
            value={reason}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReason(e.target.value)}
            disabled={loading}
          />
        </FieldGroup>
```

- [ ] **Step 2: Clean up CSS**

In `web/src/components/reservation-modal/reservation-modal.css`, delete these rule blocks (lines 44–57 and 159–168 in the current file):

```css
.reservation-form-group {
    margin-bottom: 0;
}

.reservation-form-group label {
    display: block;
    color: var(--text-subtle);
    font-size: 11px;
    font-weight: 800;
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-family: 'JetBrains Mono', monospace;
}
```

and:

```css
.error-message {
    color: #ff4d4d;
    font-size: 11px;
    margin-top: 12px;
    background-color: rgba(255, 77, 77, 0.05);
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid rgba(255, 77, 77, 0.2);
    font-family: 'JetBrains Mono', monospace;
}
```

Keep everything else (`.title-icon`, `.reservation-modal-body`, `.device-id-badge`, `.reservation-input`, `.duration-selector`, `.duration-option`, `.btn-cancel`, `.btn-reserve`).

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd web && npx vitest run`
Expected: all previously passing tests still pass (reservation-modal has no unit test; this is a regression check against ui/* tests).

- [ ] **Step 4: Visual spot-check**

Run: `cd web && npm run build`
Expected: build succeeds, no new warnings.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/reservation-modal/reservation-modal.tsx web/src/components/reservation-modal/reservation-modal.css
git commit -m "refactor(web): adopt FieldGroup in reservation modal"
```

---

## Task 4: Migrate tag-manager-modal

**Files:**
- Modify: `web/src/components/tag-manager-modal/tag-manager-modal.tsx`
- Modify: `web/src/components/tag-manager-modal/tag-manager-modal.css`

- [ ] **Step 1: Wrap tag input in FieldGroup**

In `web/src/components/tag-manager-modal/tag-manager-modal.tsx`, add the import (after line 7):

```tsx
import { FieldGroup } from '../ui/FieldGroup';
```

Replace lines 88–109 (the `<div className="tag-input-section">...</div>` block) with:

```tsx
        <FieldGroup
          label="Add New Tag"
          description="Press Enter to add multiple tags"
          htmlFor="tag-input"
        >
          <div className="input-with-button">
            <input
              ref={inputRef}
              id="tag-input"
              type="text"
              placeholder="e.g. stable, team-a, ios-17"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              className="add-inline-btn"
              onClick={handleAddTag}
              disabled={!inputValue.trim()}
            >
              <Plus size={16} />
            </button>
          </div>
        </FieldGroup>
```

Note: the `<label>Current Tags</label>` in the second section stays — it's a static section header, not a form field label.

- [ ] **Step 2: Clean up CSS**

In `web/src/components/tag-manager-modal/tag-manager-modal.css`, delete these rule blocks (lines 35–45 and 70–74 in the current file):

```css
.tag-input-section label,
.tags-display-section label {
    display: block;
    font-size: 11px;
    font-weight: 800;
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 8px;
    font-family: 'JetBrains Mono', monospace;
}
```

Replace with a narrower selector that still styles the remaining "Current Tags" label:

```css
.tags-display-section label {
    display: block;
    font-size: 11px;
    font-weight: 800;
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 8px;
    font-family: 'JetBrains Mono', monospace;
}
```

Also delete the `.tag-input-section .input-hint` block:

```css
.tag-input-section .input-hint {
    margin: 6px 0 0 0;
    font-size: 11px;
    color: var(--text-subtle);
}
```

Keep everything else (`.title-icon`, `.tag-modal-body`, `.device-id-badge`, `.tag-input-section .input-with-button`, `.tag-input-section input`, `.add-inline-btn`, `.tags-list`, `.tag-pill-editable`, `.remove-tag`, `.btn-cancel`, `.btn-save`).

- [ ] **Step 3: Verify build**

Run: `cd web && npm run build`
Expected: PASS, no new warnings.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/tag-manager-modal/tag-manager-modal.tsx web/src/components/tag-manager-modal/tag-manager-modal.css
git commit -m "refactor(web): adopt FieldGroup in tag-manager modal"
```

---

## Task 5: Migrate webhook-settings

**Files:**
- Modify: `web/src/components/webhook-settings/webhook-settings.tsx`
- Modify: `web/src/components/webhook-settings/webhook-settings.css`

- [ ] **Step 1: Wrap URL input and events grid in FieldGroups**

In `web/src/components/webhook-settings/webhook-settings.tsx`, add the import at the top (after line 5):

```tsx
import { FieldGroup } from '../ui/FieldGroup';
```

Replace lines 169–198 (the `.form-group` URL block and the `.events-selection` events grid block) with:

```tsx
          <FieldGroup
            label="Webhook URL"
            description="The endpoint we POST webhook events to."
            htmlFor="webhook-url"
          >
            <input
              id="webhook-url"
              type="text"
              className="webhook-input"
              placeholder="https://hooks.slack.com/services/..."
              value={newUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewUrl(e.target.value)}
            />
          </FieldGroup>

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

- [ ] **Step 2: Clean up CSS**

In `web/src/components/webhook-settings/webhook-settings.css`, delete these blocks (lines 174–176 and 197–206):

```css
.form-group {
    margin-bottom: 24px;
}
```

```css
.events-selection label {
    display: block;
    font-size: 11px;
    font-weight: 800;
    color: var(--text-subtle);
    margin-bottom: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-family: 'JetBrains Mono', monospace;
}
```

Keep `.webhook-input`, `.events-grid`, `.event-checkbox`, and everything else.

- [ ] **Step 3: Verify build**

Run: `cd web && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/webhook-settings/webhook-settings.tsx web/src/components/webhook-settings/webhook-settings.css
git commit -m "refactor(web): adopt FieldGroup in webhook add form"
```

---

## Task 6: Migrate maintenance-settings

**Files:**
- Modify: `web/src/components/settings/maintenance-settings.tsx`

(No CSS cleanup yet — that happens in Task 9 after all three settings files are migrated.)

- [ ] **Step 1: Replace four setting cards with SettingCards**

In `web/src/components/settings/maintenance-settings.tsx`, add the import (after line 18):

```tsx
import { SettingCard } from '../ui/SettingCard';
```

Replace lines 119–237 (the four `.setting-card` blocks) with:

```tsx
          <SettingCard
            icon={<History size={16} />}
            title="Retention Window"
            description="Number of days to preserve builds and sessions before automatic purging from the system."
            hint="Standard enterprise retention is typically 30-90 days."
          >
            <div className="input-group">
              <input
                type="number"
                value={config.buildCleanupDays}
                onChange={(e) =>
                  setConfig({ ...config, buildCleanupDays: parseInt(e.target.value) })
                }
                min={1}
              />
              <span className="code-font">DAYS</span>
            </div>
          </SettingCard>

          <SettingCard
            icon={<Trash2 size={16} />}
            title="Max Build Capacity"
            description="Cap the maximum number of historical builds stored in the primary database."
            hint="Protects against database bloat during high-frequency CI bursts."
          >
            <div className="input-group">
              <input
                type="number"
                value={config.buildCleanupMaxCount}
                onChange={(e) =>
                  setConfig({ ...config, buildCleanupMaxCount: parseInt(e.target.value) })
                }
                min={1}
              />
              <span className="code-font">BUILDS</span>
            </div>
          </SettingCard>

          <SettingCard
            icon={<ShieldCheck size={16} />}
            title="Asset Purge Strategy"
            description="Automatically remove binary artifacts (videos, screenshots) when build records are purged."
            hint="Disabling this will leave orphaned files on disk—use with caution."
          >
            <div className="toggle-group">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={config.deleteBuildAssets}
                  onChange={(e) => setConfig({ ...config, deleteBuildAssets: e.target.checked })}
                />
                <span className="slider round"></span>
              </label>
              <span className="toggle-label">
                {config.deleteBuildAssets ? 'ENABLED' : 'DISABLED'}
              </span>
            </div>
          </SettingCard>

          <SettingCard
            icon={<Calendar size={16} />}
            title="Cleanup Orchestration"
            description="Standardized Cron syntax for scheduling the automated cleanup engine."
          >
            <div className="setting-field">
              <div className="setting-input-wrapper">
                <input
                  type="text"
                  placeholder="e.g. 0 0 * * * (Midnight)"
                  value={config.buildCleanupSchedule}
                  onChange={(e) => setConfig({ ...config, buildCleanupSchedule: e.target.value })}
                />
              </div>
            </div>

            <div className="cron-presets">
              <div className="presets-grid">
                {[
                  { label: 'Daily (Midnight)', value: '0 0 * * *' },
                  { label: 'Weekly (Sunday)', value: '0 0 * * 0' },
                  { label: 'Bi-Daily (12h)', value: '0 */12 * * *' },
                ].map((p) => (
                  <button
                    key={p.label}
                    className={`preset-chip ${
                      config.buildCleanupSchedule === p.value ? 'active' : ''
                    }`}
                    onClick={() => setConfig({ ...config, buildCleanupSchedule: p.value })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </SettingCard>
```

- [ ] **Step 2: Verify build**

Run: `cd web && npm run build`
Expected: PASS. (Cards will render via both primitive CSS and old `.setting-card` rules in `settings.css` — visually identical.)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/settings/maintenance-settings.tsx
git commit -m "refactor(web): adopt SettingCard in maintenance settings"
```

---

## Task 7: Migrate settings.tsx

**Files:**
- Modify: `web/src/components/settings/settings.tsx`

- [ ] **Step 1: Replace three setting cards with SettingCards**

In `web/src/components/settings/settings.tsx`, add the import (after line 17):

```tsx
import { SettingCard } from '../ui/SettingCard';
```

Replace lines 143–247 (the three `.setting-card` blocks) with:

```tsx
          <SettingCard
            icon={<Clock size={16} />}
            title="Idle Health Frequency"
            description="Frequency of passive health pings when the system is in idle state."
            hint="Minimum safe value: 5000ms. Note: This frequency is overridden when a schedule is active."
          >
            <div className="input-group">
              <input
                type="number"
                value={config.healthCheckIntervalMs}
                onChange={(e) =>
                  setConfig({ ...config, healthCheckIntervalMs: parseInt(e.target.value) })
                }
                min={5000}
                step={5000}
              />
              <span className="code-font">MS</span>
            </div>
          </SettingCard>

          <SettingCard
            icon={<Calendar size={16} />}
            title="Deep Diagnostic Schedule"
            description="Execute intensive reliability bursts (WDA restarts, Cache purges) using standardized Cron syntax."
          >
            <div className="setting-field">
              <div className="setting-input-wrapper">
                <input
                  type="text"
                  placeholder="e.g. 0 * * * * (At internal min 0)"
                  value={config.healthCheckSchedule}
                  onChange={(e) => setConfig({ ...config, healthCheckSchedule: e.target.value })}
                />
              </div>
            </div>

            <div className="cron-preview">
              <span className="preview-label">Active Logic:</span>
              <span className="preview-value">
                {getSchedulePreview(config.healthCheckSchedule)}
              </span>
            </div>

            <div className="cron-presets">
              <div className="presets-label">
                <MousePointer2 size={12} />
                <span>Intent-Based Presets:</span>
              </div>
              <div className="presets-grid">
                {presets.map((p) => (
                  <button
                    key={p.label}
                    className={`preset-chip ${
                      config.healthCheckSchedule === p.value ? 'active' : ''
                    }`}
                    onClick={() => setConfig({ ...config, healthCheckSchedule: p.value })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </SettingCard>

          <SettingCard
            icon={<Brain size={16} />}
            title="AI Self-Healing"
            description="Automatically intercept and recover from failing locators using Xenon's 5-tier strategy."
            hint="When enabled, Xenon will attempt to find elements via Fuzzy XML, OCR, Visual AI, and LLM before failing a test."
          >
            <div className="toggle-group">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={config.enableSelfHealing}
                  onChange={(e) => setConfig({ ...config, enableSelfHealing: e.target.checked })}
                />
                <span className="slider round"></span>
              </label>
              <span className="toggle-label">
                {config.enableSelfHealing ? 'ENABLED' : 'DISABLED'}
              </span>
            </div>
          </SettingCard>
```

- [ ] **Step 2: Verify build**

Run: `cd web && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/settings/settings.tsx
git commit -m "refactor(web): adopt SettingCard in infrastructure settings"
```

---

## Task 8: Migrate ai-settings.tsx

**Files:**
- Modify: `web/src/components/settings/ai-settings.tsx`

- [ ] **Step 1: Read the current ai-settings cards**

Run: `sed -n '196,340p' web/src/components/settings/ai-settings.tsx`

Confirm that Section 1 (Provider Registry, starting line 196) and Section 2 (Runtime Configuration, starting line 260) are the two `.setting-card` blocks to replace. Note any third card lower in the file and include it if present.

- [ ] **Step 2: Add SettingCard import**

In `web/src/components/settings/ai-settings.tsx`, add (in the same import block that uses lucide-react):

```tsx
import { SettingCard } from '../ui/SettingCard';
```

- [ ] **Step 3: Replace Section 1 (Provider Registry)**

Replace the block starting with `<div className="setting-card stagger-1">` and ending at the matching `</div>` (the card's outermost div, currently around line 196–257) with:

```tsx
          <SettingCard
            icon={<ShieldCheck size={16} />}
            title={
              <>
                Provider Registry
                <span className="badge-elite" style={{ marginLeft: 'auto' }}>
                  {configuredCount} / {providers.length} CONFIGURED
                </span>
              </>
            }
            description="Providers are activated via environment variables. Select a configured engine to activate."
          >
            <div className="ai-provider-grid">
              {providers.map((provider) => {
                const isActive = config.aiProvider === provider.id;
                const isSelectable = provider.isConfigured;

                return (
                  <button
                    key={provider.id}
                    className={`ai-provider-card ${isActive ? 'active' : ''} ${!isSelectable ? 'disabled' : ''}`}
                    onClick={() =>
                      isSelectable && setConfig({ ...config, aiProvider: provider.id })
                    }
                    disabled={!isSelectable}
                    title={
                      !isSelectable
                        ? `Set XENON_${provider.id.toUpperCase()}_API_KEY or model/URL to enable`
                        : `Select ${provider.name}`
                    }
                  >
                    <div className="ai-provider-card-header">
                      <div className="ai-provider-icon">{provider.icon}</div>
                      <div className="ai-provider-info">
                        <span className="ai-provider-name">{provider.name}</span>
                        <span className="ai-provider-desc">{provider.description}</span>
                      </div>
                    </div>
                    <div className="ai-provider-status">
                      {isActive ? (
                        <span className="status-badge success-filled">
                          <div className="live-signal" />
                          ACTIVE
                        </span>
                      ) : provider.isConfigured ? (
                        <span className="status-badge success-filled">
                          <div className="live-signal" />
                          READY
                        </span>
                      ) : (
                        <span className="status-badge error-filled">
                          <Lock size={10} />
                          NOT SET
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </SettingCard>
```

- [ ] **Step 4: Replace Section 2 (Runtime Configuration)**

Replace the block starting with `<div className="setting-card stagger-2">` and ending at the matching `</div>` (currently around line 260–303) with:

```tsx
          <SettingCard
            icon={<Globe size={16} />}
            title="Runtime Configuration"
            description="Environmental overrides for AI model endpoints and identifiers."
          >
            <div className="ai-config-display">
              <div className="ai-config-row">
                <span className="ai-config-label">Active Provider</span>
                <span className="ai-config-value">
                  {activeProvider?.icon}
                  {activeProvider?.name || '—'}
                </span>
              </div>
              <div className="ai-config-row">
                <span className="ai-config-label">Model</span>
                <span className="ai-config-value mono">
                  {config.aiProvider === 'gemini' &&
                    (config.geminiModel || config.aiModel || getModelDefault('gemini'))}
                  {config.aiProvider === 'openai' &&
                    (config.openaiModel || config.aiModel || getModelDefault('openai'))}
                  {config.aiProvider === 'anthropic' &&
                    (config.anthropicModel || config.aiModel || getModelDefault('anthropic'))}
                  {config.aiProvider === 'ollama' &&
                    (config.ollamaModel || config.aiModel || getModelDefault('ollama'))}
                  {!config.aiModel &&
                    !config.geminiModel &&
                    !config.openaiModel &&
                    !config.anthropicModel &&
                    !config.ollamaModel && <span className="ai-config-default">default</span>}
                </span>
              </div>
              <div className="ai-config-row">
                <span className="ai-config-label">Base URL</span>
                <span className="ai-config-value mono">
                  {config.aiBaseUrl || getBaseUrlDefault(config.aiProvider)}
                  {!config.aiBaseUrl && <span className="ai-config-default">default</span>}
                </span>
              </div>
            </div>
          </SettingCard>
```

- [ ] **Step 5: Scan for any other .setting-card in ai-settings**

Run: `grep -n 'className="setting-card' web/src/components/settings/ai-settings.tsx`
Expected: empty output. If not empty, migrate any remaining cards using the same pattern before proceeding.

- [ ] **Step 6: Verify build**

Run: `cd web && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/settings/ai-settings.tsx
git commit -m "refactor(web): adopt SettingCard in AI settings"
```

---

## Task 9: CSS cleanup in settings.css

**Files:**
- Modify: `web/src/components/settings/settings.css`

- [ ] **Step 1: Verify no remaining .setting-card consumers in JSX**

Run: `grep -rn 'className="setting-card' web/src/components/settings/`
Expected: empty output. (All three `.tsx` files should now use `<SettingCard>`.)

If not empty: stop and migrate remaining consumers before continuing — deleting the CSS will break them.

- [ ] **Step 2: Delete all `.setting-card*` rules from settings.css**

Open `web/src/components/settings/settings.css` and delete the following rule blocks:

Lines 68–79 (first `.setting-card` definition):

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
```

Lines 81–84:

```css
.setting-card:hover {
    border-color: var(--border-strong);
    background: var(--bg-elevated);
}
```

Lines 184–200 (second `.setting-card` definition and hover):

```css
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

Lines 202–219 (setting-card-header + svg + h4):

```css
.setting-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--accent);
}

.setting-card-header svg {
    flex-shrink: 0;
}

.setting-card h4 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    font-family: 'Outfit', sans-serif;
    color: var(--text-primary);
}
```

Lines 221–226 (`.setting-card p`):

```css
.setting-card p {
    color: var(--text-muted);
    font-size: 0.8rem;
    margin: 0;
    line-height: 1.5;
}
```

Lines 288–294 (first `.setting-hint-clean`):

```css
.setting-hint-clean {
    margin-top: 4px;
    font-size: 0.7rem;
    color: var(--text-subtle);
    font-style: italic;
    padding-left: 2px;
}
```

Lines 533–537 (second `.setting-hint-clean`):

```css
.setting-hint-clean {
    font-size: 0.75rem;
    color: var(--text-subtle);
    margin-top: var(--space-2);
}
```

Lines 750–754 (third `.setting-card` definition in "Premium UX: Obsidian Glassmorphism" section):

```css
.setting-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-default);
    position: relative;
}
```

Lines 757–771 (`.setting-card::after` scanline — now owned by primitive):

```css
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
```

Lines 773–789 (`.setting-card::before` gradient — now owned by primitive):

```css
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

Lines 854–860 (`.section-description-dense` — now renamed under primitive):

```css
.section-description-dense {
    color: var(--text-muted);
    font-size: 0.8rem;
    margin: 0;
    line-height: 1.5;
    max-width: 500px;
}
```

Keep: `.settings-container`, `.settings-header*`, `.settings-title-group`, `.settings-subtitle`, `.badge-elite`, `.settings-content`, `.settings-grid`, `.section-description` (note: different from `-dense`), `.setting-field`, `.setting-input-wrapper*`, `.input-group*`, `.toggle-group`, `.switch`, `.slider`, `.toggle-label`, `.cron-*`, `.preset-chip*`, `.health-monitor-alert`, `.status-banner*`, `.settings-footer*`, `.save-btn*`, `.reset-btn*`, `.reset-to-defaults-btn*`, `.settings-loading`, `.animate-spin`, all AI-provider / AI-config / status-badge / terminal-block / critical-alert rules.

- [ ] **Step 3: Verify no orphan references remain**

Run: `grep -rn "section-description-dense\|setting-hint-clean" web/src`
Expected: empty output.

Run: `grep -n ".setting-card" web/src/components/settings/settings.css`
Expected: empty output.

- [ ] **Step 4: Verify build**

Run: `cd web && npm run build`
Expected: PASS.

- [ ] **Step 5: Run full test suite**

Run: `cd web && npm test`
Expected: all tests pass, including 9 new ones (4 FieldGroup + 5 SettingCard).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/settings/settings.css
git commit -m "refactor(web): remove orphan setting-card CSS rules"
```

---

## Final verification

- [ ] **Step 1: Grep for any remaining markers**

Run these four commands and confirm all return empty:

```bash
grep -rn "section-description-dense" web/src
grep -rn "setting-hint-clean" web/src
grep -rn 'className="setting-card' web/src
grep -rn "reservation-form-group" web/src
```

- [ ] **Step 2: Full test run**

Run: `cd web && npm test`
Expected: all green.

- [ ] **Step 3: Visual smoke test**

Run: `npm run dev` (from repo root) and verify in a browser:

- Reservation modal: three labeled fields render correctly; error state shows under "Reason" when submitting with empty name
- Tag manager modal: "Add New Tag" label + hint visible; input autofocus still works
- Webhook settings: "Webhook URL" label visible above input (new), "Trigger Events" label styled as `.fg-label`
- Maintenance settings: 4 cards render with scanline + border-gradient effects
- Infrastructure settings: 3 cards render, cron-preview + presets still work
- AI settings: Provider Registry and Runtime Configuration cards render

If anything regresses visually, fix before opening the PR.

- [ ] **Step 4: Push branch**

```bash
git push -u origin chore/adopt-field-group-broad
```

Then open PR manually via `https://github.com/Rabindra184/xenon/pull/new/chore/adopt-field-group-broad` (gh CLI is auth'd as a different user).

PR title: `refactor(web): broad FieldGroup + SettingCard adoption`
PR body: summarize primitive additions, call sites migrated, LOC delta, test additions.
