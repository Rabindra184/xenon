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
  // jsdom has no layout: give the row a width so a pointer position maps to
  // a share (x = 506 is the middle of 1012, i.e. a share of 0.5).
  const row = containerRef.current as HTMLDivElement;
  row.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1012, height: 400 }) as DOMRect;
  return { ...props, sep: screen.getByRole('separator') };
}

// jsdom has no PointerEvent, and fireEvent's pointer events fall back to a
// plain Event that drops clientX; a MouseEvent of the same type carries it.
const pointerDown = (el: Element, clientX: number) =>
  fireEvent(el, new MouseEvent('pointerdown', { bubbles: true, clientX }));
const pointerMove = (el: Element, clientX: number) =>
  fireEvent(el, new MouseEvent('pointermove', { bubbles: true, clientX }));

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
    pointerDown(sep, 406);
    pointerMove(sep, 506);
    fireEvent.pointerCancel(sep, { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  // pointerup calls releasePointerCapture, which fires lostpointercapture
  // right behind it — both must end the same drag, not commit it twice.
  it('does not double-commit when pointerup is followed by lostpointercapture', () => {
    const onCommit = vi.fn();
    const { sep } = renderDivider({ onCommit });
    pointerDown(sep, 406);
    pointerMove(sep, 506);
    fireEvent.pointerUp(sep, { pointerId: 1 });
    fireEvent.lostPointerCapture(sep, { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

describe('SplitDivider — a click is not a drag', () => {
  // On a narrow window the shown share is clamped below the stored one;
  // committing it on a plain click overwrote the wider preference.
  it('does not commit a press and release that never moved it', () => {
    const onCommit = vi.fn();
    const { sep } = renderDivider({ onCommit });
    fireEvent.pointerDown(sep, { pointerId: 1 });
    fireEvent.pointerUp(sep, { pointerId: 1 });
    fireEvent.lostPointerCapture(sep, { pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not commit a move that lands on the same share', () => {
    const onCommit = vi.fn();
    const onChange = vi.fn();
    // x = 406 maps to (406 - 6) / 1000 = 0.4, the current share: a real
    // drag (10px of travel) that ends where it began.
    const { sep } = renderDivider({ onCommit, onChange });
    pointerDown(sep, 396);
    pointerMove(sep, 406);
    fireEvent.pointerUp(sep, { pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  // A click's jitter would move the share a pixel's worth and commit the
  // clamped value, so the pointer has to travel 3px before it is a drag.
  it('ignores a pointer that has not yet travelled 3px', () => {
    const onCommit = vi.fn();
    const onChange = vi.fn();
    const { sep } = renderDivider({ onCommit, onChange });
    pointerDown(sep, 406);
    pointerMove(sep, 407);
    pointerMove(sep, 404);
    fireEvent.pointerUp(sep, { pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits once the pointer has travelled, and follows it back', () => {
    const onCommit = vi.fn();
    const onChange = vi.fn();
    const { sep } = renderDivider({ onCommit, onChange });
    pointerDown(sep, 406);
    pointerMove(sep, 416);
    expect(onChange).toHaveBeenLastCalledWith(0.41);
    // Past the threshold, small moves count, even back near the start.
    pointerMove(sep, 408);
    expect(onChange).toHaveBeenLastCalledWith(0.402);
    fireEvent.pointerUp(sep, { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('passes a moved share on while dragging', () => {
    const onChange = vi.fn();
    const { sep } = renderDivider({ onChange });
    pointerDown(sep, 406);
    pointerMove(sep, 506);
    expect(onChange).toHaveBeenLastCalledWith(0.5);
  });
});
