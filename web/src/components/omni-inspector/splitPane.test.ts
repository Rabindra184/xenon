import { describe, expect, it } from 'vitest';
import {
  clampSplit,
  DEFAULT_SPLIT,
  loadSplit,
  saveSplit,
  SPLIT_KEY,
  splitLimits,
} from './splitPane';

const store = (value: string | null) => {
  const saved: Record<string, string> = {};
  return {
    saved,
    getItem: () => value,
    setItem: (k: string, v: string) => {
      saved[k] = v;
    },
  };
};
const throwing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('split limits', () => {
  it('keeps 240 px for the tree and 340 px for the details', () => {
    const { min, max } = splitLimits(828);
    expect(min * 828).toBeCloseTo(240);
    expect((1 - max) * 828).toBeCloseTo(340);
    expect(clampSplit(0.1, 828)).toBeCloseTo(min);
    expect(clampSplit(0.9, 828)).toBeCloseTo(max);
    expect(clampSplit(0.4, 828)).toBe(0.4);
  });

  it('gives the tree its minimum when the row is too narrow for both', () => {
    expect(clampSplit(0.4, 500) * 500).toBeCloseTo(240);
    expect(splitLimits(500).max).toBeCloseTo(splitLimits(500).min);
  });

  it('clamps nothing before the width is known, and repairs junk', () => {
    expect(splitLimits(0)).toEqual({ min: 0, max: 1 });
    expect(clampSplit(0.7, 0)).toBe(0.7);
    expect(clampSplit(Number.NaN, 828)).toBe(DEFAULT_SPLIT);
  });
});

describe('split persistence', () => {
  it('reads a stored share and falls back to 0.4 on anything else', () => {
    expect(loadSplit(store('0.55'))).toBe(0.55);
    for (const v of [null, 'abc', '0', '1', '1.5', '-0.2']) expect(loadSplit(store(v))).toBe(0.4);
    expect(loadSplit(throwing)).toBe(0.4);
    expect(loadSplit(null)).toBe(0.4);
  });

  it('writes the share, and ignores storage that throws', () => {
    const s = store(null);
    saveSplit(s, 0.4567);
    expect(s.saved[SPLIT_KEY]).toBe('0.457');
    expect(() => saveSplit(throwing, 0.5)).not.toThrow();
  });
});
