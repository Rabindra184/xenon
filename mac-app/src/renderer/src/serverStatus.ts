import type { ServerState, ServerStatus } from '@shared/types';

/** Status dot + label styling shared by the sidebar card and status bar. */
export const STATUS_DOT: Record<ServerState['status'], string> = {
  stopped: 'bg-dim',
  starting: 'bg-warn animate-pulse',
  running: 'bg-accent',
  stopping: 'bg-warn animate-pulse',
  crashed: 'bg-danger'
};

export const STATUS_LABEL: Record<ServerState['status'], string> = {
  stopped: 'Stopped',
  starting: 'Starting…',
  running: 'Running',
  stopping: 'Stopping…',
  crashed: 'Crashed'
};

/** Extra context for a status; the status bar appends it, the sidebar card does not. */
export const STATUS_HINT: Partial<Record<ServerStatus, string>> = {
  stopping: 'Saving recordings and releasing phones…'
};

/** Status bar text: the label, plus the status hint ("Stopping — saving recordings…") when there is one. */
export function statusBarLabel(status: ServerStatus): string {
  const label = STATUS_LABEL[status];
  const hint = STATUS_HINT[status];
  if (!hint) return label;
  return `${label.replace(/…$/, '')} — ${hint.charAt(0).toLowerCase()}${hint.slice(1)}`;
}

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
 * The failed-start message worth showing under the status bar, or null. The
 * supervisor records a failed start as lastError (shown on the bar's crashed
 * line) and throws the same message, so it is hidden when that line says it.
 */
export function startErrorToShow(
  startError: string | null,
  state: Pick<ServerState, 'status' | 'lastError'>
): string | null {
  if (!startError || isServerActive(state.status)) return null;
  if (state.status === 'crashed' && startError === state.lastError) return null;
  return startError;
}
