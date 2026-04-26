# Health Badges (Design Spec)

**Date:** 2026-04-26
**Scope:** Surface battery and thermal status as colored pill badges on the device-card, replacing the existing verbose `KeyValueRow` displays. Pure frontend.
**Out of scope (deferred):** Tighter polling cadence (separate spec), ping latency badge (separate backend addition), storage-free badge, custom-threshold plugin args.

## Goal

Make device health visible at a glance from the dashboard grid. The data is already collected by `HealthMonitorService` and persisted to `IDevice.batteryLevel` / `IDevice.thermalStatus`; the existing card surfaces it as `Battery: 87%` / `Thermal: Normal` text rows in the metrics block. That text is functional but easy to miss while scanning a wall of cards. Badge pills with semantic colors flag low-battery and overheating devices instantly, which is the original "Live Health" promise from the wishlist.

## Audit findings

- `IDevice` interface (`web/src/interfaces/IDevice.ts`) already declares `batteryLevel?: number` and `thermalStatus?: string`
- `HealthMonitorService` populates them and calls `store.updateDevice(device.udid, device.host, updateData)`
- `device-card.tsx:124–129` already renders both via `KeyValueRow`
- `web/src/components/ui/Pill.tsx` exposes a `tone` prop with values `neutral | accent | ready | busy | reserved | error | offline`. Existing tones map directly to the green/yellow/red urgency states we need — no CSS additions required.

**Implication:** the entire feature is a frontend change — extract a small new component, swap the existing rows, add a tiny CSS rule. No backend, no schema, no new dependency.

## Files Touched

| File | Change |
|---|---|
| `web/src/components/device-card/health-badges.tsx` (NEW) | Single-purpose React component (~50 LOC) that renders the badge row |
| `web/src/components/device-card/device-card/device-card.tsx` | Mount `<HealthBadges device={device}/>` between `dc2-udid` and `dc2-tags`; remove the existing battery/thermal `KeyValueRow`s from `dc2-metrics` |
| `web/src/components/device-card/device-card/device-card.css` | Add `.dc2-health` flex-row rule |

No backend changes. No new npm dependencies. The existing `Pill` and `lucide-react` `Battery`, `BatteryLow`, `BatteryWarning`, `Thermometer` icons cover all the rendering needs.

## Component Contract

```tsx
import { Pill, PillTone } from '../ui/Pill';
import { Battery, BatteryLow, BatteryWarning, Thermometer } from 'lucide-react';
import { IDevice } from '../../interfaces/IDevice';

interface Props {
  device: Pick<IDevice, 'batteryLevel' | 'thermalStatus'>;
}

export const HealthBadges: React.FC<Props> = ({ device }) => { ... };
```

Renders `null` when both values are absent or `thermalStatus === 'Unknown'` and `batteryLevel === undefined`. The card preserves vertical density when health data hasn't arrived yet (same pattern as the existing `dc2-tags` row, which only renders when there are tags).

## Tone Mapping

### Battery — `batteryLevel: number`

| Range | Tone | Icon |
|---|---|---|
| ≥ 50% | `ready` | `Battery` |
| 20–49% | `reserved` | `BatteryLow` |
| < 20% | `error` | `BatteryWarning` |

- Label: `"{batteryLevel}%"`, e.g. `"87%"`.
- Tooltip (`title` prop): `"Battery {batteryLevel}%"`.
- If `batteryLevel === undefined`, the battery pill is not rendered.
- Boundaries are inclusive on the lower bound and exclusive on the upper: `>=50` → green, `>=20 && <50` → yellow, `<20` → red.

### Thermal — `thermalStatus: string`

| Value (case-sensitive) | Tone | Icon |
|---|---|---|
| `"Normal"` | `ready` | `Thermometer` |
| `"Critical"` | `error` | `Thermometer` |
| any other non-empty value (`"Warm"`, `"Hot"`, `"Fair"`, `"Serious"`, …) | `reserved` | `Thermometer` |
| `"Unknown"` or absent / empty string | not rendered | — |

- Label: the literal value (e.g. `"Normal"`, `"Critical"`).
- Tooltip: `"Thermal: {thermalStatus}"`.

