import { describe, expect, it, vi } from 'vitest';
import { toSetupOptions } from '../src/main/setupRequest';
import { tildify } from '../src/shared/paths';
import { makeDefaultProfile } from '../src/shared/profileDefaults';
import type { Profile } from '../src/shared/types';

function profileWithHome(appiumHome: string): Profile {
  const p = makeDefaultProfile({ id: 'p1', now: 1_700_000_000_000 });
  return { ...p, server: { ...p.server, appiumHome } };
}

describe('toSetupOptions', () => {
  it('installs into whatever the shared resolver returns for a blank field', () => {
    const profile = profileWithHome('');
    const resolve = vi.fn(() => '/auto/home');
    expect(toSetupOptions({ profile }, resolve).appiumHome).toBe('/auto/home');
    expect(resolve).toHaveBeenCalledWith(profile);
  });

  it('installs into the resolver result for an explicit field', () => {
    const profile = profileWithHome('/explicit');
    const resolve = vi.fn(() => '/explicit');
    expect(toSetupOptions({ profile }, resolve).appiumHome).toBe('/explicit');
    expect(resolve).toHaveBeenCalledWith(profile);
  });

  it('hands a whitespace-only field to the resolver instead of using it', () => {
    const profile = profileWithHome('   ');
    const resolve = vi.fn(() => '/auto/home');
    expect(toSetupOptions({ profile }, resolve).appiumHome).toBe('/auto/home');
    expect(resolve).toHaveBeenCalledWith(profile);
  });

  it('defaults to the local plugin source and both drivers', () => {
    const opts = toSetupOptions({ profile: profileWithHome('') }, () => '/h');
    expect(opts.pluginSource).toBe('local');
    expect(opts.drivers).toEqual(['uiautomator2', 'xcuitest']);
  });

  it('keeps an explicit plugin source and driver list', () => {
    const opts = toSetupOptions(
      { profile: profileWithHome(''), pluginSource: 'npm', drivers: ['uiautomator2'] },
      () => '/h'
    );
    expect(opts.pluginSource).toBe('npm');
    expect(opts.drivers).toEqual(['uiautomator2']);
  });
});

describe('tildify', () => {
  it('replaces a leading home directory with ~', () => {
    expect(tildify('/Users/qa/.appium', '/Users/qa')).toBe('~/.appium');
  });

  it('leaves paths outside home alone', () => {
    expect(tildify('/opt/x', '/Users/qa')).toBe('/opt/x');
  });

  it('collapses home itself to ~', () => {
    expect(tildify('/Users/qa', '/Users/qa')).toBe('~');
  });

  it('does not treat a sibling that shares the prefix as inside home', () => {
    expect(tildify('/Users/qa2/.appium', '/Users/qa')).toBe('/Users/qa2/.appium');
  });
});
