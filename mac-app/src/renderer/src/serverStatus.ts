import type { ServerState, ServerStatus } from '@shared/types';
import { STATUS_WORD } from '@shared/statusWords';
import type { Place } from './navigation';

// The words are shared with the menu-bar icon's menu, which the main process builds.
export { STATUS_WORD };

/** The colour of the status dot icon (it sits beside the word, so colour is never the only signal). */
export const STATUS_DOT: Record<ServerStatus, string> = {
  stopped: 'text-dim',
  starting: 'text-warn animate-pulse',
  running: 'text-ok',
  stopping: 'text-warn animate-pulse',
  crashed: 'text-danger'
};

/** Extra context for a status, for a line longer than the sidebar's word. */
export const STATUS_HINT: Partial<Record<ServerStatus, string>> = {
  stopping: 'Saving recordings and releasing phones…'
};

/** Compact human uptime: "42s", "3m 12s", "1h 2m". Negative deltas clamp to 0s. */
export function formatUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/** True from the moment a start is requested until the server has fully stopped (or crashed). */
export function isServerActive(status: ServerStatus): boolean {
  return status !== 'stopped' && status !== 'crashed';
}

/**
 * The failed-start message worth showing in the sidebar, or null. The
 * supervisor records a failed start as lastError and throws the same message.
 * While Home is open it says the server stopped unexpectedly, so the sidebar
 * leaves out the same message there; on any other place Home is not on screen
 * (and the error toast may be gone), so the sidebar says it.
 */
export function startErrorToShow(
  startError: string | null,
  state: Pick<ServerState, 'status' | 'lastError'>,
  place: Place
): string | null {
  if (!startError || isServerActive(state.status)) return null;
  if (place === 'home' && state.status === 'crashed' && startError === state.lastError) return null;
  return startError;
}

/**
 * What the profile lists (the switcher and the Profiles sheet) show beside the
 * profile the server was started for, while it is starting, running or
 * stopping: the status word, which is the signal, and a tint as a hint. Null
 * for every other profile, and for all of them once the server has stopped.
 */
export function profileServerBadge(
  state: Pick<ServerState, 'status' | 'profileId'>,
  profileId: string
): { word: string; tone: 'ok' | 'attention' } | null {
  if (!isServerActive(state.status) || state.profileId === null || state.profileId !== profileId) return null;
  return { word: STATUS_WORD[state.status], tone: state.status === 'running' ? 'ok' : 'attention' };
}
