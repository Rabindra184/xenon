import type { MenuAction, PreflightResult, ServerStatus } from '@shared/types';

export type Place = 'home' | 'setup' | 'settings' | 'logs';

export const PLACES: readonly Place[] = ['home', 'setup', 'settings', 'logs'];

/**
 * Whether Setup's place in the sidebar carries its "!" badge: the last check
 * found a blocker, or a blocking check that isn't ok. Not while Set up runs,
 * since the answer is changing under it and Start already says to wait.
 */
export function setupNeedsAttention(readiness: PreflightResult | null, installing: boolean): boolean {
  if (installing || readiness === null) return false;
  return readiness.blockers.length > 0 || readiness.checks.some((c) => c.blocking && c.status !== 'ok');
}

/**
 * Whether Logs carries its "new problem" dot. It comes on when the server
 * stops unexpectedly, from whatever it was doing (a start can fail before the
 * server ever runs, so stopped → crashed counts too), goes off once Logs is
 * open, and otherwise keeps its value (so it survives moving between places,
 * and a restart, until the person has looked). Called with each status the
 * main process sends, and again with the same status when the place changes.
 */
export function crashAlert(
  prev: { status: ServerStatus; alert: boolean },
  next: { status: ServerStatus; place: Place }
): boolean {
  if (next.place === 'logs') return false;
  if (prev.status !== 'crashed' && next.status === 'crashed') return true;
  return prev.alert;
}

const MENU_PLACES: Partial<Record<MenuAction, Place>> = {
  'place-home': 'home',
  'place-setup': 'setup',
  'place-settings': 'settings',
  'place-logs': 'logs'
};

/** The place a View menu item opens (⌘1–⌘4), or null for any other menu action. */
export function placeForMenuAction(action: MenuAction): Place | null {
  return MENU_PLACES[action] ?? null;
}

/** The settings in Settings' Technical group: base path, Appium folder and keep-alive. */
export const TECHNICAL_PATHS = ['server.basePath', 'server.appiumHome', 'server.keepAliveTimeout'] as const;

/**
 * Whether Settings shows its Technical group: with technical details on, and
 * also when one of its settings has a problem, which would otherwise block
 * Start with nothing on screen to fix.
 */
export function showsTechnicalGroup(technicalDetails: boolean, issuePaths: readonly string[]): boolean {
  return technicalDetails || issuePaths.some((path) => (TECHNICAL_PATHS as readonly string[]).includes(path));
}
