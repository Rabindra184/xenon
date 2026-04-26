# Health Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface battery and thermal status as colored Pill badges in a new `.dc2-health` row on the device-card, replacing the existing verbose `KeyValueRow` displays inside `.dc2-metrics`.

**Architecture:** Pure frontend change. Extract a small new `HealthBadges` component, mount it between `dc2-udid` and `dc2-tags`, remove the two stale `KeyValueRow`s from `dc2-metrics`, add one CSS rule for the new row. No backend, no schema, no new dependency.

**Tech Stack:** React 17, TypeScript, vitest + @testing-library/react, lucide-react icons (`Battery`, `BatteryLow`, `BatteryWarning`, `Thermometer`), existing `Pill` primitive.

**Spec:** `docs/superpowers/specs/2026-04-26-health-badges-design.md`

---

## File Structure

| File | Purpose |
|---|---|
| `web/src/components/device-card/health-badges.tsx` | NEW — pure component that turns `device.batteryLevel` + `device.thermalStatus` into 0–2 colored `Pill`s. ~50 LOC. |
| `web/src/components/device-card/health-badges.test.tsx` | NEW — vitest snapshot-style coverage of the four interesting cases. |
| `web/src/components/device-card/device-card/device-card.tsx` | MODIFIED — mount `<HealthBadges>` between `dc2-udid` and `dc2-tags`; remove the existing battery/thermal `KeyValueRow`s from `dc2-metrics`. |
| `web/src/components/device-card/device-card/device-card.css` | MODIFIED — add `.dc2-health` flex-row rule. |

No backend changes. No new npm dependencies.

---

## Conventions (read first)

- **Branch:** all work goes on `feat/health-badges` (already created and checked out by brainstorming).
- **Commits:** Conventional Commits — `feat(device-card): ...`, `test(device-card): ...`.
- **Test runner:** vitest. Run a single file: `cd web && npx vitest run src/components/device-card/health-badges.test.tsx`.
- **Build check after JSX edit:** `npm run build:xenon` — Vite must produce a clean build.
- **Type-check during work:** `cd web && npx tsc --noEmit`. Pre-existing project-wide errors are acceptable; only fail a task if a NEW error mentions a file we touched.
- **Never bypass hooks** with `--no-verify`.

---

## Task 1: Create `HealthBadges` component (TDD)

**Files:**
- Create: `web/src/components/device-card/health-badges.tsx`
- Create: `web/src/components/device-card/health-badges.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/components/device-card/health-badges.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HealthBadges } from './health-badges';

describe('HealthBadges', () => {
  it('returns null when both values are absent', () => {
    const { container } = render(<HealthBadges device={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when only thermalStatus is "Unknown"', () => {
    const { container } = render(
      <HealthBadges device={{ thermalStatus: 'Unknown' }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a green battery pill when battery is healthy', () => {
    const { container } = render(<HealthBadges device={{ batteryLevel: 87 }} />);
    const pills = container.querySelectorAll('.pill');
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveClass('pill-ready');
    expect(pills[0].textContent).toContain('87%');
  });

  it('renders a yellow battery pill when battery is in the warning range', () => {
    const { container } = render(<HealthBadges device={{ batteryLevel: 35 }} />);
    const pills = container.querySelectorAll('.pill');
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveClass('pill-reserved');
  });

  it('renders a red battery pill when battery is critical', () => {
    const { container } = render(<HealthBadges device={{ batteryLevel: 12 }} />);
    const pills = container.querySelectorAll('.pill');
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveClass('pill-error');
  });

  it('renders a green thermal pill when thermalStatus is Normal', () => {
    const { container } = render(
      <HealthBadges device={{ thermalStatus: 'Normal' }} />,
    );
    const pills = container.querySelectorAll('.pill');
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveClass('pill-ready');
    expect(pills[0].textContent).toContain('Normal');
  });

  it('renders a red thermal pill when thermalStatus is Critical', () => {
    const { container } = render(
      <HealthBadges device={{ thermalStatus: 'Critical' }} />,
    );
    const pills = container.querySelectorAll('.pill');
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveClass('pill-error');
  });

  it('renders a yellow thermal pill for any other non-empty value', () => {
    const { container } = render(
      <HealthBadges device={{ thermalStatus: 'Hot' }} />,
    );
    const pills = container.querySelectorAll('.pill');
    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveClass('pill-reserved');
  });

  it('renders both pills when both values are present', () => {
    const { container } = render(
      <HealthBadges device={{ batteryLevel: 15, thermalStatus: 'Critical' }} />,
    );
    const pills = container.querySelectorAll('.pill');
    expect(pills).toHaveLength(2);
    expect(pills[0]).toHaveClass('pill-error');
    expect(pills[1]).toHaveClass('pill-error');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/device-card/health-badges.test.tsx`
