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
    process.env.XENON_BOOTSTRAP_KEY_PATH ||
    path.join(basePath, 'bootstrap-key.txt'),
  authDisabled: process.env.XENON_AUTH_DISABLED === 'true',
  nodeSecret: process.env.XENON_NODE_SECRET,
  nodeSecretPrevious: process.env.XENON_NODE_SECRET_PREVIOUS,
  recordingsAssetsPath:
    process.env.XENON_RECORDINGS_ASSETS_PATH ||
    path.join(basePath, 'assets', 'sessions', 'recordings'),
  maxConcurrentRecordings: Number(process.env.XENON_MAX_CONCURRENT_RECORDINGS ?? 4),
};

export function updateConfig(newConfig: Partial<Config>) {
  Object.assign(config, newConfig);
}
