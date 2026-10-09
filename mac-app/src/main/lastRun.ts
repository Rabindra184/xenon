import type { LastRun, ServerState } from '@shared/types';

/** The statuses a run is in before it ends. */
const LIVE = new Set<ServerState['status']>(['starting', 'running', 'stopping']);

/**
 * The run that a change of state ended, if it ended one: the profile that ran,
 * and how it ended. A run ends when a starting, running or stopping server
 * becomes stopped or crashed. Nothing else is a run's end, so a second event
 * after a crash, or a Start that fails before there was a run, records nothing.
 */
export function lastRunFrom(
  prev: ServerState,
  next: ServerState,
  now: number
): { profileId: string; run: LastRun } | null {
  if (!LIVE.has(prev.status)) return null;
  if (next.status !== 'stopped' && next.status !== 'crashed') return null;
  if (!prev.profileId) return null;
  const run: LastRun = { endedAt: now, how: next.status };
  if (next.lastError) run.reason = next.lastError;
  return { profileId: prev.profileId, run };
}

/**
 * What to call with each state the server announces, in order: it follows the
 * state before, and keeps a run when one ends. A failure to keep it is
 * reported to `onError` and goes no further, so recording can never stop a
 * state from reaching the window and the menu-bar icon.
 */
export function lastRunRecorder(deps: {
  initial: ServerState;
  keep: (profileId: string, run: LastRun) => void;
  onError: (err: unknown) => void;
  now?: () => number;
}): (state: ServerState) => void {
  const now = deps.now ?? Date.now;
  let previous = deps.initial;
  return (state) => {
    const ended = lastRunFrom(previous, state, now());
    previous = state;
    if (!ended) return;
    try {
      deps.keep(ended.profileId, ended.run);
    } catch (err) {
      deps.onError(err);
    }
  };
}

/**
 * Forgets a deleted profile's last run. The profile is already gone by then, so
 * a store that can't be written must not fail the delete (the window would keep
 * showing the profile): the failure is reported to `onError` and goes no further.
 */
export function forgetLastRun(
  forget: (profileId: string) => void,
  profileId: string,
  onError: (err: unknown) => void
): void {
  try {
    forget(profileId);
  } catch (err) {
    onError(err);
  }
}

/** A stored run read back safely: the run it holds, or null when what is there is not a run. */
export function sanitizeLastRun(value: unknown): LastRun | null {
  if (!value || typeof value !== 'object') return null;
  const { endedAt, how, reason } = value as Record<string, unknown>;
  if (typeof endedAt !== 'number' || !Number.isFinite(endedAt)) return null;
  if (how !== 'stopped' && how !== 'crashed') return null;
  const run: LastRun = { endedAt, how };
  if (typeof reason === 'string' && reason !== '') run.reason = reason;
  return run;
}
