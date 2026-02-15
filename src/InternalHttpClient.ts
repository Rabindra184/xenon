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

  constructor(tlsRejectUnauthorized?: boolean) {
    this.axiosInstance = axios.create({
      httpAgent: this.getHttpAgent(),
      httpsAgent: this.getHttpsAgent(tlsRejectUnauthorized),
      timeout: 30000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    this.setupInterceptors();
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
        log.debug(
          `[HTTP ←] ${response.config.method?.toUpperCase()} ${response.config.url} ` +
            `[${response.status}] ${duration}ms`,
        );

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

        if (!config || config.retryCount === undefined) {
          config.retryCount = 0;
        }

        const maxRetries = 2;
        const status = response?.status;

        // Log failed request
        log.warn(
          `[HTTP ←] ${config?.method?.toUpperCase()} ${config?.url} ` +
            `[${status || 'ERR'}] ${duration}ms - ${error.message}`,
        );

        // Don't retry client errors (4xx) except for occasional 429
        if (status && status < 500 && status !== 429) {
          return Promise.reject(error);
        }

        if (config.retryCount < maxRetries) {
          config.retryCount += 1;
          const backoff = config.retryCount * 1000;
          log.warn(
            `[HTTP ↻] Retrying ${config.url} in ${backoff}ms (Attempt ${config.retryCount}/${maxRetries})...`,
          );

          await new Promise((resolve) => setTimeout(resolve, backoff));
          return this.axiosInstance(config);
        }

        return Promise.reject(error);
      },
    );
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
