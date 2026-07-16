import { describe, expect, it } from 'vitest';
import { LOG_BUFFER_LIMIT, appendCapped } from '../src/renderer/src/logBuffer';

const line = (id: number) => ({ id, ts: 0, stream: 'stdout' as const, text: `line ${id}` });

describe('appendCapped', () => {
  it('appends a batch in order', () => {
    expect(appendCapped([line(1)], [line(2), line(3)], 10).map((l) => l.id)).toEqual([1, 2, 3]);
  });

  it('drops the oldest lines beyond the cap', () => {
    const prev = [line(1), line(2), line(3)];
    expect(appendCapped(prev, [line(4)], 3).map((l) => l.id)).toEqual([2, 3, 4]);
  });

  it('keeps only the newest when a single batch exceeds the cap', () => {
    const batch = [line(1), line(2), line(3), line(4), line(5)];
    expect(appendCapped([], batch, 2).map((l) => l.id)).toEqual([4, 5]);
  });

  it('returns the same array reference for an empty batch (no needless re-render)', () => {
    const prev = [line(1)];
    expect(appendCapped(prev, [], 10)).toBe(prev);
  });

  it('preserves line identity so memoised rows are not invalidated', () => {
    const a = line(1);
    const prev = [a];
    const next = appendCapped(prev, [line(2)], 10);
    expect(next[0]).toBe(a); // same object, not a copy
  });

  it('has a sane default cap', () => {
    expect(LOG_BUFFER_LIMIT).toBeGreaterThanOrEqual(1000);
  });
});
