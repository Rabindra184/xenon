import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, sanitizePreferences } from '../src/shared/preferences';

describe('sanitizePreferences', () => {
  it('gives the defaults when nothing was stored', () => {
    expect(sanitizePreferences(undefined)).toEqual({ technicalDetails: false, appearance: 'system' });
    expect(sanitizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
  });

  it('gives the defaults for anything that is not an object', () => {
    for (const raw of [null, 'dark', 42, true, ['light']]) {
      expect(sanitizePreferences(raw)).toEqual(DEFAULT_PREFERENCES);
    }
  });

  it('takes the default for each field of the wrong type or value', () => {
    expect(sanitizePreferences({ appearance: 'blue', technicalDetails: 'yes' })).toEqual(DEFAULT_PREFERENCES);
  });

  it('keeps a valid field and defaults the rest', () => {
    expect(sanitizePreferences({ appearance: 'light' })).toEqual({ technicalDetails: false, appearance: 'light' });
    expect(sanitizePreferences({ technicalDetails: true })).toEqual({ technicalDetails: true, appearance: 'system' });
  });

  it('keeps every valid appearance', () => {
    for (const appearance of ['system', 'light', 'dark'] as const) {
      expect(sanitizePreferences({ appearance, technicalDetails: true })).toEqual({ appearance, technicalDetails: true });
    }
  });

  it('drops fields it does not know', () => {
    expect(sanitizePreferences({ appearance: 'dark', zoom: 3 })).toEqual({ technicalDetails: false, appearance: 'dark' });
  });

  it('returns a fresh object, so a caller cannot change the defaults', () => {
    const a = sanitizePreferences(undefined);
    a.appearance = 'dark';
    expect(DEFAULT_PREFERENCES.appearance).toBe('system');
    expect(sanitizePreferences(undefined).appearance).toBe('system');
  });
});
