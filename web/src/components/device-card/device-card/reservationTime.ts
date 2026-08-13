import prettyMilliseconds from 'pretty-ms';

/**
 * How long is left on a reservation, for the card's `RES ·` banner.
 *
 * Two units, not `compact`. `compact: true` keeps only the largest unit and
 * floors it, so a reservation reads a whole hour short for all but the first
 * millisecond of its life: booking 2 hours and immediately seeing "1h" is not
 * a rounding quibble, it is the wrong number on the screen someone uses to
 * decide whether they have time to finish. Measured against the running
 * server — a reservation whose `reservedUntil` was 120 minutes away rendered
 * as `(1h)`.
 *
 *   reserved   compact   unitCount: 2
 *   2h         1h        1h 59m
 *   4h         3h        3h 59m
 *   8h         7h        7h 59m
 *
 * A non-positive remainder cannot normally reach here — `deriveKind` only
 * calls a device reserved while `Date.now() < reservedUntil`, computed in the
 * same render — but `prettyMilliseconds` renders a negative as `-5s`, so the
 * guard costs one comparison and removes a way for the banner to print
 * nonsense if that ever stops being true.
 */
export function formatReservationRemaining(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 'expiring';
  return prettyMilliseconds(remainingMs, { unitCount: 2 });
}
