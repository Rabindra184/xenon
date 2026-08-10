import { useEffect, useRef, useState } from 'react';
import XenonApiService from '../../api-service';

export type DisplayState = 'on' | 'off' | 'doze' | 'unknown';

/** Slow on purpose — this answers "is it asleep", not "what is on screen". */
const POLL_MS = 5000;

/**
 * Poll whether the device's panel is lit.
 *
 * The preview shows a perfectly black frame for a sleeping device, which is
 * indistinguishable from a broken stream or a black-themed app. Rather than
 * guess from the pixels — plenty of real screens on an AMOLED device are pure
 * black, and calling one of those "asleep" would be worse than saying nothing
 * — the server is asked, and it reads `dumpsys power`.
 *
 * Polling stops while the tab is hidden: a background tab has nobody to
 * inform, and this costs an adb call per device per interval.
 */
export function useDisplayState(udid: string | null | undefined, enabled = true): DisplayState {
  const [state, setState] = useState<DisplayState>('unknown');
  // Kept in a ref so the effect does not re-subscribe on every reading.
  const stateRef = useRef<DisplayState>('unknown');

  useEffect(() => {
    if (!udid || !enabled) {
      setState('unknown');
      stateRef.current = 'unknown';
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const apply = (next: DisplayState) => {
      if (cancelled || next === stateRef.current) return;
      stateRef.current = next;
      setState(next);
    };

    const poll = async () => {
      if (cancelled) return;
      // Any entry cancels the pending one, so returning to the tab restarts
      // the loop instead of running a second one alongside it — which would
      // double the poll rate on every tab switch.
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        timer = setTimeout(poll, POLL_MS);
        return;
      }
      try {
        const res: any = await XenonApiService.getDisplayState(udid);
        apply((res?.state as DisplayState) ?? 'unknown');
      } catch {
        // A failed read is not evidence the screen is off. Leave the last
        // reading alone rather than flashing an overlay on a network blip.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };

    poll();
    // Coming back to the tab should not wait out a full interval.
    const onVisible = () => {
      if (document.visibilityState === 'visible') poll();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [udid, enabled]);

  return state;
}
