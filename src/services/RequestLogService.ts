import { Service } from 'typedi';
import { prisma } from '../prisma';
import log from '../logger';

/**
 * Sanitizes sensitive data from request payloads before logging.
 * Redacts passwords, tokens, API keys, and other secrets.
 */
function sanitizePayload(data: any, depth = 0): any {
  if (depth > 5) return '[MAX_DEPTH]';
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    // Truncate very long strings (e.g., base64 images)
    if (data.length > 500) {
      return `[STRING_TRUNCATED: ${data.length} chars]`;
    }
    return data;
  }

  if (Array.isArray(data)) {
    if (data.length > 10) {
      return `[ARRAY_TRUNCATED: ${data.length} items]`;
    }
    return data.map((item) => sanitizePayload(item, depth + 1));
  }

  if (typeof data === 'object') {
    const sanitized: Record<string, any> = {};
    const sensitiveKeys = [
      'password',
      'token',
      'apikey',
      'api_key',
      'secret',
      'authorization',
      'auth',
      'credential',
      'key',
      'private',
      'accesstoken',
      'access_token',
      'refreshtoken',
      'refresh_token',
      'bearer',
      'jwt',
    ];

    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((s) => lowerKey.includes(s))) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizePayload(value, depth + 1);
      }
    }
    return sanitized;
  }

  return data;
}

export interface RequestLogEntry {
  id?: string;
  timestamp: Date;
  direction: 'outgoing' | 'incoming';
  method: string;
  url: string;
  requestBody?: string;
  responseBody?: string;
  statusCode?: number;
  durationMs?: number;
  error?: string;
  source?: string;
  correlationId?: string;
}

/**
 * RequestLogService provides centralized logging for HTTP requests.
 *
 * Features:
 * - In-memory ring buffer for recent requests (fast access)
 * - Database persistence for audit trail (optional)
 * - Automatic payload sanitization (no secrets in logs)
 * - Correlation ID tracking for distributed tracing
 */
@Service()
export class RequestLogService {
  private ringBuffer: RequestLogEntry[] = [];
  private bufferSize = 500; // Keep last 500 requests in memory
  private persistToDb = false; // Enable for full audit trail

  constructor() {
    log.info('[RequestLogService] Initialized with buffer size', this.bufferSize);

    // Principal Decoupling: Subscribe to global events
    import('./EventBus').then(({ EVENT_BUS }) => {
      EVENT_BUS.on('http:outgoing', (data) => this.logRequest(data));
    });
  }

  /**
   * Enable/disable database persistence
   */
  setPersistence(enabled: boolean) {
    this.persistToDb = enabled;
    log.info(`[RequestLogService] Database persistence: ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Log an outgoing HTTP request
   */
  async logRequest(entry: Omit<RequestLogEntry, 'id' | 'timestamp'>): Promise<void> {
    const fullEntry: RequestLogEntry = {
      ...entry,
      timestamp: new Date(),
      requestBody: entry.requestBody
        ? JSON.stringify(sanitizePayload(JSON.parse(entry.requestBody || '{}')))
        : undefined,
      responseBody: entry.responseBody
        ? JSON.stringify(sanitizePayload(JSON.parse(entry.responseBody || '{}')))
        : undefined,
    };

    // Add to ring buffer
    this.ringBuffer.push(fullEntry);
    if (this.ringBuffer.length > this.bufferSize) {
      this.ringBuffer.shift();
    }

    // Log to console with appropriate level
    if (entry.error) {
      log.error(
        `[HTTP ${entry.direction.toUpperCase()}] ${entry.method} ${entry.url} ` +
          `[${entry.statusCode || 'ERR'}] ${entry.durationMs}ms - ${entry.error}`,
      );
    } else if ((entry.statusCode || 0) >= 400) {
      log.warn(
        `[HTTP ${entry.direction.toUpperCase()}] ${entry.method} ${entry.url} ` +
          `[${entry.statusCode}] ${entry.durationMs}ms`,
      );
    } else {
      log.debug(
        `[HTTP ${entry.direction.toUpperCase()}] ${entry.method} ${entry.url} ` +
          `[${entry.statusCode}] ${entry.durationMs}ms`,
      );
    }

    // Persist to database if enabled
    if (this.persistToDb) {
      await this.persistEntry(fullEntry);
    }
  }

  /**
   * Get recent request logs from the ring buffer
   */
  getRecentLogs(
    limit = 50,
    filter?: {
      method?: string;
      urlPattern?: string;
      direction?: 'outgoing' | 'incoming';
      hasError?: boolean;
    },
  ): RequestLogEntry[] {
    let logs = [...this.ringBuffer].reverse();

    if (filter) {
      if (filter.method) {
        logs = logs.filter((l) => l.method === filter.method);
      }
      if (filter.urlPattern) {
        const pattern = filter.urlPattern;
        logs = logs.filter((l) => l.url.includes(pattern));
      }
      if (filter.direction) {
        logs = logs.filter((l) => l.direction === filter.direction);
      }
      if (filter.hasError !== undefined) {
        logs = logs.filter((l) => (filter.hasError ? !!l.error : !l.error));
      }
    }

    return logs.slice(0, limit);
  }

  /**
   * Get summary statistics
   */
  getStats(): {
    totalLogged: number;
    errorCount: number;
    avgDurationMs: number;
    byMethod: Record<string, number>;
    byStatusCode: Record<number, number>;
  } {
    const logs = this.ringBuffer;
    const byMethod: Record<string, number> = {};
    const byStatusCode: Record<number, number> = {};
    let errorCount = 0;
    let totalDuration = 0;

    for (const entry of logs) {
      byMethod[entry.method] = (byMethod[entry.method] || 0) + 1;
      if (entry.statusCode) {
        byStatusCode[entry.statusCode] = (byStatusCode[entry.statusCode] || 0) + 1;
      }
      if (entry.error) errorCount++;
      if (entry.durationMs) totalDuration += entry.durationMs;
    }

    return {
      totalLogged: logs.length,
      errorCount,
      avgDurationMs: logs.length > 0 ? Math.round(totalDuration / logs.length) : 0,
      byMethod,
      byStatusCode,
    };
  }

  /**
   * Clear the ring buffer
   */
  clear() {
    this.ringBuffer = [];
    log.info('[RequestLogService] Buffer cleared');
  }

  /**
   * Persist entry to database (for audit trail)
   */
  private async persistEntry(entry: RequestLogEntry): Promise<void> {
    try {
      // Using a generic Log table or you could create a dedicated RequestLog table
      // For now, we'll just log - you can add Prisma model later
      // await prisma.requestLog.create({ data: { ... } });
    } catch (err: any) {
      log.warn(`[RequestLogService] Failed to persist log: ${err.message}`);
    }
  }
}
