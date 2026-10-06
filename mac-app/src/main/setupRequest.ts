import type { Profile } from '@shared/types';
import type { SetupOptions } from './SetupService';

/** What the renderer sends to run setup: the profile, never a pre-resolved folder. */
export interface SetupRequest {
  profile: Profile;
  pluginSource?: 'local' | 'npm';
  drivers?: Array<'uiautomator2' | 'xcuitest'>;
}

/**
 * Turn a request into install options. The Appium folder always comes from the
 * same resolver the header, preflight and launch use, so setup can't install
 * somewhere Start never looks.
 */
export function toSetupOptions(req: SetupRequest, resolveHome: (p: Profile) => string): SetupOptions {
  return {
    appiumHome: resolveHome(req.profile),
    pluginSource: req.pluginSource ?? 'local',
    drivers: req.drivers ?? ['uiautomator2', 'xcuitest']
  };
}
