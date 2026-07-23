export type StreamPlayer = 'h264' | 'mjpeg';

/**
 * Choose the tile's video player. H.264 (WebCodecs canvas) is used only for an
 * Android device whose backend advertises `type: 'h264'` (flag on, scrcpy/
 * screenrecord started) AND whose browser supports `VideoDecoder`. Everything
 * else — iOS, flag off, WebCodecs-less browsers — uses the MJPEG `<img>`.
 */
export function pickStreamPlayer(
  platform: string,
  backendType: 'mjpeg' | 'h264' | undefined,
  hasWebCodecs: boolean,
): StreamPlayer {
  const isAndroid =
    platform === 'android' || platform === 'androidtv' || platform === 'android-tv';
  return isAndroid && backendType === 'h264' && hasWebCodecs ? 'h264' : 'mjpeg';
}
