import { logger } from '@appium/support';
import { logs as otelLogs, Logger as OtelLogger, SeverityNumber } from '@opentelemetry/api-logs';
import { sessionContext, SessionLogContext } from './logging/sessionContext';

const OTEL_SEVERITY: Record<'debug' | 'info' | 'warn' | 'error', SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

/**
 * Keys whose values must never appear in log output.
 * Case-insensitive substring matching is used so 'myApiKey' and 'API_KEY' both match.
 */
const SENSITIVE_KEY_PATTERNS = [
  'apikey',
  'api_key',
  'secret',
  'password',
  'token',
  'accesstoken',
  'refreshtoken',
  'dburl',
  'databaseurl',
  'clientsecret',
  'privatekey',
  'auth',
  'credentials',
  'secretkey',
];

const REDACTED = '***REDACTED***';

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/[_-]/g, '');
  return SENSITIVE_KEY_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Deep-clone an object, replacing values of sensitive keys with ***REDACTED***.
 * Safe to call before JSON.stringify for logging.
 */
export function redactSecrets<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Deep Intelligence: also redact keys from strings if they look like our API keys
  if (typeof obj === 'string') {
    let result: string = obj as any;
    // Common pattern for Gemini/OpenAI/Anthropic keys in logs
    const keyPatterns = [/AIza[a-zA-Z0-9-_]{35}/g, /sk-[a-zA-Z0-9]{32,}/g];
    for (const pattern of keyPatterns) {
      result = result.split(pattern).join(REDACTED);
    }
    return result as any;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  const seen = new WeakSet<object>();
  const redact = (value: any): any => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
      let s = value;
      const keyPatterns = [/AIza[a-zA-Z0-9-_]{35}/g, /sk-[a-zA-Z0-9]{32,}/g];
      for (const pattern of keyPatterns) {
        s = s.replace(pattern, REDACTED);
      }
      return s;
    }
    if (typeof value !== 'object') return value;

    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    if (Array.isArray(value)) {
      return value.map((item) => redact(item));
    }
    const result: Record<string, any> = {};
    for (const [key, v] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        result[key] = REDACTED;
      } else {
        result[key] = redact(v);
      }
    }
    return result;
  };
  return redact(obj);
}

/**
 * Enterprise-grade logger for Xenon.
 * Wraps @appium/support logger with contextual capabilities.
 */
class XenonLogger {
  private baseLogger: any;
  private context = '';

  public static isJsonLogging = process.env.XENON_JSON_LOGGING === 'true';

  // Set by TracingService once a global OTel LoggerProvider is registered.
  // Until then, emitting OTLP records would just hit a NoopLogger and waste
  // attribute-construction work on every log call.
  private static otlpReady = false;
  private static otelLogger: OtelLogger | null = null;

  constructor(prefix = 'xenon') {
    this.baseLogger = logger.getLogger(prefix);
  }

  /**
   * Configure global logger settings
   */
  public static configure(options: { enableJsonLogging?: boolean }) {
    if (options.enableJsonLogging !== undefined) {
      this.isJsonLogging = options.enableJsonLogging;
    }
  }

  /**
   * Called by TracingService after a global LoggerProvider is registered, so
   * subsequent log calls fan out to OTLP. Resetting to false on shutdown lets
   * tests re-init cleanly.
   */
  public static setOtlpReady(ready: boolean) {
    this.otlpReady = ready;
    if (!ready) {
      this.otelLogger = null;
    }
  }

  /**
   * Creates a sub-logger with a specific component scope.
   * Example: log.scope('DeviceManager') -> [DeviceManager] Info Message
   */
  public scope(name: string): XenonLogger {
    const scoped = new XenonLogger();
    scoped.baseLogger = this.baseLogger;
    scoped.context = `[${name}] `;
    return scoped;
  }

  /**
   * Attaches session context to the logger.
   * Example: log.withSession('abc-123') -> [abc-123] Message
   */
  public withSession(sessionId: string, udid?: string): XenonLogger {
    const sessionLogger = new XenonLogger();
    sessionLogger.baseLogger = this.baseLogger;
    const udidPart = udid ? `:${udid}` : '';
    sessionLogger.context = `${this.context}[${sessionId}${udidPart}] `;
    return sessionLogger;
  }

