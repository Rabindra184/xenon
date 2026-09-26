import * as path from 'path';

/** Decoded-size cap for one mark's PNG. A full-frame freehand scribble is far below it. */
export const MAX_ANNOTATION_PNG_BYTES = 2 * 1024 * 1024;
const PREFIX = 'data:image/png;base64,';
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Where a mark's rendered image lives: beside the recording's `video/` dir,
 * so the cleanup that removes `<recordings>/<id>/` takes the images with it.
 */
export function annotationImagePath(videoFilePath: string, annotationId: string): string {
  return path.join(path.dirname(path.dirname(videoFilePath)), 'annotations', `${annotationId}.png`);
}

/** `null` = no image sent. Otherwise a decoded PNG or the reason it was refused. */
export function decodeAnnotationImage(
  image: unknown,
): null | { ok: true; png: Buffer } | { ok: false; error: string } {
  if (image === undefined || image === null) return null;
  if (typeof image !== 'string' || !image.startsWith(PREFIX)) {
    return { ok: false, error: 'image must be a data:image/png;base64 URL' };
  }
  const png = Buffer.from(image.slice(PREFIX.length), 'base64');
  if (png.length > MAX_ANNOTATION_PNG_BYTES) {
    return { ok: false, error: `image exceeds ${MAX_ANNOTATION_PNG_BYTES} bytes` };
  }
  if (png.length < PNG_SIG.length || !png.subarray(0, PNG_SIG.length).equals(PNG_SIG)) {
    return { ok: false, error: 'image is not a PNG' };
  }
  return { ok: true, png };
}
