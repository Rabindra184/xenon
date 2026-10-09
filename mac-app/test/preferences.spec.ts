import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, mergePreferences, sanitizePreferences, type Preferences } from '../src/shared/preferences';

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

describe('mergePreferences', () => {
  const current: Preferences = { technicalDetails: true, appearance: 'light' };

  it('keeps the current appearance when the patch field is undefined', () => {
    expect(mergePreferences(current, { appearance: undefined })).toEqual(current);
  });

  it('keeps the current appearance when the patch value is not one of the three', () => {
    expect(mergePreferences(current, { appearance: 'blue' as unknown as Preferences['appearance'] })).toEqual(current);
  });

  it('sets a valid appearance', () => {
    expect(mergePreferences(current, { appearance: 'dark' })).toEqual({ technicalDetails: true, appearance: 'dark' });
  });

  it('keeps the current technicalDetails when the patch value is not a boolean', () => {
    expect(mergePreferences(current, { technicalDetails: 'yes' as unknown as boolean })).toEqual(current);
    expect(mergePreferences(current, { technicalDetails: undefined })).toEqual(current);
  });

  it('sets technicalDetails to false as well as to true', () => {
    expect(mergePreferences(current, { technicalDetails: false })).toEqual({ technicalDetails: false, appearance: 'light' });
  });

  it('changes only the fields the patch names', () => {
    expect(mergePreferences(current, {})).toEqual(current);
    expect(mergePreferences(current, { appearance: 'system' })).toEqual({ technicalDetails: true, appearance: 'system' });
  });

  it('drops keys it does not know', () => {
    const merged = mergePreferences(current, { appearance: 'dark', zoom: 3 } as unknown as Partial<Preferences>);
    expect(merged).toEqual({ technicalDetails: true, appearance: 'dark' });
    expect(Object.keys(merged).sort()).toEqual(['appearance', 'technicalDetails']);
  });

  it('copes with a patch that is not an object', () => {
    for (const patch of [null, undefined, 'dark', 42]) {
      expect(mergePreferences(current, patch as unknown as Partial<Preferences>)).toEqual(current);
    }
  });

  it('returns a fresh object, so a caller cannot change the current one', () => {
    const merged = mergePreferences(current, {});
    merged.appearance = 'dark';
    expect(current.appearance).toBe('light');
  });
});
