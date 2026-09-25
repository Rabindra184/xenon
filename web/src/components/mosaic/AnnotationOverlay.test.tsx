import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { AnnotationOverlay } from './AnnotationOverlay';

describe('AnnotationOverlay', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    // jsdom has no 2d context; paint() already tolerates null.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Annotation geometry is normalized to the canvas box and burned into the
  // video against the full frame, so the canvas must cover the whole tile.
  // `inset: 0` alone does not do that: a <canvas> is a replaced element, so
  // with auto width/height it keeps its intrinsic 300x150 size. Marks were
  // then normalized to that 300x150 band and landed far from where they were
  // drawn once rendered into the recording.
  it('stretches the canvas over the whole tile, not its default 300x150', () => {
    const { container } = render(
      <AnnotationOverlay enabled shape="RECT" color="#ff3333" onCommit={() => {}} />,
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.width).toBe('100%');
    expect(canvas.style.height).toBe('100%');
  });
});
