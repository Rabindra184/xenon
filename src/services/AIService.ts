import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import log from '../logger';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { CIRCUIT_BREAKERS, CircuitOpenError } from './CircuitBreaker';

export interface AnalysisContext {
  sessionId: string;
  failureReason: string;
  commandLogs: any[];
  deviceLogs: string[];
  screenshotPath?: string;
}

interface LLMProvider {
  /** `signal` cancels the request (a call over its time limit). */
  analyze(prompt: string, screenshotBase64?: string, signal?: AbortSignal): Promise<string>;
}

/** A provider's verdict on whether a condition holds on a screenshot. */
export interface VisualVerdict {
  result: boolean;
  message: string;
}

/**
 * A provider refused a call for its rate limit or quota (HTTP 429), whichever
 * provider it is. A failed call like any other: its caller gets no answer and
 * the circuit breaker counts it (`status`). Through 2.14 Gemini's provider
 * answered a 429 with the text 'CONNECTION_OK_RATE_LIMITED', which was saved
 * as a failed session's AI analysis and counted by the breaker as a success.
 */
export class AIRateLimitedError extends Error {
  public readonly name = 'AIRateLimitedError';
  public readonly status = 429;
  /** What the provider said. */
  public readonly detail: string;
  constructor(detail: string) {
    super('The AI provider is rate-limited or out of quota');
    this.detail = detail;
  }
}

/** A provider's 429, as its SDK (`status`) or axios (`response.status`) reports it. */
function isRateLimit(err: any): boolean {
  return err instanceof AIRateLimitedError || err?.status === 429 || err?.response?.status === 429;
}

/**
 * The circuit breaker didn't send the call: the provider's recent calls
 * failed. Still a CircuitOpenError, in words for testers: the Omni-Scan, Test
 * locator and visual assertion answers show it, and "Circuit open for
 * 'ai:gemini:<model>'; retry in 43120ms" isn't.
 */
export class AIProviderPausedError extends CircuitOpenError {
  /** Seconds until the provider is called again. */
  public readonly seconds: number;
  constructor(from: CircuitOpenError) {
    super(from.key, from.retryAfterMs);
    this.seconds = Math.max(1, Math.ceil(from.retryAfterMs / 1000));
    this.message = `The AI provider has been failing, so Xenon will call it again in ${this.seconds} s`;
  }
}

/** A call that outlasted its time limit; its request was cancelled. The circuit breaker counts it (`code`). */
export class AITimeoutError extends Error {
  public readonly name = 'AITimeoutError';
  public readonly code = 'ETIMEDOUT';
  constructor(ms: number) {
    super(`The AI provider didn't answer within ${Math.round(ms / 1000)} s`);
  }
}

/**
 * How long an AI call may take, retries included, unless it says otherwise
 * (failure analysis). Most are made while a test command runs: the LLM and
 * visual healing tiers inside a failing findElement (both: 2 of these), the
 * visual assertion and the screen description inside an execute script, an
 * ai-icon find. The OpenAI and Anthropic SDKs otherwise wait up to 10 minutes
 * a try, three tries, and Gemini has no limit, which held the command past
 * the client's own timeout. Ollama's generate call already had 30 s.
 */
export const AI_CALL_TIMEOUT_MS = 30_000;

/**
 * How long a failed session's AI analysis may take, retries included. The
 * OpenAI and Anthropic SDKs otherwise wait up to 10 minutes a try, three
 * tries. The analysis runs after the session has ended (onSessionStopped
 * doesn't wait for it), so this bounds the work left running, not a client's
 * wait: an answer with a screenshot usually takes seconds.
 */
export const FAILURE_ANALYSIS_TIMEOUT_MS = 120_000;

