import type { XenonSchema } from '@shared/types';

/**
 * Args an older plugin lists as `required` though its schema gives them no
 * default (`enableJsonLogging`: later plugins leave it unset so
 * XENON_JSON_LOGGING can decide). A plugin that still requires one refuses a
 * config file without it, so the launcher writes the value those plugins
 * defaulted to. The settings form can still change it.
 */
const LEGACY_FALLBACK_DEFAULTS: Readonly<Record<string, unknown>> = {
  enableJsonLogging: false
};

/**
 * Defaults for the args a generated launch config must carry: the ones the
 * schema lists as `required`, and none when it has no such list.
 *
 * Appium checks a --config file against the installed plugin's schema before
 * it applies defaults, so a plugin up to 2.13.1 (which marks 23 args required)
 * refuses a file that leaves one out. Later plugins have no list and accept a
 * partial file, and forcing values there would defeat their own fallbacks.
 * Callers pass the schema of the plugin that will actually run, so this follows
 * its version. Filling from schema defaults also keeps each launch config
 * complete and reproducible.
 */
export function requiredDefaults(schema: XenonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of schema.required ?? []) {
    const prop = schema.properties[key];
    if (!prop) continue;
    const value = prop.default !== undefined ? prop.default : LEGACY_FALLBACK_DEFAULTS[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
