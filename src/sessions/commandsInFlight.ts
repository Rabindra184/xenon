import log from '../logger';

/**
 * The test's commands running now on this server, per session: the ones the
 * plugin's interceptor runs for this server's own phones, and the ones a hub
 * forwards to a node.
 *
 * The idle sweeper (releaseBlockedDevices) frees a session's phone a
 * new-command timeout after its clock (`lastCmdExecutedAt`). Appium pauses
 * its own new-command timer while a command runs and starts it again when
 * the command ends; Xenon touched its clock only when a command started. So
 * one command longer than the timeout (a find whose heal reaches the AI
 * tiers, a large installApp) had its phone freed, its span ended and its
 * session stopped while the driver still ran it. Through 2.36.
 *
 * Now a session with a command running is never idle (the sweeper asks
 * hasCommandInFlight), and each command touches the clock again when it
 * ends, either way, so the timeout counts from there, as Appium's does.
 *
 * In memory: the sweeper runs in the process that runs the commands. A count,
 * not a flag, since a session's commands may overlap (a client's parallel
 * calls).
 */
const running = new Map<string, number>();

/** Whether one of the session's commands is running on this server now. */
export function hasCommandInFlight(sessionId: string | null | undefined): boolean {
  return !!sessionId && (running.get(sessionId) ?? 0) > 0;
}

function ended(sessionId: string): void {
  const left = (running.get(sessionId) ?? 1) - 1;
  if (left > 0) running.set(sessionId, left);
  else running.delete(sessionId);
}

/**
 * Run `command` as one of the session's commands: counted while it runs,
 * then the session's clock is touched (`touch`, keyed on the session's claim,
 * so a session that has ended meanwhile touches nothing). The count goes down
 * only once that touch has landed, so the sweeper never sees the command gone
 * with the clock still where the command started. The touch isn't waited for:
 * the command's answer goes back at once. Never throws for the touch.
 */
export async function runAsSessionCommand<T>(
  sessionId: string,
  touch: (sessionId: string) => Promise<void>,
  command: () => Promise<T>,
): Promise<T> {
  running.set(sessionId, (running.get(sessionId) ?? 0) + 1);
  try {
    return await command();
  } finally {
    let touched: Promise<void>;
    try {
      touched = touch(sessionId);
    } catch (error) {
      touched = Promise.reject(error);
    }
    void touched
      .catch((error: any) =>
        log.warn(
          `Could not record the end of a command of session ${sessionId}: ${error?.message ?? error}`,
        ),
      )
      .finally(() => ended(sessionId));
  }
}
