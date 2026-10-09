import { DEFAULT_PREFERENCES, mergePreferences, type Preferences } from '@shared/preferences';

// The window's copy of the preferences, which the main process owns. A change
// made here shows at once; main answers each one with a broadcast to every
// window and then with the saved result. Two quick changes (the Settings
// switch, then ⌥⌘T) would otherwise show the first answer over the second
// change for a moment, so answers are not shown while a change made here is
// still on its way: the saved result of the last one is.

export interface PrefsSync {
  /** What the window shows. */
  shown: Preferences;
  /** Changes made here that main has not answered yet. */
  pending: number;
  /** Something newer than the first read has been seen, so that read is stale. */
  touched: boolean;
}

export type PrefsEvent =
  /** A change made in this window. */
  | { type: 'local'; patch: Partial<Preferences> }
  /** Main's broadcast, after a change from anywhere (this window, or the View menu). */
  | { type: 'broadcast'; prefs: Preferences }
  /** Main's answer to one of this window's changes: the whole saved set. */
  | { type: 'reply'; prefs: Preferences }
  /** One of this window's changes never got an answer. */
  | { type: 'failed' }
  /** The first read, when the window opens. */
  | { type: 'read'; prefs: Preferences };

export const initialPrefsSync = (): PrefsSync => ({ shown: DEFAULT_PREFERENCES, pending: 0, touched: false });

export function prefsSync(state: PrefsSync, event: PrefsEvent): PrefsSync {
  switch (event.type) {
    case 'local':
      return { shown: mergePreferences(state.shown, event.patch), pending: state.pending + 1, touched: true };
    case 'broadcast':
      // While a change made here is on its way, its own answer is the one to show.
      return state.pending > 0 ? { ...state, touched: true } : { shown: event.prefs, pending: 0, touched: true };
    case 'reply': {
      const pending = Math.max(0, state.pending - 1);
      // The last answer is the saved set after every change so far, from here or elsewhere.
      return { shown: pending === 0 ? event.prefs : state.shown, pending, touched: true };
    }
    case 'failed':
      return { ...state, pending: Math.max(0, state.pending - 1) };
    case 'read':
      return state.touched || state.pending > 0 ? state : { ...state, shown: event.prefs };
  }
}
