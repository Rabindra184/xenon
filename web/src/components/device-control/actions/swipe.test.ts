import { describe, expect, it } from 'vitest';
import { swipePath } from './swipe';

// The old D-pad's geometry: through the centre, across 80% of the screen.
describe('swipePath', () => {
  it('moves the content the way it names', () => {
    expect(swipePath('up', 1000, 2000)).toEqual({
      startX: 500,
      startY: 1800,
      endX: 500,
      endY: 200,
    });
    expect(swipePath('down', 1000, 2000)).toEqual({
      startX: 500,
      startY: 200,
      endX: 500,
      endY: 1800,
    });
    expect(swipePath('left', 1000, 2000)).toEqual({
      startX: 900,
      startY: 1000,
      endX: 100,
      endY: 1000,
    });
    expect(swipePath('right', 1000, 2000)).toEqual({
      startX: 100,
      startY: 1000,
      endX: 900,
      endY: 1000,
    });
  });

  it('rounds to whole pixels', () => {
    const p = swipePath('up', 1081, 2221);
    for (const v of Object.values(p)) expect(Number.isInteger(v)).toBe(true);
  });
});