/** `call`, given a signal that cancels it after `ms`, when it fails with AITimeoutError. */
async function withTimeLimit<T>(ms: number, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // The time-out first, so it, not the cancelled request's error, is the answer.
      reject(new AITimeoutError(ms));
      controller.abort();
    }, ms);
  });
  try {
    return await Promise.race([call(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A provider's answer to the assertion prompt, `{ "result": true|false,
 * "reason": "..." }`, read leniently (code fences, text around the JSON,
 * `message` for `reason`, "true"/"false" as strings) but never guessed: null
 * when it holds no true/false `result`.
 */
export function parseVisualVerdict(answer: string): VisualVerdict | null {
  const text = answer.replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let data: any;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const raw = data?.result;
  const result =
    raw === true || raw === 'true' ? true : raw === false || raw === 'false' ? false : null;
  if (result === null) return null;
  const reason =
    typeof data.reason === 'string'
      ? data.reason
      : typeof data.message === 'string'
        ? data.message
        : '';
  return {
    result,
    message: reason.trim() || (result ? 'The condition holds.' : 'The condition does not hold.'),
  };
}

class GeminiProvider implements LLMProvider {
  private genAI: GoogleGenerativeAI;
  private modelName: string;

  constructor(apiKey: string, modelName?: string) {
    this.genAI = new GoogleGenerativeAI(apiKey.trim());
    this.modelName =
      modelName && modelName.trim() !== '' ? modelName.trim() : 'gemini-3-flash-preview';
  }

  async analyze(prompt: string, screenshotBase64?: string, signal?: AbortSignal): Promise<string> {
    const parts: any[] = [prompt];
    if (screenshotBase64) {
      parts.push({
        inlineData: {
          data: screenshotBase64,
          mimeType: 'image/png',
        },
      });
    }

    // Deep Intelligence: Try v1 (stable), then v1beta (experimental)
    // Optimization: Preview models (like gemini-3-flash-preview) often require v1beta.
    const isPreview = this.modelName.includes('preview') || this.modelName.includes('experimental');
    const versions = isPreview ? ['v1beta', 'v1'] : ['v1', 'v1beta'];
    let lastError: any = null;

    for (const version of versions) {
      try {
        const model = this.genAI.getGenerativeModel(
          { model: this.modelName },
          { apiVersion: version },
        );
        const result = await model.generateContent(parts, signal ? { signal } : undefined);
        const response = await result.response;
        return response.text();
      } catch (err: any) {
        lastError = err;
        // The other endpoint has the same quota. By status only: the message
        // holds the URL and the provider's text, where "429" can be a token
        // count or part of the model's name.
        if (err.status === 429) throw new AIRateLimitedError(err.message);

        if (
          err.message.includes('404') ||
          err.message.includes('not found') ||
          err.message.includes('unsupported')
        ) {
          log.info(`[Gemini] ${version} endpoint failed for ${this.modelName}. Trying next...`);
          continue;
        }
        break;
      }
    }

    throw lastError;
  }
}

class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;
  constructor(apiKey: string, model = 'gpt-4o', baseURL?: string) {
    this.client = new OpenAI({ apiKey, baseURL });
    this.model = model;
  }
  async analyze(prompt: string, screenshotBase64?: string, signal?: AbortSignal): Promise<string> {
    const messages: any[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      },
    ];

    if (screenshotBase64) {
      messages[0].content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${screenshotBase64}` },
      });
    }

    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        messages,
        max_tokens: 500,
      },
      { signal },
    );
    return response.choices[0].message.content || '';
  }
}

class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;
  constructor(apiKey: string, model = 'claude-sonnet-4-6') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }
  async analyze(prompt: string, screenshotBase64?: string, signal?: AbortSignal): Promise<string> {
    const content: any[] = [{ type: 'text', text: prompt }];

    if (screenshotBase64) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: screenshotBase64,
        },
      });
    }

    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: 500,
        messages: [{ role: 'user', content }],
      },
      { signal },
    );
    return (response.content[0] as any).text || '';
  }
}

