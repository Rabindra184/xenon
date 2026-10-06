import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { XenonSchema } from '@shared/types';
import { installedPluginDir } from './installedPluginVersion';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the option list (JSON schema) of the Xenon plugin actually installed in
 * a given APPIUM_HOME, plus its version, or null if either can't be read.
 *
 * The file is whatever the plugin's own package.json names under
 * `appium.schema` (the field Appium itself reads), so no file name is assumed.
 * A plugin installed from a local checkout is a symlink to it; reading follows
 * the link. Null means "use the bundled list instead".
 */
export function readInstalledSchema(appiumHome: string): { schema: XenonSchema; version: string } | null {
  if (!appiumHome) return null;
  const pluginDir = installedPluginDir(appiumHome);
  try {
    const pkg: unknown = JSON.parse(readFileSync(path.join(pluginDir, 'package.json'), 'utf8'));
    if (!isPlainObject(pkg) || typeof pkg.version !== 'string') return null;
    const appium = pkg.appium;
    if (!isPlainObject(appium) || typeof appium.schema !== 'string' || !appium.schema) return null;
    const schema: unknown = JSON.parse(readFileSync(path.resolve(pluginDir, appium.schema), 'utf8'));
    if (!isPlainObject(schema) || !isPlainObject(schema.properties)) return null;
    // `required`, when present, is iterated at launch; anything but a list is unusable.
    if (schema.required !== undefined && !Array.isArray(schema.required)) return null;
    return { schema: schema as unknown as XenonSchema, version: pkg.version };
  } catch {
    return null;
  }
}
