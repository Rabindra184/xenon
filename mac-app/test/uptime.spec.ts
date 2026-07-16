import { describe, expect, it } from 'vitest';
import { formatUptime } from '../src/renderer/src/serverStatus';

describe('formatUptime', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatUptime(5_000)).toBe('5s');
    expect(formatUptime(65_000)).toBe('1m 5s');
    expect(formatUptime(3_720_000)).toBe('1h 2m');
  });

  it('clamps negative deltas to zero', () => {
    expect(formatUptime(-100)).toBe('0s');
  });
});
