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
