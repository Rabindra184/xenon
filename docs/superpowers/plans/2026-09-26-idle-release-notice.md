# Idle release notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Live Devices, pause the idle timeout during a recording, and after an automatic release show a lasting banner with Restore.

**Architecture:** The rules live in a pure module, `idleRestore.ts`: `idleWatchEnabled`, `planRestore`, `releaseMessage` and `restoreMessage`. A small `IdleReleaseBanner` component renders the notice. `DeviceMosaicView` wires them in:

- the idle hook's `enabled` flag;
- a snapshot of the tiles on timeout;
- one `addDevice` path shared by the device list and Restore.

**Tech Stack:** React 17, TypeScript, Vitest + Testing Library.

Spec: `docs/superpowers/specs/2026-09-26-idle-release-notice-design.md`.

## Global Constraints

- The banner appears only after the automatic timeout, never after **Release now**.
- The banner uses a neutral style (`--surface-2`, `--border`, `--text`), not the green `info` tone. Tokens only: the colour-literal ratchet must pass.
- Restore goes through the same add path as clicking a device in the list (`ADD_TILE` + `XenonApiService.startStream`, and a 409 removes the tile).
- No server changes. Explicit `git add` paths. Branch `feat/idle-release-notice` (it holds the spec commit).

---

### Task 1: The rules — `idleRestore.ts`

**Files:**
- Create: `web/src/components/mosaic/idleRestore.ts`
- Test: `web/src/components/mosaic/idleRestore.test.ts`

**Interfaces:**
- Produces:
  - `interface RestoreDevice { udid: string; name?: string; busy?: boolean; session_id?: string | null; offline?: boolean }`
  - `type SkipReason = 'in_use' | 'offline' | 'gone'`
  - `idleWatchEnabled(tileCount: number, recordingPhase: string): boolean`
  - `planRestore<D extends RestoreDevice>(saved: { udid: string; name?: string }[], devices: D[], myUserId: string | null): { restore: D[]; skipped: { name: string; reason: SkipReason }[] }`
  - `releaseMessage(count: number, minutes: number): string`
  - `restoreMessage(restored: number, skipped: { name: string; reason: SkipReason }[]): string | null`

