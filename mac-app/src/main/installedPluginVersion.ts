import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NPM_PLUGIN } from './setupPlan';

/** Folder the Xenon plugin package lives in inside a given APPIUM_HOME. */
export function installedPluginDir(appiumHome: string): string {
  return path.join(appiumHome, 'node_modules', NPM_PLUGIN);
}

/**
 * Read the version of the Xenon plugin actually installed in a given
 * APPIUM_HOME, or null if it isn't installed / can't be read.
 *
 * The footer previously showed `SchemaService`'s pluginVersion — the version
 * recorded when the bundled schema was last synced — which goes stale after a
 * plugin install/update. This reads the live installed package instead.
 */
export function readInstalledPluginVersion(appiumHome: string): string | null {
  if (!appiumHome) return null;
  const pkgJson = path.join(installedPluginDir(appiumHome), 'package.json');
  try {
    if (!existsSync(pkgJson)) return null;
    const parsed = JSON.parse(readFileSync(pkgJson, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}