Expected: every test fails with `Cannot find module './health-badges'`.

- [ ] **Step 3: Implement the component**

```tsx
// web/src/components/device-card/health-badges.tsx
import * as React from 'react';
import { Battery, BatteryLow, BatteryWarning, Thermometer } from 'lucide-react';
import { Pill, PillTone } from '../ui/Pill';
import { IDevice } from '../../interfaces/IDevice';

interface Props {
  device: Pick<IDevice, 'batteryLevel' | 'thermalStatus'>;
}

function batteryTone(level: number): PillTone {
  if (level >= 50) return 'ready';
  if (level >= 20) return 'reserved';
  return 'error';
}

function batteryIcon(level: number): React.ReactNode {
  if (level >= 50) return <Battery size={10} />;
  if (level >= 20) return <BatteryLow size={10} />;
  return <BatteryWarning size={10} />;
}

function thermalTone(status: string): PillTone {
  if (status === 'Normal') return 'ready';
  if (status === 'Critical') return 'error';
  return 'reserved';
}

export const HealthBadges: React.FC<Props> = ({ device }) => {
  const showBattery = typeof device.batteryLevel === 'number';
  const showThermal =
    typeof device.thermalStatus === 'string' &&
    device.thermalStatus.length > 0 &&
    device.thermalStatus !== 'Unknown';

  if (!showBattery && !showThermal) return null;

  return (
    <div className="dc2-health">
      {showBattery && (
        <Pill
          tone={batteryTone(device.batteryLevel as number)}
          title={`Battery ${device.batteryLevel}%`}
        >
          {batteryIcon(device.batteryLevel as number)}
          {device.batteryLevel}%
        </Pill>
      )}
      {showThermal && (
        <Pill
          tone={thermalTone(device.thermalStatus as string)}
          title={`Thermal: ${device.thermalStatus}`}
        >
          <Thermometer size={10} />
          {device.thermalStatus}
        </Pill>
      )}
    </div>
  );
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/device-card/health-badges.test.tsx`
Expected: 9 passing.

- [ ] **Step 5: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no errors mentioning `health-badges.tsx` or `health-badges.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/device-card/health-badges.tsx web/src/components/device-card/health-badges.test.tsx
git commit -m "feat(device-card): add HealthBadges component"
```

---

## Task 2: Add CSS for the new health row

**Files:**
- Modify: `web/src/components/device-card/device-card/device-card.css`

- [ ] **Step 1: Locate the existing card-related CSS**

The file already contains rules for `.dc2`, `.dc2-header`, `.dc2-name`, `.dc2-tags`, `.dc2-metrics`, etc. We add the new `.dc2-health` rule at the bottom of the file (or alongside `.dc2-tags` if that grouping is preferred). Either location is fine — the rule has no specificity conflicts.

- [ ] **Step 2: Append the rule**

Open `web/src/components/device-card/device-card/device-card.css` and append:

```css
.dc2-health {
  display: flex;
  gap: 6px;
  margin-top: 4px;
  flex-wrap: wrap;
}
```

- [ ] **Step 3: Verify the build is clean**

