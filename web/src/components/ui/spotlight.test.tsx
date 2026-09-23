import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Spotlight } from './spotlight';

describe('Spotlight', () => {
  it('removes exactly the listeners it added to its parent', () => {
    const add = vi.spyOn(HTMLElement.prototype, 'addEventListener');
    const remove = vi.spyOn(HTMLElement.prototype, 'removeEventListener');

    const { container, unmount } = render(
      <div>
        <Spotlight />
      </div>,
    );
    // React also registers its own delegated listeners on the root; only
    // the ones on the spotlight's parent are the component's.
    const parent = container.firstElementChild;
    const added = add.mock.calls.filter((_, i) => (add.mock.instances[i] as unknown) === parent);
    expect(added.map(([type]) => type).sort()).toEqual(['mouseenter', 'mouseleave', 'mousemove']);

    unmount();
    const removed = remove.mock.calls.filter(
      (_, i) => (remove.mock.instances[i] as unknown) === parent,
    );
    expect(removed).toEqual(added);

    add.mockRestore();
    remove.mockRestore();
  });

  it('becomes visible while the pointer is over the parent', () => {
    const { container, getByTestId } = render(
      <div>
        <Spotlight />
      </div>,
    );
    const parent = container.firstElementChild as HTMLElement;
    const spot = getByTestId('spotlight');
    expect(spot.className).toContain('opacity-0');

    parent.dispatchEvent(new MouseEvent('mouseenter'));
    parent.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 300 }));
    expect(spot.className).toContain('opacity-100');
    expect(spot.style.getPropertyValue('--spot-x')).toBe(`${400 - 160}px`);

    parent.dispatchEvent(new MouseEvent('mouseleave'));
    expect(spot.className).toContain('opacity-0');
  });
});
