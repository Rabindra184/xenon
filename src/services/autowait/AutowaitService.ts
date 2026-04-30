import { Service } from 'typedi';
import { AutowaitConfig, IPluginArgs } from '../../interfaces/IPluginArgs';
import log from '../../logger';

export interface AutowaitProps {
  enabled: boolean;
  timeoutMs: number;
  intervalBetweenAttemptsMs: number;
  excludeEnabledCheck: string[];
}

export const AUTOWAIT_DEFAULTS: AutowaitProps = {
  enabled: false,
  timeoutMs: 10000,
  intervalBetweenAttemptsMs: 500,
  excludeEnabledCheck: [],
};

/**
 * Per-session implicit-wait configuration.
 *
 * Plugin args provide the baseline; the `xenon: setAutowaitProperties` execute
 * script lets a test override the values for its own session at runtime.
 *
 * Inspired by `appium-wait-plugin`. Integrates with Xenon's self-healing:
 * autowait runs first (give the element time to render), then if the timeout
 * still expires HealingOrchestrator gets a shot.
 */
@Service()
export class AutowaitService {
  private readonly logger = log.scope('Autowait');
  private overrides = new Map<string, Partial<AutowaitProps>>();

  /**
   * Resolve the effective config for a session.
   *
   * Order: hard-coded defaults → plugin args → per-session override.
   * `pluginArgs` is passed in (rather than injected) because the interceptor
   * already receives it from the plugin entry point.
   */
  getProps(sessionId: string | undefined, pluginArgs: IPluginArgs): AutowaitProps {
    const fromArgs = this.normalizeConfig(pluginArgs.autowait);
    const merged: AutowaitProps = { ...AUTOWAIT_DEFAULTS, ...fromArgs };
    if (sessionId) {
      const override = this.overrides.get(sessionId);
      if (override) Object.assign(merged, override);
    }
    return merged;
  }

  /**
   * Apply a runtime override for a session. Caller-supplied keys validated;
   * unknown / wrong-typed keys are dropped with a warning rather than throwing.
   */
  setProps(sessionId: string, partial: Partial<AutowaitProps>): AutowaitProps {
    const current = this.overrides.get(sessionId) ?? {};
    const next: Partial<AutowaitProps> = { ...current };

    if (partial.enabled !== undefined) {
      if (typeof partial.enabled !== 'boolean') {
        throw new Error('autowait.enabled must be a boolean');
      }
      next.enabled = partial.enabled;
    }
    if (partial.timeoutMs !== undefined) {
      if (typeof partial.timeoutMs !== 'number' || partial.timeoutMs < 0) {
        throw new Error('autowait.timeoutMs must be a non-negative number');
      }
      next.timeoutMs = partial.timeoutMs;
    }
    if (partial.intervalBetweenAttemptsMs !== undefined) {
      if (
        typeof partial.intervalBetweenAttemptsMs !== 'number' ||
        partial.intervalBetweenAttemptsMs < 0
      ) {
        throw new Error('autowait.intervalBetweenAttemptsMs must be a non-negative number');
      }
      next.intervalBetweenAttemptsMs = partial.intervalBetweenAttemptsMs;
    }
    if (partial.excludeEnabledCheck !== undefined) {
      if (
        !Array.isArray(partial.excludeEnabledCheck) ||
        partial.excludeEnabledCheck.some((c) => typeof c !== 'string')
      ) {
        throw new Error('autowait.excludeEnabledCheck must be an array of strings');
      }
      next.excludeEnabledCheck = [...partial.excludeEnabledCheck];
    }

    this.overrides.set(sessionId, next);
    this.logger.info(`Updated autowait props for session ${sessionId}: ${JSON.stringify(next)}`);
    return { ...AUTOWAIT_DEFAULTS, ...next };
  }

  clearSession(sessionId: string): void {
    this.overrides.delete(sessionId);
  }

  /**
   * Accept legacy appium-wait-plugin field names so existing tests don't
   * have to be rewritten when migrating.
   */
  static fromLegacyShape(payload: any): Partial<AutowaitProps> {
    if (!payload || typeof payload !== 'object') return {};
    const out: Partial<AutowaitProps> = {};
    if (typeof payload.enabled === 'boolean') out.enabled = payload.enabled;
    if (typeof payload.timeout === 'number') out.timeoutMs = payload.timeout;
    if (typeof payload.timeoutMs === 'number') out.timeoutMs = payload.timeoutMs;
    if (typeof payload.intervalBetweenAttempts === 'number') {
      out.intervalBetweenAttemptsMs = payload.intervalBetweenAttempts;
    }
    if (typeof payload.intervalBetweenAttemptsMs === 'number') {
      out.intervalBetweenAttemptsMs = payload.intervalBetweenAttemptsMs;
    }
    if (Array.isArray(payload.excludeEnabledCheck)) {
      out.excludeEnabledCheck = payload.excludeEnabledCheck.filter(
        (c: unknown) => typeof c === 'string',
      );
    }
    return out;
  }

  private normalizeConfig(cfg: AutowaitConfig | undefined): Partial<AutowaitProps> {
    if (!cfg) return {};
    const out: Partial<AutowaitProps> = {};
    if (typeof cfg.enabled === 'boolean') out.enabled = cfg.enabled;
    if (typeof cfg.timeoutMs === 'number') out.timeoutMs = cfg.timeoutMs;
    if (typeof cfg.intervalBetweenAttemptsMs === 'number') {
      out.intervalBetweenAttemptsMs = cfg.intervalBetweenAttemptsMs;
    }
    if (Array.isArray(cfg.excludeEnabledCheck)) {
      out.excludeEnabledCheck = [...cfg.excludeEnabledCheck];
    }
    return out;
  }
}
