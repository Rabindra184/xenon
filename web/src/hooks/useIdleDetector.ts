import { useEffect, useRef, useState } from 'react';

interface UseIdleDetectorOptions {
  // Total ms of inactivity before `onTimeout` fires.
  idleAfterMs: number;
  // Seconds before timeout when the warning modal should appear.
  // The modal counts down from `warningSec` to 0, then `onTimeout` fires.
  warningSec: number;
  // Called once when the user crosses into the warning window.
  // Receives the remaining seconds at first warn (== warningSec).
  onWarning: (remainingSec: number) => void;
  // Called when the warning countdown reaches zero.
  onTimeout: () => void;
  // When false, all timers are cleared and no events fire.
  enabled: boolean;
}

interface UseIdleDetectorResult {
  // true while the warning window is showing.
  warning: boolean;
  // current countdown seconds while warning is true; null otherwise.
  remainingSec: number | null;
  // user clicked "continue" — restart the idle clock.
  reset: () => void;
}

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'] as const;

// Tracks user activity and surfaces a warning + timeout the way ADF and other
// device-lab UIs do. Does NOT call any backend itself — `onTimeout` is the
// place to release manual sessions / sendBeacon. Browser tab close is handled
// by the existing OrphanSweeper on the hub side; this hook only handles the
// "user walked away with the tab still open" case.
export function useIdleDetector({
  idleAfterMs,
  warningSec,
  onWarning,
  onTimeout,
  enabled,
}: UseIdleDetectorOptions): UseIdleDetectorResult {
  const [warning, setWarning] = useState(false);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);

  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // `warningRef` mirrors the `warning` state so onActivity can read it
  // without making the effect re-run when it flips. (If we put `warning`
  // in the effect deps, the effect's cleanup tears down our running
  // countdown interval the moment the warning starts.)
  const warningRef = useRef(false);
  const onWarningRef = useRef(onWarning);
  const onTimeoutRef = useRef(onTimeout);
  onWarningRef.current = onWarning;
  onTimeoutRef.current = onTimeout;

  function clearAll() {
    if (warnTimerRef.current) {
      clearTimeout(warnTimerRef.current);
      warnTimerRef.current = null;
    }
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
  }

  function startWarningCountdown() {
    warningRef.current = true;
    setWarning(true);
    setRemainingSec(warningSec);
    onWarningRef.current(warningSec);
    let left = warningSec;
    tickIntervalRef.current = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearAll();
        warningRef.current = false;
        setWarning(false);
        setRemainingSec(null);
        onTimeoutRef.current();
      } else {
        setRemainingSec(left);
      }
    }, 1000);
  }

  function scheduleWarning() {
    clearAll();
    warningRef.current = false;
    setWarning(false);
    setRemainingSec(null);
    const warnAfter = idleAfterMs - warningSec * 1000;
    warnTimerRef.current = setTimeout(startWarningCountdown, Math.max(0, warnAfter));
  }

  function reset() {
    if (!enabled) return;
    scheduleWarning();
  }

  useEffect(() => {
    if (!enabled) {
      clearAll();
      warningRef.current = false;
      setWarning(false);
      setRemainingSec(null);
      return;
    }
    function onActivity() {
      // Activity during the warning countdown does NOT silently dismiss it —
      // the modal demands an explicit "Continue" so the user notices the
      // session was about to die. Pre-warning activity bumps the idle clock.
      if (warningRef.current) return;
      scheduleWarning();
    }
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    scheduleWarning();
    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity));
      clearAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, idleAfterMs, warningSec]);

  return { warning, remainingSec, reset };
}
