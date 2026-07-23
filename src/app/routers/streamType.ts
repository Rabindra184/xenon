export type StreamType = 'mjpeg' | 'h264';

/**
 * Which live-stream transport the backend advertises for a device.
 *
 * Android uses H.264 (scrcpy → WebCodecs) only when the `streaming.androidH264`
 * flag is on and the device is not recording — a recording device keeps the
 * MJPEG path so the recording pipeline (which reads the MJPEG server) is
 * unaffected (spec phase-1 rule). iOS/tvOS always use MJPEG (WDA emits it
 * directly).
 */
export function resolveStreamType(
  platform: string,
  flagOn: boolean,
  recording: boolean,
): StreamType {
  const isAndroid = platform === 'android' || platform === 'androidtv' || platform === 'android-tv';
  if (!isAndroid || !flagOn || recording) return 'mjpeg';
  return 'h264';
}
