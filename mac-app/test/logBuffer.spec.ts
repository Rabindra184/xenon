import { describe, expect, it } from 'vitest';
import { LOG_BUFFER_LIMIT, appendCapped, withLiveLines, withSeed } from '../src/renderer/src/logBuffer';

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

// R67: the window starts from main's lines (the seed) and then takes main's batches as they come.
// Both carry main's ids. The seed is main's lines when it answered; a batch sent before that answer
// arrives before it, one sent after arrives after, and a batch can hold lines the seed has too.
const ids = (lines: Array<{ id: number }>) => lines.map((l) => l.id);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => line(from + i));

describe('withLiveLines', () => {
  it('appends a batch of new lines in order', () => {
    expect(ids(withLiveLines(range(1, 3), range(4, 6), 10))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('skips the lines it already has (a batch that overlaps the seed), with no gap', () => {
    // Main had pushed 8–10 when it answered the seed, but sent them in a batch after: 8–12 arrive.
    expect(ids(withLiveLines(range(1, 10), range(8, 12), 100))).toEqual(range(1, 12).map((l) => l.id));
  });

  it('returns the same array when every line of the batch is already there', () => {
    const prev = range(1, 5);
    expect(withLiveLines(prev, range(3, 5), 10)).toBe(prev);
    expect(withLiveLines(prev, [], 10)).toBe(prev);
  });

  it('drops the oldest beyond the cap, and keeps the surviving lines as they were', () => {
    const prev = range(1, 3);
    const next = withLiveLines(prev, range(4, 5), 3);
    expect(ids(next)).toEqual([3, 4, 5]);
    expect(next[0]).toBe(prev[2]);
  });
});

describe('withSeed', () => {
  it('starts from main’s lines when nothing came before them', () => {
    expect(ids(withSeed([], range(1, 5), 0, 100))).toEqual([1, 2, 3, 4, 5]);
  });

  it('takes a batch that raced ahead of the seed: no line twice, none missing, in main’s order', () => {
    // A batch with 8–10 came in before the seed's answer, which has 1–10.
    const racing = withLiveLines([], range(8, 10), 100);
    const seeded = withSeed(racing, range(1, 10), 0, 100);
    expect(ids(seeded)).toEqual(range(1, 10).map((l) => l.id));
    // The batch's own lines are kept as they were (their rows stay drawn).
    expect(seeded[7]).toBe(racing[0]);
    // And the batch after the seed, overlapping it, adds only what is new.
    expect(ids(withLiveLines(seeded, range(9, 12), 100))).toEqual(range(1, 12).map((l) => l.id));
  });

  it('leaves out what the window cleared before the seed came back', () => {
    // The window cleared through 10 while main's answer, made before the clear, was on its way.
    expect(ids(withSeed([], range(1, 12), 10, 100))).toEqual([11, 12]);
    expect(withSeed([], range(1, 10), 10, 100)).toEqual([]);
  });

  it('keeps main’s newest lines up to the cap', () => {
    expect(ids(withSeed(range(9, 10), range(1, 8), 0, 4))).toEqual([7, 8, 9, 10]);
  });

  it('returns the same array when the seed adds nothing', () => {
    const prev = range(1, 3);
    expect(withSeed(prev, range(1, 3), 0, 10)).toBe(prev);
    expect(withSeed(prev, [], 0, 10)).toBe(prev);
  });
});