class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;
  private isAvailable: boolean | null = null; // Cache availability status
  private lastAvailabilityCheck = 0;
  private readonly AVAILABILITY_CHECK_INTERVAL = 60000; // Check every 60s

  constructor(baseUrl = 'http://localhost:11434', model = 'llama3') {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  private async checkAvailability(): Promise<boolean> {
    const now = Date.now();
    // An answer is kept for a while; "down" is checked again at the next call
    // (a refused local connection costs nothing), so Ollama is used as soon as
    // it is back.
    if (this.isAvailable && now - this.lastAvailabilityCheck < this.AVAILABILITY_CHECK_INTERVAL) {
      return true;
    }

    try {
      // Quick health check - Ollama has a /api/tags endpoint
      await axios.get(`${this.baseUrl}/api/tags`, { timeout: 2000 });
      this.isAvailable = true;
      this.lastAvailabilityCheck = now;
      return true;
    } catch (err: any) {
      this.isAvailable = false;
      this.lastAvailabilityCheck = now;
      return false;
    }
  }

  async analyze(prompt: string, screenshotBase64?: string, signal?: AbortSignal): Promise<string> {
    // Check if Ollama is available before attempting
    const available = await this.checkAvailability();
    if (!available) {
      throw new Error(`Ollama service unavailable at ${this.baseUrl}. Is Ollama running?`);
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/api/generate`,
        {
          model: this.model,
          prompt: prompt,
          images: screenshotBase64 ? [screenshotBase64] : [],
          stream: false,
        },
        { timeout: 30000, signal }, // 30s timeout for generation
      );
      return response.data.response || '';
    } catch (err: any) {
      // Mark as unavailable on 404/ECONNREFUSED
      if (err.response?.status === 404 || err.code === 'ECONNREFUSED') {
        this.isAvailable = false;
        throw new Error(`Ollama service unavailable at ${this.baseUrl}. Is Ollama running?`);
      }
      throw err;
    }
  }
}

export class AIService {
  private provider: LLMProvider | null = null;
  private isMock = false;
  /** The settings `provider` was set up from (initializeProvider). */
  private setUpFrom: string | null = null;

  constructor() {
    this.initializeProvider();
  }

  // Key the breaker by provider + resolved model name so a misbehaving model
  // (rate-limited preview tier, deprecated snapshot) doesn't trip sibling
  // models on the same provider. Falls back to 'default' if model unresolved.
  private breakerKey(): string {
    const provider = config.aiProvider || 'unknown';
    const model =
      provider === 'gemini'
        ? config.geminiModel
        : provider === 'openai'
          ? config.openaiModel
          : provider === 'anthropic'
            ? config.anthropicModel
            : provider === 'ollama'
              ? config.ollamaModel
              : config.aiModel;
    return `ai:${provider}:${model || 'default'}`;
  }

  // Single choke point for every LLM call so circuit-breaker state is shared
  // across analyzeFailure / visualFind / healLocator. A rate limit is
  // AIRateLimitedError whichever provider sent it; a call is cancelled after
  // `timeoutMs` (AI_CALL_TIMEOUT_MS unless given: AITimeoutError). The breaker
  // counts both, and a call it holds back is AIProviderPausedError.
  private async callProvider(
    prompt: string,
    screenshotBase64?: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<string> {
    const provider = this.provider!;
    try {
      return await CIRCUIT_BREAKERS.execute(this.breakerKey(), () =>
        withTimeLimit(opts.timeoutMs ?? AI_CALL_TIMEOUT_MS, (signal) =>
          provider.analyze(prompt, screenshotBase64, signal),
        ),
      );
    } catch (err: any) {
      if (isRateLimit(err) && !(err instanceof AIRateLimitedError)) {
        throw new AIRateLimitedError(err?.message ?? String(err));
      }
      if (err instanceof CircuitOpenError && !(err instanceof AIProviderPausedError)) {
        throw new AIProviderPausedError(err);
      }
      throw err;
    }
  }

  /**
   * Sets the provider up from the server's AI settings, which the AI engine
   * page changes while the server runs (`POST /config`). Again only when they
   * changed, so a provider's client, and Ollama's availability check, carry
   * over from one call to the next.
   */
  private initializeProvider() {
    const providerType = config.aiProvider;
    const genericModel = config.aiModel;
    const baseUrl = config.aiBaseUrl;

    const settings = JSON.stringify([
      providerType,
      genericModel,
      baseUrl,
      config.geminiApiKey,
      config.openaiApiKey,
      config.anthropicApiKey,
      config.geminiModel,
      config.openaiModel,
      config.anthropicModel,
      config.ollamaModel,
      process.env.GEMINI_API_KEY === 'mock',
    ]);
    if (settings === this.setUpFrom) return;
    this.setUpFrom = settings;
    // A provider chosen without a key is no provider, never the previous one.
    this.provider = null;
    this.isMock = false;

    log.info(`[AIService] Initializing with provider: ${providerType}`);

    if (process.env.GEMINI_API_KEY === 'mock') {
      this.isMock = true;
      log.info('[AIService] Running in MOCK mode.');
      return;
    }

    try {
      switch (providerType) {
        case 'gemini':
          const geminiKey = config.geminiApiKey;
          if (geminiKey)
            this.provider = new GeminiProvider(geminiKey, config.geminiModel || genericModel);
          break;
        case 'openai':
          const openaiKey = config.openaiApiKey;
          if (openaiKey)
            this.provider = new OpenAIProvider(
              openaiKey,
              config.openaiModel || genericModel || 'gpt-4o',
              baseUrl,
            );
          break;
        case 'anthropic':
          const anthropicKey = config.anthropicApiKey;
          if (anthropicKey)
            this.provider = new AnthropicProvider(
              anthropicKey,
              config.anthropicModel || genericModel || 'claude-sonnet-4-6',
            );
          break;
        case 'ollama':
          this.provider = new OllamaProvider(
            baseUrl || 'http://localhost:11434',
            config.ollamaModel || genericModel || 'llama3',
          );
          break;
      }

      if (!this.provider && !this.isMock) {
        log.warn(`[AIService] No valid API key found for ${providerType}. AI features disabled.`);
      }
    } catch (err: any) {
      log.error(`[AIService] Initialization error: ${err.message}`);
    }
  }

  /**
   * Whether a provider is set up for the settings in force now. Failure
   * analysis and the LLM and visual healing tiers ask this first; it used to
   * answer for the provider set up last, so choosing a configured provider on
   * the AI engine page never turned them on, and choosing one without a key
   * left the previous provider answering.
   */
  public isEnabled(): boolean {
    this.initializeProvider();
    return this.provider !== null || this.isMock;
  }

  public async analyzeFailure(context: AnalysisContext): Promise<string | null> {
    // Re-initialize provider to pick up runtime config changes
    this.initializeProvider();

    if (!this.isEnabled()) return null;

    if (this.isMock) {
      return `
Root Cause: The test failed because the **'Login' button** was obscured by a system permission dialog ("Allow Xenon to access location?"). This prevented the automated click from registering.

Fix: Add a pre-emptive check for the location permission dialog or use the \`autoAcceptAlerts\` capability to handle system popups automatically.
            `.trim();
    }

    log.info(
      `[AIService] Analyzing failure for session ${context.sessionId} via ${config.aiProvider}`,
    );

    try {
      const prompt = this.constructPrompt(context);
      const screenshotBase64 = this.getScreenshotBase64(context.screenshotPath);

      const text = await this.callProvider(prompt, screenshotBase64 || undefined, {
        timeoutMs: FAILURE_ANALYSIS_TIMEOUT_MS,
      });

      log.info(`[AIService] Analysis complete for ${context.sessionId}`);
      return text;
    } catch (err: any) {
      if (err instanceof CircuitOpenError) {
        log.debug(`[AIService] Analysis skipped: ${err.message}`);
      } else if (err instanceof AIRateLimitedError) {
        log.warn(`[AIService] No analysis for ${context.sessionId}: ${err.message}: ${err.detail}`);
      } else if (err instanceof AITimeoutError) {
        log.warn(`[AIService] No analysis for ${context.sessionId}: ${err.message}`);
      } else {
        log.error(`[AIService] Analysis failed: ${err.message}`);
      }
      return null;
    }
  }

  /**
   * Finds coordinates for an element based on a visual description (Tier 4)
   */
  /**
   * `throwOnError`: fail, rather than answer "not found", when no provider is
   * configured or the call fails. Device control's "Test locator" asks for
   * it; Appium's ai-icon findElement doesn't.
   */
  public async visualFind(
    screenshotBase64: string,
    description: string,
    opts: { throwOnError?: boolean } = {},
  ): Promise<{ x: number; y: number } | null> {
    this.initializeProvider();
    if (!this.isEnabled()) {
      if (opts.throwOnError) throw new Error('No AI provider is configured');
      return null;
    }

    const prompt = `
            Task: Find the center coordinates (X, Y) of the element described as: "${description}"
            Response Format: JSON only, strictly { "x": number, "y": number }. 
            Scale: 0 to screen width/height.
            Instructions: Look at the provided screenshot and find the exact center of the specified element.
        `;

    try {
      const response = await this.callProvider(prompt, screenshotBase64);
      const data = JSON.parse(response.replace(/```json|```/g, '').trim());
      return data;
    } catch (err: any) {
      // Log service unavailability / tripped breaker at debug level (expected);
      // genuine errors at warn.
      if (
        err instanceof CircuitOpenError ||
        err.message?.includes('unavailable') ||
        err.response?.status === 404
      ) {
        log.debug(`[AIService] visualFind skipped: ${err.message}`);
      } else {
        log.warn(`[AIService] visualFind failed: ${err.message}`);
      }
      if (opts.throwOnError) throw err;
      return null;
    }
  }

  /**
   * Asks the provider whether `condition` holds on the screenshot
   * (`xenon: assertVisualState`). Answers only with the provider's own
   * verdict: with no provider, a failed call, a rate limit or an answer that
   * isn't true or false it throws, saying the condition was not checked. A
   * `false` there would pass a test asserting that something is absent.
   */
  public async assertVisual(screenshotBase64: string, condition: string): Promise<VisualVerdict> {
    this.initializeProvider();
    const notChecked = 'so the condition was not checked';
    if (!this.provider) {
      throw new Error(
        `No AI provider is configured, ${notChecked}. Set XENON_AI_PROVIDER and the provider's key.`,
      );
    }

    const prompt = `
You are checking a screenshot of a mobile app for an automated test.

Condition: ${JSON.stringify(condition)}

Is the condition true of what the screenshot shows? Judge only what is visible on the screen.
Answer with JSON only, exactly: {"result": true or false, "reason": "one sentence on what you see"}
        `.trim();

    let answer: string;
    try {
      answer = await this.callProvider(prompt, screenshotBase64);
    } catch (err: any) {
      if (err instanceof AIRateLimitedError || err instanceof AITimeoutError) {
        throw new Error(`${err.message}, ${notChecked}. Try again later.`);
      }
      if (err instanceof AIProviderPausedError) {
        throw new Error(
          `The AI provider has been failing, ${notChecked}. Xenon will call it again in ${err.seconds} s.`,
        );
      }
      throw new Error(`The AI provider failed, ${notChecked}: ${err?.message ?? err}`);
    }
    const verdict = parseVisualVerdict(answer);
    if (!verdict) {
      const said = answer.replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new Error(
        `Xenon could not read the AI provider's answer as true or false, ${notChecked}. ` +
          `It answered: ${JSON.stringify(said)}`,
      );
    }
    return verdict;
  }

  /**
   * A short description of the screen in the screenshot, for
   * `xenon: analyzeScreen` and device control's Omni-Scan. Throws when there
   * is no provider or the call fails (AIRateLimitedError for a rate limit,
   * AITimeoutError after AI_CALL_TIMEOUT_MS), so the caller can say why there
   * is none.
   */
  public async describeScreen(screenshotBase64: string): Promise<string> {
    this.initializeProvider();
    if (!this.provider) throw new Error('No AI provider is configured');

    const prompt = `
You are looking at a screenshot of a mobile app, for a software tester.
Describe the screen in a few short sentences: which screen it is, its main elements and their state (for example filled in, empty, selected or disabled), and anything unexpected, such as an error message, a system dialog, a crash or a loading indicator.
Describe only what is visible. Answer in plain text.
        `.trim();

    return this.callProvider(prompt, screenshotBase64);
  }

  /**
   * Heals a broken locator using deep LLM reasoning (Tier 5)
   */
  public async healLocator(context: {
    selector: string;
    strategy: string;
    xml: string;
    screenshotBase64?: string;
  }): Promise<{ recommendedXpath: string; reason: string } | null> {
    this.initializeProvider();
    if (!this.isEnabled()) return null;

    // Deep Intelligence: Skip healing if the selector is explicitly meant for failure verification
    if (context.selector.includes('NON_EXISTENT')) {
      log.info(`[AIService] Skipping healing for verification locator: ${context.selector}`);
      return null;
    }

    const prompt = `
            You are an automated self-healing engine. 
            The locator "${context.selector}" (strategy: ${context.strategy}) failed to find an element.
            
            Current Page Source (XML):
            ${context.xml.substring(0, 10000)} ... [truncated]

            Analyze the XML and the provided screenshot. Find the element that most likely matches the developer's intent.
            Return a stable, optimized XPath for this element.
            
            Response Format: JSON only, strictly { "recommendedXpath": "string", "reason": "string" }.
        `;

    try {
      const response = await this.callProvider(prompt, context.screenshotBase64);
      const data = JSON.parse(response.replace(/```json|```/g, '').trim());
      return data;
    } catch (err: any) {
      // Log service unavailability / tripped breaker at debug level (expected);
      // genuine errors at warn.
      if (
        err instanceof CircuitOpenError ||
        err.message?.includes('unavailable') ||
        err.response?.status === 404
      ) {
        log.debug(`[AIService] healLocator skipped: ${err.message}`);
      } else {
        log.warn(`[AIService] healLocator failed: ${err.message}`);
      }
      return null;
    }
  }

  public async testConnection(testConfig: any): Promise<{ success: boolean; message: string }> {
    const providerType = testConfig.aiProvider || config.aiProvider;
    try {
      let testProvider: LLMProvider | null = null;
      const model = testConfig.aiModel || config.aiModel;
      const baseUrl = testConfig.aiBaseUrl || config.aiBaseUrl;

      log.info(`[AIService] Testing connection for provider: ${providerType}`);

      switch (providerType) {
        case 'gemini':
          // Prioritize Environment Key (via config singleton), then fallback to UI input
          const geminiKey = (config.geminiApiKey || testConfig.geminiApiKey || '').trim();
          if (!geminiKey)
            throw new Error(
              'Gemini API Key missing. Please set XENON_GEMINI_API_KEY environment variable.',
            );
          const targetGeminiModel =
            (config.geminiModel || model || '').trim() || 'gemini-3-flash-preview';
          testProvider = new GeminiProvider(geminiKey, targetGeminiModel);
          break;
        case 'openai':
          const openaiKey = (config.openaiApiKey || testConfig.openaiApiKey || '').trim();
          if (!openaiKey)
            throw new Error(
              'OpenAI API Key missing. Please set XENON_OPENAI_API_KEY environment variable.',
            );
          testProvider = new OpenAIProvider(
            openaiKey,
            config.openaiModel || model || 'gpt-4o',
            baseUrl,
          );
          break;
        case 'anthropic':
          const anthropicKey = (config.anthropicApiKey || testConfig.anthropicApiKey || '').trim();
          if (!anthropicKey)
            throw new Error(
              'Anthropic API Key missing. Please set XENON_ANTHROPIC_API_KEY environment variable.',
            );
          testProvider = new AnthropicProvider(
            anthropicKey,
            config.anthropicModel || model || 'claude-sonnet-4-6',
          );
          break;
        case 'ollama':
          testProvider = new OllamaProvider(
            baseUrl || 'http://localhost:11434',
            config.ollamaModel || model || 'llama3',
          );
          break;
        default:
          throw new Error(`Unsupported provider: ${providerType}`);
      }

      if (!testProvider) throw new Error('Failed to initialize provider for testing');

      // Send a minimal ping command. Not through the circuit breaker (a test
      // shouldn't pause the provider for everyone), but with the time limit.
      const pinged = testProvider;
      await withTimeLimit(AI_CALL_TIMEOUT_MS, (signal) =>
        pinged.analyze('Hello. Response: OK', undefined, signal),
      );
      return { success: true, message: `Successfully connected to ${providerType}!` };
    } catch (err: any) {
      // Not a success: every AI call fails the same way until it has quota again.
      if (isRateLimit(err)) {
        log.warn(
          `[AIService] Connection test: ${providerType} is rate-limited: ${err.detail ?? err.message}`,
        );
        return {
          success: false,
          message: `${providerType} answered, but it is rate-limited or out of quota. AI features won't work with it until it has quota again.`,
        };
      }
      log.error(`[AIService] Connection test failed: ${err.message}`);
      return { success: false, message: `Connection failed: ${err.message}` };
    }
  }

  private constructPrompt(context: AnalysisContext): string {
    return `
You are an Elite Mobile Automation Expert and Root Cause Analyst. 
Your mission is to analyze a failed Appium test session and explain EXACTLY why it failed in simple, human-readable terms.

### Context:
- **Session ID**: ${context.sessionId}
- **Primary Failure Reason**: ${context.failureReason}

### Last 10 Commands:
${JSON.stringify(context.commandLogs, null, 2)}

### Last 50 Device Log Lines:
${context.deviceLogs.join('\n')}

### Task:
1. Identify if it was a functional bug (app issue), a flaky selector, a system dialog, or an infrastructure failure.
2. If a screenshot is provided, look for visual clues (e.g., error popups, ANR, crash dialogs).
3. Provide a concise summary (max 3 sentences) starting with "Root Cause:".
4. Suggest a specific fix.

Formatting: Use Markdown.
        `.trim();
  }

  private getScreenshotBase64(screenshotPath?: string): string | null {
    if (!screenshotPath) return null;

    const fullPath = path.isAbsolute(screenshotPath)
      ? screenshotPath
      : path.join(config.sessionAssetsPath, screenshotPath);

    if (!fs.existsSync(fullPath)) {
      log.warn(`[AIService] Screenshot not found at ${fullPath}`);
      return null;
    }

    try {
      return fs.readFileSync(fullPath).toString('base64');
    } catch (err: any) {
      log.warn(`[AIService] Failed to read screenshot: ${err.message}`);
      return null;
    }
  }
}

export const AI_SERVICE = new AIService();
