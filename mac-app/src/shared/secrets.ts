import type { SecretDescriptor, SecretKey, SecretSlot } from './types';

// The secrets the launcher can inject as environment variables on the spawned
// Appium process. These are exactly the env vars Xenon reads (XENON_-prefixed
// names win over bare ones), which is why the web dashboard refuses to accept
// them in-app; PROXY_PASSWORD alone goes into the proxy's address instead (see
// SECRETS_NOT_IN_ENV). Values are stored encrypted via Electron safeStorage.
export const SECRET_DESCRIPTORS: SecretDescriptor[] = [
  {
    key: 'XENON_GEMINI_API_KEY',
    label: 'Gemini API key',
    description: 'Google Gemini key for the LLM self-healing tier and visual analysis.'
  },
  {
    key: 'XENON_OPENAI_API_KEY',
    label: 'OpenAI API key',
    description: 'OpenAI key used when the AI provider is set to openai.'
  },
  {
    key: 'XENON_ANTHROPIC_API_KEY',
    label: 'Anthropic API key',
    description: 'Anthropic (Claude) key used when the AI provider is set to anthropic.'
  },
  {
    key: 'XENON_HUB_ACCESS_KEY',
    label: 'Hub access key',
    description: 'Needed when this Mac joins a hub, and on a hub or standalone server that hands out device leases. Paired with the hub token.'
  },
  {
    key: 'XENON_HUB_TOKEN',
    label: 'Hub token',
    description: 'Paired with the hub access key. Needed when this Mac joins a hub, and on a hub or standalone server that hands out device leases.'
  },
  {
    key: 'DATABASE_URL',
    label: 'Database URL',
    description: 'Where the SQLite database lives, file:/path/to/xenon.db. Leave empty for the default under ~/.cache/xenon. The plugin stores its data in SQLite only.'
  },
  {
    key: 'XENON_SMTP_URL',
    label: 'SMTP URL',
    description:
      'SMTP connection string used for password-reset emails. Set XENON_PUBLIC_URL (the address people reach this server at, such as http://lab-mac:4723) under environment variables too: reset links point there, and without it none are emailed.'
  },
  {
    key: 'CLOUD_KEY',
    label: 'Cloud access key',
    description: 'The cloud provider key Xenon passes as CLOUD_KEY.'
  },
  {
    key: 'PROXY_PASSWORD',
    label: 'Proxy password',
    description: 'The password for the proxy in this profile’s proxy settings.'
  }
];

/**
 * Secrets the launch never passes as an environment variable of their own
 * name. Xenon reads no PROXY_PASSWORD: the launch puts the password into the
 * proxy's address instead (main/proxyEnv.ts). So an env var a profile gives
 * that name is the profile's own, and never moves into the Keychain.
 */
export const SECRETS_NOT_IN_ENV: ReadonlySet<SecretKey> = new Set<SecretKey>(['PROXY_PASSWORD']);

/**
 * Secrets each profile keeps its own of (R54): the cloud key and the proxy
 * password belong to a provider and a proxy, and profiles name different ones.
 * Each profile's value is in its own Keychain slot (profileSecretSlot), never
 * shared with another profile and never in the profile itself, and the launch
 * uses it whenever one is saved: a profile's `secretRefs` never names these.
 * Every other secret is app-wide: one value, used by the profiles that turn it on.
 */
export const PROFILE_SECRETS: readonly SecretKey[] = ['CLOUD_KEY', 'PROXY_PASSWORD'];

/** True for a secret each profile keeps its own of (PROFILE_SECRETS). */
export function isProfileSecret(key: SecretKey): boolean {
  return PROFILE_SECRETS.includes(key);
}

/** The Keychain slot of a profile's own secret: `CLOUD_KEY@<profile id>`. */
export function profileSecretSlot(key: SecretKey, profileId: string): SecretSlot {
  return `${key}@${profileId}`;
}

/**
 * Secret parts of settings, by their dotted path, and the secret that holds
 * each instead (main/profileSecrets.ts moves them there; the config file never
 * carries them). A form must never offer a box for one: it points to Keys &
 * accounts, like the settings in SECRET_SETTINGS. A box saves while someone
 * types, and a key arriving a few letters per save is not a value to store.
 * (A JSON field commits whole when it loses focus, so the proxy's is fine.)
 */
export const SECRET_SETTING_PARTS: Readonly<Record<string, SecretKey>> = {
  'cloud.apiKey': 'CLOUD_KEY',
  'proxy.auth.password': 'PROXY_PASSWORD'
};

/**
 * Settings (plugin args in schema.json) whose value is a secret, and the
 * secret above that holds it instead. The settings form shows a pointer to
 * Secrets & Env in their place, the config file never carries them, and
 * neither does a profile once it is loaded (main/profileSecrets.ts).
 */
export const SECRET_SETTINGS: Readonly<Record<string, SecretKey>> = {
  geminiApiKey: 'XENON_GEMINI_API_KEY',
  openaiApiKey: 'XENON_OPENAI_API_KEY',
  anthropicApiKey: 'XENON_ANTHROPIC_API_KEY',
  databaseUrl: 'DATABASE_URL'
};

/** True for an environment variable the launcher keeps as a secret, such as DATABASE_URL. */
export function isSecretKey(name: string): name is SecretKey {
  return SECRET_DESCRIPTORS.some((d) => d.key === name);
}

/** Older names Xenon also reads for some of these secrets, when the XENON_ one is unset (src/config.ts). */
export const SECRET_ENV_ALIASES: Readonly<Record<string, SecretKey>> = {
  GEMINI_API_KEY: 'XENON_GEMINI_API_KEY',
  OPENAI_API_KEY: 'XENON_OPENAI_API_KEY',
  ANTHROPIC_API_KEY: 'XENON_ANTHROPIC_API_KEY'
};

/** The secret an environment variable holds, by its own name or an older one; null for any other variable. */
export function secretForEnvName(name: string): SecretKey | null {
  if (isSecretKey(name)) return name;
  return Object.prototype.hasOwnProperty.call(SECRET_ENV_ALIASES, name) ? SECRET_ENV_ALIASES[name] : null;
}