- [ ] **Step 1: Write the failing tests** — `idleRestore.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { idleWatchEnabled, planRestore, releaseMessage, restoreMessage } from './idleRestore';

describe('idleWatchEnabled', () => {
  it('watches when devices are open and nothing is recording', () => {
    expect(idleWatchEnabled(1, 'idle')).toBe(true);
  });
  // The release stopped the streams under a recording: measured, the whole
  // 38 s recording came back FAILED, 28 bytes.
  it('never watches during a recording', () => {
    for (const phase of ['starting', 'recording', 'stopping']) {
      expect(idleWatchEnabled(2, phase)).toBe(false);
    }
  });
  it('does not watch an empty grid', () => {
    expect(idleWatchEnabled(0, 'idle')).toBe(false);
  });
});

describe('planRestore', () => {
  const saved = [
    { udid: 'A', name: 'Galaxy S9+' },
    { udid: 'B', name: 'Pixel 8 Pro' },
    { udid: 'C', name: 'iPad Air' },
    { udid: 'D', name: 'moto g54' },
    { udid: 'E', name: 'Galaxy Tab' },
  ];
  const devices = [
    { udid: 'E', name: 'Galaxy Tab', busy: false, offline: false },
    { udid: 'A', name: 'Galaxy S9+', busy: false, offline: false },
    { udid: 'B', name: 'Pixel 8 Pro', busy: true, session_id: 'manual_u42_B' },
    { udid: 'C', name: 'iPad Air', busy: false, offline: true },
  ];

  it('restores free devices in the saved order, and skips the rest with a reason', () => {
    const plan = planRestore(saved, devices, 'me');
    expect(plan.restore.map((d) => d.udid)).toEqual(['A', 'E']);
    expect(plan.skipped).toEqual([
      { name: 'Pixel 8 Pro', reason: 'in_use' },
      { name: 'iPad Air', reason: 'offline' },
      { name: 'moto g54', reason: 'gone' },
    ]);
  });

  it('restores a device still held by your own lock', () => {
    const plan = planRestore(
      [{ udid: 'A', name: 'Galaxy S9+' }],
      [{ udid: 'A', name: 'Galaxy S9+', busy: true, session_id: 'manual_me_A' }],
      'me',
    );
    expect(plan.restore.map((d) => d.udid)).toEqual(['A']);
  });

  it('skips a device running a test session', () => {
    const plan = planRestore(
      [{ udid: 'A', name: 'Galaxy S9+' }],
      [{ udid: 'A', busy: true, session_id: '8f2c1a9e' }],
      'me',
    );
    expect(plan.skipped).toEqual([{ name: 'Galaxy S9+', reason: 'in_use' }]);
  });
});

describe('messages', () => {
  it('says how many devices were released and why', () => {
    expect(releaseMessage(1, 5)).toBe('Released 1 device after 5 minutes without activity.');
    expect(releaseMessage(2, 5)).toBe('Released 2 devices after 5 minutes without activity.');
  });

  it('has nothing to say when everything came back', () => {
    expect(restoreMessage(2, [])).toBe(null);
  });

  it('names what could not come back', () => {
    expect(
      restoreMessage(1, [
        { name: 'Pixel 8 Pro', reason: 'in_use' },
        { name: 'iPad Air', reason: 'offline' },
        { name: 'moto g54', reason: 'gone' },
      ]),
    ).toBe(
      'Restored 1 device. Pixel 8 Pro is now in use by someone else. iPad Air is offline. moto g54 is no longer connected.',
    );
    expect(restoreMessage(0, [{ name: 'Pixel 8 Pro', reason: 'in_use' }])).toBe(
      'No devices restored. Pixel 8 Pro is now in use by someone else.',
    );
  });
});
```

- [ ] **Step 2: Run them:** `cd web && npx vitest run src/components/mosaic/idleRestore.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement** — `idleRestore.ts`:

```ts
import { isSelfManualLock } from './manual-lock';

export interface RestoreDevice {
  udid: string;
  name?: string;
  busy?: boolean;
  session_id?: string | null;
  offline?: boolean;
}

export type SkipReason = 'in_use' | 'offline' | 'gone';

/**
 * Whether the idle timeout should run. Never during a recording: its release
 * stops the streams the recording reads from, and the recording is lost
 * (measured: FAILED, 28 bytes for 38 s).
 */
export function idleWatchEnabled(tileCount: number, recordingPhase: string): boolean {
  return tileCount > 0 && recordingPhase === 'idle';
}

