import { describe, it, expect, beforeEach } from 'vitest';
import { isThemeV2, applyThemeFlag, setThemeV2 } from './theme-flag';

describe('theme-flag (v1.5.0 — always v2)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    document.documentElement.removeAttribute('data-theme');
  });

  it('isThemeV2 always returns true', () => {
    expect(isThemeV2()).toBe(true);
  });

  it('URL param ?themeV2=0 no longer disables v2 (flag removed)', () => {
    window.history.replaceState(null, '', '/?themeV2=0');
    expect(isThemeV2()).toBe(true);
  });

  it('localStorage "off" is ignored (flag removed)', () => {
    window.localStorage.setItem('xenon.themeV2', 'off');
    expect(isThemeV2()).toBe(true);
  });

  it('applyThemeFlag is a no-op', () => {
    applyThemeFlag();
    expect(document.documentElement.getAttribute('data-theme')).toBe(null);
  });

  it('setThemeV2 is a no-op', () => {
    setThemeV2(false);
    expect(isThemeV2()).toBe(true);
  });
});
