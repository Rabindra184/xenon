import { describe, expect, it } from 'vitest';
import {
  filterApps,
  libraryAppsFor,
  libraryNote,
  looksLikePackageId,
  platformNoun,
  uploadAccept,
  type LibraryApp,
} from './appsList';

describe('filterApps', () => {
  const apps = ['com.samsung.notes', 'com.google.docs', 'io.appium.settings'];

  it('sorts, and an empty query returns everything', () => {
    expect(filterApps(apps, '')).toEqual([
      'com.google.docs',
      'com.samsung.notes',
      'io.appium.settings',
    ]);
    expect(filterApps(apps, '   ')).toHaveLength(3);
  });

  it('matches a substring, ignoring case', () => {
    expect(filterApps(apps, 'GOOGLE')).toEqual(['com.google.docs']);
    expect(filterApps(apps, 'set')).toEqual(['io.appium.settings']);
    expect(filterApps(apps, 'nothing')).toEqual([]);
  });
});

describe('looksLikePackageId', () => {
  it('accepts Android packages and iOS bundle ids', () => {
    for (const id of ['com.foo.bar', 'io.appium.settings', 'com.example.my-app', ' com.foo ']) {
      expect(looksLikePackageId(id)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const id of ['foo', 'com foo', '.foo', 'com..foo', '1com.foo', 'com.', '']) {
      expect(looksLikePackageId(id)).toBe(false);
    }
  });
});

describe('libraryAppsFor', () => {
  const lib: LibraryApp[] = [
    { id: 'a', name: 'Shop', platform: 'android' },
    { id: 'i', name: 'Shop', platform: 'ios' },
    { id: 'x', name: 'Other', platform: null },
  ];

  it('gives Android devices Android builds, iOS and tvOS the iOS builds', () => {
    expect(libraryAppsFor(lib, 'android').map((a) => a.id)).toEqual(['a']);
    expect(libraryAppsFor(lib, 'ios').map((a) => a.id)).toEqual(['i']);
    expect(libraryAppsFor(lib, 'tvos').map((a) => a.id)).toEqual(['i']);
    expect(libraryAppsFor(lib, 'windows')).toEqual([]);
  });
});

describe('libraryNote, platformNoun, uploadAccept', () => {
  it('joins what is known', () => {
    expect(libraryNote({ version: '2.1', packageName: 'com.shop' })).toBe('2.1 · com.shop');
    expect(libraryNote({ version: '2.1', packageName: null })).toBe('2.1');
    expect(libraryNote({ version: null, packageName: 'com.shop' })).toBe('com.shop');
    expect(libraryNote({})).toBe('');
  });

  it('names the platform and the files it installs', () => {
    expect(platformNoun('android')).toBe('Android');
    expect(platformNoun('tvos')).toBe('iOS');
    expect(uploadAccept('android')).toBe('.apk');
    expect(uploadAccept('ios')).toBe('.ipa,.app');
  });
});