/** Which released devices can come back, in their old order, and why the rest can't. */
export function planRestore<D extends RestoreDevice>(
  saved: { udid: string; name?: string }[],
  devices: D[],
  myUserId: string | null,
): { restore: D[]; skipped: { name: string; reason: SkipReason }[] } {
  const restore: D[] = [];
  const skipped: { name: string; reason: SkipReason }[] = [];
  for (const tile of saved) {
    const d = devices.find((x) => x.udid === tile.udid);
    const name = d?.name || tile.name || tile.udid;
    if (!d) skipped.push({ name, reason: 'gone' });
    else if (d.offline) skipped.push({ name, reason: 'offline' });
    else if (d.busy && !isSelfManualLock(d.session_id, d.udid, myUserId)) {
      skipped.push({ name, reason: 'in_use' });
    } else restore.push(d);
  }
  return { restore, skipped };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function releaseMessage(count: number, minutes: number): string {
  return `Released ${plural(count, 'device')} after ${minutes} minutes without activity.`;
}

const SKIP_TEXT: Record<SkipReason, string> = {
  in_use: 'is now in use by someone else.',
  offline: 'is offline.',
  gone: 'is no longer connected.',
};

/** Null when everything came back (the banner closes). */
export function restoreMessage(
  restored: number,
  skipped: { name: string; reason: SkipReason }[],
): string | null {
  if (skipped.length === 0) return null;
  const head = restored > 0 ? `Restored ${plural(restored, 'device')}.` : 'No devices restored.';
  return [head, ...skipped.map((s) => `${s.name} ${SKIP_TEXT[s.reason]}`)].join(' ');
}
```

- [ ] **Step 4: Run them:** Expected: PASS.
- [ ] **Step 5: Commit:** `git add web/src/components/mosaic/idleRestore.ts web/src/components/mosaic/idleRestore.test.ts && git commit -m "feat(mosaic): rules for pausing the idle timeout and restoring released devices"`

### Task 2: `IdleReleaseBanner`

**Files:**
- Create: `web/src/components/mosaic/IdleReleaseBanner.tsx`
- Test: `web/src/components/mosaic/IdleReleaseBanner.test.tsx`

**Interfaces:**
- Produces: `IdleReleaseBanner({ message, onRestore?, onDismiss }: { message: string; onRestore?: () => void; onDismiss: () => void })`

- [ ] **Step 1: Write the failing tests:**

```tsx
import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IdleReleaseBanner } from './IdleReleaseBanner';

