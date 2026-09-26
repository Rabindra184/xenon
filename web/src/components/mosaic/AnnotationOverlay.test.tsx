import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { AnnotationOverlay, appendPoint, paintAnnotation } from './AnnotationOverlay';

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

describe('appendPoint (freehand path)', () => {
  it('drops points closer than 2px to the last one', () => {
    const p = appendPoint([[0, 0]], 1, 1);
    expect(p).toEqual([[0, 0]]);
    expect(appendPoint(p, 3, 0)).toEqual([
      [0, 0],
      [3, 0],
    ]);
  });

  it('caps the path at 2000 points', () => {
    const full = Array.from({ length: 2000 }, (_, i) => [i * 3, 0] as [number, number]);
    expect(appendPoint(full, 99999, 0)).toHaveLength(2000);
  });
});

describe('paintAnnotation FREEHAND', () => {
  const recordingCtx = () => {
    const calls: string[] = [];
    const drawing = ['beginPath', 'moveTo', 'lineTo', 'stroke', 'strokeRect', 'fillRect'];
    const ctx = new Proxy(
      {},
      {
        get: (_t, k) =>
          typeof k === 'string' && drawing.includes(k) ? () => calls.push(k) : undefined,
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
  };

  it('strokes the recorded path instead of a rectangle', () => {
    const { ctx, calls } = recordingCtx();
    paintAnnotation(ctx, 100, 200, {
      shape: 'FREEHAND',
      color: '#ff0000',
      geometry: {
        x: 0.1,
        y: 0.1,
        w: 0.5,
        h: 0.5,
        points: [
          [0.1, 0.1],
          [0.3, 0.4],
          [0.6, 0.6],
        ],
      },
    });
    expect(calls).toContain('lineTo');
    expect(calls).not.toContain('strokeRect');
  });

  it('still draws a legacy freehand row without points as its box', () => {
    const { ctx, calls } = recordingCtx();
    paintAnnotation(ctx, 100, 200, {
      shape: 'FREEHAND',
      color: '#ff0000',
      geometry: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
    });
    expect(calls).toContain('strokeRect');
  });
});