  private logMessage(level: 'info' | 'warn' | 'error' | 'debug', message: any, ...args: any[]) {
    const redactedMessage = redactSecrets(message);
    const redactedArgs = args.map((arg) => redactSecrets(arg));
    const ctx = sessionContext.get();
    const formattedMessage = this.format(redactedMessage);

    if (XenonLogger.isJsonLogging) {
      const logEntry: Record<string, any> = {
        timestamp: new Date().toISOString(),
        level,
        scope: this.context.trim() || 'root',
        message: formattedMessage,
      };
      if (ctx) {
        if (ctx.sessionId) logEntry.sessionId = ctx.sessionId;
        if (ctx.udid) logEntry.udid = ctx.udid;
        if (ctx.requestId) logEntry.requestId = ctx.requestId;
        if (ctx.commandName) logEntry.commandName = ctx.commandName;
        if (ctx.traceId) logEntry.traceId = ctx.traceId;
        if (ctx.spanId) logEntry.spanId = ctx.spanId;
      }
      if (redactedArgs.length) logEntry.args = redactedArgs;
      this.baseLogger.info(JSON.stringify(logEntry));
    } else {
      const ctxPrefix = this.buildTextPrefix(ctx);
      this.baseLogger[level](`${this.context}${ctxPrefix}${formattedMessage}`, ...redactedArgs);
    }

    // OTLP fan-out is independent of the stdout format toggle: operators may
    // want human-readable console + structured remote shipping at the same time.
    if (XenonLogger.otlpReady) {
      this.emitOtlp(level, formattedMessage, ctx, redactedArgs);
    }
  }

  private emitOtlp(
    level: 'info' | 'warn' | 'error' | 'debug',
    body: string,
    ctx: SessionLogContext | undefined,
    args: any[],
  ) {
    if (!XenonLogger.otelLogger) {
      XenonLogger.otelLogger = otelLogs.getLogger('xenon');
    }
    const attributes: Record<string, any> = {
      scope: this.context.trim() || 'root',
      log_level: level,
    };
    if (ctx?.sessionId) attributes.sessionId = ctx.sessionId;
    if (ctx?.udid) attributes.udid = ctx.udid;
    if (ctx?.requestId) attributes.requestId = ctx.requestId;
    if (ctx?.commandName) attributes.commandName = ctx.commandName;
    if (ctx?.traceId) attributes.traceId = ctx.traceId;
    if (ctx?.spanId) attributes.spanId = ctx.spanId;
    if (args.length) attributes.args = JSON.stringify(args);

    XenonLogger.otelLogger.emit({
      severityNumber: OTEL_SEVERITY[level],
      severityText: level.toUpperCase(),
      body,
      attributes,
    });
  }

  // Emit a compact [s:shortId] marker when async context has a sessionId that
  // isn't already baked into this.context (i.e. this logger wasn't created via
  // withSession). Keeps console lines short while still giving grep-ability.
  private buildTextPrefix(ctx: SessionLogContext | undefined): string {
    if (!ctx?.sessionId) return '';
    if (this.context.includes(ctx.sessionId)) return '';
    return `[s:${ctx.sessionId.slice(0, 8)}] `;
  }

  public info(message: any, ...args: any[]) {
    this.logMessage('info', message, ...args);
  }

  public warn(message: any, ...args: any[]) {
    this.logMessage('warn', message, ...args);
  }

  public error(message: any, ...args: any[]) {
    this.logMessage('error', message, ...args);
  }

  public debug(message: any, ...args: any[]) {
    this.logMessage('debug', message, ...args);
  }

  /**
   * Enterprise Audit entry.
   */
  public audit(action: string, actor = 'system', details: any = {}) {
    const redactedDetails = redactSecrets(details);
    const detailStr = Object.keys(redactedDetails).length
      ? ` | Details: ${JSON.stringify(redactedDetails)}`
      : '';
    this.baseLogger.info(`[AUDIT] ${this.context}${action} | Actor: ${actor}${detailStr}`);
  }

  /**
   * Performance instrumentation.
   */
  public async monitor<T>(label: string, task: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      this.debug(`[PERF] Start: ${label}`);
      const result = await task();
      const elapsed = Date.now() - start;
      this.debug(`[PERF] End: ${label} | Elapsed: ${elapsed}ms`);
      return result;
    } catch (err: any) {
      const elapsed = Date.now() - start;
      this.error(`[PERF] Failed: ${label} | Elapsed: ${elapsed}ms | Error: ${err.message}`);
      throw err;
    }
  }

  private format(message: any): string {
    if (typeof message === 'object') {
      try {
        return JSON.stringify(message);
      } catch (e) {
        return String(message);
      }
    }
    return String(message);
  }

  public banner(version: string, nodeId: string) {
    const splash = `
\x1b[36m
  __  __   ______   __   __   ______   __   __    
 /\\_\\_\\_\\ /\\  ___\\ /\\ "-.\\ \\ /\\  __ \\ /\\ "-.\\ \\   
 \\/_/\\_\\/_\\\\ \\  __\\ \\ \\ \\-.  \\\\ \\ \\/\\ \\\\ \\ \\-.  \\  
   /\\_\\_\\_\\ \\ \\_____\\\\ \\_\\\\"\\_\\\\ \\_____\\\\ \\_\\\\"\\_\\ 
   \\/_/_/_/  \\/_____/ \\/_/ \\/_/ \\/_____/ \\/_/ \\/_/ 
\x1b[0m
 :: \x1b[32mXenon Mobile Infrastructure\x1b[0m ::       (v${version})

 [Node ID: ${nodeId}]
 [Status:  Operational]
 -------------------------------------------------------------------
`;
    this.baseLogger.info(splash);
  }
}

// Initial main instance
const mainLogger = new XenonLogger('xenon');

export default mainLogger;
export { XenonLogger };
