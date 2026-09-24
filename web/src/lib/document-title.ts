import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const APP = 'Xenon';

// Same words as the sidebar, so a tab reads like the nav item that opened it.
const EXACT: Record<string, string> = {
  '/overview': 'Overview',
  '/devices': 'Devices',
  '/devices/live': 'Live devices',
  '/apps': 'Apps',
  '/builds': 'Sessions',
  '/selector-health': 'Selector health',
  '/selector-health/detail': 'Selector health',
  '/notifications': 'Notifications',
  '/settings': 'Settings',
  '/ai-settings': 'AI engine',
  '/maintenance': 'Maintenance',
  '/teams': 'Teams',
  '/users': 'Users',
  '/api-keys': 'API keys',
  '/profile': 'Profile',
  '/login': 'Sign in',
  '/forgot-password': 'Forgot password',
  '/reset-password': 'Reset password',
};

/**
 * The browser-tab title for a router path (basename already stripped).
 * Every tab used to read just "Xenon", so several open pages — a normal way to
 * work across devices and runs — were indistinguishable in the tab strip and
 * history, and screen readers announced no page change on navigation.
 */
export function titleForPath(pathname: string): string {
  const path = pathname.replace(/\/+$/, '') || '/';
  let page = EXACT[path];
  if (!page) {
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/devices\/([^/]+)\/control/)))
      page = `${decodeURIComponent(m[1])} · Device`;
    else if (/^\/builds\/[^/]+\/sessions\//.test(path)) page = 'Session';
    else if (/^\/builds\/[^/]+$/.test(path)) page = 'Sessions';
    else if ((m = path.match(/^\/runbooks\/([^/]+)/)))
      page = `Runbook · ${decodeURIComponent(m[1])}`;
    else if (path.startsWith('/reset-password/')) page = 'Reset password';
  }
  return page ? `${page} · ${APP}` : APP;
}

/** Keeps document.title in step with the route. Mount once inside the router. */
export function DocumentTitle(): null {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titleForPath(pathname);
  }, [pathname]);
  return null;
}
