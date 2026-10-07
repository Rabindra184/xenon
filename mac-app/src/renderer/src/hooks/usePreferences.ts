import { useCallback, useEffect, useRef, useState } from 'react';
import type { Preferences } from '@shared/preferences';
import { initialPrefsSync, prefsSync, type PrefsEvent } from '../prefsSync';

export interface PreferencesApi {
  prefs: Preferences;
  /** Change the named fields only; one that is undefined or invalid keeps its value. */
  setPrefs(patch: Partial<Preferences>): void;
}

/**
 * The person's preferences, kept in step with the main process, which owns
 * them. A change from anywhere (a switch here, the View menu) arrives on the
 * same subscription. A change made here shows at once, and main's answers are
 * held back until the last such change is answered (see prefsSync), so two
 * quick toggles never flicker.
 */
export function usePreferences(): PreferencesApi {
  const sync = useRef(initialPrefsSync());
  const [prefs, setShown] = useState<Preferences>(sync.current.shown);

  const apply = useCallback((event: PrefsEvent) => {
    sync.current = prefsSync(sync.current, event);
    setShown(sync.current.shown);
  }, []);

  useEffect(() => {
    let live = true;
    const off = window.xenon.onPrefs((p) => apply({ type: 'broadcast', prefs: p }));
    void window.xenon.prefs.get().then((p) => {
      if (live) apply({ type: 'read', prefs: p });
    });
    return () => {
      live = false;
      off();
    };
  }, [apply]);

  const setPrefs = useCallback(
    (patch: Partial<Preferences>) => {
      apply({ type: 'local', patch });
      window.xenon.prefs.set(patch).then(
        (saved) => apply({ type: 'reply', prefs: saved }),
        () => {
          apply({ type: 'failed' });
          // Nothing more is on its way: show what is saved.
          if (sync.current.pending === 0) {
            void window.xenon.prefs.get().then((p) => apply({ type: 'broadcast', prefs: p }));
          }
        }
      );
    },
    [apply]
  );

  return { prefs, setPrefs };
}
