import { describe, expect, it } from 'vitest';
import { retryEachFrame } from '../src/renderer/src/retryEachFrame';

/** A frame clock driven by hand: `tick()` runs what was asked for on the next frame. */
function frames() {
  let next = 1;
  const queued = new Map<number, () => void>();
  return {
    request: (cb: () => void) => {
      const id = next++;
      queued.set(id, cb);
      return id;
    },
    cancel: (id: number) => void queued.delete(id),
    tick() {
      const due = [...queued.values()];
      queued.clear();
      due.forEach((cb) => cb());
    },
    get waiting() {
      return queued.size;
    }
  };
}

describe('retryEachFrame', () => {
  it('tries at once, and stops when the first try works', () => {
    const clock = frames();
    let calls = 0;
    retryEachFrame(() => ++calls === 1, 10, clock);
    expect(calls).toBe(1);
    expect(clock.waiting).toBe(0);
  });

  it('tries again on each frame until it works', () => {
    const clock = frames();
    let calls = 0;
    retryEachFrame(() => ++calls === 3, 10, clock);
    expect(calls).toBe(1);
    clock.tick();
    expect(calls).toBe(2);
    clock.tick();
    expect(calls).toBe(3);
    clock.tick();
    expect(calls).toBe(3);
    expect(clock.waiting).toBe(0);
  });

  it('gives up after the given number of tries', () => {
    const clock = frames();
    let calls = 0;
    retryEachFrame(() => (calls++, false), 4, clock);
    for (let i = 0; i < 10; i++) clock.tick();
    expect(calls).toBe(4);
  });

  it('stops when cancelled', () => {
    const clock = frames();
    let calls = 0;
    const cancel = retryEachFrame(() => (calls++, false), 10, clock);
    clock.tick();
    cancel();
    clock.tick();
    clock.tick();
    expect(calls).toBe(2);
    expect(clock.waiting).toBe(0);
  });
});
