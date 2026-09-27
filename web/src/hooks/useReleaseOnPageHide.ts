import { useEffect, useRef } from 'react';

/**
 * Let go of something the page holds when the page itself goes away.
 *
 * An effect's cleanup runs when React unmounts a component, which covers
 * leaving through the app, but closing the tab, reloading and going to
 * another address tear the page down without unmounting anything. `pagehide`
 * fires in all of them. `release` has to send its request synchronously and
 * with `keepalive` (or `sendBeacon`): the page can be gone a moment later.
 *
 * A page brought back from the back/forward cache (`pageshow` with
 * `persisted`) calls `onRestore`, to take back what `pagehide` gave up.
 */
export function useReleaseOnPageHide(release: () => void, onRestore?: () => void): void {
  const releaseRef = useRef(release);
  const restoreRef = useRef(onRestore);
  releaseRef.current = release;
  restoreRef.current = onRestore;

  useEffect(() => {
    const onHide = () => releaseRef.current();
    const onShow = (e: Event) => {
      if ((e as PageTransitionEvent).persisted) restoreRef.current?.();
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
    };
  }, []);
}
