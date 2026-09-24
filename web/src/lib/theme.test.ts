import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme, readPreference, resolveTheme, savePreference, THEME_KEY } from './theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.setAttribute('data-theme', 'dark');
  });

  it('defaults to dark, so nobody changes theme on upgrade without choosing', () => {
    expect(readPreference()).toBe('dark');
  });

  it('ignores a garbage stored value', () => {
    localStorage.setItem(THEME_KEY, 'purple');
    expect(readPreference()).toBe('dark');
  });

  it('resolves "system" from the OS setting', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('saving applies the theme to <html> and persists it', () => {
    savePreference('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