describe('IdleReleaseBanner', () => {
  it('says what happened and offers Restore and Dismiss', () => {
    const onRestore = vi.fn();
    const onDismiss = vi.fn();
    render(<IdleReleaseBanner message="Released 1 device." onRestore={onRestore} onDismiss={onDismiss} />);
    expect(screen.getByRole('status')).toHaveTextContent('Released 1 device.');
    fireEvent.click(screen.getByRole('button', { name: 'Restore devices' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('offers only Dismiss after a partial restore', () => {
    render(<IdleReleaseBanner message="Restored 1 device." onDismiss={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Restore devices' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them:** Expected: FAIL (module missing).
- [ ] **Step 3: Implement:**

```tsx
import * as React from 'react';
import { Clock } from 'lucide-react';
import { Button } from '../ui/button';

interface Props {
  message: string;
  /** Offered right after a release; absent after a partial restore. */
  onRestore?: () => void;
  onDismiss: () => void;
}

/**
 * Stays until dismissed: the person it's for was away when the release
 * happened, so a toast would already be gone. Neutral, not the green `info`
 * banner, which would read as good news.
 */
export function IdleReleaseBanner({ message, onRestore, onDismiss }: Props) {
  return (
    <div
      role="status"
      className="text-sm rounded border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] px-3 py-2 flex items-center gap-2"
    >
      <Clock aria-hidden size={14} className="shrink-0 text-[var(--text-dim)]" />
      <span className="flex-1">{message}</span>
      {onRestore && (
        <Button variant="tonal" size="sm" onClick={onRestore}>
          Restore devices
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run them:** Expected: PASS.
- [ ] **Step 5: Commit:** `git add web/src/components/mosaic/IdleReleaseBanner.tsx web/src/components/mosaic/IdleReleaseBanner.test.tsx && git commit -m "feat(mosaic): banner for devices released while idle"`

### Task 3: Wire it into `DeviceMosaicView`

**Files:**
- Modify: `web/src/components/mosaic/DeviceMosaicView.tsx`

**Interfaces:**
- Consumes:
  - `idleWatchEnabled`, `planRestore`, `releaseMessage` and `restoreMessage` (Task 1);
  - `IdleReleaseBanner` (Task 2).

- [ ] **Step 1: Share the add path.** In `onTogglePickerRow`, move the lines from `dispatch({ type: 'ADD_TILE', … })` through the conflict rollback into a new function above it, and call `await addDevice(device);` in their place:

```tsx
  // One add path for the device list and Restore: optimistic tile, pre-warmed
  // stream, and a rollback only on a genuine ownership conflict (409).
  const addDevice = async (device: DeviceRow) => {
    dispatch({ type: 'ADD_TILE', tile: tileFromDevice(device) });
    const started = await XenonApiService.startStream(device.udid).catch(() => null);
    if (isDeviceConflictBody(started)) {
      dispatch({ type: 'REMOVE_TILE', udid: device.udid });
    }
  };
```

Keep the existing explanatory comment above the `startStream` line.

- [ ] **Step 2: Add the notice state and handlers** (after `releaseAll`):

```tsx
  // After an automatic release: what to say, and the tiles Restore can bring
  // back (null once Restore has run).
  const [idleNotice, setIdleNotice] = useState<{
    message: string;
    tiles: MosaicTile[] | null;
  } | null>(null);

  const onRestoreReleased = async () => {
    const saved = idleNotice?.tiles;
    if (!saved) return;
    const plan = planRestore(saved, devices, myUserId);
    for (const d of plan.restore) await addDevice(d);
    const note = restoreMessage(plan.restore.length, plan.skipped);
    setIdleNotice(note ? { message: note, tiles: null } : null);
    setRefreshKey((k) => k + 1);
  };
```

- [ ] **Step 3: Pause during recordings and save on timeout.** Replace the `useIdleDetector` options' `enabled` and `onTimeout`:

```tsx
    // Never during a recording: the release stops the streams it reads from.
    enabled: idleWatchEnabled(state.tiles.length, state.recordingPhase),
    …
    onTimeout: () => {
      const released = state.tiles;
      releaseAll();
      setIdleNotice({
        message: releaseMessage(released.length, IDLE_TOTAL_MS / 60_000),
        tiles: released,
      });
    },
```

`IdleWarningModal`'s `onReleaseNow={releaseAll}` stays as it is: a chosen release shows no banner.

- [ ] **Step 4: Render the banner** directly after the `{state.banner && ( … )}` block:

```tsx
        {idleNotice && (
          <IdleReleaseBanner
            message={idleNotice.message}
            onRestore={idleNotice.tiles && !state.recording ? onRestoreReleased : undefined}
            onDismiss={() => setIdleNotice(null)}
          />
        )}
```

Import `MosaicTile` (type) from `./recording-group-store`, the four helpers from `./idleRestore`, and `IdleReleaseBanner`.

- [ ] **Step 5: Type-check and test:** `npx tsc --noEmit -p . && npx vitest run src/components/mosaic/`. Expected: clean, all PASS.
- [ ] **Step 6: Commit:** `git commit -m "feat(mosaic): pause the idle timeout while recording; notice + Restore after a release"` (explicit path).

### Task 4: Verify live and open the PR

- [ ] **Step 1: Run the checks:**
  - web suite, `tsc`;
  - per-file lint against `origin/main`;
  - `npm run build:xenon && npm run build:copy`.
- [ ] **Step 2: Recording survives idleness.** In the Browser pane, add the S9+, press Record, and touch nothing for 6 minutes. Then:
  - no warning dialog appeared (poll the DOM for `role="dialog"` every 10 s);
  - press Stop (a DOM click); the response lists the recording as `STOPPED` with `sizeBytes > 1 MB`.
- [ ] **Step 3: The notice after an automatic release.** Leave the page idle for 5.5 minutes. Expected:
  - the warning dialog appears at about 4.5 minutes, then the tile is removed;
  - the banner reads "Released 1 device after 5 minutes without activity.";
  - the server log shows `stream/stop`.
- [ ] **Step 4: Restore.** Click **Restore devices**. Expected:
  - the tile returns and goes live;
  - `session_id` is `manual_<me>_381103b720057ece` again;
  - the banner closes.
- [ ] **Step 5:** Screenshot the banner in dark and light. Push and open the PR with the evidence.
