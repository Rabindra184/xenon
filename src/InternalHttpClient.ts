import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import http from 'http';
import https from 'https';
import _ from 'lodash';
import log from './logger';

export class InternalHttpClient {
  private static instance: AxiosInstance;

  private static getHttpAgent() {
    return new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 120000,
    });
  }

  private static getHttpsAgent() {
    return new https.Agent({
      rejectUnauthorized: false,
      keepAlive: true,
      keepAliveMsecs: 120000,
    });
  }

  public static getClient(): AxiosInstance {
    if (!this.instance) {
      this.instance = axios.create({
        httpAgent: this.getHttpAgent(),
        httpsAgent: this.getHttpsAgent(),
        timeout: 30000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      // Add resilient retry interceptor
      this.instance.interceptors.response.use(
        (response) => response,
        async (error) => {
          const { config, response } = error;

          if (!config || config.retryCount === undefined) {
            config.retryCount = 0;
          }

          const maxRetries = 2;
          const status = response?.status;

          // Don't retry client errors (4xx) except for occasional 429
          if (status && status < 500 && status !== 429) {
            return Promise.reject(error);
          }

          if (config.retryCount < maxRetries) {
            config.retryCount += 1;
            const backoff = config.retryCount * 1000;
            log.warn(
              `Resilient Client: Request to ${config.url} failed (${error.message}). Retrying in ${backoff}ms (Attempt ${config.retryCount}/${maxRetries})...`,
            );

            await new Promise((resolve) => setTimeout(resolve, backoff));
            return this.instance(config);
          }

          return Promise.reject(error);
        },
      );
    }
    return this.instance;
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
}
