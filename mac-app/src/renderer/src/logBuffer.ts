import type { LogLine } from '@shared/types';
import { LOG_LINES_KEPT } from '@shared/logView';

// The log console's buffer: the window's copy of the lines main keeps (R67). Every line carries the
// id main gave it, so a line is the same line in main and here, and rows can be memoised: without
// it, capping the buffer shifts every index and invalidates every row.

export type UiLogLine = LogLine;

/** Max lines kept in memory, as many as main keeps. Older lines are dropped, oldest first. */
export const LOG_BUFFER_LIMIT = LOG_LINES_KEPT;

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

/**
 * A batch main sent, added to the lines the window has: the ones it has not got yet, in the order
 * they came. A batch can hold lines the window already has, when main had them when it answered the
 * seed but sent them after (withSeed): those are skipped by their id. The previous array comes back
 * when nothing is new.
 */
export function withLiveLines(prev: LogLine[], batch: LogLine[], cap: number): LogLine[] {
  if (batch.length === 0) return prev;
  // Main's lines come in its order, so a line after the last one held is new; only one at or below
  // it is looked up.
  const last = prev.length === 0 ? -Infinity : prev[prev.length - 1].id;
  let fresh = batch;
  if (batch.some((l) => l.id <= last)) {
    const have = new Set(prev.map((l) => l.id));
    fresh = batch.filter((l) => !have.has(l.id));
  }
  return appendCapped(prev, fresh, cap);
}

/**
 * The window's lines once main's answer to "which lines do you keep?" is back (the seed, read when
 * the window opens). Batches can come in before it, holding lines it has too: the two are put
 * together by id, each line once, in main's order (its ids), the newest `cap` kept. Lines the window
 * cleared since it asked (ids up to `clearedThrough`) stay out. The lines the window already had are
 * kept as they were, so their rows stay drawn; the previous array comes back when the seed adds
 * nothing.
 */
export function withSeed(prev: LogLine[], seed: LogLine[], clearedThrough: number, cap: number): LogLine[] {
  const have = new Set(prev.map((l) => l.id));
  const added = seed.filter((l) => l.id > clearedThrough && !have.has(l.id));
  if (added.length === 0) return prev;
  const merged = prev.concat(added).sort((a, b) => a.id - b.id);
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}
