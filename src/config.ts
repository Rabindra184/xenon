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
  authDisabled: boolean;
  // When true (default), the hub auto-applies any pending schema changes
  // at startup — `db push` for SQLite, `prisma migrate deploy` for
  // PostgreSQL. Set XENON_AUTO_MIGRATE=false in environments where
  // schema is managed externally (CI-driven migrations with auditable
  // change-control), in which case the operator is responsible for
  // applying migrations before the hub boots.
  autoMigrate: boolean;
  // Outbound credentials a node uses to talk to the hub. Both must be set
  // for node-to-hub traffic to authenticate; otherwise the hub will reject
  // the handshake unless XENON_AUTH_DISABLED=true.
  hubAccessKey?: string;
  hubToken?: string;
  // Phase 1 identity
  bootstrapAdminEmail: string;
  bootstrapAdminPassword: string;
  bootstrapResetPassword: boolean;
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
  authDisabled: process.env.XENON_AUTH_DISABLED === 'true',
  autoMigrate: process.env.XENON_AUTO_MIGRATE !== 'false',
  hubAccessKey: process.env.XENON_HUB_ACCESS_KEY,
  hubToken: process.env.XENON_HUB_TOKEN,
  bootstrapAdminEmail: process.env.XENON_BOOTSTRAP_ADMIN_EMAIL || 'admin@xenon.local',
  bootstrapAdminPassword: process.env.XENON_BOOTSTRAP_ADMIN_PASSWORD || 'Admin@123',
  bootstrapResetPassword: process.env.XENON_BOOTSTRAP_RESET_PASSWORD === 'true',
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

/**
 * Whether authentication should be off, given the `--plugin-xenon-auth-disabled`
 * CLI arg and the XENON_AUTH_DISABLED env var.
 *
 * Both exist because `authDisabled` is declared in schema.json (so Appium
 * accepts the flag) while every consumer reads `config.authDisabled`, which is
 * populated from the env var. Nothing bridged them, so the documented flag
 * silently did nothing — this is that bridge, kept pure so the precedence is
 * testable without booting a server.
 *
 * Two deliberate choices:
 * - `=== true` only. The schema types it boolean, and a loose check would let a
 *   stray `"false"` string disable authentication for the whole server.
 * - OR, not override. Either source can turn auth off; neither can turn it back
 *   on, so the more restrictive of the two never loses to the other.
 */
export function resolveAuthDisabled(pluginArgValue: unknown, envDisabled: boolean): boolean {
  return pluginArgValue === true || envDisabled === true;
}
