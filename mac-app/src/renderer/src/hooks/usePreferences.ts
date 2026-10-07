import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_PREFERENCES, mergePreferences, type Preferences } from '@shared/preferences';

export interface PreferencesApi {
  prefs: Preferences;
  /** Change the named fields only; one that is undefined or invalid keeps its value. */
  setPrefs(patch: Partial<Preferences>): void;
}

/**
 * The person's preferences, kept in step with the main process, which owns
 * them. A change from anywhere (a switch here, the Appearance menu) arrives on
 * the same subscription.
 */
export function usePreferences(): PreferencesApi {
  const [prefs, setPrefsState] = useState<Preferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    let live = true;
    // A change that arrives before the first read is newer than that read.
    let changed = false;
    const off = window.xenon.onPrefs((p) => {
      changed = true;
      setPrefsState(p);
    });
    void window.xenon.prefs.get().then((p) => {
      if (live && !changed) setPrefsState(p);
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  const setPrefs = useCallback((patch: Partial<Preferences>) => {
    // Show it at once; the main process answers with the saved result on the subscription above.
    setPrefsState((prev) => mergePreferences(prev, patch));
    void window.xenon.prefs.set(patch);
  }, []);

  return { prefs, setPrefs };
}
