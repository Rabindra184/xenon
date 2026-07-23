export const SCRCPY_DEVICE_JAR_PATH = '/data/local/tmp/scrcpy-server-manual.jar';

/**
 * The argv passed to the resolved adb AFTER any `-s <udid>` — a headless,
 * video-only scrcpy-server launch. All three metadata channels are disabled
 * (`send_device_meta=false`, `send_codec_meta=false`, `send_frame_meta=false`)
 * so the socket carries plain Annex-B H.264 that the existing H264NalParser
 * consumes unchanged. `send_dummy_byte=true` (the tunnel_forward readiness byte)
 * is explicit because the socket reader skips exactly one leading byte.
 * Arg NAMES verified against the vendored scrcpy 3.3.4 jar's dex; the version
 * constant and this argv move together (see scrcpyVersion.ts / vendor/README.md).
 * No `scid` → the server listens on `localabstract:scrcpy` (per-device namespace).
 */
export function buildScrcpyServerArgs(opts: {
  version: string;
  jarDevicePath: string;
  maxSize: number;
}): string[] {
  return [
    'shell',
    `CLASSPATH=${opts.jarDevicePath}`,
    'app_process',
    '/',
    'com.genymobile.scrcpy.Server',
    opts.version,
    'tunnel_forward=true',
    'audio=false',
    'control=false',
    'video=true',
    'video_codec=h264',
    `max_size=${opts.maxSize}`,
    'video_bit_rate=4000000',
    'max_fps=30',
    'send_device_meta=false',
    'send_codec_meta=false',
    'send_frame_meta=false',
    'send_dummy_byte=true',
    'cleanup=true',
  ];
}

/**
 * scrcpy `max_size` caps the device's LONGER edge (single int, aspect preserved).
 * Derive it so the SHORTER edge lands near `targetShortEdge` (matches today's
 * ~720-wide screenrecord downscale). Never upscales.
 */
export function scrcpyMaxSizeFromDims(sw: number, sh: number, targetShortEdge = 720): number {
  const shortE = Math.min(sw, sh);
  const longE = Math.max(sw, sh);
  if (!Number.isFinite(shortE) || !Number.isFinite(longE) || shortE <= 0 || longE <= 0) {
    return targetShortEdge * 2; // safe default longer-edge cap
  }
  if (shortE <= targetShortEdge) return longE; // no upscale
  return Math.round(longE * (targetShortEdge / shortE));
}

/** Parse the local TCP port that `adb forward tcp:0 …` prints on stdout. */
export function parseAdbForwardPort(stdout: string): number {
  const port = parseInt(String(stdout).trim(), 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Unparseable adb forward port: ${JSON.stringify(stdout)}`);
  }
  return port;
}
