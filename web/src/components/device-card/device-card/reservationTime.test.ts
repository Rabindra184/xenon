import { describe, expect, it } from 'vitest';
import { formatReservationRemaining } from './reservationTime';

const HOUR = 3600 * 1000;

describe('formatReservationRemaining', () => {
  // The bug: `compact: true` floors to the largest unit, so a reservation was
  // an hour short from its first millisecond. Booking 2 hours and reading "1h"
  // is the wrong number on the screen someone plans around.
  it('does not lose an hour the moment a reservation starts', () => {
    expect(formatReservationRemaining(2 * HOUR - 1)).to.equal('1h 59m');
    expect(formatReservationRemaining(4 * HOUR - 1000)).to.equal('3h 59m');
    expect(formatReservationRemaining(8 * HOUR - 1000)).to.equal('7h 59m');
  });

  it('never reports fewer whole hours than actually remain', () => {
    for (const hours of [1, 2, 4, 8]) {
      const shown = formatReservationRemaining(hours * HOUR - 1000);
      const shownHours = Number(/^(\d+)h/.exec(shown)?.[1] ?? 0);
      const trueHours = Math.floor((hours * HOUR - 1000) / HOUR);
      expect(shownHours, `${hours}h reservation rendered "${shown}"`).to.equal(trueHours);
    }
  });

  it('renders an exact duration without inventing a second unit', () => {
    expect(formatReservationRemaining(2 * HOUR)).to.equal('2h');
  });

  it('still reads naturally under an hour', () => {
    expect(formatReservationRemaining(HOUR - 1000)).to.equal('59m 59s');
  });

  // pretty-ms renders a negative as "-5s"; the banner must never print that.
  it('says expiring rather than a negative duration', () => {
    expect(formatReservationRemaining(-5000)).to.equal('expiring');
    expect(formatReservationRemaining(0)).to.equal('expiring');
    expect(formatReservationRemaining(Number.NaN)).to.equal('expiring');
  });
});
