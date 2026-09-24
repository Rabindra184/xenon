import { useEffect, useState } from 'react';

/** What the user chose. "system" follows the OS light/dark setting. */
export type ThemePreference = 'dark' | 'light' | 'system';
export type Theme = 'dark' | 'light';

// Also read by the inline script in index.html, which applies the theme
// before first paint. Keep the key and the default in step with it.
export const THEME_KEY = 'xenon.theme';
export const DEFAULT_THEME: ThemePreference = 'dark';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

export function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'system' || v === 'dark' ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME; // storage blocked: private window, locked-down browser
  }
}

export function resolveTheme(pref: ThemePreference, systemPrefersLight: boolean): Theme {
  if (pref === 'system') return systemPrefersLight ? 'light' : 'dark';
  return pref;
}

function systemPrefersLight(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(LIGHT_QUERY).matches;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function savePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* not persisted; the choice still applies for this page load */
  }
  applyTheme(resolveTheme(pref, systemPrefersLight()));
}

/**
 * The saved preference plus a setter. While the preference is "system",
 * follows the OS switching light/dark live.
 */
export function useThemePreference(): [ThemePreference, (p: ThemePreference) => void] {
  const [pref, setPref] = useState<ThemePreference>(readPreference);

  useEffect(() => {
    if (pref !== 'system' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(LIGHT_QUERY);
    const onChange = () => applyTheme(resolveTheme('system', mq.matches));
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [pref]);

  const set = (p: ThemePreference) => {
    savePreference(p);
    setPref(p);
  };
  return [pref, set];
}
