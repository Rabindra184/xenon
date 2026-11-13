import { describe, expect, it } from 'vitest';
import {
  isLibraryFiltered,
  libraryFiltersToParams,
  libraryQuery,
  NO_LIBRARY_FILTERS,
  parseLibraryFilters,
  phoneChoiceOf,
  phoneFacetValue,
  withPhoneChoice,
} from './libraryFilters';

describe('library filters', () => {
  it('reads and writes the link', () => {
    const f = parseLibraryFilters(new URLSearchParams('phone=U1&by=unknown&when=7d&q=pay'));
    expect(f).toEqual({ phone: 'U1', host: '', by: 'unknown', when: '7d', q: 'pay' });
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
    expect(libraryQuery({ phone: 'U1', host: '', by: '', when: '24h', q: ' pay ' }, now)).toEqual({
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

  // Two servers can have a phone of one udid: the menu then lists each, and
  // the link and the query carry the chosen one's host beside the udid.
  it("carries a phone's host with its udid, in the link and the query", () => {
    const H = 'http://10.0.0.2:4723';
    const f = parseLibraryFilters(
      new URLSearchParams(`phone=emulator-5554&host=${encodeURIComponent(H)}`),
    );
    expect(f).toEqual({ ...NO_LIBRARY_FILTERS, phone: 'emulator-5554', host: H });
    expect(libraryFiltersToParams(f).get('host')).toBe(H);
    expect(libraryQuery(f, 0)).toMatchObject({ udid: 'emulator-5554', host: H });
    // A host with no phone means nothing.
    const hostOnly = { ...NO_LIBRARY_FILTERS, host: H };
    expect(libraryFiltersToParams(hostOnly).toString()).toBe('');
    expect(libraryQuery(hostOnly, 0).host).toBeUndefined();
  });

  it('gives each phone facet a value of its own, and reads the choice back', () => {
    const H1 = 'http://10.0.0.1:4723';
    const H2 = 'http://10.0.0.2:4723';
    const phones = [
      { udid: 'emulator-5554', host: H1, name: 'Pixel 8 (http://10.0.0.1:4723)', count: 1 },
      { udid: 'emulator-5554', host: H2, name: 'Pixel 8 (http://10.0.0.2:4723)', count: 2 },
      { udid: 'U2', name: 'iPhone 17', count: 1 },
    ];
    const values = phones.map(phoneFacetValue);
    expect(new Set(values).size).toBe(3);
    expect(values[2]).toBe('U2');

    const picked = withPhoneChoice(NO_LIBRARY_FILTERS, values[1], phones);
    expect(picked).toMatchObject({ phone: 'emulator-5554', host: H2 });
    expect(phoneChoiceOf(picked)).toBe(values[1]);

    const single = withPhoneChoice(picked, 'U2', phones);
    expect(single).toMatchObject({ phone: 'U2', host: '' });
    expect(phoneChoiceOf(single)).toBe('U2');
    expect(withPhoneChoice(picked, '', phones)).toMatchObject({ phone: '', host: '' });
  });
});
