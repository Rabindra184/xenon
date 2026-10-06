import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Matches the assignment line only, in the compiled CommonJS form
 * (`exports.GO_IOS_VERSION = 'v1.2.1';`) or a plain declaration, either quote
 * style. Anchored to the start of a line so a comment that merely mentions the
 * name, or tsc's `exports.X = exports.GO_IOS_VERSION = void 0;` preamble, can't match.
 */
const PIN_RE = /^\s*(?:exports\.|export\s+const\s+|const\s+)GO_IOS_VERSION\s*=\s*['"]([^'"\r\n]+)['"]/m;

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
