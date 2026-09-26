import { fitContain } from './AnnotationOverlay';

/**
 * Map a pointer position on a tile to device pixels.
 *
 * The tap layer covers the whole tile, but the tile can be letterboxed: a
 * narrow 3x2 cell squeezes it out of the device's aspect, and a tile added
 * before the device reported its size uses a 9:16 fallback. The picture sits
 * inside it `object-fit: contain`, so positions are measured against that
 * picture. Mapping against the tile sent taps near the top and bottom of a 3x2
 * tile 223 px off on a 1080x2220 screen.
 *
 * Returns null for a press outside the picture (on the black bars), unless
 * `clamp` is set, which pins it to the nearest screen edge (the end of a swipe).
 * Without `mediaAspect` (no frame yet) the whole tile is the picture, as before.
 */
export function pointerToDevice(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  screenWidth: number,
  screenHeight: number,
  mediaAspect?: number,
  clamp = false,
): { x: number; y: number } | null {
  const box = fitContain(rect.width, rect.height, mediaAspect);
  let nx = (clientX - rect.left - box.left) / box.width;
  let ny = (clientY - rect.top - box.top) / box.height;
  const inside = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
  if (!inside && !clamp) return null;
  nx = Math.min(1, Math.max(0, nx));
  ny = Math.min(1, Math.max(0, ny));
  return { x: Math.round(nx * screenWidth), y: Math.round(ny * screenHeight) };
}
