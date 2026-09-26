import type { OverlayAnnotation } from './recording-group-store';
import { paintAnnotation } from './AnnotationOverlay';

export const RASTER_LONG_SIDE = 1600;

/** Raster with the tile's aspect ratio and a fixed long side, so strokes stay sharp once scaled to the video. */
export function rasterSize(w: number, h: number): { w: number; h: number } {
  const k = RASTER_LONG_SIDE / Math.max(w, h);
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/**
 * Render one mark to a transparent PNG with the exact code the live overlay
 * uses. The context is scaled from tile CSS px, so stroke width and arrow-head
 * size keep the proportion to the frame that the user saw. The server
 * composites it over the video, so the recording matches the preview.
 *
 * Imports paintAnnotation from AnnotationOverlay, which imports this module: a
 * cycle that is safe because neither is called while the modules evaluate.
 */
export function rasterizeAnnotation(
  ann: OverlayAnnotation,
  displayW: number,
  displayH: number,
  doc: Pick<Document, 'createElement'> = document,
): string | null {
  if (displayW <= 0 || displayH <= 0) return null;
  const { w, h } = rasterSize(displayW, displayH);
  const canvas = doc.createElement('canvas') as HTMLCanvasElement;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(w / displayW, h / displayH);
  paintAnnotation(ctx, displayW, displayH, ann);
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
