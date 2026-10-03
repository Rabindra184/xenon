import { describe, expect, it } from 'vitest';
import { formatCount, formatTime, formatTimeMs } from './logFormat';

describe('logFormat', () => {
  it('writes counts with thousands separators', () => {
    expect(formatCount(2629)).toBe('2,629');
    expect(formatCount(7)).toBe('7');
  });

  it('writes the time to the second, and to the millisecond for details', () => {
    const ts = Date.UTC(2026, 7, 9, 16, 11, 5) + 42;
    expect(formatTime(ts)).toMatch(/^\d\d:\d\d:05$/);
    expect(formatTimeMs(ts)).toMatch(/^\d\d:\d\d:05\.042$/);
  });
});
