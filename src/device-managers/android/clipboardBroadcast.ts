/** Appium Settings' clipboard receiver and its only clipboard action (read). */
export const CLIPBOARD_RECEIVER = 'io.appium.settings/.receivers.ClipboardReceiver';
export const CLIPBOARD_GET_ACTION = 'io.appium.settings.clipboard.get';

/**
 * The clipboard text from `am broadcast … io.appium.settings.clipboard.get`.
 *
 * Appium Settings answers `result=-1, data="<base64>"`, with an empty data for
 * an empty clipboard. Anything else means the broadcast reached no receiver,
 * or the wrong one (a missing app answers `result=0`), so it is an error, not
 * an empty clipboard.
 */
export function parseClipboardBroadcast(output: string): string {
  const answered = /\bresult=-1\b/.test(output);
  const data = /data="([^"]*)"/.exec(output);
  if (!answered || !data) {
    const last = output.trim().split('\n').pop() || 'no output';
    throw new Error(
      `Appium Settings didn’t return the clipboard. Check that it is installed and up to date (${last}).`,
    );
  }
  return data[1] ? Buffer.from(data[1], 'base64').toString('utf8') : '';
}
