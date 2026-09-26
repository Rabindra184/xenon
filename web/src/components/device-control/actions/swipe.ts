export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

/**
 * A swipe through the screen's centre across 80% of it, as the old D-pad sent.
 * "up" moves the content up: the finger goes from low to high.
 */
export function swipePath(direction: SwipeDirection, width: number, height: number) {
  const cx = width / 2;
  const cy = height / 2;
  const dx = width * 0.4;
  const dy = height * 0.4;
  const [startX, startY, endX, endY] = {
    up: [cx, cy + dy, cx, cy - dy],
    down: [cx, cy - dy, cx, cy + dy],
    left: [cx + dx, cy, cx - dx, cy],
    right: [cx - dx, cy, cx + dx, cy],
  }[direction].map(Math.round);
  return { startX, startY, endX, endY };
}
