import { paintAnnotation, type NormalizedAnnotation } from '../../mosaic/AnnotationOverlay';

/** The server's base64 PNG as a Blob: a third smaller to keep than the string. */
export function base64ToBlob(base64: string, type = 'image/png'): Blob {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** A Blob's bytes; FileReader where the browser's Blob has no arrayBuffer(). */
export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('the picture could not be read'));
    };
    img.src = url;
  });
}

/** Resolves in time even where the browser never loads images (jsdom). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
  ]);
}

async function decode(
  blob: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  }
  const img = await withTimeout(loadImage(blob), 3000);
  return { source: img, width: img.naturalWidth, height: img.naturalHeight };
}

/** The picture's pixel size, or 0 × 0 when it can't be read. */
export async function pictureSize(png: Blob): Promise<{ width: number; height: number }> {
  try {
    const { width, height } = await decode(png);
    return { width, height };
  } catch {
    return { width: 0, height: 0 };
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('the picture could not be made'))),
      type,
      quality,
    );
  });
}

export const THUMB_LONG_SIDE = 320;

/**
 * A small copy for the rail. Falls back to the full picture when the browser
 * can't draw one: a rail of full PNGs is slower, never broken.
 */
export async function makeThumbnail(png: Blob, longSide = THUMB_LONG_SIDE): Promise<Blob> {
  try {
    const { source, width, height } = await decode(png);
    if (!width || !height) return png;
    const k = Math.min(1, longSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * k));
    canvas.height = Math.max(1, Math.round(height * k));
    const ctx = canvas.getContext('2d');
    if (!ctx) return png;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas, 'image/jpeg', 0.8);
  } catch {
    return png;
  }
}

/**
 * The picture at full resolution with every mark painted over it, by the code
 * the overlay draws with. Marks are in 0..1 of the picture, so they land where
 * they were drawn whatever size the preview had. Throws when it can't.
 */
export async function flattenMarks(png: Blob, marks: NormalizedAnnotation[]): Promise<Blob> {
  const { source, width, height } = await decode(png);
  if (!width || !height) throw new Error('the picture could not be read');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('this browser cannot draw here');
  ctx.drawImage(source, 0, 0, width, height);
  marks.forEach((m) => paintAnnotation(ctx, width, height, m));
  return canvasToBlob(canvas, 'image/png');
}
