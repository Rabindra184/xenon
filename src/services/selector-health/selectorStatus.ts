import type { SelectorState } from '../../generated/client';

/**
 * A SelectorState row's status. The column is a plain string; these are the
 * only values written. The dashboard calls them "To fix" (`active`, or no row
 * at all), "Verifying" (`pending`), "Fixed" (`resolved`) and "Muted".
 *
 * - `pending` has `fixed_at`; `resolved` has `fixed_at` and `resolved_at`.
 * - `active` and `muted` have neither: a selector that leaves verification for
 *   anything else drops its fix. Who marked it fixed stays in SelectorEvent.
 */
export type SelectorStatus = 'active' | 'pending' | 'resolved' | 'muted';

/** The statuses a heal of the selector sends back to `active`. */
export const WATCHED_STATUSES: SelectorStatus[] = ['pending', 'resolved'];

/** Whether a row in this status carries a fix (`fixed_at`, and `resolved_at` once verified). */
export function carriesFix(status: string): boolean {
  return (WATCHED_STATUSES as string[]).includes(status);
}

/**
 * The columns that hold a fix and its verification, cleared. Every change to
 * `active` or `muted` writes them, so neither status shows a "fixed by".
 */
export const NO_FIX = {
  fixed_at: null,
  fixed_by_api_key: null,
  resolved_at: null,
  clean_builds_count: 0,
} as const;

/**
 * Whether a row leaving `muted` or `pending` for `active` is kept. An `active`
 * row carries no fix, so the only thing it has to show is how often the
 * selector broke again; without that the row is deleted, and the selector is
 * "To fix" as one with no row is. Unmute and cancel share this rule. Through
 * 2.36 unmute counted `fixed_at` and cancel didn't, so an unmuted selector was
 * left `active` with the fix it had before, shown as "fixed by" someone.
 */
export function keepsRowWhenActive(row: Pick<SelectorState, 'regression_count'>): boolean {
  return row.regression_count > 0;
}
