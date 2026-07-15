import { app } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync } from 'node:fs';

// Centralized filesystem locations the launcher owns.

function ensure(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** App-managed data root, e.g. ~/Library/Application Support/xenon-control. */
export function dataDir(): string {
  return ensure(app.getPath('userData'));
}

/** Default APPIUM_HOME the launcher provisions the plugin into when a profile leaves it blank. */
export function defaultAppiumHome(): string {
  return ensure(path.join(dataDir(), 'appium-home'));
}

/** Directory where generated per-launch Appium config YAML files are written. */
export function launchConfigDir(): string {
  return ensure(path.join(dataDir(), 'launch-configs'));
}

/** Location of the bundled schema snapshot, resolved for both dev and packaged builds. */
export function resourcesDir(): string {
  // In dev, resources/ lives at the project root; when packaged, electron-builder
  // copies it next to the app via extraResources -> process.resourcesPath.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(app.getAppPath(), 'resources');
}

/** Where Xenon caches its auto-provisioned artifacts (go-ios, sqlite db). */
export function xenonCacheDir(): string {
  return path.join(os.homedir(), '.cache', 'xenon');
}
