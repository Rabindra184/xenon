import { useCallback, useEffect, useState } from 'react';

/**
 * Whether the sidebar shows labels (expanded, 208px) or icons only (the
 * 56px rail). It can expand only from WIDE up: at 1440 an expanded sidebar
 * leaves pages 1232px, more than the rail leaves them at 1280 (1224), so no
 * page gets less room than it already had. Below 1440 it is always the rail.
 * The user's choice is remembered; with no choice it is expanded when wide.
 *
 * The inline script in index.html applies it before first paint. Keep the
 * key, the width and the rule in step with it.
 */
export const SIDEBAR_KEY = 'xenon.sidebar';
export const SIDEBAR_WIDE = 1440;

type Preference = 'expanded' | 'collapsed' | null;

function readPreference(): Preference {
  try {
    const v = localStorage.getItem(SIDEBAR_KEY);
    return v === 'expanded' || v === 'collapsed' ? v : null;
  } catch {
    return null;
  }
}

function savePreference(p: 'expanded' | 'collapsed'): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, p);
  } catch {
    /* not persisted; the choice still applies for this page load */
  }
}

export function sidebarExpanded(viewportWidth: number, pref: Preference): boolean {
  return viewportWidth >= SIDEBAR_WIDE && pref !== 'collapsed';
}

/** `--sidebar-width` follows this attribute (index.css). */
function apply(expanded: boolean): void {
  document.documentElement.setAttribute('data-sidebar', expanded ? 'expanded' : 'rail');
}

/**
 * The sidebar's state, kept on <html data-sidebar>. `canExpand` is false
 * below WIDE, where there is no toggle.
 */
export function useSidebar(): { expanded: boolean; canExpand: boolean; toggle: () => void } {
  const [width, setWidth] = useState(() => window.innerWidth);
  const [pref, setPref] = useState<Preference>(readPreference);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const expanded = sidebarExpanded(width, pref);
  useEffect(() => {
    apply(expanded);
    // Pages that size themselves from the window (device control's canvas)
    // measure again on resize; the sidebar changing width is one for them.
    window.dispatchEvent(new Event('xenon:sidebar'));
  }, [expanded]);

  const toggle = useCallback(() => {
    const next = expanded ? 'collapsed' : 'expanded';
    savePreference(next);
    setPref(next);
  }, [expanded]);

  return { expanded, canExpand: width >= SIDEBAR_WIDE, toggle };
}

/** The sidebar's current width in px, for code that sizes against the window. */
export function sidebarWidth(): number {
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'),
  );
  return Number.isFinite(v) ? v : 56;
}
