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

/** Build the Appium config-file document from a profile. */
export function buildConfigYaml(profile: Profile, requiredDefaults: Record<string, unknown> = {}): string {
  // Required-key defaults sit UNDERNEATH the user's settings so the config is
  // always complete (Appium rejects a --config missing any required property),
  // while any value the user changed still wins.
  const merged = { ...requiredDefaults, ...profile.settings };
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

  // Environment layering: APPIUM_HOME, then the profile's extra (non-secret) env
  // vars, then secrets last so a secret always wins over a same-named plain var.
  const env: Record<string, string> = { APPIUM_HOME: ctx.appiumHome };
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
