import { describe, it, expect } from 'vitest';
import { formatDateTime, formatDate } from './time';

describe('formatDateTime', () => {
  it('formats as "MMM d, HH:mm:ss"', () => {
    expect(formatDateTime('2026-07-16T14:45:00')).toBe('Jul 16, 14:45:00');
  });
  it('accepts epoch-millisecond numbers', () => {
    expect(formatDateTime(new Date('2026-07-16T14:45:00').getTime())).toBe('Jul 16, 14:45:00');
  });
  it('returns em dash for nullish/invalid', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
  });
});

describe('formatDate', () => {
  it('formats as "MMM d, yyyy"', () => {
    expect(formatDate('2026-08-15T00:00:00')).toBe('Aug 15, 2026');
  });
  it('returns em dash for nullish/invalid', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });
});
