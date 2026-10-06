import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Matches the compiled CommonJS form: `exports.GO_IOS_VERSION = 'v1.2.1';` (either quote style). */
const PIN_RE = /GO_IOS_VERSION\s*=\s*['"]([^'"\r\n]+)['"]/;

/**
 * The go-ios release the installed Xenon plugin expects, or null if it can't be
 * read (plugin not installed, or an older release that doesn't ship the file).
 *
 * The plugin owns this pin (`GO_IOS_VERSION` in its goIosVersion script) and
 * installs go-ios to match it; reading it from the installed package keeps the
 * app from carrying a copy that drifts when the plugin is updated. The file is
 * read as text and never executed: the Appium folder can be any path a profile
 * points at, and merely selecting that profile must not run code from it.
 */
export function loadGoIosPin(pluginDir: string): string | null {
  try {
    const source = readFileSync(path.join(pluginDir, 'lib', 'src', 'scripts', 'goIosVersion.js'), 'utf8');
    return PIN_RE.exec(source)?.[1] ?? null;
  } catch {
    return null;
  }
}
