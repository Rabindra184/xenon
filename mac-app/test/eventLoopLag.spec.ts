import { describe, it, expect } from 'vitest';
import { computeLag, isGenuineFreeze, startLagMonitor } from '../src/main/eventLoopLag';

describe('computeLag', () => {
  it('returns null when the timer fires on time', () => {
    expect(computeLag(1000, 1000, 500)).toBeNull();
  });

  it('returns null for jitter under the threshold', () => {
    expect(computeLag(1000, 1200, 500)).toBeNull(); // 200ms late < 500ms
  });

  it('reports the stall when elapsed exceeds interval + threshold', () => {
    expect(computeLag(1000, 4200, 500)).toBe(3200); // 3.2s late
  });

  it('reports exactly at the threshold boundary', () => {
    expect(computeLag(1000, 1500, 500)).toBe(500);
  });

  it('rounds fractional lag', () => {
    expect(computeLag(1000, 1600.7, 500)).toBe(601);
  });
});

describe('isGenuineFreeze', () => {
  // Awake long ago + focused + plausible duration = a real freeze.
  it('accepts a focused, plausible stall with no recent wake', () => {
    expect(isGenuineFreeze({ lagMs: 8000, focused: true, msSinceWake: 120_000 })).toBe(true);
  });

  it('rejects a stall while the window is not focused (App Nap territory)', () => {
    expect(isGenuineFreeze({ lagMs: 8000, focused: false, msSinceWake: 120_000 })).toBe(false);
  });

  it('rejects a stall that spanned a wake/focus transition', () => {
    // The app just came back; the lateness IS the resume, not a freeze.
    expect(isGenuineFreeze({ lagMs: 8000, focused: true, msSinceWake: 5000 })).toBe(false);
  });

  it('rejects an implausibly long stall as suspension, even if focused', () => {
    expect(isGenuineFreeze({ lagMs: 90_000, focused: true, msSinceWake: 999_999 })).toBe(false);
  });

  it('honors a custom plausibility ceiling', () => {
    expect(isGenuineFreeze({ lagMs: 20_000, focused: true, msSinceWake: 999_999, maxPlausibleFreezeMs: 15_000 })).toBe(
      false
    );
  });

  // The actual false positives that flooded diagnostics.log overnight — all
  // multi-minute, all must be rejected regardless of focus/wake state.
  it.each([424460, 910060, 1819104, 256946])('rejects the real-world suspension artifact ~%dms', (lagMs) => {
    expect(isGenuineFreeze({ lagMs, focused: true, msSinceWake: 999_999 })).toBe(false);
  });
});

describe('startLagMonitor', () => {
  it('fires onStall with the measured lag when the heartbeat runs late', () => {
    // Drive the interval and the clock by hand: nominal 1000ms interval, but the
    // clock jumps 5000ms between ticks — a 4000ms stall.
    let tickFn: (() => void) | null = null;
    const times = [0, 5000, 6000]; // now() readings: install, tick1, ...
    let i = 0;
    const stalls: number[] = [];

    const stop = startLagMonitor({
      intervalMs: 1000,
      thresholdMs: 500,
      now: () => times[Math.min(i, times.length - 1)],
      onStall: (lag) => stalls.push(lag),
      schedule: (fn) => {
        tickFn = fn;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clear: () => {
        tickFn = null;
      }
    });

    i = 1; // clock now at 5000
    tickFn?.(); // elapsed 5000 - 0 = 5000 → lag 4000
    expect(stalls).toEqual([4000]);

    stop();
    expect(tickFn).toBeNull();
  });

  it('stays quiet when heartbeats are punctual', () => {
    let tickFn: (() => void) | null = null;
    const times = [0, 1000, 2000];
    let i = 0;
    const stalls: number[] = [];

    startLagMonitor({
      intervalMs: 1000,
      thresholdMs: 500,
      now: () => times[Math.min(i, times.length - 1)],
      onStall: (lag) => stalls.push(lag),
      schedule: (fn) => {
        tickFn = fn;
        return 1 as unknown as ReturnType<typeof setInterval>;
      },
      clear: () => undefined
    });

    i = 1;
    tickFn?.(); // elapsed 1000 → on time
    i = 2;
    tickFn?.(); // elapsed 1000 → on time
    expect(stalls).toEqual([]);
  });
});
