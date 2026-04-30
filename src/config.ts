import * as os from 'os';
import * as path from 'path';
const basePath = path.join(os.homedir(), '.cache', 'xenon');

export interface Config {
  cacheDir: string;
  databaseProvider: 'sqlite' | 'postgresql';
  databaseUrl: string;
  databasePath: string;
  sessionAssetsPath: string;
  appsPath: string;
  takeScreenshotsFor: Array<string>;
  aiProvider: 'gemini' | 'openai' | 'anthropic' | 'ollama';
  aiModel?: string;
  aiBaseUrl?: string;
  geminiApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  geminiModel?: string;
  openaiModel?: string;
  anthropicModel?: string;
  ollamaModel?: string;
  bootstrapKeyPath: string;
  authDisabled: boolean;
  nodeSecret?: string;
  // Previous secret accepted during a rotation overlap window. Set both
  // `XENON_NODE_SECRET` (new) and `XENON_NODE_SECRET_PREVIOUS` (old) on the
  // hub, flip nodes one by one to the new secret, then drop PREVIOUS.
  nodeSecretPrevious?: string;
  // Phase 4B node pair auth — outbound credentials a node uses to talk to
  // the hub. When both are set they take precedence over the legacy
  // XENON_NODE_SECRET. Inbound side: the hub continues to accept either
  // shape; XENON_ACCEPT_LEGACY_NODE_SECRET below gates the legacy path.
  hubAccessKey?: string;
  hubToken?: string;
  // Inbound flag on the hub. When false, x-xenon-node-secret is rejected
  // and nodes must use the (accessKey, token) pair. Default true for one
  // minor — mirrors Phase 1's XENON_ACCEPT_LEGACY_KEY pattern.
  acceptLegacyNodeSecret: boolean;
  // Phase 1 identity
  bootstrapAdminEmail: string;
  bootstrapAdminPassword: string;
  bootstrapResetPassword: boolean;
  acceptLegacyKey: boolean;
  loginRateLimitAttempts: number;
  loginRateLimitWindowMs: number;
  userSessionTtlMs: number;
  // Phase 2 password reset
  smtpUrl?: string;
  smtpFrom?: string;
  resetTokenTtlMs: number;
  passwordResetLogFallback: boolean;
  resetRateLimitAttempts: number;
  resetRateLimitWindowMs: number;
  recordingsAssetsPath: string;
  maxConcurrentRecordings: number;
}

export const config: Config = {
  cacheDir: basePath,
  databaseProvider: (process.env.XENON_DB_PROVIDER as any) || 'sqlite',
  databaseUrl: process.env.DATABASE_URL || `file:${path.join(basePath, 'xenon.db')}`,
  databasePath: path.join(basePath, 'xenon.db'),
  sessionAssetsPath: path.join(basePath, 'assets', 'sessions'),
  appsPath: path.join(basePath, 'apps'),
  takeScreenshotsFor: [
    'click',
    'setUrl',
    'setValue',
    'performActions',
    'clear',
    'swipe',
    'scroll',
    'dragAndDrop',
    'back',
    'forward',
  ],
  aiProvider: (process.env.XENON_AI_PROVIDER as any) || 'gemini',
  aiModel: process.env.XENON_AI_MODEL,
  aiBaseUrl: process.env.XENON_AI_BASE_URL,
  geminiApiKey: process.env.XENON_GEMINI_API_KEY || process.env.GEMINI_API_KEY,
  openaiApiKey: process.env.XENON_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  anthropicApiKey: process.env.XENON_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
  geminiModel: process.env.XENON_GEMINI_MODEL,
  openaiModel: process.env.XENON_OPENAI_MODEL,
  anthropicModel: process.env.XENON_ANTHROPIC_MODEL,
  ollamaModel: process.env.XENON_OLLAMA_MODEL,
  bootstrapKeyPath:
    process.env.XENON_BOOTSTRAP_KEY_PATH || path.join(basePath, 'bootstrap-key.txt'),
  authDisabled: process.env.XENON_AUTH_DISABLED === 'true',
  nodeSecret: process.env.XENON_NODE_SECRET,
  nodeSecretPrevious: process.env.XENON_NODE_SECRET_PREVIOUS,
  hubAccessKey: process.env.XENON_HUB_ACCESS_KEY,
  hubToken: process.env.XENON_HUB_TOKEN,
  acceptLegacyNodeSecret: process.env.XENON_ACCEPT_LEGACY_NODE_SECRET !== 'false',
  bootstrapAdminEmail: process.env.XENON_BOOTSTRAP_ADMIN_EMAIL || 'admin@xenon.local',
  bootstrapAdminPassword: process.env.XENON_BOOTSTRAP_ADMIN_PASSWORD || 'Admin@123',
  bootstrapResetPassword: process.env.XENON_BOOTSTRAP_RESET_PASSWORD === 'true',
  acceptLegacyKey: process.env.XENON_ACCEPT_LEGACY_KEY !== 'false',
  loginRateLimitAttempts: Number(process.env.XENON_LOGIN_RATE_LIMIT_ATTEMPTS) || 5,
  loginRateLimitWindowMs: Number(process.env.XENON_LOGIN_RATE_LIMIT_WINDOW_MS) || 5 * 60 * 1000,
  userSessionTtlMs: Number(process.env.XENON_USER_SESSION_TTL_MS) || 24 * 60 * 60 * 1000,
  smtpUrl: process.env.XENON_SMTP_URL,
  smtpFrom: process.env.XENON_SMTP_FROM,
  resetTokenTtlMs: Number(process.env.XENON_RESET_TOKEN_TTL_MS) || 60 * 60 * 1000,
  passwordResetLogFallback: process.env.XENON_PASSWORD_RESET_LOG_FALLBACK !== 'false',
  resetRateLimitAttempts: Number(process.env.XENON_RESET_RATE_LIMIT_ATTEMPTS) || 3,
  resetRateLimitWindowMs: Number(process.env.XENON_RESET_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  recordingsAssetsPath:
    process.env.XENON_RECORDINGS_ASSETS_PATH ||
    path.join(basePath, 'assets', 'sessions', 'recordings'),
  maxConcurrentRecordings: Number(process.env.XENON_MAX_CONCURRENT_RECORDINGS ?? 4),
};

export function updateConfig(newConfig: Partial<Config>) {
  Object.assign(config, newConfig);
}
