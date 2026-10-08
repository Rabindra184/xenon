import yaml from 'js-yaml';
import type { LaunchSpec, Profile, SecretKey, SettingsValues, XenonSchema } from '@shared/types';
import { SECRET_SETTINGS, SECRETS_NOT_IN_ENV } from '@shared/secrets';
import { RETIRED_SETTINGS } from '@shared/retiredSettings';
import { humanize } from '@shared/humanize';
import { XENON_LOG_FILTERS } from './logFilters';
import { proxyEnv, proxyUrl } from './proxyEnv';

// Setting keys that must NEVER be written into the on-disk config YAML. These
// are secret-bearing plugin args; the launcher injects their secrets as
// environment variables instead (XENON_* names, and DATABASE_URL, which Xenon
// reads when it starts) so nothing sensitive lands in a plaintext file. The
// same goes for the secret parts of two settings: the cloud key and user name
// (cloudForConfig) and the proxy password (proxyForConfig).
const SECRET_SETTING_KEYS = new Set(Object.keys(SECRET_SETTINGS));

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

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
  /**
   * The environment the server inherits on top of the plan's (process.env).
   * Only its NO_PROXY is read, when the proxy is passed in the environment: the
   * loopback hosts are added to the list in force. Without it, none is inherited.
   */
  inheritedEnv?: Readonly<Record<string, string | undefined>>;
}

/**
 * Env vars derived from settings:
 * - XENON_AUTH_DISABLED. The plugin has honoured the `authDisabled` arg itself
 *   since #225; this bridge is kept so a profile that turns auth off still
 *   works against an older plugin that reads only the variable (src/config.ts).
 * - CLOUD_USERNAME, from the cloud settings' user name. Xenon reads the cloud
 *   user name and key from the environment only (CLOUD_USERNAME and CLOUD_KEY:
 *   src/device-managers/cloud/CapabilityManager.ts, nodeUrl in src/helpers/index.ts).
 */
function deriveEnvFromSettings(settings: SettingsValues): Record<string, string> {
  const env: Record<string, string> = {};
  if (settings.authDisabled === true) env.XENON_AUTH_DISABLED = 'true';
  const { cloud } = settings;
  if (isRecord(cloud) && typeof cloud.username === 'string' && cloud.username.trim() !== '') {
    env.CLOUD_USERNAME = cloud.username.trim();
  }
  return env;
}

/** The object without the named keys; the same object when it has none of them. */
function omit(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  if (!keys.some((k) => has(obj, k))) return obj;
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}

/**
 * The cloud settings without the key and the user name, which Xenon reads from
 * the environment (deriveEnvFromSettings) and its cloud schema doesn't ask for
 * (src/types/CloudSchema.ts); undefined when nothing else is left.
 */
function cloudForConfig(cloud: unknown): unknown {
  if (!isRecord(cloud)) return cloud;
  const rest = omit(cloud, ['apiKey', 'username']);
  return Object.keys(rest).length === 0 ? undefined : rest;
}

/** The proxy settings without a password, which reaches Xenon in the environment or not at all (launchProxyUrl). */
function proxyForConfig(proxy: unknown): unknown {
  if (!isRecord(proxy) || !isRecord(proxy.auth) || !has(proxy.auth, 'password')) return proxy;
  return { ...proxy, auth: omit(proxy.auth, ['password']) };
}

/**
 * The proxy address the launch passes in the environment, password included:
 * the Keychain's password when the profile injects PROXY_PASSWORD and one is
 * stored, else one the proxy settings still hold (one the Keychain couldn't
 * take, or a draft the window sent before it heard the value had moved). Null
 * without a password, or when the settings make no address (proxyUrl): the
 * proxy then stays the `proxy` option.
 */
function launchProxyUrl(profile: Profile, secretValues: BuildContext['secretValues']): string | null {
  const proxy = isRecord(profile.settings) ? profile.settings.proxy : undefined;
  const refs: unknown[] = Array.isArray(profile.secretRefs) ? profile.secretRefs : [];
  const stored = refs.includes('PROXY_PASSWORD') ? secretValues.PROXY_PASSWORD : undefined;
  const held = isRecord(proxy) && isRecord(proxy.auth) ? proxy.auth.password : undefined;
  const password = stored || (typeof held === 'string' && held !== '' ? held : undefined);
  return password ? proxyUrl(proxy, password) : null;
}

/** The NO_PROXY list in force, as Xenon reads it (the lower-case name first): the profile's, else the inherited one. */
function noProxyInForce(profileEnv: unknown, inherited: BuildContext['inheritedEnv']): string | undefined {
  for (const env of [isRecord(profileEnv) ? profileEnv : {}, inherited ?? {}]) {
    for (const name of ['no_proxy', 'NO_PROXY']) {
      const value = (env as Record<string, unknown>)[name];
      if (typeof value === 'string' && value !== '') return value;
    }
  }
  return undefined;
}

