import type { ServerState, ServerStatus } from '@shared/types';

/** The colour of the status dot icon (it sits beside the word, so colour is never the only signal). */
export const STATUS_DOT: Record<ServerStatus, string> = {
  stopped: 'text-dim',
  starting: 'text-warn animate-pulse',
  running: 'text-ok',
  stopping: 'text-warn animate-pulse',
  crashed: 'text-danger'
};

/** The server's status in a word or two, as the sidebar shows it and a screen reader announces it. */
export const STATUS_WORD: Record<ServerStatus, string> = {
  stopped: 'Stopped',
  starting: 'Starting…',
  running: 'Running',
  stopping: 'Stopping…',
  crashed: 'Stopped unexpectedly'
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
 * supervisor records a failed start as lastError (which Home shows once the
 * server has stopped unexpectedly) and throws the same message, so it is
 * hidden when that line says it.
 */
export function startErrorToShow(
  startError: string | null,
  state: Pick<ServerState, 'status' | 'lastError'>
): string | null {
  if (!startError || isServerActive(state.status)) return null;
  if (state.status === 'crashed' && startError === state.lastError) return null;
  return startError;
}
