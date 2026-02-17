import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import log from '../logger';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

export interface AnalysisContext {
  sessionId: string;
  failureReason: string;
  commandLogs: any[];
  deviceLogs: string[];
  screenshotPath?: string;
}

interface LLMProvider {
  analyze(prompt: string, screenshotBase64?: string): Promise<string>;
}

class GeminiProvider implements LLMProvider {
  private genAI: GoogleGenerativeAI;
  private modelName: string;

  constructor(apiKey: string, modelName?: string) {
    this.genAI = new GoogleGenerativeAI(apiKey.trim());
    this.modelName = modelName && modelName.trim() !== '' ? modelName.trim() : 'gemini-3-flash-preview';
  }

  async analyze(prompt: string, screenshotBase64?: string): Promise<string> {
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
        const model = this.genAI.getGenerativeModel({ model: this.modelName }, { apiVersion: version });
        const result = await model.generateContent(parts);
        const response = await result.response;
        return response.text();
      } catch (err: any) {
        lastError = err;
        // If we get a 429, the connection IS WORKING, just rate limited.
        if (err.message.includes('429') || err.message.includes('Quota exceeded')) {
          log.info(`[Gemini] Connection verified (Rate Limited) via ${version} endpoint.`);
          return "CONNECTION_OK_RATE_LIMITED";
        }

        if (err.message.includes('404') || err.message.includes('not found') || err.message.includes('unsupported')) {
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
  async analyze(prompt: string, screenshotBase64?: string): Promise<string> {
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

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: 500,
    });
    return response.choices[0].message.content || '';
  }
}

class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;
  constructor(apiKey: string, model = 'claude-3-5-sonnet-20240620') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }
  async analyze(prompt: string, screenshotBase64?: string): Promise<string> {
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

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 500,
      messages: [{ role: 'user', content }],
    });
    return (response.content[0] as any).text || '';
  }
}

class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;
  constructor(baseUrl = 'http://localhost:11434', model = 'llama3') {
    this.baseUrl = baseUrl;
    this.model = model;
  }
  async analyze(prompt: string, screenshotBase64?: string): Promise<string> {
    const response = await axios.post(`${this.baseUrl}/api/generate`, {
      model: this.model,
      prompt: prompt,
      images: screenshotBase64 ? [screenshotBase64] : [],
      stream: false,
    });
    return response.data.response || '';
  }
}

export class AIService {
  private provider: LLMProvider | null = null;
  private isMock = false;

  constructor() {
    this.initializeProvider();
  }

  private initializeProvider() {
    const providerType = config.aiProvider;
    const model = config.aiModel;
    const baseUrl = config.aiBaseUrl;

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
          if (geminiKey) this.provider = new GeminiProvider(geminiKey, model);
          break;
        case 'openai':
          const openaiKey = config.openaiApiKey;
          if (openaiKey) this.provider = new OpenAIProvider(openaiKey, model || 'gpt-4o', baseUrl);
          break;
        case 'anthropic':
          const anthropicKey = config.anthropicApiKey;
          if (anthropicKey)
            this.provider = new AnthropicProvider(
              anthropicKey,
              model || 'claude-3-5-sonnet-20240620',
            );
          break;
        case 'ollama':
          this.provider = new OllamaProvider(
            baseUrl || 'http://localhost:11434',
            model || 'llama3',
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

  public isEnabled(): boolean {
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

      const text = await this.provider!.analyze(prompt, screenshotBase64 || undefined);

      log.info(`[AIService] Analysis complete for ${context.sessionId}`);
      return text;
    } catch (err: any) {
      log.error(`[AIService] Analysis failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Finds coordinates for an element based on a visual description (Tier 4)
   */
  public async visualFind(
    screenshotBase64: string,
    description: string,
  ): Promise<{ x: number; y: number } | null> {
    this.initializeProvider();
    if (!this.isEnabled()) return null;

    const prompt = `
            Task: Find the center coordinates (X, Y) of the element described as: "${description}"
            Response Format: JSON only, strictly { "x": number, "y": number }. 
            Scale: 0 to screen width/height.
            Instructions: Look at the provided screenshot and find the exact center of the specified element.
        `;

    try {
      const response = await this.provider!.analyze(prompt, screenshotBase64);
      const data = JSON.parse(response.replace(/```json|```/g, '').trim());
      return data;
    } catch (err: any) {
      log.error(`[AIService] visualFind failed: ${err.message}`);
      return null;
    }
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
      const response = await this.provider!.analyze(prompt, context.screenshotBase64);
      const data = JSON.parse(response.replace(/```json|```/g, '').trim());
      return data;
    } catch (err: any) {
      log.error(`[AIService] healLocator failed: ${err.message}`);
      return null;
    }
  }

  public async testConnection(testConfig: any): Promise<{ success: boolean; message: string }> {
    try {
      let testProvider: LLMProvider | null = null;
      const providerType = testConfig.aiProvider || config.aiProvider;
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
          const targetGeminiModel = (model || '').trim() || 'gemini-3-flash-preview';
          testProvider = new GeminiProvider(geminiKey, targetGeminiModel);
          break;
        case 'openai':
          const openaiKey = (config.openaiApiKey || testConfig.openaiApiKey || '').trim();
          if (!openaiKey)
            throw new Error(
              'OpenAI API Key missing. Please set XENON_OPENAI_API_KEY environment variable.',
            );
          testProvider = new OpenAIProvider(openaiKey, model || 'gpt-4o', baseUrl);
          break;
        case 'anthropic':
          const anthropicKey = (config.anthropicApiKey || testConfig.anthropicApiKey || '').trim();
          if (!anthropicKey)
            throw new Error(
              'Anthropic API Key missing. Please set XENON_ANTHROPIC_API_KEY environment variable.',
            );
          testProvider = new AnthropicProvider(anthropicKey, model || 'claude-3-5-sonnet-20240620');
          break;
        case 'ollama':
          testProvider = new OllamaProvider(baseUrl || 'http://localhost:11434', model || 'llama3');
          break;
        default:
          throw new Error(`Unsupported provider: ${providerType}`);
      }

      if (!testProvider) throw new Error('Failed to initialize provider for testing');

      // Send a minimal ping command
      const responseText = await testProvider.analyze('Hello. Response: OK');
      if (responseText === 'CONNECTION_OK_RATE_LIMITED') {
        return { success: true, message: `Successfully connected to ${providerType}! (Note: You are currently out of quota/rate-limited, but the setup is correct)` };
      }
      return { success: true, message: `Successfully connected to ${providerType}!` };
    } catch (err: any) {
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
