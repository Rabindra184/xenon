import { describe, expect, it } from 'vitest';
import { LINKS, linkUrl } from '../src/shared/links';

describe('LINKS', () => {
  it('has the install guide', () => {
    expect(LINKS.install).toBe('https://xenon-6e6.pages.dev/docs/xenon-control#what-you-need');
  });

  it('has the steps to reinstall Xenon when its iPhone support is missing', () => {
    expect(LINKS.reinstall).toBe('https://xenon-6e6.pages.dev/docs/xenon-control#when-iphone-support-is-missing');
  });

  it('holds only https addresses', () => {
    for (const url of Object.values(LINKS)) expect(url.startsWith('https://')).toBe(true);
  });
});

describe('linkUrl', () => {
  it('gives the address of a known name', () => {
    expect(linkUrl('install')).toBe(LINKS.install);
    expect(linkUrl('reinstall')).toBe(LINKS.reinstall);
  });

  it('gives null for anything else, including names every object has', () => {
    for (const name of ['', 'nope', 'Install', 'toString', 'constructor', '__proto__', 'hasOwnProperty', 'https://example.com']) {
      expect(linkUrl(name)).toBeNull();
    }
    for (const notAName of [undefined, null, 1, {}, ['install'], true]) {
      expect(linkUrl(notAName)).toBeNull();
    }
  });
});
