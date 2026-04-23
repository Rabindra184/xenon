import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import http from 'http';
import https from 'https';
import log from './logger';
import { Container } from 'typedi';

/**
 * InternalHttpClient - Centralized HTTP client for all internal communication.
 *
 * Features:
 * - Keep-alive connections for performance
 * - Automatic retry with exponential backoff
 * - Request/response logging for debugging
 * - Correlation ID tracking
 */
export class InternalHttpClient {
  private static defaultInstance: InternalHttpClient;
  private axiosInstance: AxiosInstance;

  // Transient network failures worth retrying. Stalled/restarting node ports
  // commonly surface as these codes; the node is usually back within seconds.
  private static readonly RETRYABLE_NETWORK_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EPIPE',
    'ECONNABORTED',
    'ERR_NETWORK',
  ]);

  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_RETRY_MS = 500;
  private static readonly MAX_RETRY_MS = 4000;

  constructor(tlsRejectUnauthorized?: boolean, timeoutMs?: number) {
    this.axiosInstance = axios.create({
      httpAgent: this.getHttpAgent(),
      httpsAgent: this.getHttpsAgent(tlsRejectUnauthorized),
      timeout: InternalHttpClient.resolveTimeoutMs(timeoutMs),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    this.setupInterceptors();
  }

  // Ops can shorten the global default via env var when a slow node is
  // stalling session creation. Per-call override is still available via
  // AxiosRequestConfig.timeout on individual post/get/etc calls.
  private static resolveTimeoutMs(explicit?: number): number {
    if (typeof explicit === 'number' && explicit > 0) return explicit;
    const raw = process.env.XENON_HTTP_TIMEOUT_MS;
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
      log.warn(`[HTTP] Ignoring invalid XENON_HTTP_TIMEOUT_MS=${raw}, using 30000ms default`);
    }
    return 30000;
  }

  private getHttpAgent() {
    return new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 120000,
    });
  }

  private getHttpsAgent(tlsRejectUnauthorized?: boolean) {
    // Principal Decoupling: Prioritize constructor arg, fall back to env var
    const rejectUnauthorized =
      tlsRejectUnauthorized !== undefined
        ? tlsRejectUnauthorized
        : process.env.XENON_TLS_REJECT_UNAUTHORIZED !== 'false';

    return new https.Agent({
      // Hardened TLS Security: rejectUnauthorized defaults to true (production-safe).
      rejectUnauthorized,
      keepAlive: true,
      keepAliveMsecs: 120000,
    });
  }

  private setupInterceptors() {
    // Request interceptor - adds timing and logging
    this.axiosInstance.interceptors.request.use(
      (config: AxiosRequestConfig) => {
        // Add request start time for duration calculation
        (config as any).metadata = { startTime: Date.now() };

        // Log outgoing request
        log.debug(`[HTTP →] ${config.method?.toUpperCase()} ${config.url}`);

        return config as any;
      },
      (error) => {
        log.error(`[HTTP →] Request setup error: ${error.message}`);
        return Promise.reject(error);
      },
    );

    // Response interceptor - logging + retry logic
    this.axiosInstance.interceptors.response.use(
      async (response: AxiosResponse) => {
        const duration = Date.now() - ((response.config as any).metadata?.startTime || Date.now());

        // Log successful response
        if (!(response.config as any).silent) {
          log.debug(
            `[HTTP ←] ${response.config.method?.toUpperCase()} ${response.config.url} ` +
              `[${response.status}] ${duration}ms`,
          );
        }

        // Principal Decoupling: Emit event for logging/observability
        try {
          const { EVENT_BUS } = await import('./services/EventBus');
          EVENT_BUS.emit('http:outgoing', {
            direction: 'outgoing',
            method: response.config.method?.toUpperCase() || 'GET',
            url: response.config.url || '',
            requestBody: response.config.data ? JSON.stringify(response.config.data) : undefined,
            responseBody: response.data ? JSON.stringify(response.data).slice(0, 2000) : undefined,
            statusCode: response.status,
            durationMs: duration,
            source: 'InternalHttpClient',
          });
        } catch (e) {
          /* ignore */
        }

        return response;
      },
      async (error: AxiosError) => {
        const config: any = error.config;
        const response = error.response;
        const duration = Date.now() - (config?.metadata?.startTime || Date.now());

        // Principal Decoupling: Emit event for logging/observability
        try {
          const { EVENT_BUS } = await import('./services/EventBus');
          EVENT_BUS.emit('http:outgoing', {
            direction: 'outgoing',
            method: config?.method?.toUpperCase() || 'GET',
            url: config?.url || '',
            requestBody: config?.data ? JSON.stringify(config.data) : undefined,
            responseBody: response?.data ? JSON.stringify(response.data).slice(0, 2000) : undefined,
            statusCode: response?.status,
            durationMs: duration,
            error: error.message,
            source: 'InternalHttpClient',
          });
        } catch (e) {
          /* ignore */
        }

        if (!config) {
          return Promise.reject(error);
        }
        if (config.retryCount === undefined) {
          config.retryCount = 0;
        }

        const status = response?.status;

        // Log failed request
        if (!(config as any)?.silent) {
          log.warn(
            `[HTTP ←] ${config?.method?.toUpperCase()} ${config?.url} ` +
              `[${status || 'ERR'}] ${duration}ms - ${error.message}`,
          );
        }

        const decision = InternalHttpClient.classifyRetry(error);
        if (!decision.retryable || config.retryCount >= InternalHttpClient.MAX_RETRIES) {
          return Promise.reject(error);
        }

        config.retryCount += 1;
        const backoff = InternalHttpClient.computeBackoff(config.retryCount);
        log.warn(
          `[HTTP ↻] Retrying ${config.url} in ${backoff}ms (${decision.reason}, attempt ${config.retryCount}/${InternalHttpClient.MAX_RETRIES})`,
        );

        await new Promise((resolve) => setTimeout(resolve, backoff));
        return this.axiosInstance(config);
      },
    );
  }

  private static classifyRetry(error: AxiosError): { retryable: boolean; reason: string } {
    const response = error.response;
    if (response) {
      const s = response.status;
      if (s >= 500) return { retryable: true, reason: `HTTP ${s}` };
      if (s === 429) return { retryable: true, reason: 'rate limited (429)' };
      return { retryable: false, reason: `HTTP ${s}` };
    }
    // No response — network/transport error
    const code = (error as any).code || '';
    if (InternalHttpClient.RETRYABLE_NETWORK_CODES.has(code)) {
      return { retryable: true, reason: `network: ${code}` };
    }
    if (/timeout/i.test(error.message)) {
      return { retryable: true, reason: 'request timeout' };
    }
    return { retryable: false, reason: code || error.message };
  }

  private static computeBackoff(attempt: number): number {
    const base = Math.min(
      InternalHttpClient.BASE_RETRY_MS * Math.pow(2, attempt - 1),
      InternalHttpClient.MAX_RETRY_MS,
    );
    // 0-25% jitter to avoid thundering-herd on a recovering node
    const jitter = Math.random() * base * 0.25;
    return Math.floor(base + jitter);
  }

  public static getClient(tlsRejectUnauthorized?: boolean): AxiosInstance {
    if (tlsRejectUnauthorized !== undefined) {
      return new InternalHttpClient(tlsRejectUnauthorized).axiosInstance;
    }
    if (!this.defaultInstance) {
      this.defaultInstance = new InternalHttpClient();
    }
    return this.defaultInstance.axiosInstance;
  }

  public static async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response = await this.getClient().post<T>(url, data, config);
    return response.data;
  }

  public static async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.getClient().get<T>(url, config);
    return response.data;
  }

  public static async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.getClient().delete<T>(url, config);
    return response.data;
  }

  public static async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response = await this.getClient().put<T>(url, data, config);
    return response.data;
  }
}
