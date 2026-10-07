import type { PreflightResult, ServerStatus } from '@shared/types';
import { isServerActive } from './serverStatus';

export type Place = 'home' | 'setup' | 'settings' | 'logs';

export const PLACES: readonly Place[] = ['home', 'setup', 'settings', 'logs'];

/**
 * Whether Setup's place in the sidebar carries its "!" badge: the last check
 * found a blocker, or a blocking check that isn't ok. Not while Set up runs,
 * since the answer is changing under it and Start already says to wait.
 */
export function setupNeedsAttention(readiness: PreflightResult | null, installing: boolean): boolean {
  if (installing || readiness === null) return false;
  return readiness.blockers.length > 0 || readiness.checks.some((c) => c.blocking && c.status !== 'ok');
}

/**
 * Whether Logs carries its "new problem" dot. It comes on when a server that
 * was starting, running or stopping stops unexpectedly, goes off once Logs is
 * open, and otherwise keeps its value (so it survives moving between places,
 * and a restart, until the person has looked).
 */
export function crashAlert(
  prev: { status: ServerStatus; alert: boolean },
  next: { status: ServerStatus; place: Place }
): boolean {
  if (next.place === 'logs') return false;
  if (isServerActive(prev.status) && next.status === 'crashed') return true;
  return prev.alert;
}
