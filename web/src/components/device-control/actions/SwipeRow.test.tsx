import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SwipeRow } from './SwipeRow';

describe('SwipeRow', () => {
  it('offers four named swipes', () => {
    const onSwipe = vi.fn();
    render(<SwipeRow onSwipe={onSwipe} />);
    for (const d of ['up', 'down', 'left', 'right']) {
      fireEvent.click(screen.getByRole('button', { name: `Swipe ${d}` }));
      expect(onSwipe).toHaveBeenLastCalledWith(d);
    }
  });
});
