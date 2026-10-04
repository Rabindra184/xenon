/**
 * usbmuxd is the system service every real-iPhone call goes through
 * (/var/run/usbmuxd). A Linux machine without iPhone tooling, such as an
 * Android-only node or a container, has none. That is a normal setup, not a
 * fault: it means "no iPhones here", said once.
 */

const USBMUXD = /usbmuxd/;

/**
 * True for the ways a missing or stopped usbmuxd shows up: a connect to its
 * socket that finds nothing there (ENOENT) or nobody listening
 * (ECONNREFUSED), and appium-ios-device's own "The usbmuxd socket at ...
 * does not exist" error.
 */
export function isUsbmuxdUnavailable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; address?: unknown; message?: unknown };
  if ((e.code === 'ENOENT' || e.code === 'ECONNREFUSED') && USBMUXD.test(String(e.address ?? ''))) {
    return true;
  }
  return /usbmuxd socket .* does not exist/.test(String(e.message ?? ''));
}

let noticed = false;

/**
 * Warns that iPhones aren't available, once per process: the tracker and
 * discovery's poll both meet it, and the poll runs on every device sync.
 */
export function usbmuxdNotice(logger: { warn: (msg: string) => void }, err: unknown): void {
  if (noticed) return;
  noticed = true;
  const reason = (err as { message?: unknown } | null)?.message;
  logger.warn(
    'Real iPhones aren’t available on this machine: usbmuxd isn’t running' +
      (reason ? ` (${String(reason)})` : '') +
      '. Android devices and simulators are unaffected.',
  );
}

/** Tests only. */
export function resetUsbmuxdNotice(): void {
  noticed = false;
}
