import type { SecretDescriptor, SecretKey } from './types';

// The secrets the launcher can inject as environment variables on the spawned
// Appium process. These are exactly the env vars Xenon reads (XENON_-prefixed
// names win over bare ones), which is why the web dashboard refuses to accept
// them in-app. Values are stored encrypted via Electron safeStorage.
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
  }
];

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
