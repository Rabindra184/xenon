import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { AnnotationOverlay, appendPoint, fitContain, paintAnnotation } from './AnnotationOverlay';

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
  // Marks are measured against the canvas and burned into the recorded frame,
  // so in a letterboxed tile (late screen size, an iPhone with none, a
  // landscape app) the canvas must cover the picture, not the black bars.
  it('fits the canvas to the video picture inside a letterboxed tile', () => {
    const parent = document.createElement('div');
    Object.defineProperty(parent, 'clientWidth', { value: 400 });
    Object.defineProperty(parent, 'clientHeight', { value: 800 });
    document.body.appendChild(parent);
    const { container } = render(
      <AnnotationOverlay
        enabled
        shape="RECT"
        color="#ff3333"
        onCommit={() => {}}
        mediaAspect={1}
      />,
      { container: parent },
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.left).toBe('0px');
    expect(canvas.style.top).toBe('200px');
    expect(canvas.style.width).toBe('400px');
    expect(canvas.style.height).toBe('400px');
    parent.remove();
  });

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

describe('fitContain (object-fit: contain)', () => {
  it('pillarboxes a tall picture in a wide box', () => {
    expect(fitContain(400, 200, 0.5)).toEqual({ left: 150, top: 0, width: 100, height: 200 });
  });
  it('letterboxes a wide picture in a tall box', () => {
    expect(fitContain(400, 800, 2)).toEqual({ left: 0, top: 300, width: 400, height: 200 });
  });
  it('fills the box when the aspects match or the picture aspect is unknown', () => {
    expect(fitContain(300, 600, 0.5)).toEqual({ left: 0, top: 0, width: 300, height: 600 });
    expect(fitContain(300, 600, undefined)).toEqual({ left: 0, top: 0, width: 300, height: 600 });
  });
});
