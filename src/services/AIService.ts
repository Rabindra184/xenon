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
    private model: any;
    constructor(apiKey: string, modelName: string = 'gemini-1.5-flash') {
        const genAI = new GoogleGenerativeAI(apiKey);
        this.model = genAI.getGenerativeModel({ model: modelName });
    }
    async analyze(prompt: string, screenshotBase64?: string): Promise<string> {
        const parts: any[] = [prompt];
        if (screenshotBase64) {
            parts.push({
                inlineData: {
                    data: screenshotBase64,
                    mimeType: 'image/png'
                }
            });
        }
        const result = await this.model.generateContent(parts);
        const response = await result.response;
        return response.text();
    }
}

class OpenAIProvider implements LLMProvider {
    private client: OpenAI;
    private model: string;
    constructor(apiKey: string, model: string = 'gpt-4o', baseURL?: string) {
        this.client = new OpenAI({ apiKey, baseURL });
        this.model = model;
    }
    async analyze(prompt: string, screenshotBase64?: string): Promise<string> {
        const messages: any[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: prompt }
                ]
            }
        ];

        if (screenshotBase64) {
            messages[0].content.push({
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${screenshotBase64}` }
            });
        }

        const response = await this.client.chat.completions.create({
            model: this.model,
            messages,
            max_tokens: 500
        });
        return response.choices[0].message.content || '';
    }
}

class AnthropicProvider implements LLMProvider {
    private client: Anthropic;
    private model: string;
    constructor(apiKey: string, model: string = 'claude-3-5-sonnet-20240620') {
        this.client = new Anthropic({ apiKey });
        this.model = model;
    }
    async analyze(prompt: string, screenshotBase64?: string): Promise<string> {
        const content: any[] = [
            { type: 'text', text: prompt }
        ];

        if (screenshotBase64) {
            content.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: screenshotBase64
                }
            });
        }

        const response = await this.client.messages.create({
            model: this.model,
            max_tokens: 500,
            messages: [{ role: 'user', content }]
        });
        return (response.content[0] as any).text || '';
    }
}

class OllamaProvider implements LLMProvider {
    private baseUrl: string;
    private model: string;
    constructor(baseUrl: string = 'http://localhost:11434', model: string = 'llama3') {
        this.baseUrl = baseUrl;
        this.model = model;
    }
    async analyze(prompt: string, screenshotBase64?: string): Promise<string> {
        const response = await axios.post(`${this.baseUrl}/api/generate`, {
            model: this.model,
            prompt: prompt,
            images: screenshotBase64 ? [screenshotBase64] : [],
            stream: false
        });
        return response.data.response || '';
    }
}

export class AIService {
    private provider: LLMProvider | null = null;
    private isMock: boolean = false;

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
                    const geminiKey = process.env.GEMINI_API_KEY;
                    if (geminiKey) this.provider = new GeminiProvider(geminiKey, model);
                    break;
                case 'openai':
                    const openaiKey = process.env.OPENAI_API_KEY;
                    if (openaiKey) this.provider = new OpenAIProvider(openaiKey, model || 'gpt-4o', baseUrl);
                    break;
                case 'anthropic':
                    const anthropicKey = process.env.ANTHROPIC_API_KEY;
                    if (anthropicKey) this.provider = new AnthropicProvider(anthropicKey, model || 'claude-3-5-sonnet-20240620');
                    break;
                case 'ollama':
                    this.provider = new OllamaProvider(baseUrl || 'http://localhost:11434', model || 'llama3');
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

        log.info(`[AIService] Analyzing failure for session ${context.sessionId} via ${config.aiProvider}`);

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

    public async testConnection(testConfig: any): Promise<{ success: boolean; message: string }> {
        try {
            let testProvider: LLMProvider | null = null;
            const providerType = testConfig.aiProvider;
            const model = testConfig.aiModel;
            const baseUrl = testConfig.aiBaseUrl;

            log.info(`[AIService] Testing connection for provider: ${providerType}`);

            switch (providerType) {
                case 'gemini':
                    const geminiKey = testConfig.geminiApiKey || process.env.GEMINI_API_KEY;
                    if (!geminiKey) throw new Error('Gemini API Key missing');
                    testProvider = new GeminiProvider(geminiKey, model || 'gemini-1.5-flash');
                    break;
                case 'openai':
                    const openaiKey = testConfig.openaiApiKey || process.env.OPENAI_API_KEY;
                    if (!openaiKey) throw new Error('OpenAI API Key missing');
                    testProvider = new OpenAIProvider(openaiKey, model || 'gpt-4o', baseUrl);
                    break;
                case 'anthropic':
                    const anthropicKey = testConfig.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
                    if (!anthropicKey) throw new Error('Anthropic API Key missing');
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
            await testProvider.analyze('Hello. Response: OK');

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
