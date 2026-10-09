import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { resolveAppiumHome, resolvedAppiumHomeInfo } from '../src/main/appiumHome';
import { pickAppiumHome } from '../src/main/toolchainRules';
import { expandHome, tildify } from '../src/shared/paths';
import type { Profile } from '../src/shared/types';

// paths.ts (pulled in by appiumHome) asks Electron for folders at import time.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

const FALLBACK = '/app/managed/appium-home';

const candidates = [
  { path: '/from/shell/env', hasPlugin: false, source: 'env' as const },
  { path: '/app/managed/appium-home', hasPlugin: false, source: 'app-managed' as const },
  { path: '/Users/me/.appium', hasPlugin: true, source: 'convention' as const }
];

describe('pickAppiumHome', () => {
  it('always honours an explicit profile override', () => {
    expect(pickAppiumHome({ override: '/explicit/home', candidates, fallback: FALLBACK })).toEqual({
      path: '/explicit/home',
      source: 'profile'
    });
  });

  it('ignores a blank override', () => {
    expect(pickAppiumHome({ override: '   ', candidates, fallback: FALLBACK }).source).toBe('convention');
  });

  it('picks the first candidate that actually has the plugin', () => {
    expect(pickAppiumHome({ candidates, fallback: FALLBACK })).toEqual({
      path: '/Users/me/.appium',
      source: 'convention'
    });
  });

  it('prefers an earlier candidate when several have the plugin', () => {
    const many = [
      { path: '/from/shell/env', hasPlugin: true, source: 'env' as const },
      { path: '/Users/me/.appium', hasPlugin: true, source: 'convention' as const }
    ];
    expect(pickAppiumHome({ candidates: many, fallback: FALLBACK }).path).toBe('/from/shell/env');
  });

  it('falls back to the app-managed home when nothing has the plugin', () => {
    const none = candidates.map((c) => ({ ...c, hasPlugin: false }));
    expect(pickAppiumHome({ candidates: none, fallback: FALLBACK })).toEqual({
      path: FALLBACK,
      source: 'fallback'
    });
  });

  it('falls back when there are no candidates at all', () => {
    expect(pickAppiumHome({ candidates: [], fallback: FALLBACK }).path).toBe(FALLBACK);
  });
});

describe('expandHome', () => {
  it('turns a leading ~/ into the home folder', () => {
    expect(expandHome('~/.appium', '/Users/qa')).toBe('/Users/qa/.appium');
    expect(expandHome('~/a/b', '/Users/qa/')).toBe('/Users/qa/a/b');
  });

  it('turns a bare ~ into the home folder', () => {
    expect(expandHome('~', '/Users/qa')).toBe('/Users/qa');
  });

  it('leaves everything else as it was', () => {
    expect(expandHome('/opt/appium', '/Users/qa')).toBe('/opt/appium');
    expect(expandHome('rel/path', '/Users/qa')).toBe('rel/path');
    expect(expandHome('/x/~/y', '/Users/qa')).toBe('/x/~/y');
    expect(expandHome('~other/.appium', '/Users/qa')).toBe('~other/.appium');
  });

  it('does nothing without a home folder to expand to', () => {
    expect(expandHome('~/.appium', '')).toBe('~/.appium');
  });

  it('undoes tildify', () => {
    for (const p of ['/Users/qa/.appium', '/Users/qa']) {
      expect(expandHome(tildify(p, '/Users/qa'), '/Users/qa')).toBe(p);
    }
  });
});

describe('a typed folder in the profile', () => {
  const withHome = (appiumHome: string): Profile => ({ server: { appiumHome } }) as unknown as Profile;
  const home = os.homedir();

  it('is used as typed when it is a full path', () => {
    expect(resolveAppiumHome(withHome('/opt/appium'))).toBe('/opt/appium');
    expect(resolvedAppiumHomeInfo(withHome('/opt/appium'))).toEqual({ path: '/opt/appium', source: 'profile' });
  });

  it('reads a leading ~/ as the home folder, as the Health card shows it', () => {
    expect(resolveAppiumHome(withHome('~/.appium'))).toBe(`${home}/.appium`);
    expect(resolvedAppiumHomeInfo(withHome('~/.appium'))).toEqual({ path: `${home}/.appium`, source: 'profile' });
  });

  it('reads a bare ~ as the home folder', () => {
    expect(resolveAppiumHome(withHome('~'))).toBe(home);
  });

  it('ignores the spaces around it', () => {
    expect(resolveAppiumHome(withHome('  ~/.appium  '))).toBe(`${home}/.appium`);
  });
});
