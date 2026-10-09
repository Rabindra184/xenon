// A running server keeps what it was started with until the next start: its
// port, base path and Appium folder. One of them edited meanwhile applies only
// then, and Settings says so under it. Pure, so the rule is unit-tested.

import type { Profile, ServerState } from '@shared/types';

export type RestartField = 'server.basePath' | 'server.port' | 'server.appiumHome';

/**
 * Whether the profile's own server is starting or running: every option then
 * waits for a restart, and Settings says so once, above its tabs.
 */
export function serverRunsFor(server: ServerState, profile: Profile): boolean {
  return server.profileId === profile.id && (server.status === 'starting' || server.status === 'running');
}

/**
 * The server settings of `profile` that differ from what its server was started
 * with, while that server is starting or running; empty otherwise (another
 * profile's server, or none). A value the server did not report (null) is not
 * compared. Put back as it was started, a setting needs no restart.
 */
export function restartNeeded(server: ServerState, profile: Profile): RestartField[] {
  if (!serverRunsFor(server, profile)) return [];
  const changed: RestartField[] = [];
  if (server.basePath !== null && server.basePath !== profile.server.basePath) changed.push('server.basePath');
  if (server.port !== null && server.port !== profile.server.port) changed.push('server.port');
  // `!= null`: a state from before the field existed has none.
  if (server.appiumHome != null && server.appiumHome !== profile.server.appiumHome) changed.push('server.appiumHome');
  return changed;
}
