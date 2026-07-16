import type { ServerState } from '@shared/types';

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

/** Compact human uptime: "42s", "3m 12s", "1h 2m". Negative deltas clamp to 0s. */
export function formatUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
