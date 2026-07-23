import path from 'path';

/**
 * Pinned scrcpy-server version. The vendored jar filename AND the `app_process`
 * <version> argument both derive from this — they must always agree, so this is
 * the single source of truth. Bump procedure: see vendor/README.md.
 */
export const SCRCPY_SERVER_VERSION = '2.7';

export function scrcpyServerJarFilename(): string {
  return `scrcpy-server-${SCRCPY_SERVER_VERSION}.jar`;
}

/** Absolute path to the vendored jar, valid in src (ts-node) and lib (built). */
export function scrcpyServerJarPath(): string {
  return path.join(__dirname, 'vendor', scrcpyServerJarFilename());
}
