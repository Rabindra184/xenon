import type { MenuAction, PlaceMenuAction, PreflightResult, ServerStatus } from '@shared/types';

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

/**
 * Where a start goes when its own check finds a problem, or null to stay. Home
 * says what is in the way and offers its fix, so a start pressed there (or with
 * ⌘⏎ while it is open) stays on it. From every other place, Setup opens, where
 * every check is listed.
 */
export function placeAfterFailedCheck(here: Place): Place | null {
  return here === 'home' ? null : 'setup';
}

const MENU_PLACES: Record<PlaceMenuAction, Place> = {
  'place-home': 'home',
  'place-setup': 'setup',
  'place-settings': 'settings',
  'place-logs': 'logs'
};

/** One of View's places, ⌘1–⌘4. */
export function isPlaceMenuAction(action: MenuAction): action is PlaceMenuAction {
  return Object.hasOwn(MENU_PLACES, action);
}

/** The place a View menu item opens (⌘1–⌘4), or null for any other menu action. */
export function placeForMenuAction(action: MenuAction): Place | null {
  return isPlaceMenuAction(action) ? MENU_PLACES[action] : null;
}

/** What the window has read so far, which a menu action may need before it can act. */
export interface MenuReadiness {
  /** The saved profiles, and which one is open. */
  profiles: boolean;
  /** The server's status: whether one is active, and for which profile. */
  server: boolean;
  /** Also the server's status, and the open profile's settings checked against its own option list, port included. */
  settings: boolean;
}

/** The actions that act on what a start would launch: they must see the settings checked, as the Start button does. */
const NEEDS_CHECKED_SETTINGS: ReadonlySet<MenuAction> = new Set<MenuAction>([
  'toggle-server',
  'start-server',
  'launch-preview',
  'export-config'
]);

/** The actions that act on whichever profile's server is active: they must know the server's status first. */
const NEEDS_SERVER_STATUS: ReadonlySet<MenuAction> = new Set<MenuAction>(['copy-test-address']);

/**
 * Whether the window can act on a menu action yet. Nothing acts before the
 * profiles are read. A Start, the launch preview and the config export also
 * wait for the open profile's settings to be checked, so an invalid setting
 * stops a Start from the menu-bar icon as it stops the Start button. Copy Test
 * Address waits for the server's status, since a running server's profile may
 * not be the open one. The rest (the places, New, Manage, Import, Export
 * Profile) act at once, so an option list that is slow, or never comes, holds
 * nothing else up.
 */
export function menuActionReady(action: MenuAction, ready: MenuReadiness): boolean {
  if (!ready.profiles) return false;
  if (NEEDS_SERVER_STATUS.has(action)) return ready.server;
  return !NEEDS_CHECKED_SETTINGS.has(action) || ready.settings;
}

/**
 * After a place is opened from the View menu, focus that was in the place it
 * replaced (now an empty, inactive panel) or nowhere goes to the new place's
 * tab: that is where the person went. Focus anywhere else (the sidebar, a
 * sheet) stays where it is.
 */
export function focusChosenPlaceIfLost(doc: Document = document): void {
  const active = doc.activeElement;
  const lost = active === null || active === doc.body || active.closest('[role="tabpanel"][data-state="inactive"]') !== null;
  if (!lost) return;
  doc.querySelector<HTMLElement>('[data-places] [role="tab"][data-state="active"]')?.focus();
}

/** The settings in Settings' Technical group: base path, Appium folder and keep-alive. */
export const TECHNICAL_PATHS = ['server.basePath', 'server.appiumHome', 'server.keepAliveTimeout'] as const;

/** One of the Technical group's settings has a problem. */
export function hasTechnicalProblem(issuePaths: readonly string[]): boolean {
  return issuePaths.some((path) => (TECHNICAL_PATHS as readonly string[]).includes(path));
}

/**
 * What keeps the Technical group on screen with technical details off.
 * `held`: it was shown for a problem, and focus has not left it since with the
 * problem fixed. `focused`: one of its fields has focus.
 */
export interface TechnicalHold {
  held: boolean;
  focused: boolean;
}

export type TechnicalHoldEvent =
  /** What the settings' problems are now. */
  | { type: 'problem'; problem: boolean }
  /** Focus moved into the group. */
  | { type: 'focus' }
  /** Focus left the group, for somewhere else in the window; `problem` is whether one remains. */
  | { type: 'blur'; problem: boolean };

/**
 * A group shown for a problem stays while the problem is being fixed: typing
 * "/wd/hub" over "wd/hub" fixes it at the "/", and the field must not go then.
 * It goes once focus leaves it with the problem fixed (or the person leaves
 * Settings or its tab, which starts the hold again).
 */
export function technicalHold(state: TechnicalHold, event: TechnicalHoldEvent): TechnicalHold {
  switch (event.type) {
    case 'problem':
      return event.problem && !state.held ? { ...state, held: true } : state;
    case 'focus':
      return state.focused ? state : { ...state, focused: true };
    case 'blur':
      return { held: event.problem, focused: false };
  }
}

/**
 * Whether Settings shows its Technical group: with technical details on; also
 * while one of its settings has a problem, which would otherwise block Start
 * with nothing on screen to fix; and never taken away while it is held (see
 * technicalHold) or one of its fields has focus.
 */
export function showsTechnicalGroup(technicalDetails: boolean, problem: boolean, hold: TechnicalHold): boolean {
  return technicalDetails || problem || hold.held || hold.focused;
}
