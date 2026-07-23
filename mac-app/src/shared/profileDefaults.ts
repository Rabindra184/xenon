import type { Profile } from './types';

// Single definition of "a new profile", shared by the first-run seed (main) and
// the sidebar's + button (renderer) so the two can't drift apart. Id and clock
// are injected because each side has its own source for them.

export const NEW_PROFILE_NAME = 'New profile';
export const SEED_PROFILE_NAME = 'Local server';

export function makeDefaultProfile(opts: { id: string; now: number; name?: string }): Profile {
  return {
    id: opts.id,
    name: opts.name ?? NEW_PROFILE_NAME,
    settings: {
      platform: 'both',
      enableDashboard: true,
      maxSessions: 8,
      // Faster scrcpy H.264 Android live preview on by default; the Streaming
      // section's toggle reflects/overrides this. scrcpy-incompatible devices
      // auto-fall back (screenrecord → MJPEG), so it's safe to default on.
      streaming: { androidH264: true },
      // Booted-only iOS discovery. Xenon leases one WDA port per discovered
      // simulator from a 100-port pool (8100-8199), so a host with more
      // installed simulators than that fails iOS discovery outright. Booted-only
      // keeps a fresh profile working regardless of how many sims are installed;
      // the Health tab explains the trade-off for hosts that want it off.
      bootedSimulators: true
    },
    server: {
      port: 4723,
      basePath: '/wd/hub',
      appiumHome: '',
      keepAliveTimeout: 800
    },
    secretRefs: [],
    env: {},
    createdAt: opts.now,
    updatedAt: opts.now
  };
}

/**
 * Backfill fields added in later versions so older persisted profiles stay valid.
 * Runs on every profile read. A profile that already set `streaming` keeps its own
 * value (it spreads last); one that predates it gets the on-by-default streaming
 * preference so the Streaming toggle reflects the actual launch default.
 */
export function migrateProfile(profile: Profile): Profile {
  return {
    ...profile,
    env: profile.env ?? {},
    secretRefs: profile.secretRefs ?? [],
    settings: {
      streaming: { androidH264: true },
      ...profile.settings
    }
  };
}
