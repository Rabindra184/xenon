import type { SecretDescriptor } from './types';

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
    description: 'Node → hub access key. Required (with the token) when this instance runs as a node.'
  },
  {
    key: 'XENON_HUB_TOKEN',
    label: 'Hub token',
    description: 'Node → hub auth token. Paired with the hub access key.'
  },
  {
    key: 'DATABASE_URL',
    label: 'Database URL',
    description: 'Prisma DB URL. Only needed for postgres/shared-DB deployments; sqlite is the default.'
  },
  {
    key: 'XENON_SMTP_URL',
    label: 'SMTP URL',
    description: 'SMTP connection string used for password-reset emails.'
  }
];
