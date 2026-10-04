import axios from 'axios';
import sinon from 'sinon';
import { config } from '../../src/config';

/**
 * The AI providers, answered here instead of on the network. Gemini, OpenAI
 * and Anthropic's SDKs call `fetch`; Ollama goes through axios. The fakes
 * answer at that level, so the SDKs build their own errors (a 429 is the
 * SDK's own rate-limit error) and nothing reaches a real provider.
 *
 * Call `useFakeAiProviders()` inside a `describe`. It saves the server's AI
 * settings before each test and puts them back after, and answers every fetch
 * and every axios GET/POST itself, for the whole test: an AI call is answered
 * as the test says, anything else fails.
 */

export type ProviderName = 'gemini' | 'openai' | 'anthropic' | 'ollama';
export const PROVIDERS: ProviderName[] = ['gemini', 'openai', 'anthropic', 'ollama'];

/** How a fake provider answers one call: a text, an HTTP error (with the provider's message), or never. */
export type Answer = { text: string } | { status: number; message?: string } | 'hang';

export interface FakeAiProviders {
  /** Chooses `provider` with a key and a model no other test uses (its own circuit breaker). */
  use(provider: ProviderName, opts?: { key?: boolean }): { model: string };
  /** How the chosen provider answers from now on. */
  answer(answer: Answer): void;
  /** Whether Ollama's server answers its health check (it does unless told). */
  ollamaUp(up: boolean): void;
  /** Calls that reached the provider (the Ollama health check not included). */
  readonly calls: Array<{ provider: ProviderName; body: string; signal?: AbortSignal }>;
}

const AI_SETTINGS = [
  'aiProvider',
  'aiModel',
  'aiBaseUrl',
  'geminiApiKey',
  'openaiApiKey',
  'anthropicApiKey',
  'geminiModel',
  'openaiModel',
  'anthropicModel',
  'ollamaModel',
] as const;

export const OLLAMA_URL = 'http://ollama.test:11434';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    // The OpenAI and Anthropic SDKs retry a 429 after a pause unless told not to.
    headers: { 'content-type': 'application/json', 'x-should-retry': 'false' },
  });
}

function okBody(provider: ProviderName, text: string): unknown {
  switch (provider) {
    case 'gemini':
      return {
        candidates: [
          { content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 },
        ],
      };
    case 'openai':
      return {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 0,
        model: 'test',
        choices: [
          { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
        ],
      };
    case 'anthropic':
      return {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'test',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    default:
      return { response: text };
  }
}

function errorBody(provider: ProviderName, status: number, said?: string): unknown {
  const message =
    said ?? (status === 429 ? 'Resource has been exhausted (e.g. check quota).' : `HTTP ${status}`);
  switch (provider) {
    case 'gemini':
      return { error: { code: status, message, status: 'RESOURCE_EXHAUSTED' } };
    case 'anthropic':
      return { type: 'error', error: { type: 'rate_limit_error', message } };
    default:
      return { error: { message, type: 'requests', code: 'rate_limit_exceeded' } };
  }
}

function aborted(): Error {
  const err = new Error('This operation was aborted');
  err.name = 'AbortError';
  return err;
}

/** Resolves never, and rejects as fetch does when the request's signal aborts. */
function hangUntilAborted<T>(signal?: AbortSignal): Promise<T> {
  return new Promise((_, reject) => {
    if (signal?.aborted) return reject(aborted());
    signal?.addEventListener('abort', () => reject(aborted()));
  });
}

export function useFakeAiProviders(): FakeAiProviders {
  let saved: Record<string, unknown> = {};
  let savedMockEnv: string | undefined;
  let provider: ProviderName = 'gemini';
  let current: Answer = { status: 500 };
  let ollamaUp = true;
  const calls: FakeAiProviders['calls'] = [];
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    saved = Object.fromEntries(AI_SETTINGS.map((k) => [k, (config as any)[k]]));
    savedMockEnv = process.env.GEMINI_API_KEY;
    // 'mock' would put the service in its built-in mock mode.
    if (process.env.GEMINI_API_KEY === 'mock') delete process.env.GEMINI_API_KEY;
    for (const k of AI_SETTINGS) (config as any)[k] = undefined;
    config.aiProvider = 'gemini';
    calls.length = 0;
    current = { status: 500 };
    ollamaUp = true;

    sandbox.stub(globalThis, 'fetch').callsFake((async (_url: any, init?: RequestInit) => {
      const signal = init?.signal ?? undefined;
      calls.push({ provider, body: String(init?.body ?? ''), signal });
      if (current === 'hang') return hangUntilAborted(signal);
      if ('text' in current) return json(200, okBody(provider, current.text));
      return json(current.status, errorBody(provider, current.status, current.message));
    }) as any);

    // Ollama: its health check answers, then the generate call as told.
    sandbox.stub(axios, 'get').callsFake((async (url: string) => {
      if (url.startsWith(OLLAMA_URL)) {
        if (ollamaUp) return { status: 200, data: { models: [] } };
        throw Object.assign(new Error(`connect ECONNREFUSED ${OLLAMA_URL}`), {
          code: 'ECONNREFUSED',
        });
      }
      throw new Error(`no network in tests: GET ${url}`);
    }) as any);
    sandbox.stub(axios, 'post').callsFake((async (url: string, body: any, cfg?: any) => {
      if (!url.startsWith(OLLAMA_URL)) throw new Error(`no network in tests: POST ${url}`);
      const signal: AbortSignal | undefined = cfg?.signal;
      calls.push({ provider: 'ollama', body: JSON.stringify(body), signal });
      if (current === 'hang') return hangUntilAborted(signal);
      if ('text' in current) return { status: 200, data: okBody('ollama', current.text) };
      const err: any = new Error(`Request failed with status code ${current.status}`);
      err.response = {
        status: current.status,
        data: errorBody('ollama', current.status, current.message),
      };
      throw err;
    }) as any);
  });

  afterEach(() => {
    sandbox.restore();
    for (const k of AI_SETTINGS) (config as any)[k] = saved[k];
    if (savedMockEnv === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedMockEnv;
  });

  return {
    calls,
    use(name, opts = {}) {
      provider = name;
      const model = `test-${name}-${Math.random().toString(36).slice(2)}`;
      const key = opts.key === false ? undefined : 'test-key';
      config.aiProvider = name;
      if (name === 'gemini') Object.assign(config, { geminiApiKey: key, geminiModel: model });
      if (name === 'openai') Object.assign(config, { openaiApiKey: key, openaiModel: model });
      if (name === 'anthropic')
        Object.assign(config, { anthropicApiKey: key, anthropicModel: model });
      if (name === 'ollama') Object.assign(config, { aiBaseUrl: OLLAMA_URL, ollamaModel: model });
      return { model };
    },
    answer(answer) {
      current = answer;
    },
    ollamaUp(up) {
      ollamaUp = up;
    },
  };
}
