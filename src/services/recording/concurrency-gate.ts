import { Service } from 'typedi';
import { config } from '../../config';

/**
 * Server-wide cap on simultaneous free-form (mosaic) recordings.
 * Automation/session recordings are tracked separately via VideoPipelineService
 * and are NOT counted against this gate — they bypass it entirely.
 */
@Service()
export class ConcurrencyGate {
  private active = new Set<string>();

  /**
   * An explicit `limit` is fixed. Without one the gate follows
   * `config.maxConcurrentRecordings` as it stands at each admission, not as it
   * stood when the gate was built: the gate is created on first use, and the
   * `maxConcurrentRecordings` option is applied at boot.
   */
  constructor(private readonly fixedLimit?: number) {}

  private get limit(): number {
    return this.fixedLimit ?? config.maxConcurrentRecordings ?? 4;
  }

  /**
   * Atomic admission: either ALL recordingIds are admitted, or none are.
   * Returns true on success; false if admitting them would exceed the limit.
   */
  tryAcquire(recordingIds: string[]): boolean {
    if (this.active.size + recordingIds.length > this.limit) return false;
    for (const id of recordingIds) this.active.add(id);
    return true;
  }

  release(recordingId: string): void {
    this.active.delete(recordingId);
  }

  activeCount(): number {
    return this.active.size;
  }

  getLimit(): number {
    return this.limit;
  }
}
