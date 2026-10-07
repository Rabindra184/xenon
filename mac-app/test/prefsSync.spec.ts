import { describe, expect, it } from 'vitest';
import { initialPrefsSync, prefsSync, type PrefsSync } from '../src/renderer/src/prefsSync';
import { DEFAULT_PREFERENCES, type Preferences } from '../src/shared/preferences';

const on: Preferences = { ...DEFAULT_PREFERENCES, technicalDetails: true };
const off: Preferences = { ...DEFAULT_PREFERENCES, technicalDetails: false };

/** Runs the events in order and returns every value shown along the way, the first one included. */
function shown(events: Parameters<typeof prefsSync>[1][], start: PrefsSync = initialPrefsSync()): Preferences[] {
  const seen = [start.shown];
  let state = start;
  for (const event of events) {
    state = prefsSync(state, event);
    seen.push(state.shown);
  }
  return seen;
}

describe('prefsSync', () => {
  it('starts on the defaults with nothing in flight', () => {
    expect(initialPrefsSync()).toEqual({ shown: DEFAULT_PREFERENCES, pending: 0, touched: false });
  });

  it('shows a local change at once', () => {
    const next = prefsSync(initialPrefsSync(), { type: 'local', patch: { technicalDetails: true } });
    expect(next.shown).toEqual(on);
    expect(next.pending).toBe(1);
  });

  // Main answers each change with a broadcast and then the reply. Two quick toggles used to show the
  // first broadcast (on) over the second change (off) for a moment.
  it('toggling twice in a row ends in the right state and never shows the first answer over the second change', () => {
    const values = shown([
      { type: 'local', patch: { technicalDetails: true } },
      { type: 'local', patch: { technicalDetails: false } },
      { type: 'broadcast', prefs: on },
      { type: 'reply', prefs: on },
      { type: 'broadcast', prefs: off },
      { type: 'reply', prefs: off }
    ]);
    expect(values.map((p) => p.technicalDetails)).toEqual([false, true, false, false, false, false, false]);
  });

  it('takes the saved answer once the last local change is back', () => {
    // The saved answer is the whole set, so a change made elsewhere meanwhile (the menu) comes with it.
    const fromMenu: Preferences = { technicalDetails: true, appearance: 'dark' };
    let state = prefsSync(initialPrefsSync(), { type: 'local', patch: { technicalDetails: true } });
    state = prefsSync(state, { type: 'broadcast', prefs: { ...DEFAULT_PREFERENCES, appearance: 'dark' } });
    expect(state.shown).toEqual(on);
    state = prefsSync(state, { type: 'reply', prefs: fromMenu });
    expect(state).toEqual({ shown: fromMenu, pending: 0, touched: true });
  });

  it('applies a broadcast when no local change is in flight (the View menu)', () => {
    const state = prefsSync(initialPrefsSync(), { type: 'broadcast', prefs: on });
    expect(state.shown).toEqual(on);
    expect(state.touched).toBe(true);
  });

  it('a failed change stops counting as in flight', () => {
    let state = prefsSync(initialPrefsSync(), { type: 'local', patch: { technicalDetails: true } });
    state = prefsSync(state, { type: 'failed' });
    expect(state.pending).toBe(0);
    // The next broadcast or read puts the saved value back.
    state = prefsSync(state, { type: 'broadcast', prefs: off });
    expect(state.shown).toEqual(off);
  });

  it('the first read applies only when nothing newer has been seen', () => {
    expect(prefsSync(initialPrefsSync(), { type: 'read', prefs: on }).shown).toEqual(on);
    const afterBroadcast = prefsSync(initialPrefsSync(), { type: 'broadcast', prefs: off });
    expect(prefsSync(afterBroadcast, { type: 'read', prefs: on }).shown).toEqual(off);
    const afterLocal = prefsSync(initialPrefsSync(), { type: 'local', patch: { appearance: 'light' } });
    expect(prefsSync(afterLocal, { type: 'read', prefs: on }).shown.appearance).toBe('light');
  });

  it('never counts below zero', () => {
    expect(prefsSync(initialPrefsSync(), { type: 'reply', prefs: on }).pending).toBe(0);
    expect(prefsSync(initialPrefsSync(), { type: 'failed' }).pending).toBe(0);
  });
});
