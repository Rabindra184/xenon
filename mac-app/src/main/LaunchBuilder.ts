import yaml from 'js-yaml';
import type { LaunchSpec, Profile, SecretKey, SettingsValues, XenonSchema } from '@shared/types';
import { SECRET_SETTINGS } from '@shared/secrets';
import { humanize } from '@shared/humanize';
import { XENON_LOG_FILTERS } from './logFilters';

// Setting keys that must NEVER be written into the on-disk config YAML. These
// are secret-bearing plugin args; the launcher injects their secrets as
// environment variables instead (XENON_* names, and DATABASE_URL, which Xenon
// reads when it starts) so nothing sensitive lands in a plaintext file.
const SECRET_SETTING_KEYS = new Set(Object.keys(SECRET_SETTINGS));

export interface LaunchPlan {
  command: string;
  args: string[];
  /** Full environment for the child process, including decrypted secret values. */
  env: Record<string, string>;
  /** Redacted, renderer-safe description (no secret values). */
  spec: LaunchSpec;
  /**
   * Keys the profile set that the installed Xenon doesn't know, so they were
   * left out of the config. App defaults dropped the same way aren't listed.
   */
  skippedSettings: string[];
}

export interface BuildContext {
  /** Resolved APPIUM_HOME (profile override or app default). */
  appiumHome: string;
  /** Absolute path the config YAML will be written to. */
  configYamlPath: string;
  /** Decrypted secret values keyed by SecretKey. Missing keys are simply not injected. */
  secretValues: Partial<Record<SecretKey, string>>;
  /**
   * Defaults for schema-required keys. Merged UNDER the profile's settings so the
   * generated config always satisfies Appium's `required` validation (a partial
   * --config is rejected at startup). See requiredDefaults() in configDefaults.ts.
   */
  requiredDefaults?: Record<string, unknown>;
  /**
   * The option list of the Xenon that will run (SchemaService.effectiveSchema).
   * When given, settings it doesn't list are left out: Appium refuses a config
   * with an unknown plugin arg. Without it nothing is pruned.
   */
  schema?: XenonSchema;
}

/**
 * Some Xenon settings are only honored via an environment variable, NOT their
 * plugin-arg equivalent. Bridge those so a setting the user flips actually takes
 * effect. `authDisabled` is the key case: Xenon resolves it from
 * XENON_AUTH_DISABLED (src/config.ts), so the plugin arg alone is a no-op and
 * the dashboard would still demand an API key.
 */
function deriveEnvFromSettings(settings: SettingsValues): Record<string, string> {
  const env: Record<string, string> = {};
  if (settings.authDisabled === true) env.XENON_AUTH_DISABLED = 'true';
  return env;
}

/** Strip secret-bearing and empty values from the settings before serialization. */
function sanitizeSettings(settings: SettingsValues): SettingsValues {
  const out: SettingsValues = {};
  for (const [key, value] of Object.entries(settings)) {
    if (SECRET_SETTING_KEYS.has(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

// Mac-app launch defaults that aren't schema-required but we want ON out of the
// box. Like requiredDefaults, they sit UNDER the profile's settings so a profile
// that sets the same key explicitly always wins.
//   - streaming.androidH264: use the faster scrcpy H.264 Android live preview by
//     default; scrcpy-incompatible devices auto-fall back to MJPEG at the player
//     level, so this is safe to default on. A profile overrides by setting its own
//     `streaming` (shallow-replaces this default): `{ androidH264: false }` to turn
//     it off, or `{ androidH264: { source: 'screenrecord' } }` for the rollback source.
const MAC_APP_SETTING_DEFAULTS: Record<string, unknown> = {
  streaming: { androidH264: true }
};

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** The config YAML plus the profile's settings left out because the installed Xenon doesn't know them. */
function composeConfig(
  profile: Profile,
  requiredDefaults: Record<string, unknown>,
  schema?: XenonSchema
): { configYaml: string; skippedSettings: string[] } {
  // Defaults sit UNDERNEATH the user's settings so the config is always complete
  // (Appium rejects a --config missing any required property) and our launch
  // defaults are ON, while any value the user changed still wins.
  const merged = sanitizeSettings({ ...MAC_APP_SETTING_DEFAULTS, ...requiredDefaults, ...profile.settings });
  const skippedSettings: string[] = [];
  let settings = merged;
  if (schema) {
    // Only what would have been written counts as skipped: not empty values or
    // secrets (never written), and not app defaults the user didn't choose.
    settings = {};
    for (const [key, value] of Object.entries(merged)) {
      if (has(schema.properties, key)) settings[key] = value;
      else if (has(profile.settings, key)) skippedSettings.push(key);
    }
  }
  const doc = {
    server: {
      port: profile.server.port,
      'base-path': profile.server.basePath,
      'keep-alive-timeout': profile.server.keepAliveTimeout,
      'use-plugins': ['xenon'],
      'log-filters': XENON_LOG_FILTERS,
      plugin: {
        xenon: settings
      }
    }
  };
  return { configYaml: yaml.dump(doc, { lineWidth: 120, noRefs: true }), skippedSettings };
}

/** Build the Appium config-file document from a profile. */
export function buildConfigYaml(
  profile: Profile,
  requiredDefaults: Record<string, unknown> = {},
  schema?: XenonSchema
): string {
  return composeConfig(profile, requiredDefaults, schema).configYaml;
}

/** The log line telling the user which of their settings the installed Xenon doesn't support; null when none. */
export function skippedSettingsLine(keys: string[]): string | null {
  if (keys.length === 0) return null;
  const n = keys.length;
  return `Skipped ${n} setting${n === 1 ? '' : 's'} your installed Xenon doesn't support: ${keys.map(humanize).join(', ')}.`;
}

/** Turn a profile + secrets into a full, runnable launch plan. Pure — writes nothing. */
export function buildLaunchPlan(profile: Profile, ctx: BuildContext): LaunchPlan {
  const { configYaml, skippedSettings } = composeConfig(profile, ctx.requiredDefaults ?? {}, ctx.schema);
  const args = ['server', '--config', ctx.configYamlPath];

  // Environment layering, lowest → highest precedence:
  //   APPIUM_HOME + settings-derived vars (e.g. XENON_AUTH_DISABLED) → the
  //   profile's explicit env vars → secrets. So an explicit value always wins
  //   over the auto-bridge, and a secret always wins over a plain var.
  const env: Record<string, string> = { APPIUM_HOME: ctx.appiumHome, ...deriveEnvFromSettings(profile.settings) };
  for (const [k, v] of Object.entries(profile.env ?? {})) {
    if (k && v !== undefined && v !== null) env[k] = String(v);
  }
  for (const key of profile.secretRefs) {
    const value = ctx.secretValues[key];
    if (value) env[key] = value;
  }

  const spec: LaunchSpec = {
    command: 'appium',
    args,
    envKeys: Object.keys(env),
    appiumHome: ctx.appiumHome,
    configYamlPath: ctx.configYamlPath,
    configYaml
  };

  return { command: 'appium', args, env, spec, skippedSettings };
}
