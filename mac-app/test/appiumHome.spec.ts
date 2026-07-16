import { describe, expect, it } from 'vitest';
import { pickAppiumHome } from '../src/main/toolchainRules';

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
