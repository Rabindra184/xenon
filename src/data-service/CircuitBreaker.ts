import log from '../logger';
import { Service } from 'typedi';

enum BreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface BreakerStats {
  state: BreakerState;
  failures: number;
  lastFailureTime?: number;
  nextRetryTime?: number;
}

/**
 * Principal Circuit Breaker
 * Prevents cascading failures by temporary bypassing unstable remote nodes.
 */
@Service()
export class CircuitBreaker {
  private stats: Map<string, BreakerStats> = new Map();
  private logger = log.scope('CircuitBreaker');

  private readonly FAILURE_THRESHOLD = 3;
  private readonly RECOVERY_TIMEOUT_MS = 60000; // 1 minute

  constructor() {}

  /**
   * Checks if a node is currently healthy enough to receive requests.
   * @param host The remote node host URL
   */
  public isOpen(host: string): boolean {
    const nodeStats = this.stats.get(host);
    if (!nodeStats || nodeStats.state === BreakerState.CLOSED) {
      return false;
    }

    if (nodeStats.state === BreakerState.OPEN) {
      if (Date.now() > (nodeStats.nextRetryTime || 0)) {
        this.logger.info(`🔄 Node ${host} entering HALF_OPEN state. Attempting recovery...`);
        nodeStats.state = BreakerState.HALF_OPEN;
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Records a failure for a specific node.
   */
  public recordFailure(host: string): void {
    const nodeStats = this.stats.get(host) || { state: BreakerState.CLOSED, failures: 0 };
    nodeStats.failures++;
    nodeStats.lastFailureTime = Date.now();

    if (nodeStats.failures >= this.FAILURE_THRESHOLD) {
      this.logger.error(
        `🚨 Node ${host} tripped! Circuit OPEN. Bypassing for ${this.RECOVERY_TIMEOUT_MS / 1000}s`,
      );
      nodeStats.state = BreakerState.OPEN;
      nodeStats.nextRetryTime = Date.now() + this.RECOVERY_TIMEOUT_MS;
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
}
