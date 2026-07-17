import { describe, it, expect, vi } from 'vitest';
import { LogBatcher } from '../src/main/logBatcher';

/** A hand-driven scheduler so we control exactly when the flush timer fires. */
function fakeClock() {
  let pending: (() => void) | null = null;
  return {
    schedule: (fn: () => void) => {
      pending = fn;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: () => {
      pending = null;
    },
    tick: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
    hasPending: () => pending !== null
  };
}

describe('LogBatcher', () => {
  it('coalesces items until the flush timer fires', () => {
    const clock = fakeClock();
    const batches: number[][] = [];
    const b = new LogBatcher<number>({
      flushMs: 100,
      maxBatch: 1000,
      onFlush: (batch) => batches.push(batch),
      schedule: clock.schedule,
      cancel: clock.cancel
    });

    b.push(1);
    b.push(2);
    b.push(3);
    expect(batches).toEqual([]); // nothing emitted before the timer fires

    clock.tick();
    expect(batches).toEqual([[1, 2, 3]]); // one send for all three lines
  });

  it('flushes immediately when maxBatch is reached, without waiting', () => {
    const clock = fakeClock();
    const batches: number[][] = [];
    const b = new LogBatcher<number>({
      flushMs: 100,
      maxBatch: 3,
      onFlush: (batch) => batches.push(batch),
      schedule: clock.schedule,
      cancel: clock.cancel
    });

    b.push(1);
    b.push(2);
    expect(batches).toEqual([]);
    b.push(3); // hits the cap
    expect(batches).toEqual([[1, 2, 3]]);
    expect(clock.hasPending()).toBe(false); // pending timer was cancelled
  });

  it('starts a fresh window after a size-triggered flush', () => {
    const clock = fakeClock();
    const batches: number[][] = [];
    const b = new LogBatcher<number>({
      flushMs: 100,
      maxBatch: 2,
      onFlush: (batch) => batches.push(batch),
      schedule: clock.schedule,
      cancel: clock.cancel
    });

    b.push(1);
    b.push(2); // flush [1,2]
    b.push(3); // begins a new window
    clock.tick();
    expect(batches).toEqual([[1, 2], [3]]);
  });

  it('flush() is a no-op when the buffer is empty', () => {
    const batches: number[][] = [];
    const b = new LogBatcher<number>({ flushMs: 100, maxBatch: 10, onFlush: (x) => batches.push(x) });
    b.flush();
    expect(batches).toEqual([]);
  });

  it('flush() emits buffered items immediately and clears the pending timer', () => {
    const clock = fakeClock();
    const batches: number[][] = [];
    const b = new LogBatcher<number>({
      flushMs: 100,
      maxBatch: 10,
      onFlush: (batch) => batches.push(batch),
      schedule: clock.schedule,
      cancel: clock.cancel
    });

    b.push(1);
    b.flush();
    expect(batches).toEqual([[1]]);
    expect(clock.hasPending()).toBe(false);
    clock.tick(); // stray tick must not double-emit
    expect(batches).toEqual([[1]]);
  });

  it('dispose() drops buffered items and cancels the timer', () => {
    const clock = fakeClock();
    const batches: number[][] = [];
    const b = new LogBatcher<number>({
      flushMs: 100,
      maxBatch: 10,
      onFlush: (batch) => batches.push(batch),
      schedule: clock.schedule,
      cancel: clock.cancel
    });

    b.push(1);
    b.dispose();
    clock.tick();
    expect(batches).toEqual([]);
    expect(clock.hasPending()).toBe(false);
  });
});
