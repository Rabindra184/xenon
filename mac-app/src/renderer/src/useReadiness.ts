import { useCallback, useEffect, useRef, useState } from 'react';
import type { PreflightResult, Profile, ServerStatus } from '@shared/types';
import { createDebouncer } from './debounce';
import {
  ReadinessTracker,
  planRecheck,
  recheckKey,
  runCheck,
  type ReadinessTicks,
  type RecheckKey
} from './readiness';

/** Edits and ticks arrive in bursts (typing a port, regaining focus); look once after they settle. */
const RECHECK_DEBOUNCE_MS = 400;

interface View {
  profileId: string;
  readiness: PreflightResult | null;
  checking: boolean;
  /** When the answer on screen came back (Date.now()), or null before one has. */
  checkedAt: number | null;
  /** Which check's answer was just applied, or null while a check runs (see the hook's answerId). */
  answerId: number | null;
}

/**
 * Whether the active profile can start, kept current. It re-checks when the
 * profile, its port or its Appium folder changes, whenever a tick bumps
 * (window focus, a finished setup, Check again), and the moment our own server
 * stops or Set up ends. While that server is active nothing is checked, since
 * it holds the port, nor while Set up runs, since it is changing what a check
 * reads. The decisions live in readiness.ts; this only holds them in React state.
 */
export function useReadiness(
  profile: Profile | null,
  ticks: ReadinessTicks,
  serverStatus: ServerStatus,
  installing: boolean
): {
  readiness: PreflightResult | null;
  checking: boolean;
  /** When the answer shown came back, for Setup's "Checked 2 minutes ago."; null before one has. */
  checkedAt: number | null;
  /**
   * Set (to a number higher than any before) when a check's answer is applied, and null from the
   * moment the next check begins. A new value is a check that just completed; a profile's last
   * answer, shown again while its own check runs, has none, so it is never taken for one.
   */
  answerId: number | null;
  refreshNow(): Promise<PreflightResult | null>;
} {
  const [tracker] = useState(() => new ReadinessTracker());
  // Pending-ness lives in React state because the tracker's isn't reactive.
  const [view, setView] = useState<View | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  // When each profile's shown answer came back. A profile opened again shows its last answer while
  // it is checked again, with the time that answer was shown.
  const checkedAt = useRef(new Map<string, number>());
  const lastAnswerId = useRef(0);

  const check = useCallback((): Promise<PreflightResult | null> => {
    const p = profileRef.current;
    if (!p) return Promise.resolve(null);
    return runCheck({
      tracker,
      profile: p,
      preflight: (x) => window.xenon.toolchain.preflight(x),
      onBegin: (profileId, last) =>
        setView({
          profileId,
          readiness: last,
          checking: true,
          checkedAt: last === null ? null : (checkedAt.current.get(profileId) ?? null),
          answerId: null
        }),
      onApply: (profileId, readiness) => {
        const at = Date.now();
        checkedAt.current.set(profileId, at);
        setView({ profileId, readiness, checking: false, checkedAt: at, answerId: ++lastAnswerId.current });
      },
      isShown: (profileId) => profileRef.current?.id === profileId
    });
  }, [tracker]);

  const [debounced] = useState(() => createDebouncer(() => void check(), RECHECK_DEBOUNCE_MS));

  const key = recheckKey(profile, ticks, serverStatus, installing);
  const lastKey = useRef<RecheckKey | null>(null);
  useEffect(() => {
    const plan = planRecheck(lastKey.current, key);
    lastKey.current = key;
    if (plan === 'now') {
      debounced.cancel();
      void check();
    } else if (plan === 'later') {
      debounced.call();
    } else if (key.profileId === null) {
      debounced.cancel();
      setView(null);
    } else if (key.serverActive || key.installing) {
      debounced.cancel(); // a look already waiting would blame our own server, or read a half-installed Mac
    }
    // `key` is rebuilt every render; its fields are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key.profileId, key.port, key.appiumHome, key.focus, key.setup, key.recheck, key.serverActive, key.installing]);

  useEffect(
    () => () => {
      debounced.cancel();
      lastKey.current = null;
    },
    [debounced]
  );

  const refreshNow = useCallback(() => {
    debounced.cancel();
    return check();
  }, [debounced, check]);

  // What was learned about another profile is not this one's answer. Until the
  // check for a just-selected profile has begun, say it is being checked.
  const current = view && profile && view.profileId === profile.id ? view : null;
  return {
    readiness: current ? current.readiness : null,
    checking: current ? current.checking : profile !== null,
    checkedAt: current ? current.checkedAt : null,
    answerId: current ? current.answerId : null,
    refreshNow
  };
}
