/** The reason recorded when Appium ends a session and gives no cause of its own. */
export const UNEXPECTED_SHUTDOWN_REASON = 'Driver shut down unexpectedly';

/**
 * The failure reason of a session Appium ended by itself
 * (`XenonPlugin.onUnexpectedShutdown`): the message of the cause Appium
 * passed, else UNEXPECTED_SHUTDOWN_REASON.
 *
 * Appium's new-command timeout is the usual cause, and its message ("New
 * Command Timeout of 60 seconds expired. Try customizing the timeout using
 * the 'newCommandTimeout' desired capability") is what files the session
 * under TIMEOUT. A driver that gives up on itself passes its own error, such
 * as base-driver's "The driver was unexpectedly shut down!". The umbrella's
 * placeholder for a missing cause, "Unknown error", says nothing, so it gets
 * the fallback too. Through 2.14 every such session was recorded with the
 * fixed reason, which no failure pattern matches, so an idle session was
 * filed UNKNOWN.
 */
export function unexpectedShutdownReason(cause: unknown): string {
  const message =
    typeof cause === 'string' ? cause : (cause as { message?: unknown } | null)?.message;
  const text = typeof message === 'string' ? message.trim() : '';
  return text && text !== 'Unknown error' ? text : UNEXPECTED_SHUTDOWN_REASON;
}
