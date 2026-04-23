import log from '../logger';

// Per-key circuit breaker with closed / open / half-open states.
// Intended for outbound calls where a degraded dependency (rate-limited
// LLM, dead Ollama, flaky hub-node) should stop receiving traffic for
// a cooldown instead of burning tokens/CPU on every new caller.
//
// Keys are caller-defined. For AI providers we key on `<provider>:<model>`
// so a misbehaving model doesn't blackout sibling models on the same
// provider (e.g. Gemini flash rate limit ≠ Gemini pro rate limit).

export type BreakerState = 'closed' | 'open' | 'half_open';

export class CircuitOpenError extends Error {
  public readonly name = 'CircuitOpenError';
  public readonly retryAfterMs: number;
  public readonly key: string;
  constructor(key: string, retryAfterMs: number) {
    super(`Circuit open for '${key}'; retry in ${retryAfterMs}ms`);
    this.key = key;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface BreakerOptions {
  // Consecutive failures in the closed state that trip the breaker open.
  failureThreshold: number;
  // How long the breaker stays fully open before a half-open probe is allowed.
  openDurationMs: number;
}

export interface BreakerSnapshot {
  key: string;
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number;
}

class Breaker {
  public state: BreakerState = 'closed';
  public consecutiveFailures = 0;
  public openedAt = 0;

  constructor(
    public readonly key: string,
    public readonly opts: BreakerOptions,
  ) {}

  // Returns whether the next request should go through. Transitions open ->
  // half_open here if the cooldown has elapsed — caller gets exactly one
  // probe attempt which then drives the closed/open decision.
  public admit(): { allowed: true } | { allowed: false; retryAfterMs: number } {
    if (this.state === 'closed' || this.state === 'half_open') {
      return { allowed: true };
    }
    const elapsed = Date.now() - this.openedAt;
    if (elapsed >= this.opts.openDurationMs) {
      this.state = 'half_open';
      log.info(`[CircuitBreaker] ${this.key} -> half_open (cooldown elapsed)`);
      return { allowed: true };
    }
    return { allowed: false, retryAfterMs: this.opts.openDurationMs - elapsed };
  }

  public recordSuccess(): void {
    const wasRecovering = this.state !== 'closed';
    this.state = 'closed';
    this.consecutiveFailures = 0;
    if (wasRecovering) {
      log.info(`[CircuitBreaker] ${this.key} -> closed (probe succeeded)`);
    }
  }

  public recordFailure(): void {
    if (this.state === 'half_open') {
      // Probe failed -> re-open immediately with a fresh cooldown window.
      this.state = 'open';
      this.openedAt = Date.now();
      log.warn(`[CircuitBreaker] ${this.key} -> open (probe failed)`);
      return;
    }
    this.consecutiveFailures++;
    if (this.state === 'closed' && this.consecutiveFailures >= this.opts.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
      log.warn(
        `[CircuitBreaker] ${this.key} -> open after ${this.consecutiveFailures} consecutive failures (cooldown ${this.opts.openDurationMs}ms)`,
      );
    }
  }

  public snapshot(): BreakerSnapshot {
    return {
      key: this.key,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
    };
  }
}

// Classifier: only transient / server-side failures should trip the breaker.
// Caller-induced failures (400s, parse errors, bad API key) stay uncounted
// so a misconfigured request doesn't take the breaker out for everyone.
export function isTransientFailure(err: any): boolean {
  const status: number | undefined = err?.response?.status ?? err?.status;
  if (typeof status === 'number') {
    if (status >= 500) return true;
    if (status === 429) return true; // rate limit — back off
    return false; // 4xx (auth, bad model, bad request) won't heal itself via retry
  }
  const code = String(err?.code || '').toUpperCase();
  const transientCodes = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EPIPE',
    'ECONNABORTED',
    'ERR_NETWORK',
  ];
  if (transientCodes.includes(code)) return true;

  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) return true;
  if (msg.includes('service unavailable') || msg.includes('unavailable')) return true;
  // SDK errors often embed HTTP status as text (Gemini/Anthropic wrap raw responses).
  if (/\b(5\d{2}|429)\b/.test(msg)) return true;

  return false;
}

class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, Breaker>();
  private readonly defaults: BreakerOptions = {
    failureThreshold: 5,
    openDurationMs: 60_000,
  };

  public async execute<T>(
    key: string,
    task: () => Promise<T>,
    opts?: Partial<BreakerOptions>,
  ): Promise<T> {
    const breaker = this.getOrCreate(key, opts);
    const gate = breaker.admit();
    if (!gate.allowed) {
      throw new CircuitOpenError(key, gate.retryAfterMs);
    }
    try {
      const result = await task();
      breaker.recordSuccess();
      return result;
    } catch (err) {
      if (isTransientFailure(err)) {
        breaker.recordFailure();
      }
      throw err;
    }
  }

  public snapshot(): BreakerSnapshot[] {
    return Array.from(this.breakers.values()).map((b) => b.snapshot());
  }

  private getOrCreate(key: string, opts?: Partial<BreakerOptions>): Breaker {
    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = new Breaker(key, { ...this.defaults, ...opts });
      this.breakers.set(key, breaker);
    }
    return breaker;
  }
}

export const CIRCUIT_BREAKERS = new CircuitBreakerRegistry();
