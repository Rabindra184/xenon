/**
 * Single source of truth for the ffmpeg binary path.
 *
 * A bare `ffmpeg` ENOENTs when the server is launched from the Mac app, which
 * inherits no shell PATH — so every ffmpeg spawn must go through the bundled
 * `@ffmpeg-installer/ffmpeg` binary rather than a bare name. Falls back to
 * `ffmpeg` on PATH only if the package is somehow unavailable.
 */
let cached: string | null = null;

export function resolveFfmpegPath(): string {
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require('@ffmpeg-installer/ffmpeg').path as string;
  } catch {
    cached = 'ffmpeg';
  }
  return cached;
}