/**
 * The hub as its plain origin. The plugin appends its own path to it
 * (`${hub}/xenon/api/register`), so a trailing slash would register at a double
 * slash and never pair; whitespace and `user:pass@` would also land in the
 * plaintext config. Anything that isn't an http(s) address is left as it is:
 * validation blocks it before launch.
 */
function hubOrigin(hub: unknown): unknown {
  if (typeof hub !== 'string') return hub;
  try {
    const u = new URL(hub.trim());
    return /^https?:$/.test(u.protocol) ? u.origin : hub;
  } catch {
    return hub;
  }
}

/**
 * Strip secret-bearing, retired and empty values (a hub of only whitespace is
 * empty) from the settings, the cloud key and user name and the proxy password
 * too, and tidy the hub, before serialization. The proxy goes altogether when
 * it is passed in the environment.
 */
function sanitizeSettings(settings: SettingsValues, proxyInEnv: boolean): SettingsValues {
  const out: SettingsValues = {};
  for (const [key, raw] of Object.entries(settings)) {
    if (SECRET_SETTING_KEYS.has(key) || RETIRED_SETTINGS.has(key)) continue;
    if (key === 'proxy' && proxyInEnv) continue;
    const value = key === 'cloud' ? cloudForConfig(raw) : key === 'proxy' ? proxyForConfig(raw) : raw;
    if (value === undefined || value === null || value === '') continue;
    if (key === 'hub' && typeof value === 'string' && value.trim() === '') continue;
    out[key] = key === 'hub' ? hubOrigin(value) : value;
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

/** The config YAML plus the profile's settings left out because the installed Xenon doesn't know them. */
function composeConfig(
  profile: Profile,
  requiredDefaults: Record<string, unknown>,
  schema: XenonSchema | undefined,
  proxyInEnv: boolean
): { configYaml: string; skippedSettings: string[] } {
  // Defaults sit UNDERNEATH the user's settings so the config is always complete
  // (Appium rejects a --config missing any required property) and our launch
  // defaults are ON, while any value the user changed still wins.
  const merged = sanitizeSettings({ ...MAC_APP_SETTING_DEFAULTS, ...requiredDefaults, ...profile.settings }, proxyInEnv);
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

/**
 * Build the Appium config-file document from a profile (Export Config). It has
 * no environment to pass, so a proxy stays the `proxy` option, without its
 * password, and the cloud settings without their key or user name.
 */
export function buildConfigYaml(
  profile: Profile,
  requiredDefaults: Record<string, unknown> = {},
  schema?: XenonSchema
): string {
  return composeConfig(profile, requiredDefaults, schema, false).configYaml;
}

/** The log line telling the user which of their settings the installed Xenon doesn't support; null when none. */
export function skippedSettingsLine(keys: string[]): string | null {
  if (keys.length === 0) return null;
  const n = keys.length;
  return `Skipped ${n} setting${n === 1 ? '' : 's'} your installed Xenon doesn't support: ${keys.map(humanize).join(', ')}.`;
}

/** Turn a profile + secrets into a full, runnable launch plan. Pure — writes nothing. */
export function buildLaunchPlan(profile: Profile, ctx: BuildContext): LaunchPlan {
  // A proxy with a password goes in the environment, so the config file never holds the password.
  const proxy = launchProxyUrl(profile, ctx.secretValues);
  const { configYaml, skippedSettings } = composeConfig(profile, ctx.requiredDefaults ?? {}, ctx.schema, proxy !== null);
  const args = ['server', '--config', ctx.configYamlPath];

  // Environment layering, lowest → highest precedence:
  //   APPIUM_HOME + settings-derived vars (e.g. XENON_AUTH_DISABLED,
  //   CLOUD_USERNAME) → the profile's explicit env vars → secrets (CLOUD_KEY
  //   among them; never PROXY_PASSWORD) → the proxy from the settings. So an
  //   explicit value always wins over the auto-bridge, a secret always wins over
  //   a plain var, and the proxy setting wins over the proxy variables, as
  //   Xenon's `proxy` option did.
  const env: Record<string, string> = { APPIUM_HOME: ctx.appiumHome, ...deriveEnvFromSettings(profile.settings) };
  for (const [k, v] of Object.entries(profile.env ?? {})) {
    if (k && v !== undefined && v !== null) env[k] = String(v);
  }
  for (const key of profile.secretRefs) {
    const value = ctx.secretValues[key];
    if (value && !SECRETS_NOT_IN_ENV.has(key)) env[key] = value;
  }
  if (proxy !== null) Object.assign(env, proxyEnv(proxy, noProxyInForce(profile.env, ctx.inheritedEnv)));

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
