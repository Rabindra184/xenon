import { logger } from '@appium/support';

/**
 * Enterprise-grade logger for Xenon.
 * Wraps @appium/support logger with contextual capabilities.
 */
class XenonLogger {
  private baseLogger: any;
  private context: string = '';

  constructor(prefix: string = 'xenon') {
    this.baseLogger = logger.getLogger(prefix);
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

  public info(message: any, ...args: any[]) {
    this.baseLogger.info(`${this.context}${this.format(message)}`, ...args);
  }

  public warn(message: any, ...args: any[]) {
    this.baseLogger.warn(`${this.context}${this.format(message)}`, ...args);
  }

  public error(message: any, ...args: any[]) {
    this.baseLogger.error(`${this.context}${this.format(message)}`, ...args);
  }

  public debug(message: any, ...args: any[]) {
    this.baseLogger.debug(`${this.context}${this.format(message)}`, ...args);
  }

  /**
   * Enterprise Audit entry.
   */
  public audit(action: string, actor: string = 'system', details: any = {}) {
    const detailStr = Object.keys(details).length ? ` | Details: ${JSON.stringify(details)}` : '';
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
const which_appium = process.env.APPIUM_HOME ? 'main' : 'core';
const mainLogger = new XenonLogger(`xenon-${which_appium}`);

export default mainLogger;
export { XenonLogger };
