import * as React from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Hand } from 'lucide-react';
import { Button } from '../../ui/button';
import type { SwipeDirection } from './swipe';

const SWIPES: { direction: SwipeDirection; Icon: typeof ArrowUp }[] = [
  { direction: 'up', Icon: ArrowUp },
  { direction: 'down', Icon: ArrowDown },
  { direction: 'left', Icon: ArrowLeft },
  { direction: 'right', Icon: ArrowRight },
];

/**
 * Swipes by button. Dragging on the live screen needs a mouse, so these keep
 * swiping open to keyboard and screen-reader users; one line instead of the
 * old 230px D-pad.
 */
export function SwipeRow({ onSwipe }: { onSwipe: (direction: SwipeDirection) => void }) {
  return (
    <section className="actions-section actions-swipe" aria-labelledby="actions-swipe-title">
      <h4 id="actions-swipe-title" className="actions-section-title">
        <Hand size={15} aria-hidden="true" /> Swipe
      </h4>
      <div className="actions-swipe-buttons">
        {SWIPES.map(({ direction, Icon }) => (
          <Button
            key={direction}
            variant="secondary"
            size="icon"
            aria-label={`Swipe ${direction}`}
            title={`Swipe ${direction}`}
            onClick={() => onSwipe(direction)}
          >
            <Icon size={14} aria-hidden="true" />
          </Button>
        ))}
      </div>
    </section>
  );
}
