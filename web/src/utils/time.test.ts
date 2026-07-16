import { describe, it, expect } from 'vitest';
import { formatDateTime } from './time';

describe('formatDateTime', () => {
  it('formats as "MMM d, HH:mm:ss"', () => {
    expect(formatDateTime('2026-07-16T14:45:00')).toBe('Jul 16, 14:45:00');
  });
  it('returns em dash for nullish/invalid', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
  });
});
