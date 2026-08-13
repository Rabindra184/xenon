/**
 * Which log transport serves a device.
 *
 * Android reads `adb logcat`; iOS reads `go-ios ostrace` (os_trace_relay, the
 * transport Xcode's console uses and the only one carrying Debug-level
 * messages — the older `syslog` carries Notice and Error only).
 *
 * Pure and separate from both services for the same reason `resolveStreamType`
 * is: the choice is a one-line rule that wants a test, and the alternative is
 * a platform check buried in a wiring closure where nothing can reach it.
 */
export type LogSource = 'logcat' | 'ostrace' | 'unsupported';

export function resolveLogSource(platform: string | undefined): LogSource {
  const p = (platform ?? '').toLowerCase();
  if (p === 'android') return 'logcat';
  if (p === 'ios') return 'ostrace';
  // tvOS and anything else: no transport wired up. The caller refuses the
  // stream rather than guessing, so a new platform surfaces as an explicit
  // "unsupported" instead of an empty pane that looks like a broken feature.
  return 'unsupported';
}
