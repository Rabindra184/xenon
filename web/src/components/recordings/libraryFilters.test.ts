import { describe, expect, it } from 'vitest';
import {
  isLibraryFiltered,
  libraryFiltersToParams,
  libraryQuery,
  NO_LIBRARY_FILTERS,
  parseLibraryFilters,
} from './libraryFilters';

describe('library filters', () => {
  it('reads and writes the link', () => {
    const f = parseLibraryFilters(new URLSearchParams('phone=U1&by=unknown&when=7d&q=pay'));
    expect(f).toEqual({ phone: 'U1', by: 'unknown', when: '7d', q: 'pay' });
    expect(libraryFiltersToParams(f).toString()).toBe('phone=U1&by=unknown&when=7d&q=pay');
    expect(parseLibraryFilters(new URLSearchParams('when=forever'))).toEqual(NO_LIBRARY_FILTERS);
    expect(libraryFiltersToParams(NO_LIBRARY_FILTERS).toString()).toBe('');
  });

  it('knows when anything is filtered', () => {
    expect(isLibraryFiltered(NO_LIBRARY_FILTERS)).toBe(false);
    expect(isLibraryFiltered({ ...NO_LIBRARY_FILTERS, q: '  ' })).toBe(false);
    expect(isLibraryFiltered({ ...NO_LIBRARY_FILTERS, when: '24h' })).toBe(true);
  });

  it('builds the server query, with When as a start time', () => {
    const now = Date.parse('2026-09-27T12:00:00.000Z');
    expect(libraryQuery({ phone: 'U1', by: '', when: '24h', q: ' pay ' }, now)).toEqual({
      udid: 'U1',
      startedBy: undefined,
      since: '2026-09-26T12:00:00.000Z',
      q: 'pay',
    });
    expect(libraryQuery(NO_LIBRARY_FILTERS, now)).toEqual({
      udid: undefined,
      startedBy: undefined,
      since: undefined,
      q: undefined,
    });
  });
});
