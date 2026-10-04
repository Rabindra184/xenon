/**
 * Whether this browser can decode the H.264 live preview (WebCodecs'
 * `VideoDecoder`). Browsers expose it only in a secure context, https or
 * localhost, so a dashboard opened over plain http://hub:4723 has none and
 * shows MJPEG.
 */
export function canDecodeH264(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof window !== 'undefined' && typeof (window as any).VideoDecoder !== 'undefined';
}
