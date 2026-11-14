import { Container } from 'typedi';
import { SESSION_MANAGER } from './SessionManager';
import { AppiumUmbrella } from './appiumUmbrella';

/**
 * Whether a session still runs on this server: one SESSION_MANAGER holds (a
 * session routed to a node or cloud, or a local one with the dashboard or
 * video on), or one Appium's umbrella has.
 *
 * Never SESSION_MANAGER alone. A local session goes into it only with the
 * dashboard on or its video recorded, so on a default server (dashboard off) a
 * session with `xe:record_video: false` is in no map, and the sweepers that
 * asked SESSION_MANAGER freed its phone a minute into the test.
 */
export function isSessionLiveHere(sessionId: string | null | undefined): boolean {
  if (!sessionId) return false;
  if (SESSION_MANAGER.isValidSession(sessionId)) return true;
  return Container.get(AppiumUmbrella).hasSession(sessionId);
}
