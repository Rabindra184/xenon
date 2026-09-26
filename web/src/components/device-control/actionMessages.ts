/**
 * Wording for the Actions tab's results. Several actions used to fail
 * silently (typing, swipes) or with a hint for the wrong platform, so the
 * messages live here where they're tested.
 */

/** Why an action failed, from the thrown error; '' when it doesn't say. */
export function errorReason(err: unknown): string {
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' ? message.trim() : '';
}

/** "Couldn’t send the text: reason", or "Couldn’t send the text." */
export function failed(what: string, err: unknown): string {
  const reason = errorReason(err);
  return reason ? `Couldn’t ${what}: ${reason}` : `Couldn’t ${what}.`;
}

/**
 * Android reads the clipboard through the Appium Settings app, which is
 * usually what's missing. iOS reads it through WebDriverAgent, so the server's
 * own reason is more useful there.
 */
export function clipboardError(platform: string | undefined, err: unknown): string {
  if (platform === 'android') {
    return 'Couldn’t read the clipboard. Check that the Appium Settings app is installed on the device.';
  }
  return failed('read the clipboard', err);
}
