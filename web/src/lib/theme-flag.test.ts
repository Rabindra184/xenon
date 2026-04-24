import { describe, it, expect, beforeEach } from 'vitest';
import { isThemeV2, applyThemeFlag, setThemeV2 } from './theme-flag';

describe('theme-flag', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Reset URL search without reload
    window.history.replaceState(null, '', '/');
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to v2 when no override set', () => {
    expect(isThemeV2()).toBe(true);
  });

  it('URL param ?themeV2=0 forces off', () => {
    window.history.replaceState(null, '', '/?themeV2=0');
    expect(isThemeV2()).toBe(false);
  });

  it('URL param ?themeV2=1 forces on', () => {
    window.history.replaceState(null, '', '/?themeV2=1');
    expect(isThemeV2()).toBe(true);
  });

  it('localStorage "off" turns it off', () => {
    window.localStorage.setItem('xenon.themeV2', 'off');
    expect(isThemeV2()).toBe(false);
  });

  it('URL param wins over localStorage', () => {
    window.localStorage.setItem('xenon.themeV2', 'off');
    window.history.replaceState(null, '', '/?themeV2=1');
    expect(isThemeV2()).toBe(true);
  });

  it('applyThemeFlag sets data-theme="v2" when enabled', () => {
    applyThemeFlag();
    expect(document.documentElement.getAttribute('data-theme')).toBe('v2');
  });

  it('applyThemeFlag sets data-theme="v1" when disabled', () => {
    window.localStorage.setItem('xenon.themeV2', 'off');
    applyThemeFlag();
    expect(document.documentElement.getAttribute('data-theme')).toBe('v1');
  });

  it('setThemeV2 persists to localStorage and reapplies', () => {
    setThemeV2(false);
    expect(window.localStorage.getItem('xenon.themeV2')).toBe('off');
    expect(document.documentElement.getAttribute('data-theme')).toBe('v1');
    setThemeV2(true);
    expect(window.localStorage.getItem('xenon.themeV2')).toBe('on');
    expect(document.documentElement.getAttribute('data-theme')).toBe('v2');
  });
});
