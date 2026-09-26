import { describe, expect, it, vi } from 'vitest';
import { rasterSize, rasterizeAnnotation } from './rasterizeAnnotation';

const noopCtx = (extra: Record<string, unknown> = {}) =>
  new Proxy(extra, {
    get: (t: any, k) => (k in t ? t[k] : () => undefined),
    set: () => true,
  });

describe('rasterizeAnnotation', () => {
  it('sizes the raster to the tile aspect with a 1600px long side', () => {
    expect(rasterSize(277, 572)).toEqual({ w: 775, h: 1600 });
    expect(rasterSize(800, 400)).toEqual({ w: 1600, h: 800 });
  });

  it('paints through a context scaled from tile CSS px to the raster', () => {
    const scale = vi.fn();
    const ctx = noopCtx({ scale });
    const canvas: any = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toDataURL: () => 'data:image/png;base64,AAA',
    };
    const doc: any = { createElement: () => canvas };
    const out = rasterizeAnnotation(
      { shape: 'RECT', color: '#ff0000', geometry: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
      277,
      572,
      doc,
    );
    expect(out).toBe('data:image/png;base64,AAA');
    expect(canvas.width).toBe(775);
    expect(canvas.height).toBe(1600);
    expect(scale).toHaveBeenCalledWith(775 / 277, 1600 / 572);
  });

  it('returns null without a 2d context or with an empty tile', () => {
    const doc: any = { createElement: () => ({ getContext: () => null }) };
    const ann = { shape: 'RECT' as const, color: 'red', geometry: { x: 0, y: 0, w: 1, h: 1 } };
    expect(rasterizeAnnotation(ann, 10, 10, doc)).toBe(null);
    expect(rasterizeAnnotation(ann, 0, 10, doc)).toBe(null);
  });
});
