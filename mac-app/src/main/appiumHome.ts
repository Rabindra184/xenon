import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Profile } from '@shared/types';
import { shellAppiumHome } from './env';
import { defaultAppiumHome } from './paths';
import { PLUGIN_MARKER, pickAppiumHome, type AppiumHomeCandidate, type AppiumHomeSource } from './toolchainRules';

// Which APPIUM_HOME a profile launches against. A profile stores '' for "auto"
// so it stays portable across machines; auto is resolved here, per host.

/** Appium's conventional home, used when the app-managed one isn't set up. */
const CONVENTIONAL_HOME = path.join(os.homedir(), '.appium');

/** Cheap probe: the plugin's directory exists in this home's node_modules. */
function hasXenonPlugin(home: string): boolean {
  return existsSync(path.join(home, ...PLUGIN_MARKER));
}

let auto: { path: string; source: AppiumHomeSource } | null = null;

/**
 * Resolve the automatic home once, at startup. Reading the login shell is async
 * (a GUI launch inherits no exports), while the callers below are sync — so the
 * result is cached here and refreshed after a successful install.
 */
export async function warmAppiumHome(): Promise<{ path: string; source: AppiumHomeSource }> {
  const fallback = defaultAppiumHome();
  const shell = await shellAppiumHome();

  const candidates: AppiumHomeCandidate[] = [];
  if (shell) candidates.push({ path: shell, hasPlugin: hasXenonPlugin(shell), source: 'env' });
  candidates.push({ path: fallback, hasPlugin: hasXenonPlugin(fallback), source: 'app-managed' });
  if (CONVENTIONAL_HOME !== fallback && CONVENTIONAL_HOME !== shell) {
    candidates.push({ path: CONVENTIONAL_HOME, hasPlugin: hasXenonPlugin(CONVENTIONAL_HOME), source: 'convention' });
  }

  auto = pickAppiumHome({ candidates, fallback });
  return auto;
}

/** Re-scan after an install may have changed which homes carry the plugin. */
export function invalidateAppiumHome(): void {
  auto = null;
}

/** The resolved home for a profile: its override, else the detected one. */
export function resolveAppiumHome(profile: Profile): string {
  const override = profile.server?.appiumHome?.trim();
  if (override) return override;
  return auto?.path ?? defaultAppiumHome();
}

/** Where the resolved home came from — surfaced in the UI so auto isn't magic. */
export function resolvedAppiumHomeInfo(profile: Profile): { path: string; source: AppiumHomeSource } {
  const override = profile.server?.appiumHome?.trim();
  if (override) return { path: override, source: 'profile' };
  return auto ?? { path: defaultAppiumHome(), source: 'fallback' };
}
