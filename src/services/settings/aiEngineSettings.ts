import { Container, Service } from 'typedi';
import log from '../../logger';
import { config, Config, updateConfig } from '../../config';
import { WebConfigService } from '../../data-service/web-config-service';
import type { SettingsProblem } from './labSettings';

/**
 * The AI engine page's settings: which provider answers the AI calls (failure
 * analysis, the visual and LLM healing tiers, visual assertions), and the model
 * and address it uses.
 *
 * They follow the rule every lab setting does (labSettings.ts): a value saved
 * in the dashboard (`WebConfig`, written by `POST /config`), else the plugin
 * option or environment variable the server was started with, else the
 * default. The result is written to `config`, which every AI call reads, at
 * boot and on each save, so a change applies to the next call without a
 * restart. Through 2.14 `POST /config` changed `config` and saved nothing: a
 * restart went back to the provider the server was started with.
 *
 * API keys are not among them. They come from the server's environment only,
 * are never saved, and are never sent to the dashboard.
 */

export const AI_PROVIDERS = ['gemini', 'openai', 'anthropic', 'ollama'] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

/** The settings decided here, by their names in `config`, `WebConfig` and `/config`. */
export const AI_ENGINE_SETTINGS = [
  'aiProvider',
  'aiModel',
  'aiBaseUrl',
  'geminiModel',
  'openaiModel',
  'anthropicModel',
  'ollamaModel',
] as const;
export type AiEngineSetting = (typeof AI_ENGINE_SETTINGS)[number];

const MODEL_SETTINGS = [
  'aiModel',
  'geminiModel',
  'openaiModel',
  'anthropicModel',
  'ollamaModel',
] as const;

export type AiEngineChoice = Partial<Pick<Config, AiEngineSetting>>;
export type EffectiveAiEngine = Pick<Config, AiEngineSetting>;

const DEFAULT_PROVIDER: AiProviderName = 'gemini';
const MODEL_MAX_LENGTH = 200;
const BASE_URL_MAX_LENGTH = 2048;

const isProvider = (v: unknown): v is AiProviderName =>
  typeof v === 'string' && (AI_PROVIDERS as readonly string[]).includes(v);
const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** The AI engine settings in `source` (the running config, the saved rows), and nothing else. */
export function pickAiEngine(source: Record<string, unknown>): AiEngineChoice {
  const out: Record<string, string> = {};
  for (const name of AI_ENGINE_SETTINGS) {
    if (typeof source[name] === 'string') out[name] = source[name] as string;
  }
  return out as AiEngineChoice;
}

/**
 * The settings in effect, field by field: the saved value when it can work,
 * else the one the server was started with, else the default (gemini; a model
 * or base URL has none, and the provider's own then applies). An empty saved
 * value is the person clearing it. The started-with provider is kept as it
 * is, even one Xenon doesn't know: falling back to another provider would
 * send screenshots somewhere the server's owner didn't choose. AIService then
 * runs with no provider, and says so.
 */
export function effectiveAiEngine(
  startup: AiEngineChoice,
  saved: AiEngineChoice,
): EffectiveAiEngine {
  const out: Record<string, string | undefined> = {
    aiProvider: isProvider(saved.aiProvider)
      ? saved.aiProvider
      : isNonEmpty(startup.aiProvider)
        ? startup.aiProvider
        : DEFAULT_PROVIDER,
  };
  for (const name of AI_ENGINE_SETTINGS) {
    if (name === 'aiProvider') continue;
    const mine = saved[name];
    out[name] = isNonEmpty(mine)
      ? mine.trim()
      : isNonEmpty(startup[name])
        ? startup[name]
        : undefined;
  }
  return out as EffectiveAiEngine;
}

/** Why `url` can't be saved as the base URL, or null. */
function baseUrlProblem(url: string): string | null {
  const why =
    "aiBaseUrl must be an http or https address with no user name, password or query (the API key comes from the server's environment), or empty to use the server's own.";
  if (url.length > BASE_URL_MAX_LENGTH) return why;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return why;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return why;
  // Anything that could carry a credential would be one saved in the database.
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return why;
  return null;
}

/**
 * What is wrong with the AI engine fields of a settings update, or null.
 * Checked before anything is saved: a saved value outlives the restart that
 * used to undo it. Each may be empty, to go back to what the server was
 * started with. Fields not sent are not checked.
 */
export function validateAiEngineUpdate(body: Record<string, unknown>): SettingsProblem | null {
  const has = (key: string) => body[key] !== undefined;
  if (has('aiProvider') && !(body.aiProvider === '' || isProvider(body.aiProvider))) {
    return {
      field: 'aiProvider',
      message: `aiProvider must be one of ${AI_PROVIDERS.join(', ')}, or empty to use the server's own.`,
    };
  }
  for (const field of MODEL_SETTINGS) {
    if (!has(field)) continue;
    const value = body[field];
    const name = typeof value === 'string' ? value.trim() : null;
    if (name === null || name.length > MODEL_MAX_LENGTH || /[\s\u0000-\u001f\u007f]/.test(name)) {
      return {
        field,
        message: `${field} must be a model name with no spaces, of at most ${MODEL_MAX_LENGTH} characters, or empty to use the server's own.`,
      };
    }
  }
  if (has('aiBaseUrl')) {
    const value = body.aiBaseUrl;
    const problem =
      typeof value !== 'string'
        ? 'aiBaseUrl must be text.'
        : value.trim() === ''
          ? null
          : baseUrlProblem(value.trim());
    if (problem) return { field: 'aiBaseUrl', message: problem };
  }
  return null;
}

/** The AI engine fields of a checked update, as they are saved: names trimmed. */
export function aiEngineUpdateOf(body: Record<string, unknown>): AiEngineChoice {
  const picked = pickAiEngine(body) as Record<string, string>;
  for (const name of Object.keys(picked)) picked[name] = picked[name].trim();
  return picked as AiEngineChoice;
}

/**
 * Keeps `config`'s AI engine settings at the values in effect. Loaded once at
 * boot, after the startup options were applied and the database is ready, and
 * told of each save by `POST /config`.
 */
@Service()
export class AiEngineSettings {
  /** What the server was started with: `config` before anything saved was applied. */
  private startup: AiEngineChoice | undefined;
  /** What the dashboard saved. */
  private saved: AiEngineChoice = {};

  /**
   * Reads the saved settings and applies them. A database that can't be read
   * leaves the startup settings in charge, as it does for the other settings.
   */
  async load(): Promise<void> {
    this.startedWith();
    try {
      this.saved = pickAiEngine(
        (await Container.get(WebConfigService).getConfig()) as Record<string, unknown>,
      );
    } catch (err: any) {
      this.saved = {};
      log.warn(
        `Could not read the saved AI engine settings, using the startup options: ${err?.message}`,
      );
    }
    this.apply();
  }

  /** What `POST /config` just saved, in force for the next AI call. */
  noteSaved(update: AiEngineChoice): void {
    this.startedWith();
    this.saved = { ...this.saved, ...update };
    this.apply();
  }

  private startedWith(): AiEngineChoice {
    if (!this.startup) this.startup = pickAiEngine(config as unknown as Record<string, unknown>);
    return this.startup;
  }

  private apply(): void {
    const before = config.aiProvider;
    updateConfig(effectiveAiEngine(this.startedWith(), this.saved));
    if (config.aiProvider !== before) log.info(`AI provider: ${config.aiProvider}`);
  }
}