Run: `npm run build:xenon`
Expected: clean build, no Vite warnings about the new CSS rule.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/device-card/device-card/device-card.css
git commit -m "feat(device-card): add .dc2-health row layout"
```

---

## Task 3: Mount `HealthBadges` and remove the stale rows

**Files:**
- Modify: `web/src/components/device-card/device-card/device-card.tsx`

- [ ] **Step 1: Add the import**

Open `device-card.tsx`. Find the existing imports for sibling components (e.g., `import { KeyValueRow } from '../../ui/KeyValueRow';` and similar). Add:

```tsx
import { HealthBadges } from '../health-badges';
```

- [ ] **Step 2: Mount `<HealthBadges>` between `dc2-udid` and `dc2-tags`**

Find this block (around line 80–85):

```tsx
<div className="dc2-udid" title={device.udid}>
  {middleEllipsis(device.udid)}
</div>

{(device.teamId || (device.tags && device.tags.length > 0)) && (
  <div className="dc2-tags">
```

Insert `<HealthBadges device={device} />` between the closing `</div>` of `dc2-udid` and the opening `(device.teamId || ...) && (`:

```tsx
<div className="dc2-udid" title={device.udid}>
  {middleEllipsis(device.udid)}
</div>

<HealthBadges device={device} />

{(device.teamId || (device.tags && device.tags.length > 0)) && (
  <div className="dc2-tags">
```

- [ ] **Step 3: Remove the stale battery/thermal rows from `dc2-metrics`**

Find this block (around line 124–129):

```tsx
{typeof device.batteryLevel === 'number' && (
  <KeyValueRow label="Battery" value={`${device.batteryLevel}%`} />
)}
{device.thermalStatus && device.thermalStatus !== 'Unknown' && (
  <KeyValueRow label="Thermal" value={device.thermalStatus} />
)}
```

Delete it. The two surrounding lines (the Reservation/Session/Utilization branch above, and the `<KeyValueRow label="Host" ... />` below) stay intact.

After this edit, the `dc2-metrics` block reads:

```tsx
<div className="dc2-metrics">
  {reserved ? (
    <div className="dc2-banner dc2-banner-reserved">
      ...
    </div>
  ) : device.session_id ? (
    <div className="dc2-banner dc2-banner-session">
      ...
    </div>
  ) : (
    <KeyValueRow
      label="Utilization"
      value={prettyMilliseconds(device.totalUtilizationTimeMilliSec || 0, { compact: true })}
    />
  )}
  <KeyValueRow label="Host" value={device.ip || device.host} mono />
</div>
```

- [ ] **Step 4: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: no NEW errors mentioning `device-card.tsx`. (Pre-existing project-wide errors unrelated to this branch are acceptable.)

- [ ] **Step 5: Build the frontend**

Run: `npm run build:xenon`
Expected:
```
✓ built in <N>s
🔄 Syncing build artifacts...
✅ Xenon build complete.
```

- [ ] **Step 6: Commit**

```bash
git add web/src/components/device-card/device-card/device-card.tsx
git commit -m "feat(device-card): mount HealthBadges and remove stale rows"
```

---

## Task 4: Manual smoke test

**Prerequisites:** At least one connected device or simulator visible to Xenon.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: `[Xenon] Dashboard available at: /xenon/`

- [ ] **Step 2: Open the dashboard and view the device grid**

Open http://127.0.0.1:4723/xenon/, log in. The device grid is the home view.

- [ ] **Step 3: Verify badges render correctly**

For each visible card with a populated `batteryLevel` and/or `thermalStatus`:
- The new `.dc2-health` row appears between the UDID and the tags row
- Battery pill: pill text matches `<level>%`, color is green / yellow / red per the threshold (≥50 / 20–49 / <20)
- Thermal pill: pill text matches the literal status string, color matches the value mapping (Normal=green, Critical=red, anything else=yellow)
- Hovering each pill shows the full tooltip (`Battery 87%` / `Thermal: Normal`)

- [ ] **Step 4: Verify cards with no health data**

For any card whose device hasn't been health-checked yet (battery + thermal both absent), confirm the `.dc2-health` row is NOT rendered — the layout should compress instead of showing an empty row.

- [ ] **Step 5: Verify the old rows are gone**

Open a card and check the metrics block at the bottom. It should show: `Reservation` / `Session` / `Utilization` (whichever applies) and `Host`. **No** `Battery` or `Thermal` rows should appear there.

- [ ] **Step 6: Regression sanity-check**

- Click "Take Control" on a card — device-control view opens normally.
- Header (platform · SDK + status pill) renders unchanged.
- Tags row (when present) renders unchanged.
- Reservation banner / Session banner render unchanged when applicable.

- [ ] **Step 7: Stop the dev server**

Ctrl-C in the terminal running `npm run dev`.

---

## Task 5: Push branch and open draft PR

- [ ] **Step 1: Push the branch**

Run: `git push -u origin feat/health-badges`

- [ ] **Step 2: Open the draft PR**

```bash
gh pr create --draft --title "feat(device-card): replace verbose health rows with colored badges" --body "$(cat <<'EOF'
## Summary

Replaces the existing `Battery: 87%` / `Thermal: Normal` text rows in the device-card metrics block with colored `Pill` badges in a new `.dc2-health` row, positioned between the UDID and the tags row for at-a-glance visibility.

## Tone mapping

- **Battery:** ≥50% → green (ready), 20–49% → yellow (reserved), <20% → red (error)
- **Thermal:** `Normal` → green, `Critical` → red, anything else → yellow; `Unknown` / absent → not rendered

## What did NOT change

- `HealthMonitorService` (still polls every 24h by default — separate spec)
- `IDevice` schema, backend health pipeline
- `Pill`, `KeyValueRow` primitives
- Card header, status pill, action buttons, banners (Reservation/Session/SID)
- Other rows in the metrics block (Reservation/Session/Utilization, Host)

## Test plan

- [x] 9 unit tests on `<HealthBadges>` covering empty, battery-only, thermal-only, and combined cases
- [x] `npm run build:xenon` clean
- [x] Browser-verified: badges render with correct colors and tooltips, layout compresses cleanly when health data is absent
- [ ] Reviewer pulls and confirms badge colors match expected thresholds on a real device

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: After review, mark the PR ready**

Run: `gh pr ready <PR-NUMBER>` (number printed by step 2).

---

## Spec Coverage Check

| Spec section | Covered by task |
|---|---|
| Goal — colored pill badges in a new row | Task 1 (component), Task 3 (mount) |
| Files Touched table | Task 1 (component + test), Task 2 (CSS), Task 3 (card) |
| Component contract | Task 1 step 3 (matches the spec's contract verbatim) |
| Battery tone mapping (≥50, 20–49, <20) | Task 1 step 1 (3 tests), Task 1 step 3 (`batteryTone`) |
| Thermal tone mapping (Normal / Critical / other) | Task 1 step 1 (3 tests), Task 1 step 3 (`thermalTone`) |
| Returns null when both values absent | Task 1 step 1 test 1, Task 1 step 3 (`if (!showBattery && !showThermal) return null;`) |
| `Unknown` thermal not rendered | Task 1 step 1 test 2, Task 1 step 3 (`!== 'Unknown'`) |
| Layout (between udid and tags) | Task 3 step 2 |
| `.dc2-health` CSS | Task 2 |
| Existing `dc2-metrics` rows preserved (Reservation/Session/Utilization/Host) | Task 3 step 3 (only the battery/thermal block removed) |
| Acceptance criterion 1 (battery pill renders correctly) | Task 4 step 3 |
| Acceptance criterion 2 (thermal pill renders correctly) | Task 4 step 3 |
| Acceptance criterion 3 (no row when no data) | Task 4 step 4 |
| Acceptance criterion 4 (`dc2-metrics` no longer has battery/thermal) | Task 4 step 5 |
| Acceptance criterion 5 (clean TS + build) | Task 1 step 5, Task 3 steps 4–5 |
