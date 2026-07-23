import yaml from 'js-yaml';
import type { LaunchSpec, Profile, SecretKey, SettingsValues } from '@shared/types';

// Setting keys that must NEVER be written into the on-disk config YAML. These
// are secret-bearing plugin args; the launcher injects them as environment
// variables (XENON_* wins in Xenon's own config resolution) so nothing sensitive
// lands in a plaintext file.
const SECRET_SETTING_KEYS = new Set(['geminiApiKey', 'openaiApiKey', 'anthropicApiKey', 'databaseUrl']);

export interface LaunchPlan {
  command: string;
  args: string[];
  /** Full environment for the child process, including decrypted secret values. */
  env: Record<string, string>;
  /** Redacted, renderer-safe description (no secret values). */
  spec: LaunchSpec;
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
   * --config is rejected at startup). See SchemaService.requiredDefaults().
   */
  requiredDefaults?: Record<string, unknown>;
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

/** Build the Appium config-file document from a profile. */
export function buildConfigYaml(profile: Profile, requiredDefaults: Record<string, unknown> = {}): string {
  // Defaults sit UNDERNEATH the user's settings so the config is always complete
  // (Appium rejects a --config missing any required property) and our launch
  // defaults are ON, while any value the user changed still wins.
  const merged = { ...MAC_APP_SETTING_DEFAULTS, ...requiredDefaults, ...profile.settings };
  const doc = {
    server: {
      port: profile.server.port,
      'base-path': profile.server.basePath,
      'keep-alive-timeout': profile.server.keepAliveTimeout,
      'use-plugins': ['xenon'],
      plugin: {
        xenon: sanitizeSettings(merged)
      }
    }
  };
  return yaml.dump(doc, { lineWidth: 120, noRefs: true });
}

/** Turn a profile + secrets into a full, runnable launch plan. Pure — writes nothing. */
export function buildLaunchPlan(profile: Profile, ctx: BuildContext): LaunchPlan {
  const configYaml = buildConfigYaml(profile, ctx.requiredDefaults ?? {});
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

  return { command: 'appium', args, env, spec };
}
