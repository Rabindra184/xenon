import { Service } from 'typedi';

/**
 * Appium's umbrella driver (`AppiumDriver`), as this process last saw it.
 *
 * It holds every session this server runs, and `sessionExists` reads its map
 * without running a command. A command, even a read like `GET .../timeouts`,
 * restarts the session driver's new-command timeout and Xenon's idle clock, so
 * a liveness probe that sends one keeps an abandoned session (and its phone)
 * alive for ever. Asking the umbrella touches neither.
 *
 * Plugins only get the umbrella as the `driver` of a create (for a session's
 * commands they get its driver), so XenonPlugin.createSession notes it here.
 * Before the first create there is no umbrella yet, and no session either.
 */

interface UmbrellaLike {
  sessionExists(sessionId: string): unknown;
}

function isUmbrella(driver: unknown): driver is UmbrellaLike {
  return (
    !!driver &&
    typeof driver === 'object' &&
    typeof (driver as { sessionExists?: unknown }).sessionExists === 'function'
  );
}

@Service()
export class AppiumUmbrella {
  private umbrella: UmbrellaLike | undefined;

  /** Remember the umbrella a create was given. Anything else is ignored. */
  note(driver: unknown): void {
    if (isUmbrella(driver)) this.umbrella = driver;
  }

  /** Whether Appium has this session now, without sending it a command. */
  hasSession(sessionId: string): boolean {
    if (!sessionId || !this.umbrella) return false;
    return !!this.umbrella.sessionExists(sessionId);
  }
}
