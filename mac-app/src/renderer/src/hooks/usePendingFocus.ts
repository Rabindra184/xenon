import { useCallback, useEffect, useState } from 'react';
import { focusSetting } from '../focusSetting';
import { retryEachFrame } from '../retryEachFrame';

/** How many frames a setting to focus is looked for before giving up. */
const FOCUS_TRIES = 10;

/**
 * Puts the cursor in a setting once the screen that holds it is drawn. The
 * place a setting is on may not be drawn yet: Radix mounts a newly chosen tab's
 * panel in a render of its own, after the commit that chose it. So it looks on
 * each frame until the setting is there, for a few frames at most.
 */
export function usePendingFocus(): (path: string) => void {
  const [pending, setPending] = useState<{ path: string } | null>(null);

  useEffect(() => {
    if (!pending) return;
    return retryEachFrame(() => focusSetting(pending.path), FOCUS_TRIES);
  }, [pending]);

  // A fresh object each time, so asking for the same setting twice looks again.
  return useCallback((path: string) => setPending({ path }), []);
}
