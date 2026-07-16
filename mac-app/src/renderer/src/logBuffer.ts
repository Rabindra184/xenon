import type { LogLine } from '@shared/types';

// The log console's buffer. Lines carry a stable id so rows can be memoised:
// without it, capping the buffer shifts every index and invalidates every row.

export interface UiLogLine extends LogLine {
  /** Monotonic, assigned on arrival. Stable across capping. */
  id: number;
}

/** Max lines kept in memory. Older lines are dropped, oldest first. */
export const LOG_BUFFER_LIMIT = 5000;

/** How long incoming lines are coalesced before a render. */
export const LOG_FLUSH_MS = 120;

/**
 * Append a batch, keeping at most `cap` lines. Returns the previous array
 * unchanged for an empty batch, and never clones surviving lines — both matter
 * so React can skip work.
 */
export function appendCapped<T>(prev: T[], batch: T[], cap: number): T[] {
  if (batch.length === 0) return prev;
  const next = prev.concat(batch);
  return next.length > cap ? next.slice(next.length - cap) : next;
}
