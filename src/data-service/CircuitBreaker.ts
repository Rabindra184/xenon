import log from '../logger';
import { Service } from 'typedi';

enum BreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface BreakerStats {
  /** CLOSED or OPEN. Half-open is OPEN past `nextRetryTime`, worked out when read. */
  state: BreakerState.CLOSED | BreakerState.OPEN;
  failures: number;
  lastFailureTime?: number;
  nextRetryTime?: number;
  /** When the half-open host's one trial session was allocated; unset while none is out. */
  trialStartedAt?: number;
}

/**
 * A hub's breaker per node host: three failed session creates on a node take
 * its phones out of allocation (`isOpen`, in device-service's getDevices) for
 * RECOVERY_TIMEOUT_MS. After that the host is half-open: the next phone
 * allocated there takes the one trial (`beginTrial`), the host is held back
 * from every other allocation while it runs, and its outcome decides
 * (`recordSuccess` closes, `recordFailure` opens for another cooldown). A
 * trial that hasn't reported back within RECOVERY_TIMEOUT_MS gives way to a
 * new one.
 *
 * Reading changes nothing. Through 2.36 `isOpen` turned an open host
 * half-open when the cooldown had passed, on whichever device listing came
 * first, and a half-open host was offered to every allocation.
 */
@Service()
export class CircuitBreaker {
  private stats: Map<string, BreakerStats> = new Map();
  private logger = log.scope('CircuitBreaker');

  private readonly FAILURE_THRESHOLD = 3;
  private readonly RECOVERY_TIMEOUT_MS = 60000; // 1 minute

  /** CLOSED, OPEN (cooling down) or HALF_OPEN (cooled down: a trial may go, or is out). */
  public stateOf(host: string): BreakerState {
    const nodeStats = this.stats.get(host);
    if (!nodeStats || nodeStats.state === BreakerState.CLOSED) return BreakerState.CLOSED;
    return Date.now() > (nodeStats.nextRetryTime || 0) ? BreakerState.HALF_OPEN : BreakerState.OPEN;
  }

  /**
   * Whether allocation should skip the host's phones now: it is cooling down,
   * or half-open with its trial session out. Reads only.
   * @param host The remote node host URL
   */
  public isOpen(host: string): boolean {
    const state = this.stateOf(host);
    if (state === BreakerState.CLOSED) return false;
    if (state === BreakerState.OPEN) return true;
    return this.trialOut(this.stats.get(host)!);
  }

  /**
   * Called when a phone on `host` has been allocated. On a half-open host
   * with no trial out, makes this session its trial (true) and holds the host
   * back from other allocations until it reports. Otherwise nothing (false).
   */
  public beginTrial(host: string): boolean {
    const nodeStats = this.stats.get(host);
    if (!nodeStats || this.stateOf(host) !== BreakerState.HALF_OPEN) return false;
    if (this.trialOut(nodeStats)) return false;
    nodeStats.trialStartedAt = Date.now();
    this.logger.info(`🔄 Node ${host} is HALF_OPEN. Trying one session there...`);
    return true;
  }

  /**
   * Records a failure for a specific node. On a half-open host it is the
   * trial's outcome: open again for another cooldown.
   */
  public recordFailure(host: string): void {
    const nodeStats = this.stats.get(host) || { state: BreakerState.CLOSED, failures: 0 };
    const halfOpen = this.stateOf(host) === BreakerState.HALF_OPEN;
    nodeStats.failures++;
    nodeStats.lastFailureTime = Date.now();

    if (halfOpen || nodeStats.failures >= this.FAILURE_THRESHOLD) {
      this.logger.error(
        `🚨 Node ${host} tripped! Circuit OPEN. Bypassing for ${this.RECOVERY_TIMEOUT_MS / 1000}s`,
      );
      nodeStats.state = BreakerState.OPEN;
      nodeStats.nextRetryTime = Date.now() + this.RECOVERY_TIMEOUT_MS;
      delete nodeStats.trialStartedAt;
    }

    this.stats.set(host, nodeStats);
  }

  /**
   * Records a success, resetting the circuit.
   */
  public recordSuccess(host: string): void {
    const nodeStats = this.stats.get(host);
    if (nodeStats && nodeStats.state !== BreakerState.CLOSED) {
      this.logger.info(`✅ Node ${host} circuit CLOSED. Recovery successful.`);
    }
    this.stats.set(host, { state: BreakerState.CLOSED, failures: 0 });
  }

  private trialOut(nodeStats: BreakerStats): boolean {
    return (
      nodeStats.trialStartedAt !== undefined &&
      Date.now() - nodeStats.trialStartedAt < this.RECOVERY_TIMEOUT_MS
    );
  }
}
