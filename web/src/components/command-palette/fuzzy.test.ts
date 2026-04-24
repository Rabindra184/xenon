import { describe, it, expect } from 'vitest';
import { fuzzyScore } from './fuzzy';

describe('fuzzyScore', () => {
  it('returns 0 when no match', () => {
    expect(fuzzyScore('xyz', 'hello world')).toBe(0);
  });

  it('returns > 0 when every char appears in order', () => {
    expect(fuzzyScore('hw', 'hello world')).toBeGreaterThan(0);
  });

  it('prefix match outscores mid-string match', () => {
    expect(fuzzyScore('set', 'settings')).toBeGreaterThan(fuzzyScore('set', 'resetter'));
  });

  it('is case insensitive', () => {
    expect(fuzzyScore('IPH', 'iphone 15 pro')).toBeGreaterThan(0);
  });

  it('exact match beats prefix match', () => {
    expect(fuzzyScore('iphone', 'iphone')).toBeGreaterThan(fuzzyScore('iphone', 'iphone 15'));
  });

  it('shorter prefix-target beats longer prefix-target', () => {
    expect(fuzzyScore('set', 'set')).toBeGreaterThan(fuzzyScore('set', 'settings'));
    expect(fuzzyScore('set', 'settings')).toBeGreaterThan(fuzzyScore('set', 'settings-extra'));
  });

  it('empty query returns 0', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  it('out-of-order query chars return 0', () => {
    expect(fuzzyScore('wh', 'hello world')).toBe(0);
  });
});
