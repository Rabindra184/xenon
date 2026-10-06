import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * The go-ios release the installed Xenon plugin expects, or null if it can't be
 * read (plugin not installed, or an older release that doesn't ship the file).
 *
 * The plugin owns this pin (`GO_IOS_VERSION` in its goIosVersion script) and
 * installs go-ios to match it; reading it from the installed package keeps the
 * app from carrying a copy that drifts when the plugin is updated.
 */
export function loadGoIosPin(pluginDir: string): string | null {
  try {
    const req = createRequire(path.join(pluginDir, 'package.json'));
    const file = './lib/src/scripts/goIosVersion.js';
    // Node caches required modules for the life of the app; drop it so a plugin
    // updated by Set up is read fresh instead of showing the old pin until restart.
    delete req.cache[req.resolve(file)];
    const version = (req(file) as { GO_IOS_VERSION?: unknown }).GO_IOS_VERSION;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}
