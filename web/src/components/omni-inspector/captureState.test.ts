import { describe, expect, it } from 'vitest';
import { captureAge, isStale } from './captureState';

const T = 1_700_000_000_000;

describe('captureAge', () => {
  it('reads like a person would say it', () => {
    expect(captureAge(T, T + 2_000)).toBe('Captured just now');
    expect(captureAge(T, T + 12_000)).toBe('Captured 12 s ago');
    expect(captureAge(T, T + 3 * 60_000 + 5_000)).toBe('Captured 3 min ago');
    expect(captureAge(T, T + 2 * 3_600_000)).toBe('Captured 2 h ago');
  });

  it('never goes negative when clocks disagree', () => {
    expect(captureAge(T, T - 5_000)).toBe('Captured just now');
  });
});

// The tree, highlights and locators describe the screen at capture time; a
// tap or swipe after that may have changed it.
describe('isStale', () => {
  it('is stale once an input reached the phone after the capture', () => {
    expect(isStale(T, T + 1)).toBe(true);
    expect(isStale(T, T)).toBe(false);
    expect(isStale(T, T - 1)).toBe(false);
  });

  it('is never stale without a capture', () => {
    expect(isStale(0, T)).toBe(false);
  });
});
