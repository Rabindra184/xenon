import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SplitDivider from './SplitDivider';

function renderDivider(overrides: Partial<React.ComponentProps<typeof SplitDivider>> = {}) {
  const containerRef = React.createRef<HTMLDivElement>();
  const props = {
    share: 0.4,
    limits: { min: 0, max: 1 },
    containerRef,
    onChange: vi.fn(),
    onCommit: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(
    <div ref={containerRef}>
      <SplitDivider {...props} />
    </div>,
  );
  return { ...props, sep: screen.getByRole('separator') };
}

describe('SplitDivider — drag interruption', () => {
  // A drag that never sees pointerup (a competing touch/pen gesture firing
  // pointercancel, or the browser dropping capture) used to leave `dragging`
  // true forever: every later pointermove over the divider would keep
  // resizing with no button pressed, and the divider stayed styled dragging.
  it('ends the drag on pointercancel', () => {
    const { sep } = renderDivider();
    fireEvent.pointerDown(sep, { pointerId: 1 });
    expect(sep.className).toContain('is-dragging');
    fireEvent.pointerCancel(sep, { pointerId: 1 });
    expect(sep.className).not.toContain('is-dragging');
  });

  it('ends the drag on lostpointercapture', () => {
    const { sep } = renderDivider();
    fireEvent.pointerDown(sep, { pointerId: 1 });
    expect(sep.className).toContain('is-dragging');
    fireEvent.lostPointerCapture(sep, { pointerId: 1 });
    expect(sep.className).not.toContain('is-dragging');
  });

  it('commits the latest share when the drag is cancelled', () => {
    const onCommit = vi.fn();
    const { sep } = renderDivider({ onCommit });
    fireEvent.pointerDown(sep, { pointerId: 1 });
    fireEvent.pointerCancel(sep, { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  // pointerup calls releasePointerCapture, which fires lostpointercapture
  // right behind it — both must end the same drag, not commit it twice.
  it('does not double-commit when pointerup is followed by lostpointercapture', () => {
    const onCommit = vi.fn();
    const { sep } = renderDivider({ onCommit });
    fireEvent.pointerDown(sep, { pointerId: 1 });
    fireEvent.pointerUp(sep, { pointerId: 1 });
    fireEvent.lostPointerCapture(sep, { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