## Layout

```
┌─────────────────────────────────┐
│ ANDROID · 14         [BUSY]     │  dc2-header   (unchanged)
├─────────────────────────────────┤
│ Pixel 7 Pro                     │  dc2-name     (unchanged)
│ 8A1B…F3D2                       │  dc2-udid     (unchanged)
│ 🔋 87%   🌡 Normal              │  dc2-health   (NEW)
│ [team] [tag1] [tag2]            │  dc2-tags     (unchanged, follows health)
│ ┌─ dc2-metrics ─────────────┐   │
│ │ SID · abc123              │   │  battery/thermal rows REMOVED
│ │ Host: 1.2.3.4             │   │  Reservation/Session/Utilization/Host stay
│ └───────────────────────────┘   │
│ [Take Control]                  │  dc2-actions  (unchanged)
└─────────────────────────────────┘
```

CSS additions (only this rule, in `device-card.css`):

```css
.dc2-health {
  display: flex;
  gap: 6px;
  margin-top: 4px;
  flex-wrap: wrap;
}
```

`flex-wrap: wrap` so a future third badge (e.g., ping when added) doesn't break narrow layouts.

## What This Spec Does NOT Change

- `HealthMonitorService` cadence — still defaults to 24h. The "live" feel of badges is bottlenecked by that interval; that's a deliberate scope cut and tracked as a separate spec.
- Backend health-check pipeline, device manager interfaces, `IDevice` schema
- The `KeyValueRow` primitive (other rows still use it)
- The `Pill` primitive — just consuming it; no API or CSS changes
- Card header, status pill, action buttons, banners (Reservation/Session/SID), Host row in metrics
- The conditional render of `dc2-metrics` rows other than battery/thermal — Reservation/Session/Utilization and Host stay intact

## Testing

### Manual smoke (required)

1. `npm run dev`
2. Open dashboard, view the device grid
3. For each connected device, confirm:
   - Battery pill renders with the correct color tier and percentage label
   - Thermal pill renders with the correct color tier and label
   - Tooltips show the full value
   - No layout regression in the rest of the card

### Unit (cheap, recommended)

Snapshot-style test of `<HealthBadges>` rendering. Four cases:
1. Both absent → returns null
2. Battery 87, no thermal → green battery pill only
3. Battery 15, thermal `"Critical"` → red battery pill + red thermal pill
4. Battery 35, thermal `"Hot"` → yellow battery pill + yellow thermal pill

Each case asserts the rendered DOM contains the expected pill class (`pill-ready` / `pill-reserved` / `pill-error`).

## Acceptance Criteria

1. On every visible device card with `batteryLevel` populated, a battery pill renders with the correct tone per the threshold table.
2. On every visible device card with `thermalStatus` populated and not `"Unknown"`, a thermal pill renders with the correct tone per the value table.
3. Cards with no health data show no `.dc2-health` row (no empty pills, no extra vertical space).
4. The existing `dc2-metrics` block no longer contains Battery / Thermal rows but still shows Reservation / Session / Utilization / Host as before.
5. No new TypeScript errors and `npm run build:xenon` produces a clean build.

## Implementation Phases

For the writing-plans skill to expand:

1. Create `health-badges.tsx` with all rendering logic and the four unit-test snapshots.
2. Mount it in `device-card.tsx`, remove the existing rows from `dc2-metrics`.
3. Add the `.dc2-health` CSS rule.
4. Manual smoke test in browser.

Each phase is a single mergeable commit.

## Risk Assessment

- **Likelihood of breaking existing functionality:** very low. The only removal is two `KeyValueRow` lines whose data is being relocated, not deleted. No shared component is modified.
- **Visual regression on dense card grids:** low — the new row adds ~22px of vertical space on cards that have health data, but those cards previously also showed two `KeyValueRow`s in `dc2-metrics`. Net height is roughly the same or slightly less.
- **Tooltip / accessibility:** `Pill` already supports `title`, which natively gives a hover tooltip and is read by screen readers via the `title` attribute. No additional ARIA work needed.
